import { useEffect, useMemo, useState } from 'react';
import { ApiError, withCode } from '../api/client';
import {
  copyCount,
  describeSheets,
  nextJobNumber,
  startBlockers,
  TAB_NAMES,
  unseenTabs,
} from '../project/model';
import { projectRequest } from '../project/solution';
import { backend, client } from './client';
import { useStudio } from './context';
import { formatLength } from './format';
import { ProTag } from './ProTag';
import { useSubmitting } from './runs';
import { explain } from './explain';

/** Why the backend refuses the project's job: an error to fix, or a feature it does not have. */
type Refusal = { message: string; unavailable: boolean };

/** Asks the backend whether it would accept the project's job, shortly after each change. */
function useRefusal() {
  const { project } = useStudio();
  const request = useMemo(() => projectRequest(project), [project]);
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
              message: explain(reason),
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

/** Start nesting, at the bottom of every tab's list: it starts the project's next job. */
export function RunBar() {
  const { projectId, project, unit, startRun, setTab, runner } = useStudio();
  const submitting = useSubmitting(runner, projectId);
  const { checking, refusal } = useRefusal();

  const blocker = startBlockers(project)[0];
  // A new project's first run comes after a look through each input tab, one after the other.
  const next = unseenTabs(project)[0];
  if (!blocker && next)
    return (
      <div className="run-bar">
        <button className="primary" onClick={() => setTab(next)}>
          Next: {TAB_NAMES[next]}
        </button>
      </div>
    );
  const copies = copyCount(project.parts);
  return (
    <div className="run-bar">
      <button
        className="primary"
        disabled={!!blocker || checking || !!refusal || submitting}
        onClick={startRun}
      >
        {submitting ? 'Starting…' : 'Start nesting'}
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
          Starts job #{nextJobNumber(project)} · {copies} {copies === 1 ? 'part' : 'parts'} ·{' '}
          {project.stock.packing === 'sheets'
            ? describeSheets(project)
            : `strip ${formatLength(project.stock.strip.widthMm, unit)} ${unit} wide`}{' '}
          · {backend.solves}
        </span>
      )}
    </div>
  );
}
