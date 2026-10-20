import { memo, type MouseEvent } from 'react';
import { colors } from '../../engine/colors';
import { flattenContour, outline } from '../../engine/geometry/contour';
import { bounds } from '../../engine/geometry/normalize';
import type { WorldPart } from '../../engine/geometry/world';
import type { Job, Ring, Sheet } from '../../engine/model';
import type { Box } from '../../project/layout';
import type { DrawnLayout } from '../../project/solution';
import { ringsPath } from '../Canvas';

export const placementKey = (part: { partId: string; copyIndex: number }) =>
  `${part.partId}:${part.copyIndex}`;

/** The material a layout covers: its sheet's bounds, or the strip up to `length`. */
const materialBox = (job: Job, layout: DrawnLayout, length: number): Box =>
  layout.sheet
    ? (bounds(outline(layout.sheet.shape).outer) as Box)
    : [0, 0, length, job.settings.materialWidthMm];

/**
 * Where several layouts are drawn: in order, in rows from left to right and top to bottom, as
 * parts are on the Parts canvas. The number per row fits them best into a view of `aspect`,
 * width over height. Each layout is moved by its offset; `boxes` are the moved materials, and
 * `extent` holds them all.
 */
export function arrangeLayouts(
  job: Job,
  layouts: DrawnLayout[],
  lengths: number[],
  aspect: number,
) {
  const own = layouts.map((layout, i) => materialBox(job, layout, lengths[i]));
  if (!own.length) return { offsets: [], boxes: [], extent: [0, 0, 100, 100] as Box };
  const gap = Math.max(...own.map((box) => Math.max(box[2] - box[0], box[3] - box[1])), 1) * 0.12;
  let best: { offsets: [number, number][]; boxes: Box[]; extent: Box; size: number } | undefined;
  for (let columns = 1; columns <= own.length; columns++) {
    const offsets: [number, number][] = [];
    const boxes: Box[] = [];
    let top = 0;
    for (let start = 0; start < own.length; start += columns) {
      const row = own.slice(start, start + columns);
      const height = Math.max(...row.map((box) => box[3] - box[1]));
      let x = 0;
      for (const box of row) {
        // Rows hang from their top, and grow downward.
        const offset: [number, number] = [x - box[0], top - box[3]];
        offsets.push(offset);
        boxes.push([
          box[0] + offset[0],
          box[1] + offset[1],
          box[2] + offset[0],
          box[3] + offset[1],
        ]);
        x += box[2] - box[0] + gap;
      }
      top -= height + gap;
    }
    const extent: Box = [
      Math.min(...boxes.map((box) => box[0])),
      Math.min(...boxes.map((box) => box[1])),
      Math.max(...boxes.map((box) => box[2])),
      Math.max(...boxes.map((box) => box[3])),
    ];
    // The height the view must show: the larger of the two, the width taken at the view's aspect.
    const size = Math.max((extent[2] - extent[0]) / aspect, extent[3] - extent[1]);
    if (!best || size < best.size) best = { offsets, boxes, extent, size };
  }
  const { offsets, boxes, extent } = best!;
  return { offsets, boxes, extent };
}

/** A sheet: its outline and holes, the regions parts avoid, and where it is cut. */
function SheetMaterial({ sheet, upp }: { sheet: Sheet; upp: number }) {
  const { outer, holes } = outline(sheet.shape);
  const [, y0, , y1] = bounds(outer);
  return (
    <>
      <path
        d={ringsPath([outer, ...holes])}
        fillRule="evenodd"
        fill="var(--sheet)"
        className="sheet-edge"
        strokeWidth={2 * upp}
      />
      {sheet.defects.map((defect, i) => (
        <path
          key={i}
          d={ringsPath([flattenContour(defect, upp / 4)])}
          className="defect"
          strokeWidth={upp}
        />
      ))}
      {sheet.cutX !== null && (
        <path
          d={`M${sheet.cutX} ${-y1 - 8 * upp}V${-y0 + 8 * upp}`}
          className="accent-line"
          strokeWidth={1.2 * upp}
          strokeDasharray={`${5 * upp} ${4 * upp}`}
        />
      )}
    </>
  );
}

/**
 * A layout on its sheet or strip: the parts as placed, optional overlaps in red, and the cut.
 * With `highlight`, the copies of that part type stand out and the others fade. `offset` moves
 * it, to stand among other layouts.
 */
// Memoized: a live job redraws it only when the layout or the zoom changes.
export const LayoutDrawing = memo(function LayoutDrawing({
  job,
  world,
  sheet,
  usedLength,
  upp,
  offset = [0, 0],
  label,
  overlaps = [],
  highlight,
  hovered,
  onPick,
  onHover,
}: {
  job: Job;
  world: WorldPart[];
  /** The sheet the layout lies on; without one, the strip. */
  sheet?: Sheet;
  /** How much of the strip is used. */
  usedLength: number;
  upp: number;
  offset?: [number, number];
  /** A name shown above the material. */
  label?: string;
  overlaps?: Ring[][];
  highlight?: string;
  hovered?: string;
  onPick?: (part: WorldPart) => void;
  onHover?: (part: WorldPart | undefined, event?: MouseEvent<SVGPathElement>) => void;
}) {
  const width = job.settings.materialWidthMm;
  const index = new Map(job.parts.map((part, i) => [part.id, i]));
  const reach = usedLength + width * 0.25;
  const top = sheet ? bounds(outline(sheet.shape).outer)[3] : width;
  const left = sheet ? bounds(outline(sheet.shape).outer)[0] : 0;
  return (
    <g transform={`translate(${offset[0]} ${-offset[1]})`}>
      {sheet ? (
        <SheetMaterial sheet={sheet} upp={upp} />
      ) : (
        <>
          <rect x={0} y={-width} width={usedLength} height={width} fill="var(--sheet)" />
          <path
            d={`M${reach} ${-width}H0V0H${reach}`}
            className="sheet-edge"
            strokeWidth={2 * upp}
            fill="none"
          />
          <path
            d={`M${usedLength} ${-width - 8 * upp}V${8 * upp}`}
            className="accent-line"
            strokeWidth={1.2 * upp}
            strokeDasharray={`${5 * upp} ${4 * upp}`}
          />
        </>
      )}
      {label && (
        <text className="sheet-label" x={left} y={-top - 8 * upp} fontSize={12 * upp}>
          {label}
        </text>
      )}
      {world.map((part) => {
        const key = placementKey(part);
        const marked = highlight === part.partId;
        const faded = !!highlight && !marked;
        const active = marked || hovered === key;
        return (
          <path
            key={key}
            d={ringsPath([part.outer, ...part.holes])}
            fillRule="evenodd"
            fill={colors[(index.get(part.partId) ?? 0) % colors.length]}
            fillOpacity={faded ? 0.25 : 1}
            className={active ? 'outline selected' : faded ? 'outline faded' : 'outline'}
            strokeWidth={(active ? 2.2 : 0.8) * upp}
            onClick={onPick && (() => onPick(part))}
            onMouseMove={onHover && ((event) => onHover(part, event))}
            onMouseLeave={onHover && (() => onHover(undefined))}
            style={onPick ? { cursor: 'pointer' } : undefined}
          />
        );
      })}
      {overlaps.map((polygon, i) => (
        <path
          key={i}
          d={ringsPath(polygon)}
          fillRule="evenodd"
          className="overlap"
          pointerEvents="none"
        />
      ))}
    </g>
  );
});
