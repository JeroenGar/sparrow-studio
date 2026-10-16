import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { bounds } from '../../engine/geometry/normalize';
import { netArea } from '../../engine/geometry/world';
import { colors, shades } from '../../engine/colors';
import { LIMITS, type Part, type RotationRule } from '../../engine/model';
import type { DisplayUnit } from '../../engine/units';
import { arrangeParts } from '../../project/layout';
import {
  copyCount,
  differsFromDefaults,
  ruleKey,
  resolvedParts,
  setDefaultRotations,
  setPartRotations,
} from '../../project/model';
import { Canvas, ringsPath } from '../Canvas';
import { ProRow } from '../ProTag';
import { useStudio } from '../context';
import { formatArea, formatLength } from '../format';
import { ImportMenu } from '../ImportMenu';
import { GrainIcon, grainPaths } from '../grain';
import {
  ROTATION_LABELS,
  describeAngles,
  parseAngles,
  rotationKind,
  rotationRule,
  type RotationKind,
} from '../rotations';
import { RunBar } from '../RunBar';
import { outline } from '../../engine/geometry/contour';

type Menu = { partId: string; x: number; y: number };

export function PartsView() {
  const { project, edit, unit } = useStudio();
  const [selected, setSelected] = useState<string>();
  const [focus, setFocus] = useState<{ id: string; serial: number }>();
  const [menu, setMenu] = useState<Menu>();
  const rows = useRef(new Map<string, HTMLElement>());
  // Draw and list parts with their effective settings; ask the stored part whether a setting is its own.
  const parts = useMemo(() => resolvedParts(project), [project]);
  const differs = (id: string) => {
    const part = project.parts.find((stored) => stored.id === id);
    return !!part && differsFromDefaults(part);
  };
  const arrangement = useMemo(() => arrangeParts(parts), [parts]);
  const chosen = parts.find((part) => part.id === selected);

  const updatePart = (id: string, change: { name?: string; quantity?: number }, key?: string) =>
    edit(
      (current) => ({
        ...current,
        parts: current.parts.map((part) => (part.id === id ? { ...part, ...change } : part)),
      }),
      key,
    );
  const setRotations = (id: string, rule: RotationRule | 'default', key?: string) =>
    edit((current) => setPartRotations(current, [id], rule), key);
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
          {parts.map((part, index) => (
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
                differs={differs(part.id)}
                selected={part.id === selected}
                onSelect={() => selectFromList(part.id)}
              />
              {part.id === selected && (
                <PartProperties
                  part={part}
                  differs={differs(part.id)}
                  defaultRule={project.partDefaults.rotations}
                  onRotations={(rule, key) => setRotations(part.id, rule, key)}
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
                part={parts.find((part) => part.id === menu.partId)}
                onClose={() => setMenu(undefined)}
                onQuantity={setQuantity}
                differs={menu && differs(menu.partId)}
                defaultRule={project.partDefaults.rotations}
                onRotation={(part, rule) => setRotations(part.id, rule)}
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
            parts={parts}
            differs={differs}
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
      <DefaultsPanel />
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

export function PartThumb({ part, index }: { part: Part; index: number }) {
  const b = bounds(outline(part.shape).outer);
  const size = Math.max(b[2] - b[0], b[3] - b[1]);
  const pad = size * 0.08;
  return (
    <svg
      className="thumb"
      viewBox={`${b[0] - pad} ${-b[3] - pad} ${size + 2 * pad} ${size + 2 * pad}`}
      aria-hidden="true"
    >
      <path
        d={ringsPath([outline(part.shape).outer, ...outline(part.shape).holes])}
        fillRule="evenodd"
        fill={colors[index % colors.length]}
        stroke="var(--ink)"
        strokeWidth={size * 0.03}
      />
    </svg>
  );
}

function PartRow({
  part,
  index,
  differs,
  selected,
  onSelect,
}: {
  part: Part;
  index: number;
  differs: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { unit } = useStudio();
  const b = bounds(outline(part.shape).outer);
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
      {differs && <i className="differs-dot" title="Differs from the part defaults" />}
      <span className={part.quantity ? 'quantity' : 'quantity zero'}>×{part.quantity}</span>
    </button>
  );
}

function PartProperties({
  part,
  differs,
  defaultRule,
  onRotations,
  onChange,
  onQuantity,
  onRemove,
}: {
  part: Part;
  differs: boolean;
  defaultRule: RotationRule;
  onRotations: (rule: RotationRule | 'default', key?: string) => void;
  onChange: (change: Partial<Part>, key?: string) => void;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const { unit } = useStudio();
  const b = bounds(outline(part.shape).outer);
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
      <RotationField
        rule={part.rotations}
        defaultRule={defaultRule}
        usesDefault={!differs}
        onChange={(rule, key) => onRotations(rule, key && `${key}:${part.id}`)}
      />
      {differs && (
        <div className="differs-note">
          <i className="differs-dot" aria-hidden="true" />
          <span className="grow">Differs from the part defaults.</span>
          <button className="small" onClick={() => onRotations('default')}>
            Use the defaults
          </button>
        </div>
      )}
      <ProRow>Allow reflection</ProRow>
      <ProRow>Nest parts inside its holes</ProRow>
      <dl className="facts">
        <dt>Shape</dt>
        <dd>
          {formatLength(b[2] - b[0], unit)} × {formatLength(b[3] - b[1], unit)} {unit}
        </dd>
        <dt>Area</dt>
        <dd>{formatArea(netArea(part), unit)}</dd>
        <dt>Holes</dt>
        <dd>{part.shape.holes?.length || 'none'}</dd>
        <dt>Source</dt>
        <dd>{part.source.fileName ?? part.source.format.toUpperCase()}</dd>
      </dl>
      <button className="small danger" onClick={onRemove}>
        Remove part
      </button>
    </div>
  );
}

/**
 * Choose a rotation rule. With `defaultRule`, the first choice is to follow the part defaults;
 * picking any other rule gives the part its own.
 */
function RotationField({
  rule,
  defaultRule,
  usesDefault = false,
  onChange,
}: {
  rule: RotationRule;
  defaultRule?: RotationRule;
  usesDefault?: boolean;
  onChange: (rule: RotationRule | 'default', key?: string) => void;
}) {
  const kind = rotationKind(rule);
  const draftOf = (value: RotationRule) => describeAngles(value).replace(/°/g, '');
  const [angles, setAngles] = useState(draftOf(rule));
  // Opening the angle editor is a choice of its own: typed angles may match a named rule.
  const [customOpen, setCustomOpen] = useState(kind === 'custom');
  const emitted = useRef<string | undefined>(undefined);
  const key = ruleKey(rule);
  useEffect(() => {
    // Follow changes made elsewhere (undo, another field), not the ones typed here.
    if (key === emitted.current) return;
    setAngles(draftOf(rule));
    setCustomOpen(rotationKind(rule) === 'custom');
  }, [key]);
  const emit = (next: RotationRule | 'default', editKey?: string) => {
    emitted.current = next === 'default' ? undefined : ruleKey(next);
    onChange(next, editKey);
  };
  const anglesValid = !!parseAngles(angles);
  const value = customOpen ? 'custom' : defaultRule && usesDefault ? 'default' : kind;
  return (
    <>
      <label className="field">
        Rotations
        <span className="rotation-input">
          <GrainIcon rule={value === 'default' && defaultRule ? defaultRule : rule} />
          <select
            value={value}
            onChange={(event) => {
              const next = event.target.value as RotationKind | 'default';
              if (next === 'default') onChange('default');
              else if (next === 'custom')
                onChange(parseAngles(angles) ?? { kind: 'discrete', degrees: [0, 45] });
              else onChange(rotationRule(next));
            }}
          >
            {defaultRule && (
              <option value="default">
                Default · {ROTATION_LABELS[rotationKind(defaultRule)]}
              </option>
            )}
            {(Object.keys(ROTATION_LABELS) as RotationKind[]).map((option) => (
              <option key={option} value={option}>
                {ROTATION_LABELS[option]}
              </option>
            ))}
          </select>
        </span>
      </label>
      {value === 'custom' && (
        <label className="field">
          Angles, degrees
          <input
            className="mono"
            value={angles}
            aria-invalid={!anglesValid}
            onChange={(event) => {
              setAngles(event.target.value);
              const parsed = parseAngles(event.target.value);
              if (parsed) emit(parsed, 'angles');
            }}
          />
          {!anglesValid && (
            <span className="field-error">Enter one or more angles, separated by commas.</span>
          )}
        </label>
      )}
    </>
  );
}

/** The project's part defaults, which every part follows unless it has its own setting. */
function DefaultsPanel() {
  const { project, edit } = useStudio();
  const differing = project.parts.filter(differsFromDefaults);
  return (
    <aside className="defaults-panel" aria-label="Part defaults">
      <div className="list-head">
        <span className="label">Part defaults</span>
      </div>
      <div className="properties plain">
        <p className="muted">Every part follows these unless you set it differently.</p>
        <RotationField
          rule={project.partDefaults.rotations}
          onChange={(rule, key) =>
            rule !== 'default' &&
            edit((current) => setDefaultRotations(current, rule), key && `default-${key}`)
          }
        />
        <ProRow>Allow reflection</ProRow>
        <ProRow>Nest parts inside holes</ProRow>
        <div className="grain-key" aria-label="Grain lines">
          <span className="muted">Parts that differ show their grain line:</span>
          {(['fixed', 'half', 'quarter', 'free'] as const).map((kind) => (
            <span key={kind}>
              <GrainIcon rule={rotationRule(kind)} size={14} />
              {ROTATION_LABELS[kind]}
            </span>
          ))}
          <span>
            <GrainIcon rule={{ kind: 'discrete', degrees: [0, 120, 240] }} size={14} />
            Custom angles
          </span>
        </div>
        <div className="defaults-summary">
          <span>
            {project.parts.length - differing.length} of {project.parts.length} parts follow the
            defaults
          </span>
          {differing.length > 0 && (
            <>
              <span className="differs-count">
                <i className="differs-dot" aria-hidden="true" />
                {differing.length} {differing.length === 1 ? 'differs' : 'differ'}
              </span>
              <button
                className="small"
                onClick={() =>
                  edit((current) =>
                    setPartRotations(
                      current,
                      differing.map((part) => part.id),
                      'default',
                    ),
                  )
                }
              >
                Make every part follow the defaults
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function PartsDrawing({
  parts,
  differs,
  arrangement,
  upp,
  selected,
  unit,
  onSelect,
  onMenu,
}: {
  parts: Part[];
  differs: (id: string) => boolean;
  arrangement: ReturnType<typeof arrangeParts>;
  upp: number;
  selected?: string;
  unit: DisplayUnit;
  onSelect: (id: string) => void;
  onMenu: (id: string, event: React.MouseEvent<SVGGElement>) => void;
}) {
  const badge = 11 * upp;
  return (
    <>
      {parts.map((part, index) => {
        const [dx, dy] = arrangement.offsets.get(part.id)!;
        const box = arrangement.boxes.get(part.id)!;
        const isSelected = part.id === selected;
        const { outer, holes } = outline(part.shape);
        const d = ringsPath([outer, ...holes], dx, dy);
        const size = Math.min(box[2] - box[0], box[3] - box[1]);
        // Only parts with their own rotations show a grain line, once large enough on screen:
        // it fades in from 30 px and is fully drawn at 60 px.
        const detail = Math.max(0, Math.min(1, (size / upp - 30) / 30));
        const grain =
          differs(part.id) &&
          detail > 0 &&
          grainPaths(part.rotations, (box[0] + box[2]) / 2, -(box[1] + box[3]) / 2, size * 0.45);
        return (
          <g
            key={part.id}
            className="part-shape"
            onClick={() => onSelect(part.id)}
            onContextMenu={(event) => onMenu(part.id, event)}
          >
            <path
              d={d}
              fillRule="evenodd"
              fill={colors[index % colors.length]}
              fillOpacity={part.quantity ? 1 : 0.35}
              className={isSelected ? 'outline selected' : 'outline'}
              strokeWidth={(isSelected ? 2.5 : 1.2) * upp}
            />
            {grain && (
              <g
                opacity={detail * 0.75}
                stroke={shades[index % shades.length]}
                fill={shades[index % shades.length]}
                pointerEvents="none"
              >
                <path d={grain.line} fill="none" strokeWidth={1.4 * upp} />
                <path d={grain.heads} stroke="none" />
              </g>
            )}
            <g transform={`translate(${box[2] + badge * 0.4} ${-box[3] - badge * 0.4})`}>
              <circle r={badge} className="badge" />
              <text className="badge-text" fontSize={10 * upp} textAnchor="middle" dy={3.5 * upp}>
                ×{part.quantity}
              </text>
              {differs(part.id) && (
                <circle
                  cx={badge * 0.8}
                  cy={-badge * 0.8}
                  r={4.5 * upp}
                  className="differs-mark"
                  strokeWidth={1.5 * upp}
                />
              )}
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
      <span>
        <span className="legend-badge">×3</span>Quantity
      </span>
      <span>
        <i className="differs-dot" aria-hidden="true" />
        Differs from the part defaults
      </span>
    </div>
  );
}

function PartMenu({
  menu,
  part,
  onClose,
  onQuantity,
  differs,
  defaultRule,
  onRotation,
  onProperties,
  onRemove,
}: {
  menu: Menu;
  part?: Part;
  onClose: () => void;
  onQuantity: (part: Part, quantity: number) => void;
  differs?: boolean;
  defaultRule: RotationRule;
  onRotation: (part: Part, rule: RotationRule | 'default') => void;
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
          value={differs ? kind : 'default'}
          onChange={(event) => {
            const next = event.target.value as Exclude<RotationKind, 'custom'> | 'default';
            onRotation(part, next === 'default' ? 'default' : rotationRule(next));
          }}
        >
          <option value="default">Default · {ROTATION_LABELS[rotationKind(defaultRule)]}</option>
          {(['fixed', 'half', 'quarter', 'free'] as const).map((option) => (
            <option key={option} value={option}>
              {ROTATION_LABELS[option]}
            </option>
          ))}
          {kind === 'custom' && differs && (
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
