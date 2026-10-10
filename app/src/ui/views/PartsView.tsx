import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { bounds } from '../../engine/geometry/normalize';
import { netArea } from '../../engine/geometry/validate';
import { colors } from '../../engine/colors';
import { LIMITS, type Part } from '../../engine/model';
import { arrangeParts } from '../../project/layout';
import { copyCount } from '../../project/model';
import { Canvas, ringsPath } from '../Canvas';
import { CloudRow } from '../CloudTag';
import { useStudio } from '../context';
import { formatArea, formatLength } from '../format';
import { ImportMenu } from '../ImportMenu';
import { PatternSwatch, RotationPatterns, patternFill } from '../patterns';
import {
  ROTATION_LABELS,
  describeAngles,
  parseAngles,
  rotationKind,
  rotationRule,
  type RotationKind,
} from '../rotations';
import { RunBar } from '../RunBar';

type Menu = { partId: string; x: number; y: number };

export function PartsView() {
  const { project, edit, unit } = useStudio();
  const [selected, setSelected] = useState<string>();
  const [focus, setFocus] = useState<{ id: string; serial: number }>();
  const [menu, setMenu] = useState<Menu>();
  const rows = useRef(new Map<string, HTMLElement>());
  const arrangement = useMemo(() => arrangeParts(project.parts), [project.parts]);
  const chosen = project.parts.find((part) => part.id === selected);

  const updatePart = (id: string, change: Partial<Part>, key?: string) =>
    edit(
      (current) => ({
        ...current,
        parts: current.parts.map((part) => (part.id === id ? { ...part, ...change } : part)),
      }),
      key,
    );
  const removePart = (id: string) => {
    edit((current) => ({ ...current, parts: current.parts.filter((part) => part.id !== id) }));
    setSelected(undefined);
    setMenu(undefined);
  };
  const setQuantity = (part: Part, quantity: number) => {
    if (!Number.isInteger(quantity)) return;
    updatePart(
      part.id,
      { quantity: Math.max(0, Math.min(LIMITS.copies, quantity)) },
      `quantity:${part.id}`,
    );
  };

  // Selecting in the list zooms the canvas; selecting on the canvas scrolls the list.
  const selectFromList = (id: string) => {
    setSelected(id === selected ? undefined : id);
    setFocus((previous) => ({ id, serial: (previous?.serial ?? 0) + 1 }));
    setMenu(undefined);
  };
  const selectFromCanvas = (id: string) => {
    setSelected(id);
    setMenu(undefined);
  };
  useEffect(() => {
    if (selected)
      rows.current.get(selected)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (!chosen || document.querySelector('dialog[open]')) return;
      if (target.closest('input, select, textarea, [contenteditable]')) return;
      if (event.key === '+' || event.key === '=') setQuantity(chosen, chosen.quantity + 1);
      else if (event.key === '-' || event.key === '_') setQuantity(chosen, chosen.quantity - 1);
      else if (event.key === 'Delete' || event.key === 'Backspace') removePart(chosen.id);
      else if (event.key === 'Escape') setSelected(undefined);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const copies = copyCount(project.parts);
  const focusBox = focus && arrangement.boxes.get(focus.id);
  return (
    <div className="view">
      <section className="list-panel" aria-label="Parts">
        <div className="list-head">
          <span className="label">
            {project.parts.length} part {project.parts.length === 1 ? 'type' : 'types'} · {copies}{' '}
            {copies === 1 ? 'copy' : 'copies'}
          </span>
          <ImportMenu kind="parts" />
        </div>
        <div className="list-scroll">
          {!project.parts.length && <EmptyParts />}
          {project.parts.map((part, index) => (
            <div
              key={part.id}
              ref={(element) => {
                if (element) rows.current.set(part.id, element);
                else rows.current.delete(part.id);
              }}
            >
              <PartRow
                part={part}
                index={index}
                selected={part.id === selected}
                onSelect={() => selectFromList(part.id)}
              />
              {part.id === selected && (
                <PartProperties
                  part={part}
                  onChange={(change, key) => updatePart(part.id, change, key)}
                  onQuantity={(quantity) => setQuantity(part, quantity)}
                  onRemove={() => removePart(part.id)}
                />
              )}
            </div>
          ))}
        </div>
        <RunBar />
      </section>
      <Canvas
        label="Parts at true scale"
        extent={arrangement.extent}
        focus={focusBox && { box: focusBox, key: `${focus.id}:${focus.serial}` }}
        onBackgroundClick={() => {
          setSelected(undefined);
          setMenu(undefined);
        }}
        overlay={
          <>
            <Legend />
            {menu && (
              <PartMenu
                menu={menu}
                part={project.parts.find((part) => part.id === menu.partId)}
                onClose={() => setMenu(undefined)}
                onQuantity={setQuantity}
                onRotation={(part, kind) => updatePart(part.id, { rotations: rotationRule(kind) })}
                onProperties={(part) => {
                  setSelected(part.id);
                  setMenu(undefined);
                }}
                onRemove={removePart}
              />
            )}
          </>
        }
      >
        {({ upp }) => (
          <PartsDrawing
            parts={project.parts}
            arrangement={arrangement}
            upp={upp}
            selected={selected}
            unit={unit}
            onSelect={selectFromCanvas}
            onMenu={(partId, event) => {
              event.preventDefault();
              const rect = (
                event.currentTarget.ownerSVGElement!.parentElement as HTMLElement
              ).getBoundingClientRect();
              setSelected(partId);
              setMenu({ partId, x: event.clientX - rect.left, y: event.clientY - rect.top });
            }}
          />
        )}
      </Canvas>
    </div>
  );
}

function EmptyParts() {
  const { openImport } = useStudio();
  return (
    <div className="empty">
      <p>No parts yet.</p>
      <p className="muted">
        Import DXF, SVG or sparrow JSON files, or take parts from another project.
      </p>
      <div className="row-actions">
        <button onClick={() => openImport('parts', 'files')}>Import files…</button>
        <button onClick={() => openImport('parts', 'project')}>From another project…</button>
      </div>
    </div>
  );
}

function PartThumb({ part, index }: { part: Part; index: number }) {
  const b = bounds(part.outer);
  const size = Math.max(b[2] - b[0], b[3] - b[1]);
  const pad = size * 0.08;
  return (
    <svg
      className="thumb"
      viewBox={`${b[0] - pad} ${-b[3] - pad} ${size + 2 * pad} ${size + 2 * pad}`}
      aria-hidden="true"
    >
      <path
        d={ringsPath([part.outer, ...part.holes])}
        fillRule="evenodd"
        fill={colors[index % colors.length]}
        fillOpacity={0.55}
        stroke="var(--ink)"
        strokeWidth={size * 0.03}
      />
    </svg>
  );
}

function PartRow({
  part,
  index,
  selected,
  onSelect,
}: {
  part: Part;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { unit } = useStudio();
  const b = bounds(part.outer);
  return (
    <button
      className={selected ? 'row selected' : 'row'}
      aria-expanded={selected}
      onClick={onSelect}
    >
      <PartThumb part={part} index={index} />
      <span className="row-text">
        <span>{part.name}</span>
        <span className="muted mono">
          {formatLength(b[2] - b[0], unit)} × {formatLength(b[3] - b[1], unit)} {unit} ·{' '}
          {ROTATION_LABELS[rotationKind(part.rotations)]}
        </span>
      </span>
      <span className={part.quantity ? 'quantity' : 'quantity zero'}>×{part.quantity}</span>
    </button>
  );
}

function PartProperties({
  part,
  onChange,
  onQuantity,
  onRemove,
}: {
  part: Part;
  onChange: (change: Partial<Part>, key?: string) => void;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const { unit } = useStudio();
  const kind = rotationKind(part.rotations);
  const [angles, setAngles] = useState(describeAngles(part.rotations).replace(/°/g, ''));
  const anglesValid = !!parseAngles(angles);
  const b = bounds(part.outer);
  return (
    <div className="properties">
      <label className="field">
        Name
        <input
          value={part.name}
          onChange={(event) => onChange({ name: event.target.value }, `name:${part.id}`)}
        />
      </label>
      <div className="field">
        Quantity
        <div className="stepper">
          <button
            className="small"
            aria-label="Fewer"
            onClick={() => onQuantity(part.quantity - 1)}
          >
            −
          </button>
          <input
            className="mono quantity-input"
            type="number"
            min={0}
            max={LIMITS.copies}
            aria-label={`Quantity of ${part.name}`}
            value={part.quantity}
            onChange={(event) => onQuantity(event.target.valueAsNumber)}
          />
          <button className="small" aria-label="More" onClick={() => onQuantity(part.quantity + 1)}>
            +
          </button>
        </div>
      </div>
      <label className="field">
        Rotations
        <select
          value={kind}
          onChange={(event) => {
            const next = event.target.value as RotationKind;
            if (next === 'custom')
              onChange({
                rotations: parseAngles(angles) ?? { kind: 'discrete', degrees: [0, 45] },
              });
            else onChange({ rotations: rotationRule(next) });
          }}
        >
          {(Object.keys(ROTATION_LABELS) as RotationKind[]).map((option) => (
            <option key={option} value={option}>
              {ROTATION_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      {kind === 'custom' && (
        <label className="field">
          Angles, degrees
          <input
            className="mono"
            value={angles}
            aria-invalid={!anglesValid}
            onChange={(event) => {
              setAngles(event.target.value);
              const rule = parseAngles(event.target.value);
              if (rule) onChange({ rotations: rule }, `angles:${part.id}`);
            }}
          />
          {!anglesValid && (
            <span className="field-error">Enter one or more angles, separated by commas.</span>
          )}
        </label>
      )}
      <CloudRow>Allow reflection</CloudRow>
      <CloudRow>Nest parts inside its holes</CloudRow>
      <dl className="facts">
        <dt>Shape</dt>
        <dd>
          {formatLength(b[2] - b[0], unit)} × {formatLength(b[3] - b[1], unit)} {unit}
        </dd>
        <dt>Area</dt>
        <dd>{formatArea(netArea(part), unit)}</dd>
        <dt>Holes</dt>
        <dd>{part.holes.length || 'none'}</dd>
        <dt>Source</dt>
        <dd>{part.source.fileName ?? part.source.format.toUpperCase()}</dd>
      </dl>
      <button className="small danger" onClick={onRemove}>
        Remove part
      </button>
    </div>
  );
}

function PartsDrawing({
  parts,
  arrangement,
  upp,
  selected,
  unit,
  onSelect,
  onMenu,
}: {
  parts: Part[];
  arrangement: ReturnType<typeof arrangeParts>;
  upp: number;
  selected?: string;
  unit: string;
  onSelect: (id: string) => void;
  onMenu: (id: string, event: React.MouseEvent<SVGGElement>) => void;
}) {
  const id = useId().replace(/:/g, '');
  const stack = 6 * upp;
  const badge = 11 * upp;
  return (
    <>
      <RotationPatterns id={id} upp={upp} />
      {parts.map((part, index) => {
        const [dx, dy] = arrangement.offsets.get(part.id)!;
        const box = arrangement.boxes.get(part.id)!;
        const isSelected = part.id === selected;
        const d = ringsPath([part.outer, ...part.holes], dx, dy);
        return (
          <g
            key={part.id}
            className="part-shape"
            onClick={() => onSelect(part.id)}
            onContextMenu={(event) => onMenu(part.id, event)}
          >
            {part.quantity >= 3 && (
              <path
                d={d}
                transform={`translate(${2 * stack} ${-2 * stack})`}
                className="stack"
                strokeWidth={upp}
                fillRule="evenodd"
              />
            )}
            {part.quantity >= 2 && (
              <path
                d={d}
                transform={`translate(${stack} ${-stack})`}
                className="stack"
                strokeWidth={upp}
                fillRule="evenodd"
              />
            )}
            <path
              d={d}
              fillRule="evenodd"
              fill={colors[index % colors.length]}
              fillOpacity={part.quantity ? 0.45 : 0.15}
              className={isSelected ? 'outline selected' : 'outline'}
              strokeWidth={(isSelected ? 2.5 : 1.2) * upp}
            />
            <path
              d={d}
              fillRule="evenodd"
              fill={patternFill(id, rotationKind(part.rotations))}
              pointerEvents="none"
            />
            <g transform={`translate(${box[2] + badge * 0.4} ${-box[3] - badge * 0.4})`}>
              <circle r={badge} className="badge" />
              <text className="badge-text" fontSize={10 * upp} textAnchor="middle" dy={3.5 * upp}>
                ×{part.quantity}
              </text>
            </g>
            {/* A name only where it fits under its part at this zoom. */}
            {(box[2] - box[0]) / upp > part.name.length * 7 && (
              <text
                className="part-label"
                x={(box[0] + box[2]) / 2}
                y={-box[1] + 16 * upp}
                fontSize={12 * upp}
                textAnchor="middle"
              >
                {part.name}
              </text>
            )}
          </g>
        );
      })}
      {!parts.length && (
        <text x={50} y={-50} fontSize={14 * upp} textAnchor="middle" className="muted-text">
          Imported parts appear here at true scale ({unit}).
        </text>
      )}
    </>
  );
}

function Legend() {
  return (
    <div className="legend" aria-label="Legend">
      {(['fixed', 'half', 'quarter', 'free', 'custom'] as RotationKind[]).map((kind) => (
        <span key={kind}>
          <PatternSwatch kind={kind} />
          {ROTATION_LABELS[kind]}
        </span>
      ))}
      <span>
        <span className="legend-badge">×3</span>Quantity
      </span>
    </div>
  );
}

function PartMenu({
  menu,
  part,
  onClose,
  onQuantity,
  onRotation,
  onProperties,
  onRemove,
}: {
  menu: Menu;
  part?: Part;
  onClose: () => void;
  onQuantity: (part: Part, quantity: number) => void;
  onRotation: (part: Part, kind: Exclude<RotationKind, 'custom'>) => void;
  onProperties: (part: Part) => void;
  onRemove: (id: string) => void;
}) {
  if (!part) return null;
  const kind = rotationKind(part.rotations);
  return (
    <div
      className="context-menu"
      role="menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <strong>{part.name}</strong>
      <div className="stepper">
        <span className="muted grow">Quantity</span>
        <button
          className="small"
          aria-label="Fewer"
          onClick={() => onQuantity(part, part.quantity - 1)}
        >
          −
        </button>
        <span className="mono quantity">{part.quantity}</span>
        <button
          className="small"
          aria-label="More"
          onClick={() => onQuantity(part, part.quantity + 1)}
        >
          +
        </button>
      </div>
      <label className="field">
        Rotations
        <select
          value={kind}
          onChange={(event) =>
            onRotation(part, event.target.value as Exclude<RotationKind, 'custom'>)
          }
        >
          {(['fixed', 'half', 'quarter', 'free'] as const).map((option) => (
            <option key={option} value={option}>
              {ROTATION_LABELS[option]}
            </option>
          ))}
          {kind === 'custom' && (
            <option value="custom" disabled>
              {ROTATION_LABELS.custom}
            </option>
          )}
        </select>
      </label>
      <button className="menu-item" role="menuitem" onClick={() => onProperties(part)}>
        Show properties
      </button>
      <button className="menu-item danger" role="menuitem" onClick={() => onRemove(part.id)}>
        Remove part
      </button>
      <button className="menu-item" role="menuitem" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
