import { useMemo, useState } from 'react';
import { worldParts, type WorldPart } from '../../engine/geometry/world';
import { geometryTask } from '../../engine/workers/geometryTask';
import { projectFileName } from '../../project/file';
import type { ProjectJob } from '../../project/model';
import { drawable, sideBySide } from '../../project/solution';
import type { Result, Sheet } from '../../engine/model';
import { Canvas } from '../Canvas';
import { ProRow } from '../ProTag';
import { useStudio } from '../context';
import { download } from '../download';
import { withKind } from '../../api/client';
import { explainDiagnostic } from '../explain';
import { formatArea, formatLength, formatPercent, formatSeconds } from '../format';
import { serializeProject } from '../../project/file';
import { arrangeLayouts, LayoutDrawing, placementKey } from './LayoutDrawing';
import { colors } from '../../engine/colors';
import { JobAside } from './JobView';

type Format = 'svg' | 'dxf' | 'pdf';
type Hover = { part: WorldPart; x: number; y: number };

/** A job that completed with a layout. */
export type SolvedJob = Extract<ProjectJob, { stage: 'ended' }> & {
  document: {
    outcome: NonNullable<Extract<ProjectJob, { stage: 'ended' }>['document']['outcome']>;
  };
};

/** A completed job's layouts, its figures, and its downloads. */
export function SolutionView({
  job: solution,
  credits,
}: {
  job: SolvedJob;
  /** What the job cost, from the account's record of it, when known. */
  credits?: number;
}) {
  const { project, unit, showError } = useStudio();
  const document = solution.document;
  const outcome = document.outcome;
  const [highlight, setHighlight] = useState<string>();
  const [hover, setHover] = useState<Hover>();
  const [busy, setBusy] = useState<Format>();
  // The layout chosen in the list: the canvas zooms to it.
  const [chosen, setChosen] = useState({ index: 0, serial: 0 });
  // The names the parts and sheets had when the job started.
  const names = useMemo(() => new Map(Object.entries(solution.names)), [solution.names]);
  const drawn = useMemo(
    () => drawable(document.input, outcome.solution, names, outcome.stats),
    [document, outcome, names],
  );
  const worlds = useMemo(
    () => drawn.layouts.map((layout) => worldParts(drawn.job, layout.result)),
    [drawn],
  );
  const [aspect, setAspect] = useState(4 / 3);
  const stack = useMemo(
    () =>
      arrangeLayouts(
        drawn.job,
        drawn.layouts,
        drawn.layouts.map((layout) => layout.result.usedLengthMm),
        aspect,
      ),
    [drawn, aspect],
  );

  const { job, layouts } = drawn;
  const { stats } = outcome;
  const onSheets = document.input.problem.type === 'minimize_sheets_in_order';
  const index = Math.min(chosen.index, Math.max(0, layouts.length - 1));
  const layout = layouts[index];
  const waste = stats.consumed_area - stats.placed_area;
  const state = document.state;
  const placedCopies = layouts.reduce((n, l) => n + l.result.placements.length, 0);
  const unplacedCopies = outcome.unplaced.reduce((n, u) => n + u.quantity, 0);
  const placedOf = (partId: string) =>
    layouts.reduce((n, l) => n + l.result.placements.filter((p) => p.partId === partId).length, 0);
  // Parts with copies for which no place was found, even on empty material: the list says so.
  const unfound = new Set(
    outcome.diagnostics.flatMap((d) => withKind(d, 'no_valid_placement')?.part_id ?? []),
  );
  const notes = outcome.diagnostics.flatMap((diagnostic) =>
    withKind(diagnostic, 'no_valid_placement')
      ? []
      : (explainDiagnostic(diagnostic, names, unit) ?? []),
  );
  const [x0, y0, x1, y1] = stack.extent;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.05;

  /** Downloads every sheet of the solution: in one drawing, or one page per sheet for PDF. */
  async function exportLayout(format: Format) {
    if (!layouts.length) return;
    setBusy(format);
    try {
      const exported = async (result: Result, sheets: Sheet[] | undefined, density: number) => {
        const reply = await geometryTask({
          type: 'export',
          runId: 1,
          documentRevision: 1,
          document: { ...job, name: project.name },
          result,
          utilization: density * 100,
          sheets,
        });
        if (reply.type !== 'export-result') throw Error('Could not export the layout.');
        return reply.bundle;
      };
      const name = projectFileName(`${project.name} #${solution.number}`, format);
      if (format === 'pdf') {
        const { exportPDF } = await import('../../engine/export/pdf');
        const pages = await Promise.all(
          layouts.map(async (l) => {
            const bundle = await exported(
              l.result,
              l.sheet && [l.sheet],
              l.stats?.density ?? stats.density,
            );
            return bundle.svg;
          }),
        );
        download(name, await exportPDF(pages), 'application/pdf');
      } else {
        const { result, sheets } = sideBySide(layouts);
        const bundle = await exported(result, sheets, stats.density);
        download(name, bundle[format], format === 'svg' ? 'image/svg+xml' : 'application/dxf');
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }
  function diagnostics() {
    download(
      'sparrow-studio-diagnostics.json',
      JSON.stringify({ project: JSON.parse(serializeProject(project)), job: document }, null, 2),
      'application/json',
    );
  }

  const hovered = hover?.part;
  const hoveredPlacement =
    hovered &&
    layouts
      .flatMap((l) => l.result.placements)
      .find((p) => placementKey(p) === placementKey(hovered));
  const choose = (i: number) => setChosen(({ serial }) => ({ index: i, serial: serial + 1 }));

  const status = `${
    state.status === 'completed' && state.termination === 'stopped' ? 'Stopped' : 'Finished'
  } after ${formatSeconds(state.status === 'completed' ? state.solver_seconds : 0)}${
    credits !== undefined ? ` · ${credits} ${credits === 1 ? 'credit' : 'credits'}` : ''
  }`;
  return (
    <>
      <Canvas
        label="Solution layout"
        onAspect={setAspect}
        extent={[x0 - pad, y0 - pad, x1 + pad, y1 + pad]}
        focus={
          chosen.serial > 0 && stack.boxes[index]
            ? { box: stack.boxes[index], key: `${index}:${chosen.serial}`, margin: 0.08 }
            : undefined
        }
        onBackgroundClick={() => setHighlight(undefined)}
        toolbar={
          <span className="chip">
            Select a part in the details to find its copies. Hover a part for details.
          </span>
        }
        overlay={
          hovered &&
          hoveredPlacement && (
            <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
              <strong>
                {names.get(hovered.partId)} · copy {hovered.copyIndex + 1}
              </strong>
              <span className="mono">
                {formatLength(hoveredPlacement.xMm, unit, 2)},{' '}
                {formatLength(hoveredPlacement.yMm, unit, 2)} {unit} ·{' '}
                {Number(hoveredPlacement.angleDeg.toFixed(2))}°
                {hoveredPlacement.mirrored && ' · mirrored'}
              </span>
            </div>
          )
        }
      >
        {({ upp }) =>
          layouts.map((l, i) => (
            <LayoutDrawing
              key={i}
              job={job}
              world={worlds[i]}
              sheet={l.sheet}
              usedLength={l.result.usedLengthMm}
              upp={upp}
              offset={stack.offsets[i]}
              label={onSheets ? `${i + 1} · ${l.name}` : undefined}
              highlight={highlight}
              hovered={hovered && placementKey(hovered)}
              onPick={(part) => setHighlight(part.partId === highlight ? undefined : part.partId)}
              onHover={(part, event) => {
                if (!part || !event) return setHover(undefined);
                const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
                setHover({ part, x: event.clientX - rect.left, y: event.clientY - rect.top });
              }}
            />
          ))
        }
      </Canvas>
      <JobAside job={solution} status={status}>
        <div className="summary">
          <div className="metrics">
            <div className="metric">
              <span className="metric-value">{formatPercent(stats.density * 100)}</span>
              <span className="muted">utilization</span>
            </div>
            {onSheets ? (
              <div className="metric">
                <span className="metric-value">{layouts.length}</span>
                <span className="muted">{layouts.length === 1 ? 'sheet' : 'sheets'} used</span>
              </div>
            ) : (
              <div className="metric">
                <span className="metric-value">
                  {formatLength(layout?.result.usedLengthMm ?? 0, unit)} <small>{unit}</small>
                </span>
                <span className="muted">length used</span>
              </div>
            )}
          </div>
          <dl className="facts">
            {!onSheets && (
              <>
                <dt>Strip</dt>
                <dd>
                  {formatLength(job.settings.materialWidthMm, unit)} ×{' '}
                  {formatLength(layout?.result.usedLengthMm ?? 0, unit)} {unit}
                </dd>
              </>
            )}
            <dt>Waste</dt>
            <dd>{formatArea(waste, unit)}</dd>
            <dt>Placed</dt>
            <dd>
              {placedCopies} parts
              {unplacedCopies ? `, ${unplacedCopies} not placed` : ', all of them'}
            </dd>
          </dl>
          {unplacedCopies > 0 && (
            <div className="notice warning">
              <p>
                {unplacedCopies} {unplacedCopies === 1 ? 'copy' : 'copies'} could not be placed:
              </p>
              <ul>
                {outcome.unplaced.map((u) => (
                  <li key={u.part_id}>
                    {names.get(u.part_id) ?? 'A part'}: {u.quantity} not placed
                    {unfound.has(u.part_id) && ', as no place was found, even on empty material'}
                  </li>
                ))}
              </ul>
              <p>
                {unfound.size
                  ? 'Check that each part fits the material with the gap and the distance to the edge.'
                  : 'Add material, or lower the quantities, and start nesting again.'}
              </p>
            </div>
          )}
          {notes.length > 0 && (
            <div className="notice">
              <ul>
                {notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          )}
          <span className="label">Export solution</span>
          <div className="downloads">
            {(['svg', 'dxf', 'pdf'] as Format[]).map((format) => (
              <button
                key={format}
                aria-label={`Download ${format.toUpperCase()}`}
                disabled={!!busy || !layouts.length}
                onClick={() => void exportLayout(format)}
              >
                {busy === format ? 'Preparing…' : format.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {onSheets && (
          <>
            <div className="list-head">
              <span className="label">Sheets in this solution</span>
            </div>
            {layouts.map((l, i) => (
              <button
                key={i}
                className={i === index ? 'row selected' : 'row'}
                aria-pressed={i === index}
                onClick={() => choose(i)}
              >
                <span className="order">{i + 1}</span>
                <span className="row-text">
                  <span>{l.name}</span>
                  <span className="muted">
                    {l.result.placements.length} parts
                    {l.stats && ` · ${formatPercent(l.stats.density * 100)}`}
                    {l.sheet?.cutX != null &&
                      ` · cut at ${formatLength(l.sheet.cutX, unit)} ${unit}`}
                  </span>
                </span>
              </button>
            ))}
          </>
        )}
        <div className="part-chips">
          <span className="label">
            Parts · {placedCopies} of {placedCopies + unplacedCopies} placed
          </span>
          <div className="chips">
            {job.parts.map((part, i) => (
              <button
                key={part.id}
                className="part-chip"
                aria-pressed={part.id === highlight}
                title="Find its copies in the layout"
                onClick={() => setHighlight(part.id === highlight ? undefined : part.id)}
              >
                <i style={{ background: colors[i % colors.length] }} aria-hidden="true" />
                {part.name}
                <span className={placedOf(part.id) < part.quantity ? 'warning-text' : 'muted'}>
                  {placedOf(part.id) < part.quantity
                    ? `${placedOf(part.id)} of ${part.quantity}`
                    : part.quantity}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="pad stack">
          <ProRow>Lock placements and nest the rest again</ProRow>
          <ProRow>Compare several solutions</ProRow>
          <button className="small" onClick={diagnostics}>
            Download diagnostics
          </button>
        </div>
      </JobAside>
    </>
  );
}
