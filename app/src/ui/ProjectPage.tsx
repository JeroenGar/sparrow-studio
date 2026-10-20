import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newId } from '../engine/model';
import {
  addJob,
  addParts,
  copyCount,
  endJob,
  INPUT_TABS,
  jobNames,
  runningJobs,
  startBlockers,
  unseenTabs,
  type InputTab,
  type ProjectDocument,
} from '../project/model';
import type { Preferences } from '../project/preferences';
import { projectRequest } from '../project/solution';
import { client, usesSparrowPro } from './client';
import { StudioContext, type Studio, type Tab } from './context';
import { ImportFilesDialog } from './dialogs/ImportFilesDialog';
import { ImportFromProjectDialog, type ProjectImport } from './dialogs/ImportFromProjectDialog';
import { go, href, parseRoute } from './route';
import { useJob } from './useJob';
import { LiveView } from './views/LiveView';
import { MachineView } from './views/MachineView';
import { PartsView } from './views/PartsView';
import { SettingsView } from './views/SettingsView';
import { SheetsView } from './views/SheetsView';
import { SolutionView } from './views/SolutionView';
import type { OpenEntry, Workspace } from './workspace';

const TABS: { id: Tab; label: string }[] = [
  { id: 'parts', label: 'Parts' },
  { id: 'sheets', label: 'Sheets' },
  { id: 'machine', label: 'Machine' },
  { id: 'settings', label: 'Settings' },
  { id: 'live', label: 'Live' },
  { id: 'solution', label: 'Solution' },
];

type Dialogs =
  | { type: 'import-files'; kind: 'parts' | 'sheets' }
  | { type: 'import-project'; kind: 'parts' | 'sheets' | 'machines' };

/** One project's tabs. Its document, edits and saving belong to the workspace. */
export function ProjectPage({
  workspace,
  entry,
  tab,
  preferences,
  setPreferences,
  openPro,
  showError,
}: {
  workspace: Workspace;
  entry: OpenEntry;
  tab: Tab;
  preferences: Preferences;
  setPreferences: (change: Partial<Preferences>) => void;
  openPro: () => void;
  showError: (message: string) => void;
}) {
  const { id } = entry;
  const project = entry.history.present;
  const setTab = useCallback((tab: Tab) => go({ page: 'project', id, tab }), [id]);
  // Opening an input tab counts for the new project's first run; it is no edit to undo.
  const seenTabs = project.seenTabs;
  useEffect(() => {
    if (seenTabs && INPUT_TABS.includes(tab as InputTab) && !seenTabs.includes(tab as InputTab))
      workspace.results(id, () => ({ seenTabs: [...seenTabs, tab as InputTab] }));
  }, [workspace, id, tab, seenTabs]);
  const [dialog, setDialog] = useState<Dialogs>();
  const edit = useCallback(
    (change: (project: ProjectDocument) => ProjectDocument, key?: string) =>
      workspace.edit(id, change, key),
    [workspace, id],
  );

  // The names of the parts and sheets when the job being submitted was asked for.
  const asked = useRef<Record<string, string>>({});
  /** Shows a tab of this project instead of its Live tab, if that is the one shown. */
  const leaveLive = (next: Tab) => {
    const route = parseRoute(location.hash);
    if (route.page === 'project' && route.id === id && route.tab === 'live') setTab(next);
  };
  // The project records its jobs, so a page closed while one runs picks it up on opening; a job
  // that ends records its document.
  const job = useJob(
    client,
    {
      submitted: (jobId, request) => {
        const names = asked.current;
        workspace.results(id, (present) => ({
          jobs: addJob(present, jobId, request, names).jobs,
        }));
      },
      resumed: () => setTab('live'),
      ended: (jobId, document) => {
        workspace.results(id, (present) => ({ jobs: endJob(present, jobId, document).jobs }));
        if (document?.state.status === 'completed' && document.outcome) leaveLive('solution');
      },
    },
    // Jobs in this browser end with the page, so leaving the project stops them.
    { stopOnLeave: !usesSparrowPro },
  );
  // A job in this browser that was running when the page closed has ended with it; following it
  // finds it gone, and records it as lost.
  const remembered = runningJobs(project).at(-1);
  useEffect(() => {
    if (remembered) void job.resume(remembered.id);
    // Once, for the job the project remembered when it was opened.
  }, []);
  const running = job.running;

  function startRun() {
    if (
      running ||
      runningJobs(project).length ||
      startBlockers(project).length ||
      unseenTabs(project).length
    )
      return;
    asked.current = jobNames(project);
    void job.start(projectRequest(project));
    setTab('live');
  }

  // Leaving the page stops a job in this browser; ask first.
  useEffect(() => {
    // Sparrow Pro keeps running a job after the page closes, and the project picks it up again.
    if (!(running && !usesSparrowPro) && !job.submitting) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running, job.submitting]);

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

  const following = runningJobs(project).at(-1);
  const studio: Studio = useMemo(
    () => ({
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
      run: job.run,
      running,
      // A remembered job not being followed, such as after a lost connection, is reconnected to
      // rather than replaced.
      reconnect: following && !running ? () => void job.resume(following.id) : undefined,
      startRun,
      stopRun: job.stop,
    }),
    // startRun reads the current project; it is recreated with it.
    [project, edit, preferences, setPreferences, setTab, openPro, showError, job.run, running],
  );

  return (
    <StudioContext.Provider value={studio}>
      <nav className="tabs" aria-label="Views">
        {TABS.map((item) => (
          <a
            key={item.id}
            className={item.id === tab ? 'tab active' : 'tab'}
            aria-current={item.id === tab ? 'page' : undefined}
            href={href({ page: 'project', id, tab: item.id })}
          >
            {item.id === 'live' && running && <i className="live-dot" aria-hidden="true" />}
            {item.label}
            {item.id === 'parts' && <span className="count">{copyCount(project.parts)}</span>}
          </a>
        ))}
      </nav>
      <main className="main">
        {tab === 'parts' && <PartsView />}
        {tab === 'sheets' && <SheetsView />}
        {tab === 'machine' && <MachineView />}
        {tab === 'settings' && <SettingsView />}
        {tab === 'live' && <LiveView />}
        {tab === 'solution' && <SolutionView />}
      </main>
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
