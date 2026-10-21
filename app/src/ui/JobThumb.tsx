import { useMemo } from 'react';
import type { Input, Schemas } from '../api/client';
import { colors } from '../engine/colors';
import { JOB_THUMB_ASPECT, layoutThumb } from '../project/summary';
import { MATERIAL, thumbPath, unpackThumb, type Thumb } from '../project/thumb';

/**
 * A thumb from a project's summary: its shapes in the colors the Parts tab gives each part, on
 * the material when there is one; `plain` draws every part alike in the ink, as project cards do.
 */
export function ThumbDrawing({
  thumb,
  className,
  plain = false,
}: {
  thumb: Thumb;
  className?: string;
  plain?: boolean;
}) {
  const shapes = useMemo(() => unpackThumb(thumb), [thumb]);
  return (
    <svg
      className={className}
      viewBox={`-4 -4 ${thumb.width + 8} ${thumb.height + 8}`}
      aria-hidden="true"
    >
      {shapes?.map(({ fill, rings }, i) => (
        <path
          key={i}
          d={thumbPath(rings)}
          fillRule="evenodd"
          fill={
            fill === MATERIAL ? 'var(--sheet)' : plain ? 'var(--ink)' : colors[fill % colors.length]
          }
          {...(plain && fill !== MATERIAL && { fillOpacity: 0.3 })}
          {...((plain || fill === MATERIAL) && {
            stroke: 'var(--ink)',
            strokeWidth: 0.8,
            vectorEffect: 'non-scaling-stroke',
          })}
        />
      ))}
    </svg>
  );
}

/**
 * A job at a glance: the first sheets of its layout, as many as its thumb holds, with the number
 * of further sheets in a badge, in a frame of their shape, from square to as wide as a thumb
 * gets; an empty frame for a job without one.
 */
export function JobThumb({ thumb, more = 0 }: { thumb?: Thumb; more?: number }) {
  if (!thumb) return <span className="job-thumb" />;
  const aspect = Math.min(JOB_THUMB_ASPECT, Math.max(1, thumb.width / thumb.height));
  return (
    <span className="job-thumb" style={{ aspectRatio: aspect }}>
      <ThumbDrawing thumb={thumb} />
      {more > 0 && (
        <span className="thumb-badge" aria-label={`and ${more} more sheets`}>
          +{more}
        </span>
      )}
    </span>
  );
}

/** A running job's best layout so far, at a glance. `order` gives each part's color. */
export function LiveJobThumb({
  input,
  best,
  order,
}: {
  input: Input;
  best?: Schemas['Snapshot'];
  order: Map<string, number>;
}) {
  const drawn = useMemo(
    () => (best?.solution.layouts.length ? layoutThumb(input, best, order) : undefined),
    [input, best, order],
  );
  return <JobThumb thumb={drawn?.thumb} more={drawn?.more} />;
}
