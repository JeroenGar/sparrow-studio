import { useEffect, useMemo, useState } from 'react';
import { ApiError, withCode } from '../api/client';
import { copyCount, startBlockers } from '../project/model';
import { projectRequest } from '../project/solution';
import { client } from './client';
import { useStudio } from './context';
import { formatLength, formatSeconds } from './format';
import { ProTag } from './ProTag';
import { describeError } from './useJob';

/** Why the backend refuses the project's job: an error to fix, or a feature it does not have. */
type Refusal = { message: string; unavailable: boolean };

/** Asks the backend whether it would accept the project's job, shortly after each change. */
function useRefusal() {
  const { project } = useStudio();
  const request = useMemo(() => projectRequest(project, 0), [project]);
  const key = JSON.stringify(request);
  const [checked, setChecked] = useState<{ key: string; refusal?: Refusal }>();
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      client.validateJob(request).then(
        () => current && setChecked({ key }),
        (reason) =>
          current &&
          setChecked({
            key,
            refusal: {
              message: describeError(reason),
              unavailable:
                reason instanceof ApiError && !!withCode(reason.error, 'feature_unavailable'),
            },
          }),
      );
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // The key stands for the request.
  }, [key]);
  return checked?.key === key ? { checking: false, refusal: checked.refusal } : { checking: true };
}

/** Start nesting, at the bottom of every tab's list. While a run is going, it becomes Stop. */
export function RunBar() {
  const { project, unit, running, startRun, stopRun, run } = useStudio();
  const { checking, refusal } = useRefusal();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  if (running) {
    const started = run?.job?.started_at;
    return (
      <div className="run-bar">
        <button className="primary" onClick={stopRun}>
          Stop
        </button>
        <span className="muted">
          {started
            ? `Running · ${formatSeconds(Math.max(0, (now - Date.parse(started)) / 1000))}`
            : 'Starting the solver…'}
        </span>
      </div>
    );
  }
  const blocker = startBlockers(project)[0];
  const copies = copyCount(project.parts);
  return (
    <div className="run-bar">
      <button className="primary" disabled={!!blocker || checking || !!refusal} onClick={startRun}>
        Start nesting
      </button>
      {blocker ? (
        <span className="run-blocker">{blocker}</span>
      ) : refusal?.unavailable ? (
        <span className="run-blocker">
          {refusal.message} <ProTag />
        </span>
      ) : refusal ? (
        <span className="run-blocker">{refusal.message}</span>
      ) : (
        <span className="muted">
          {copies} {copies === 1 ? 'part' : 'parts'} · strip{' '}
          {formatLength(project.stock.strip.widthMm, unit)} {unit} wide · solved in this browser
          with open-source sparrow
        </span>
      )}
    </div>
  );
}
