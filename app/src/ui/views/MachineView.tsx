import { useState } from 'react';
import { newId } from '../../engine/model';
import { activeMachine, boundaryOf, newMachine, type MachinePreset } from '../../project/model';
import { ProRow } from '../ProTag';
import { useStudio } from '../context';
import { formatLength } from '../format';
import { ImportMenu } from '../ImportMenu';
import { LengthInput } from '../LengthInput';
import { RunBar } from '../RunBar';
import { Explanation } from './Explanation';

export function MachineView() {
  const { project, edit, unit, preferences, setPreferences } = useStudio();
  const active = activeMachine(project);
  const [selected, setSelected] = useState<string | undefined>(active.id);
  const chosen = project.machines.find((machine) => machine.id === selected);
  const update = (id: string, change: Partial<MachinePreset>, key: string) =>
    edit(
      (current) => ({
        ...current,
        machines: current.machines.map((machine) =>
          machine.id === id ? { ...machine, ...change } : machine,
        ),
      }),
      key,
    );
  const add = (machine: MachinePreset) => {
    edit((current) => ({ ...current, machines: [...current.machines, machine] }));
    setSelected(machine.id);
  };
  const remove = (id: string) => {
    edit((current) => {
      const machines = current.machines.filter((machine) => machine.id !== id);
      return {
        ...current,
        machines,
        machineId: current.machineId === id ? machines[0].id : current.machineId,
      };
    });
    setSelected(undefined);
  };
  const isDefault = (machine: MachinePreset) =>
    preferences.defaultMachine?.name === machine.name &&
    preferences.defaultMachine.gapMm === machine.gapMm &&
    preferences.defaultMachine.boundaryMm === machine.boundaryMm;
  return (
    <div className="view">
      <section className="list-panel" aria-label="Machine presets">
        <div className="list-head">
          <span className="label">Machine presets</span>
          <span className="row-actions">
            <ImportMenu kind="machines" files={false} />
            <button
              className="small"
              onClick={() => add(newMachine(`Machine ${project.machines.length + 1}`))}
            >
              + New
            </button>
          </span>
        </div>
        <div className="list-scroll">
          {project.machines.map((machine) => (
            <div key={machine.id}>
              <button
                className={machine.id === selected ? 'row selected' : 'row'}
                aria-expanded={machine.id === selected}
                onClick={() => setSelected(machine.id === selected ? undefined : machine.id)}
              >
                <span className="row-text">
                  <span>{machine.name}</span>
                  <span className="muted mono">
                    Gap {formatLength(machine.gapMm, unit, 3)} {unit}
                    {machine.boundaryMm !== undefined &&
                      ` · edge ${formatLength(machine.boundaryMm, unit, 3)} ${unit}`}
                  </span>
                </span>
                {machine.id === project.machineId && <span className="pill good">In use</span>}
              </button>
              {machine.id === selected && chosen && (
                <div className="properties">
                  <label className="field">
                    Name
                    <input
                      value={chosen.name}
                      onChange={(event) =>
                        update(chosen.id, { name: event.target.value }, `machine-name:${chosen.id}`)
                      }
                    />
                  </label>
                  <LengthInput
                    label="Gap between parts"
                    value={chosen.gapMm}
                    min={0}
                    max={1000}
                    allowZero
                    onChange={(gapMm) => update(chosen.id, { gapMm }, `machine-gap:${chosen.id}`)}
                  />
                  <label className="choice">
                    <input
                      type="checkbox"
                      checked={chosen.boundaryMm === undefined}
                      onChange={(event) =>
                        update(
                          chosen.id,
                          { boundaryMm: event.target.checked ? undefined : chosen.gapMm },
                          `machine-boundary:${chosen.id}`,
                        )
                      }
                    />
                    Keep the same distance to the edge of the material
                  </label>
                  {chosen.boundaryMm !== undefined && (
                    <LengthInput
                      label="Distance to the material edge"
                      value={chosen.boundaryMm}
                      min={0}
                      max={1000}
                      allowZero
                      onChange={(boundaryMm) =>
                        update(chosen.id, { boundaryMm }, `machine-boundary:${chosen.id}`)
                      }
                    />
                  )}
                  {chosen.boundaryMm !== undefined &&
                    chosen.boundaryMm > 0 &&
                    chosen.boundaryMm < chosen.gapMm / 2 && (
                      <span className="muted small-note">
                        A distance above zero but below half the gap counts as half the gap.
                      </span>
                    )}
                  <ProRow>Machine bed and clamps</ProRow>
                  <div className="row-actions wrap">
                    {chosen.id !== project.machineId && (
                      <button
                        className="small"
                        onClick={() => edit((current) => ({ ...current, machineId: chosen.id }))}
                      >
                        Use for this project
                      </button>
                    )}
                    <button
                      className="small"
                      disabled={isDefault(chosen)}
                      onClick={() => setPreferences({ defaultMachine: { ...chosen } })}
                    >
                      {isDefault(chosen)
                        ? 'Default for new projects'
                        : 'Make default for new projects'}
                    </button>
                    <button
                      className="small"
                      onClick={() => add({ ...chosen, id: newId(), name: `${chosen.name} copy` })}
                    >
                      Duplicate
                    </button>
                    <button
                      className="small danger"
                      disabled={project.machines.length === 1}
                      title={
                        project.machines.length === 1
                          ? 'A project needs one machine preset.'
                          : undefined
                      }
                      onClick={() => remove(chosen.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <RunBar />
      </section>
      <Explanation title={`Gap · ${active.name}`}>
        <svg viewBox="0 0 500 200" className="illustration" aria-hidden="true">
          <line x1="20" y1="20" x2="480" y2="20" className="sheet-edge" strokeWidth="2" />
          <rect x="60" y="50" width="150" height="120" className="illustration-part" />
          <rect x="260" y="50" width="150" height="120" className="illustration-part" />
          <path
            d="M210 110H260M210 100V120M260 100V120M135 20V50"
            className="accent-line"
            strokeWidth="1.5"
          />
          <text x="235" y="145" textAnchor="middle" className="accent-text">
            {formatLength(active.gapMm, unit, 3)} {unit}
          </text>
          <text x="145" y="40" className="accent-text small-text">
            {formatLength(boundaryOf(active), unit, 3)} {unit} at the edge
          </text>
        </svg>
        <p>
          The gap is the smallest distance between two parts. Parts keep the same distance to the
          edge of the material, unless the preset sets its own. Neither is cutting kerf.
        </p>
        <p className="muted">
          A machine preset holds the settings that belong to a machine, so you can reuse them across
          projects. sparrow pro will add the machine bed and clamp zones.
        </p>
      </Explanation>
    </div>
  );
}
