import { useState } from 'react';
import type { Part } from '../../engine/model';
import {
  resolvedParts,
  type MachinePreset,
  type ProjectDocument,
  type SheetEntry,
  type Strip,
} from '../../project/model';
import { backend } from '../client';
import { formatAgo } from '../format';
import { useWorkspace, type OpenEntry, type Workspace } from '../workspace';
import { useStudio } from '../context';
import { Dialog } from '../Dialog';
import { formatLength } from '../format';

export type ProjectImport = {
  parts: Part[];
  strip?: Strip;
  sheets: SheetEntry[];
  machines: MachinePreset[];
};
type Kind = 'parts' | 'sheets' | 'machines';

/**
 * Copy parts, the strip, sheets or machine presets from another saved project. The Sheets tab
 * imports what the project nests into: the strip, or sheet entries.
 */
export function ImportFromProjectDialog({
  workspace,
  kind,
  currentId,
  onImport,
  onClose,
}: {
  workspace: Workspace;
  kind: Kind;
  currentId: string;
  onImport: (content: ProjectImport) => void;
  onClose: () => void;
}) {
  const { unit, project } = useStudio();
  // What is imported: `strip` stands for the Sheets tab of a project that nests into a strip.
  const what = kind === 'sheets' && project.stock.packing === 'strip' ? 'strip' : kind;
  const title = {
    parts: 'Import parts from another project',
    strip: 'Import the strip from another project',
    sheets: 'Import sheets from another project',
    machines: 'Import machine presets from another project',
  }[what];
  const state = useWorkspace(workspace);
  // The other projects that opened; one that failed to open has nothing to import.
  const projects = (state.status === 'ready' ? state.projects : [])
    .filter((entry): entry is OpenEntry => entry.status === 'open' && entry.id !== currentId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [source, setSource] = useState<ProjectDocument>();
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  function open(document: ProjectDocument) {
    setSource(document);
    const items = {
      parts: document.parts,
      machines: document.machines,
      sheets: document.stock.sheets,
      strip: [document.stock.strip],
    }[what];
    setChosen(new Set(items.map((item) => item.id)));
  }
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const items: { id: string; label: string; detail: string }[] = !source
    ? []
    : kind === 'parts'
      ? source.parts.map((part) => ({ id: part.id, label: part.name, detail: `×${part.quantity}` }))
      : kind === 'machines'
        ? source.machines.map((machine) => ({
            id: machine.id,
            label: machine.name,
            detail: `gap ${formatLength(machine.gapMm, unit, 3)} ${unit}`,
          }))
        : what === 'sheets'
          ? source.stock.sheets.map((sheet) => ({
              id: sheet.id,
              label: sheet.name,
              detail: `×${sheet.quantity}`,
            }))
          : [
              {
                id: source.stock.strip.id,
                label: source.stock.strip.name,
                detail: `${formatLength(source.stock.strip.widthMm, unit)} ${unit} wide`,
              },
            ];

  return (
    <Dialog
      title={title}
      onClose={onClose}
      wide
      actions={
        <>
          {source && <button onClick={() => setSource(undefined)}>Other project</button>}
          <button onClick={onClose}>Cancel</button>
          {source && (
            <button
              className="primary"
              disabled={!chosen.size}
              onClick={() =>
                onImport({
                  parts:
                    kind === 'parts'
                      ? resolvedParts(source).filter((part) => chosen.has(part.id))
                      : [],
                  strip: what === 'strip' && chosen.size ? source.stock.strip : undefined,
                  sheets:
                    what === 'sheets'
                      ? source.stock.sheets.filter((sheet) => chosen.has(sheet.id))
                      : [],
                  machines:
                    kind === 'machines'
                      ? source.machines.filter((machine) => chosen.has(machine.id))
                      : [],
                })
              }
            >
              {what === 'strip' ? 'Use this strip' : `Import ${chosen.size}`}
            </button>
          )}
        </>
      }
    >
      {!source && (
        <>
          <p className="muted">Choose a project saved {backend.saves}.</p>
          {!projects.length && <p>There are no other projects yet.</p>}
          <ul className="project-list">
            {projects.map((entry) => (
              <li key={entry.id}>
                <button className="row" onClick={() => open(entry.history.present)}>
                  <span className="row-text">
                    <span>{entry.history.present.name}</span>
                    <span className="muted">Changed {formatAgo(entry.updatedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {source && (
        <>
          <p>
            From <strong>{source.name}</strong>
          </p>
          {what !== 'strip' && items.length > 1 && (
            <div className="row-actions">
              <button
                className="small"
                onClick={() => setChosen(new Set(items.map((item) => item.id)))}
              >
                Select all
              </button>
              <button className="small" onClick={() => setChosen(new Set())}>
                Select none
              </button>
            </div>
          )}
          {!items.length && <p className="muted">This project has nothing to import here.</p>}
          <ul className="check-list">
            {items.map((item) => (
              <li key={item.id}>
                <label className="choice">
                  <input
                    type={what === 'strip' ? 'radio' : 'checkbox'}
                    checked={chosen.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="grow">{item.label}</span>
                  <span className="muted mono">{item.detail}</span>
                </label>
              </li>
            ))}
          </ul>
          {what === 'strip' && (
            <p className="muted">The strip replaces the current strip width and name.</p>
          )}
        </>
      )}
    </Dialog>
  );
}
