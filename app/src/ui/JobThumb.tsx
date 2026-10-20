import { useMemo } from 'react';
import { colors } from '../engine/colors';
import { outline } from '../engine/geometry/contour';
import { bounds } from '../engine/geometry/normalize';
import { worldParts } from '../engine/geometry/world';
import { jobInput, type ProjectJob } from '../project/model';
import { drawable } from '../project/solution';
import { ringsPath } from './Canvas';
import type { Schemas } from '../api/client';

const W = 96;
const H = 60;

/**
 * A job at a glance: the first sheet of its layout, or of the best so far while it runs, with the
 * number of further sheets in a badge.
 */
export function JobThumb({
  job,
  live,
  order,
}: {
  job: ProjectJob;
  /** The best layout so far of a running job. */
  live?: Schemas['Snapshot'];
  /** Where each part is in the project's list, for the color the Parts tab gives it. */
  order: Map<string, number>;
}) {
  const best = job.stage === 'ended' ? job.document.outcome : live;
  const input = jobInput(job);
  const first = useMemo(() => {
    if (!best?.solution.layouts.length) return undefined;
    const { job: drawn, layouts } = drawable(
      input,
      { layouts: best.solution.layouts.slice(0, 1) },
      undefined,
      best.stats,
    );
    const layout = layouts[0];
    const material = layout.sheet
      ? bounds(outline(layout.sheet.shape).outer)
      : [0, 0, layout.result.usedLengthMm, drawn.settings.materialWidthMm];
    return {
      material,
      sheet: layout.sheet && outline(layout.sheet.shape),
      parts: worldParts(drawn, layout.result).map((part) => ({
        ...part,
        // A part the project no longer has takes its place in the job instead.
        color:
          colors[
            (order.get(part.partId) ?? input.parts.findIndex((p) => p.id === part.partId)) %
              colors.length
          ],
      })),
    };
  }, [input, best, order]);
  const more = (best?.solution.layouts.length ?? 1) - 1;
  if (!first) return <svg className="job-thumb" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" />;
  const [x0, y0, x1, y1] = first.material;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.04;
  const sheetRings = first.sheet
    ? [first.sheet.outer, ...first.sheet.holes]
    : [
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ] as [number, number][],
      ];
  return (
    <span className="job-thumb">
      <svg
        viewBox={`${x0 - pad} ${-y1 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`}
        aria-hidden="true"
      >
        <path
          d={ringsPath(sheetRings)}
          fillRule="evenodd"
          fill="var(--sheet)"
          stroke="var(--ink)"
          strokeWidth={0.8}
          vectorEffect="non-scaling-stroke"
        />
        {first.parts.map((part) => (
          <path
            key={`${part.partId}:${part.copyIndex}`}
            d={ringsPath([part.outer, ...part.holes])}
            fillRule="evenodd"
            fill={part.color}
          />
        ))}
      </svg>
      {more > 0 && (
        <span className="thumb-badge" aria-label={`and ${more} more sheets`}>
          +{more}
        </span>
      )}
    </span>
  );
}
