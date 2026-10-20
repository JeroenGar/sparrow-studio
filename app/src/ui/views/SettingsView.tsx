import { useState } from 'react';
import { TIME_LIMITS, type SolverSettings } from '../../project/model';
import { useStudio } from '../context';
import { useLimits } from '../limits';
import { RunBar } from '../RunBar';
import { Explanation } from './Explanation';

type Item = 'time';

const timeLabel = (limit: number) =>
  limit < 60 ? `${limit} seconds` : `${limit / 60} minute${limit > 60 ? 's' : ''}`;

export function SettingsView() {
  const { project, edit } = useStudio();
  const settings = project.settings;
  const longest = useLimits()?.max_time_limit_seconds ?? Infinity;
  const [selected, setSelected] = useState<Item | undefined>('time');
  const update = (change: Partial<SolverSettings>) =>
    edit((current) => ({ ...current, settings: { ...current.settings, ...change } }));
  const summary = `Up to ${timeLabel(settings.timeLimitSeconds)}${settings.autoTermination ? ', or once the search stops improving' : ''}`;
  return (
    <div className="view">
      <section className="list-panel" aria-label="Optimization settings">
        <div className="list-head">
          <span className="label">Optimization</span>
        </div>
        <div className="list-scroll">
          <button
            className={selected === 'time' ? 'row selected' : 'row'}
            aria-expanded={selected === 'time'}
            onClick={() => setSelected(selected === 'time' ? undefined : 'time')}
          >
            <span className="row-text">
              <span>Time and stopping</span>
              <span className="muted">{summary}</span>
            </span>
          </button>
          {selected === 'time' && (
            <div className="properties">
              <label className="field">
                Time limit
                <select
                  value={settings.timeLimitSeconds}
                  onChange={(event) => update({ timeLimitSeconds: Number(event.target.value) })}
                >
                  {TIME_LIMITS.map((limit) => (
                    <option key={limit} value={limit} disabled={limit > longest}>
                      {timeLabel(limit)}
                      {limit > longest ? ' · more than allowed' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="choice">
                <input
                  type="checkbox"
                  checked={settings.autoTermination}
                  onChange={(event) => update({ autoTermination: event.target.checked })}
                />
                Stop early once the search stops improving
              </label>
            </div>
          )}
          <p className="muted pad">The gap and other machine settings are in the Machine tab.</p>
        </div>
        <RunBar />
      </section>
      <Explanation title="Time and stopping">
        <p>
          The search runs up to the time limit. Stopping early ends it sooner, once the layout no
          longer gets shorter. You can stop any run yourself; the best valid layout found so far is
          kept.
        </p>
        <p className="muted">
          Settings apply to the next run. They do not change the current solution.
        </p>
      </Explanation>
    </div>
  );
}
