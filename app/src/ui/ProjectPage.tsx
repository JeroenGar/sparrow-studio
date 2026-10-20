import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newId } from '../engine/model';
import {
  addParts,
  copyCount,
  INPUT_TABS,
  runningJobs,
  startBlockers,
  unseenTabs,
  type InputTab,
  type ProjectDocument,
} from '../project/model';
import type { Preferences } from '../project/preferences';
import { StudioContext, type Studio, type Tab } from './context';
import { ImportFilesDialog } from './dialogs/ImportFilesDialog';
import { ImportFromProjectDialog, type ProjectImport } from './dialogs/ImportFromProjectDialog';
import { explain } from './explain';
import { JobPage } from './JobPage';
import { go, href, type JobView } from './route';
import type { Runner } from './runs';
import { JobsView } from './views/JobsView';
import { MachineView } from './views/MachineView';
import { PartsView } from './views/PartsView';
import { SettingsView } from './views/SettingsView';
import { SheetsView } from './views/SheetsView';
import type { OpenEntry, Workspace } from './workspace';

const TABS: { id: InputTab; label: string }[] = [
  { id: 'parts', label: 'Parts' },
  { id: 'sheets', label: 'Sheets' },
  { id: 'machine', label: 'Machine' },
  { id: 'settings', label: 'Settings' },
];

type Dialogs =
  | { type: 'import-files'; kind: 'parts' | 'sheets' }
  | { type: 'import-project'; kind: 'parts' | 'sheets' | 'machines' };

/**
 * One project: its input tabs and its jobs, or one job of it. Its document, edits and saving
 * belong to the workspace; its jobs are followed by the runner.
 */
