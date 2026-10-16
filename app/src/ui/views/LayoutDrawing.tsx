import { memo, type MouseEvent } from 'react';
import { colors } from '../../engine/colors';
import type { WorldPart } from '../../engine/geometry/validate';
import type { Job, Ring } from '../../engine/model';
import { ringsPath } from '../Canvas';

export const placementKey = (part: { partId: string; copyIndex: number }) =>
  `${part.partId}:${part.copyIndex}`;

/**
 * A layout on its strip: the parts as placed, optional overlaps in red, and the used length.
 * With `highlight`, the copies of that part type stand out and the others fade.
 */
// Memoized: the Live tab redraws it only when the layout or the zoom changes.
export const LayoutDrawing = memo(function LayoutDrawing({
  job,
  world,
  usedLength,
  upp,
  overlaps = [],
  highlight,
  hovered,
  onPick,
  onHover,
}: {
  job: Job;
  world: WorldPart[];
  usedLength: number;
  upp: number;
  overlaps?: Ring[][];
  highlight?: string;
  hovered?: string;
  onPick?: (part: WorldPart) => void;
  onHover?: (part: WorldPart | undefined, event?: MouseEvent<SVGPathElement>) => void;
}) {
  const width = job.settings.materialWidthMm;
  const index = new Map(job.parts.map((part, i) => [part.id, i]));
  const reach = usedLength + width * 0.25;
  return (
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
    </>
  );
});
