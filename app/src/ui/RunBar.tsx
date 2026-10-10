import { copyCount, startBlockers } from '../project/model';
import { useStudio } from './context';
import { formatLength, formatSeconds } from './format';

/** Start nesting, at the bottom of every tab's list. While a run is going, it becomes Stop. */
export function RunBar() {
  const { project, unit, running, startRun, stopRun, solver } = useStudio();
  if (running)
    return (
      <div className="run-bar">
        <button className="primary" onClick={stopRun}>
          Stop
        </button>
        <span className="muted">
          {solver.state === 'Initializing'
            ? 'Starting the solver…'
            : `Running · ${formatSeconds(solver.elapsed)}`}
        </span>
      </div>
    );
  const blockers = startBlockers(project);
  const copies = copyCount(project.parts);
  return (
    <div className="run-bar">
      <button className="primary" disabled={blockers.length > 0} onClick={startRun}>
        Start nesting
      </button>
      <span className={blockers.length ? 'run-blocker' : 'muted'}>
        {blockers.length
          ? blockers[0]
          : `${copies} ${copies === 1 ? 'part' : 'parts'} · strip ${formatLength(project.stock.strip.widthMm, unit)} ${unit} wide · solved in this browser`}
      </span>
    </div>
  );
}
