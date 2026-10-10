import { colors } from '../../engine/colors';
import type { WorldPart } from '../../engine/geometry/validate';
import type { Job, Ring } from '../../engine/model';
import { ringsPath } from '../Canvas';

export const placementKey = (part: { partId: string; copyIndex: number }) =>
  `${part.partId}:${part.copyIndex}`;

/** A layout on its strip: the parts as placed, optional overlaps in red, and the used length. */
export function LayoutDrawing({
  job,
  world,
  usedLength,
  upp,
  overlaps = [],
  selected,
  onSelect,
}: {
  job: Job;
  world: WorldPart[];
  usedLength: number;
  upp: number;
  overlaps?: Ring[][];
  selected?: string;
  onSelect?: (key: string) => void;
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
        const isSelected = key === selected;
        return (
          <path
            key={key}
            d={ringsPath([part.outer, ...part.holes])}
            fillRule="evenodd"
            fill={colors[(index.get(part.partId) ?? 0) % colors.length]}
            fillOpacity={0.7}
            className={isSelected ? 'outline selected' : 'outline'}
            strokeWidth={(isSelected ? 2.5 : 0.8) * upp}
            onClick={onSelect && (() => onSelect(key))}
            style={onSelect ? { cursor: 'pointer' } : undefined}
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
}
