import { useEffect, useMemo, useRef, useState } from 'react';
import { bounds } from '../../engine/geometry/normalize';
import { netArea, worldParts } from '../../engine/geometry/validate';
import { geometryTask } from '../../engine/workers/geometryTask';
import { projectFileName } from '../../project/file';
import { jobKey, projectJob, utilization } from '../../project/model';
import { Canvas } from '../Canvas';
import { CloudRow } from '../CloudTag';
import { useStudio } from '../context';
import { download } from '../download';
import { formatLength, formatSeconds } from '../format';
import { RunBar } from '../RunBar';
import { LayoutDrawing, placementKey } from './LayoutDrawing';

type Format = 'svg' | 'dxf' | 'pdf';

export function SolutionView() {
  const { project, unit, setTab, showError, solver } = useStudio();
  const solution = project.solutions[0];
  const [selected, setSelected] = useState<string>();
  const [focus, setFocus] = useState<{ key: string; serial: number }>();
  const [format, setFormat] = useState<Format>('svg');
  const [busy, setBusy] = useState(false);
  const rows = useRef(new Map<string, HTMLElement>());
  const world = useMemo(
    () => (solution ? worldParts(solution.job, solution.result) : []),
    [solution],
  );
  const stale = useMemo(
    () => !!solution && jobKey(solution.job) !== jobKey(projectJob(project)),
    [solution, project],
  );
  useEffect(() => {
    if (selected)
      rows.current.get(selected)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  if (!solution)
    return (
      <div className="view">
        <section className="list-panel" aria-label="Solution">
          <div className="list-head">
            <span className="label">Solution</span>
          </div>
          <div className="list-scroll">
            <div className="empty">
              <p>No solution yet.</p>
              <p className="muted">
                Start nesting. The best valid layout appears here when the run ends.
              </p>
            </div>
          </div>
          <RunBar />
        </section>
        <section className="explanation" aria-label="No solution" />
      </div>
    );

  const { job, result } = solution;
  const width = job.settings.materialWidthMm;
  const boxes = new Map(world.map((part) => [placementKey(part), bounds(part.outer)]));
  const chosen = result.placements.find((placement) => placementKey(placement) === selected);
  const focusBox = focus && (boxes.get(focus.key) as [number, number, number, number] | undefined);

  async function exportLayout() {
    setBusy(true);
    try {
      const reply = await geometryTask({
        type: 'export',
        runId: 1,
        documentRevision: 1,
        document: job,
        result,
      });
      if (reply.type !== 'export-result') throw Error('Could not export the layout.');
      const name = projectFileName(project.name, format);
      if (format === 'pdf') {
        const { exportPDF } = await import('../../engine/export/pdf');
        download(name, await exportPDF(reply.bundle.svg), 'application/pdf');
      } else
        download(
          name,
          reply.bundle[format],
          format === 'svg' ? 'image/svg+xml' : 'application/dxf',
        );
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function diagnostics() {
    const { zip } = await import('../../engine/zip');
    const { reproductionFiles } = await import('../../engine/export/diagnostics');
    const { logs = [], droppedLogs = 0, ...details } = solver.diagnostics.current ?? {};
    download(
      'sparrow-studio-diagnostics.zip',
      zip([
        {
          name: 'diagnostics.json',
          data: JSON.stringify({ project, ...details, droppedLogs }, null, 2),
        },
        ...reproductionFiles(solver.diagnostics.current),
        { name: 'solver.log', data: logs.join('\n') + '\n' },
      ]),
      'application/zip',
    );
  }

  return (
    <div className="view">
      <section className="list-panel" aria-label="Solution">
        <div className="list-head">
          <span className="label">Solutions</span>
        </div>
        <div className="list-scroll">
          <article className="solution-card">
            <strong>Latest run</strong>
            <span className="muted mono">
              {formatLength(result.usedLengthMm, unit, 2)} {unit} long ·{' '}
              {utilization(job, result, netArea).toFixed(1)}% utilization
            </span>
            <span className="muted">
              {solution.stopReason === 'Stopped' ? 'Stopped' : 'Finished'} after{' '}
              {formatSeconds(result.elapsedSeconds)} ·{' '}
              {new Date(solution.createdAt).toLocaleString()}
            </span>
            <span className="pill good">Valid layout</span>
            {stale && (
              <p className="notice">
                The parts or settings changed since this run. Start nesting again to update the
                solution.
              </p>
            )}
          </article>
          <p className="muted pad">Later: several solutions to compare, from sparrow cloud.</p>
          <div className="list-head">
            <span className="label">Placements · {result.placements.length}</span>
          </div>
          {job.parts
            .filter((part) => part.quantity > 0)
            .map((part) => (
              <div key={part.id}>
                <div className="group-head">
                  {part.name} <span className="muted">×{part.quantity}</span>
                </div>
                {result.placements
                  .filter((placement) => placement.partId === part.id)
                  .map((placement) => {
                    const key = placementKey(placement);
                    return (
                      <div
                        key={key}
                        ref={(element) => {
                          if (element) rows.current.set(key, element);
                          else rows.current.delete(key);
                        }}
                      >
                        <button
                          className={key === selected ? 'row compact selected' : 'row compact'}
                          aria-expanded={key === selected}
                          onClick={() => {
                            setSelected(key === selected ? undefined : key);
                            setFocus((previous) => ({ key, serial: (previous?.serial ?? 0) + 1 }));
                          }}
                        >
                          <span className="grow">Copy {placement.copyIndex + 1}</span>
                          <span className="muted mono">
                            {formatLength(placement.xMm, unit)}, {formatLength(placement.yMm, unit)}{' '}
                            · {Number(placement.angleDeg.toFixed(2))}°
                          </span>
                        </button>
                        {key === selected && chosen && (
                          <div className="properties">
                            <dl className="facts">
                              <dt>Part</dt>
                              <dd>{part.name}</dd>
                              <dt>Position</dt>
                              <dd>
                                {formatLength(chosen.xMm, unit, 2)},{' '}
                                {formatLength(chosen.yMm, unit, 2)} {unit}
                              </dd>
                              <dt>Rotation</dt>
                              <dd>{Number(chosen.angleDeg.toFixed(4))}°</dd>
                            </dl>
                            <CloudRow>Lock this placement and nest the rest again</CloudRow>
                            <button className="small" onClick={() => setTab('parts')}>
                              Show parts
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            ))}
          <div className="pad">
            <button className="small" onClick={() => void diagnostics()}>
              Download diagnostics
            </button>
          </div>
        </div>
        <RunBar />
      </section>
      <Canvas
        label="Solution layout"
        extent={[0, -width * 0.1, result.usedLengthMm * 1.05, width * 1.1]}
        focus={focusBox && { box: focusBox, key: `${focus.key}:${focus.serial}` }}
        onBackgroundClick={() => setSelected(undefined)}
        toolbar={
          <>
            <span className="chip mono">
              {formatLength(result.usedLengthMm, unit, 2)} {unit} ·{' '}
              {utilization(job, result, netArea).toFixed(1)}%
            </span>
            <select
              aria-label="Export format"
              value={format}
              onChange={(event) => setFormat(event.target.value as Format)}
            >
              <option value="svg">SVG</option>
              <option value="dxf">DXF</option>
              <option value="pdf">PDF</option>
            </select>
            <button className="primary small" disabled={busy} onClick={() => void exportLayout()}>
              Download {format.toUpperCase()}
            </button>
          </>
        }
      >
        {({ upp }) => (
          <LayoutDrawing
            job={job}
            world={world}
            usedLength={result.usedLengthMm}
            upp={upp}
            selected={selected}
            onSelect={(key) => setSelected(key)}
          />
        )}
      </Canvas>
    </div>
  );
}