export function ProjectPage({
  workspace,
  runner,
  entry,
  shown,
  preferences,
  setPreferences,
  openPro,
  showError,
}: {
  workspace: Workspace;
  runner: Runner;
  entry: OpenEntry;
  /** A tab of the project, or a job of it. */
  shown: { tab: Tab } | { job: number; view: JobView };
  preferences: Preferences;
  setPreferences: (change: Partial<Preferences>) => void;
  openPro: () => void;
  showError: (message: string) => void;
}) {
  const { id } = entry;
  const project = entry.history.present;
  const setTab = useCallback((tab: Tab) => go({ page: 'project', id, tab }), [id]);
  const tab = 'tab' in shown ? shown.tab : undefined;
  // Opening an input tab counts for the new project's first run; it is no edit to undo.
  const seenTabs = project.seenTabs;
  useEffect(() => {
    if (
      seenTabs &&
      tab &&
      INPUT_TABS.includes(tab as InputTab) &&
      !seenTabs.includes(tab as InputTab)
    )
      workspace.results(id, () => ({ seenTabs: [...seenTabs, tab as InputTab] }));
  }, [workspace, id, tab, seenTabs]);
  const [dialog, setDialog] = useState<Dialogs>();
  const edit = useCallback(
    (change: (project: ProjectDocument) => ProjectDocument, key?: string) =>
      workspace.edit(id, change, key),
    [workspace, id],
  );

  function startRun() {
    if (startBlockers(project).length || unseenTabs(project).length) return;
    runner.start(id).then(
      (number) => go({ page: 'job', id, number, view: 'layout' }),
      (reason) => showError(explain(reason)),
    );
  }
  const removeJob = useCallback(
    (number: number) =>
      workspace.results(id, (present) => ({
        // A running job stays: it is stopped first.
        jobs: present.jobs.filter((job) => job.number !== number || job.stage === 'running'),
      })),
    [workspace, id],
  );

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      if (
        (event.target as HTMLElement).closest('input, textarea, select') ||
        document.querySelector('dialog[open]')
      )
        return;
      event.preventDefault();
      if (event.shiftKey) workspace.redo(id);
      else workspace.undo(id);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [workspace, id]);

  const importContent = (content: ProjectImport) => {
    edit((previous) => {
      const current = addParts(
        previous,
        content.parts.map((part) => ({ ...part, id: newId() })),
      );
      return {
        ...current,
        stock: {
          ...current.stock,
          strip: content.strip
            ? { ...current.stock.strip, name: content.strip.name, widthMm: content.strip.widthMm }
            : current.stock.strip,
          sheets: [
            ...current.stock.sheets,
            ...content.sheets.map((sheet) => ({ ...sheet, id: newId() })),
          ],
        },
        machines: [
          ...current.machines,
          ...content.machines.map((machine) => ({ ...machine, id: newId() })),
        ],
      };
    });
    setDialog(undefined);
  };

  const studio: Studio = useMemo(
    () => ({
      projectId: id,
      project,
      edit,
      unit: preferences.unit,
      preferences,
      setPreferences,
      setTab,
      openPro,
      openImport: (kind, source) =>
        setDialog(
          source === 'files' && kind !== 'machines'
            ? { type: 'import-files', kind }
            : { type: 'import-project', kind },
        ),
      showError,
      runner,
      startRun,
      removeJob,
    }),
    // startRun reads the current project; it is recreated with it.
    [id, project, edit, preferences, setPreferences, setTab, openPro, showError, runner, removeJob],
  );
  const running = runningJobs(project).length;

  return (
    <StudioContext.Provider value={studio}>
      {'job' in shown ? (
        <JobPage number={shown.job} view={shown.view} />
      ) : (
        <>
          <nav className="tabs" aria-label="Project">
            {TABS.map((item) => (
              <a
                key={item.id}
                className={item.id === tab ? 'tab active' : 'tab'}
                aria-current={item.id === tab ? 'page' : undefined}
                href={href({ page: 'project', id, tab: item.id })}
              >
                {item.label}
                {item.id === 'parts' && <span className="count">{copyCount(project.parts)}</span>}
              </a>
            ))}
            <span className="spacer" />
            <a
              className={tab === 'jobs' ? 'tab active' : 'tab'}
              aria-current={tab === 'jobs' ? 'page' : undefined}
              href={href({ page: 'project', id, tab: 'jobs' })}
            >
              Jobs
              <span className="count">{project.jobs.length}</span>
              {running > 0 && (
                <i
                  className="live-dot"
                  role="img"
                  aria-label={`${running} ${running === 1 ? 'job' : 'jobs'} running`}
                />
              )}
            </a>
          </nav>
          <main className="main">
            {tab === 'parts' && <PartsView />}
            {tab === 'sheets' && <SheetsView />}
            {tab === 'machine' && <MachineView />}
            {tab === 'settings' && <SettingsView />}
            {tab === 'jobs' && <JobsView />}
          </main>
        </>
      )}
      {dialog?.type === 'import-files' && (
        <ImportFilesDialog
          kind={dialog.kind}
          onClose={() => setDialog(undefined)}
          onAdd={(parts, sheets, widthMm) => {
            edit((previous) => {
              const current = addParts(
                previous,
                parts.map((part) => ({ ...part, id: newId() })),
              );
              const added = sheets.map((sheet) => ({
                id: newId(),
                name: sheet.name,
                shape: sheet.shape,
                quantity: sheet.quantity,
                ...(sheet.defects.length && { defects: sheet.defects }),
              }));
              return {
                ...current,
                stock: {
                  ...current.stock,
                  // Sheets imported are sheets to nest into.
                  ...(added.length && { packing: 'sheets' as const }),
                  strip: widthMm ? { ...current.stock.strip, widthMm } : current.stock.strip,
                  sheets: [...current.stock.sheets, ...added],
                },
              };
            });
            setDialog(undefined);
            setTab(parts.length || !sheets.length ? 'parts' : 'sheets');
          }}
        />
      )}
      {dialog?.type === 'import-project' && (
        <ImportFromProjectDialog
          workspace={workspace}
          kind={dialog.kind}
          currentId={id}
          onClose={() => setDialog(undefined)}
          onImport={importContent}
        />
      )}
    </StudioContext.Provider>
  );
}
