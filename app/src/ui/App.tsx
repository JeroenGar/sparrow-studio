import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { newId } from '../engine/model';
import { loadExample } from '../project/examples';
import { parseProject, projectFileName, serializeProject } from '../project/file';
import {
  addParts,
  INPUT_TABS,
  newProject,
  startBlockers,
  unseenTabs,
  type InputTab,
  type ProjectDocument,
} from '../project/model';
import { projectRequest } from '../project/solution';
import { clearBrowserRecords } from '../backend/projects';
import { backend, client, usesSparrowPro } from './client';
import { useJob } from './useJob';
import { readPreferences, writePreferences, type Preferences } from '../project/preferences';
import {
  createProject,
  isConflict,
  isProjectLimit,
  isUnreadable,
  listProjects,
  openProject,
  saveProject,
  type StoredProject,
} from './projects';
import { StudioContext, type Studio, type Tab } from './context';
import { AboutDialog } from './dialogs/AboutDialog';
import { Logo } from './Logo';
import { ProDialog } from './dialogs/ProDialog';
import { ExamplesDialog } from './dialogs/ExamplesDialog';
import { ImportFilesDialog } from './dialogs/ImportFilesDialog';
import { ImportFromProjectDialog, type ProjectImport } from './dialogs/ImportFromProjectDialog';
import { NameDialog } from './dialogs/NameDialog';
import { PreferencesDialog } from './dialogs/PreferencesDialog';
import { ProjectsDialog } from './dialogs/ProjectsDialog';
import { download } from './download';
import { historyReducer, initialHistory } from './history';
import { ChevronDown, Gear } from './icons';
import { LiveView } from './views/LiveView';
import { MachineView } from './views/MachineView';
import { PartsView } from './views/PartsView';
import { SettingsView } from './views/SettingsView';
import { SheetsView } from './views/SheetsView';
import { SolutionView } from './views/SolutionView';
import { explain } from './explain';

const FIRST_EXAMPLE = 'albano.json';

/** Loads or creates a project, then hands it to the studio. Switching projects remounts the studio. */
export default function App() {
  const [preferences, setPreferencesState] = useState(readPreferences);
  const [stored, setStored] = useState<StoredProject>();
  const [error, setError] = useState('');
  const setPreferences = useCallback((change: Partial<Preferences>) => {
    setPreferencesState((current) => {
      const next = { ...current, ...change };
      writePreferences(next);
      return next;
    });
  }, []);
  // Resolve "system" to light or dark here, and follow the system while it is chosen.
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark =
        preferences.theme === 'dark' || (preferences.theme === 'system' && query.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [preferences.theme]);

  const open = useCallback(
    async (id: string) => {
      const project = await openProject(id);
      setStored(project);
      setPreferences({ lastProjectId: id });
    },
    [setPreferences],
  );
  const create = useCallback(
    async (document: ProjectDocument) => {
      const project = await createProject(document);
      setStored(project);
      setPreferences({ lastProjectId: project.id });
    },
    [setPreferences],
  );
  const openLatest = useCallback(async () => {
    // Open the most recent project that still reads; one in a format studio cannot read is skipped.
    for (const project of await listProjects()) {
      try {
        return await open(project.id);
      } catch (reason) {
        if (!isUnreadable(reason)) throw reason;
      }
    }
    await create(
      await loadExample(FIRST_EXAMPLE, preferences.defaultMachine).catch(() =>
        newProject('Untitled project'),
      ),
    );
  }, [open, create, preferences.defaultMachine]);

  useEffect(() => {
    const last = readPreferences().lastProjectId;
    const fallBack = (reason: unknown) =>
      isUnreadable(reason) ? openLatest() : Promise.reject(reason);
    // In this browser, projects stored by an earlier version may not open; they are deleted
    // and studio starts afresh rather than not at all.
    const start = () => (last ? open(last).catch(fallBack) : openLatest());
    start()
      .catch((reason) =>
        usesSparrowPro ? Promise.reject(reason) : clearBrowserRecords().then(openLatest),
      )
      .catch((reason) => setError(explain(reason)));
    // Load once, at startup.
  }, []);

  if (!stored)
    return (
      <div className="boot">
        <p>
          {error ? `sparrow studio could not open a project: ${error}` : 'Opening sparrow studio…'}
        </p>
      </div>
    );
  return (
    <StudioShell
      key={`${stored.id}:${stored.version}`}
      stored={stored}
      preferences={preferences}
      setPreferences={setPreferences}
      open={open}
      create={create}
      openLatest={openLatest}
    />
  );
}

type Dialogs =
  | { type: 'new' }
  | { type: 'rename' }
  | { type: 'projects' }
  | { type: 'examples' }
  | { type: 'pro' }
  | { type: 'preferences' }
  | { type: 'about' }
  | { type: 'import-files'; kind: 'parts' | 'sheets' }
  | { type: 'import-project'; kind: 'parts' | 'sheets' | 'machines' };

const TABS: { id: Tab; label: string }[] = [
  { id: 'parts', label: 'Parts' },
  { id: 'sheets', label: 'Sheets' },
  { id: 'machine', label: 'Machine' },
  { id: 'settings', label: 'Settings' },
  { id: 'live', label: 'Live' },
  { id: 'solution', label: 'Solution' },
];

function StudioShell({
  stored,
  preferences,
  setPreferences,
  open,
  create,
  openLatest,
}: {
  stored: StoredProject;
  preferences: Preferences;
  setPreferences: (change: Partial<Preferences>) => void;
  open: (id: string) => Promise<void>;
  create: (document: ProjectDocument) => Promise<void>;
  openLatest: () => Promise<void>;
}) {
  const [history, dispatch] = useReducer(historyReducer, stored.document, initialHistory);
  const project = history.present;
  const [tab, setTab] = useState<Tab>('parts');
  // Opening an input tab counts for the new project's first run; it is no edit to undo.
  const seenTabs = history.present.seenTabs;
  useEffect(() => {
    if (seenTabs && INPUT_TABS.includes(tab as InputTab) && !seenTabs.includes(tab as InputTab))
      dispatch({ type: 'results', results: { seenTabs: [...seenTabs, tab as InputTab] } });
  }, [tab, seenTabs]);
  const [dialog, setDialog] = useState<Dialogs>();
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error' | 'conflict'>('saved');
  const version = useRef(stored.version);
  const saved = useRef(stored.document);
  const fileInput = useRef<HTMLInputElement>(null);
  // The project remembers its running job, so a page closed meanwhile picks it up on opening; a
  // job that completed with a layout becomes the project's solution.
  const job = useJob(
    client,
    {
      // Jobs in this browser end with the page, so only Sparrow Pro's are remembered.
      submitted: (jobId) =>
        usesSparrowPro && dispatch({ type: 'results', results: { runningJobId: jobId } }),
      resumed: () => setTab('live'),
      ended: (document) => {
        const completed = document?.state.status === 'completed' && !!document.outcome;
        dispatch({
          type: 'results',
          results: {
            runningJobId: undefined,
            ...(completed && {
              solutions: [{ id: newId(), createdAt: new Date().toISOString(), document }],
            }),
          },
        });
        if (completed) setTab((current) => (current === 'live' ? 'solution' : current));
      },
    },
    // Jobs in this browser end with the page, so leaving the project stops them.
    { stopOnLeave: !usesSparrowPro },
  );
  useEffect(() => {
    const jobId = stored.document.runningJobId;
    if (jobId && usesSparrowPro) void job.resume(jobId);
    // Once, for the job the project remembered when it was opened.
  }, []);
  const running = job.running;

  const showError = useCallback((message: string) => setError(message), []);
  const edit = useCallback(
    (change: (project: ProjectDocument) => ProjectDocument, key?: string) =>
      dispatch({
        type: 'edit',
        project: change(historyRef.current.present),
        key,
        at: performance.now(),
      }),
    [],
  );
  const historyRef = useRef(history);
  historyRef.current = history;

  // Save shortly after each change, one save at a time, and when the page is hidden.
  const latest = useRef(project);
  latest.current = project;
  const pending = useRef(Promise.resolve(true));
  /** Saves the latest document after any save in progress; resolves to whether it is saved. */
  const flush = useCallback(() => {
    pending.current = pending.current.then(async () => {
      while (latest.current !== saved.current) {
        const document = latest.current;
        try {
          version.current = await saveProject(stored.id, document, version.current);
          saved.current = document;
        } catch (reason) {
          setSaveState(isConflict(reason) ? 'conflict' : 'error');
          setError(explain(reason));
          return false;
        }
      }
      setSaveState('saved');
      return true;
    });
    return pending.current;
  }, [stored.id]);
  /** Shows why a project could not be opened or made; a full account opens its projects to make room. */
  const failed = (reason: unknown) => {
    setError(explain(reason));
    if (isProjectLimit(reason)) setDialog({ type: 'projects' });
  };

  /** Goes to another project once this one is saved; a project that does not save stays open. */
  const leave = async (go: () => Promise<void>) => {
    if (job.submitting) throw Error('The job is being submitted; try again in a moment.');
    if (!(await flush())) throw Error('This project is not saved, so it stays open.');
    await go();
  };
  useEffect(() => {
    if (project === saved.current) return;
    setSaveState((state) => (state === 'conflict' ? state : 'saving'));
    // A newly remembered job is saved at once: closing the page must not lose it.
    const now = project.runningJobId !== saved.current.runningJobId;
    const timer = setTimeout(() => void flush(), now ? 0 : 400);
    return () => clearTimeout(timer);
  }, [project, flush]);
  useEffect(() => {
    const now = () => void flush();
    const hidden = () => document.visibilityState === 'hidden' && now();
    window.addEventListener('pagehide', now);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', now);
      document.removeEventListener('visibilitychange', hidden);
      now();
    };
  }, [flush]);

  function startRun() {
    if (
      running ||
      project.runningJobId ||
      startBlockers(project).length ||
      unseenTabs(project).length
    )
      return;
    setError('');
    void job.start(projectRequest(project));
    setTab('live');
  }

  // Leaving the page cancels a save on its way, and a job in this browser; ask first.
  const unsaved = saveState !== 'saved';
  useEffect(() => {
    // Sparrow Pro keeps running a job after the page closes, and the project picks it up again.
    if (!(running && !usesSparrowPro) && !job.submitting && !unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running, unsaved, job.submitting]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      if (
        (event.target as HTMLElement).closest('input, textarea, select') ||
        document.querySelector('dialog[open]')
      )
        return;
      event.preventDefault();
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

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
      project,
      edit,
      unit: preferences.unit,
      preferences,
      setPreferences,
      setTab,
      openPro: () => setDialog({ type: 'pro' }),
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
      reconnect:
        project.runningJobId && !running ? () => void job.resume(project.runningJobId!) : undefined,
      startRun,
      stopRun: job.stop,
    }),
    // startRun reads the current project; it is recreated with it.
    [project, edit, preferences, setPreferences, showError, job.run, running, job.stop],
  );

  const saveLabel = {
    saved: `Saved ${backend.saves}`,
    saving: 'Saving…',
    error: 'Not saved',
    conflict: 'Changed in another tab',
  }[saveState];
  return (
    <StudioContext.Provider value={studio}>
      <div className="app">
        <header className="top-bar">
          <button
            className="brand"
            title="About sparrow studio"
            onClick={() => setDialog({ type: 'about' })}
          >
            <Logo name="sparrow-studio-wordmark" className="brand-wordmark" alt="sparrow studio" />
          </button>
          <ProjectMenu
            name={project.name}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            onAction={(action) => {
              if (action === 'undo' || action === 'redo') dispatch({ type: action });
              else if (action === 'export')
                download(
                  projectFileName(project.name, 'sparrow-project.json'),
                  serializeProject(project),
                  'application/json',
                );
              else if (action === 'open-file') fileInput.current?.click();
              else if (action === 'duplicate')
                void leave(() => create({ ...project, name: `${project.name} copy` })).catch(
                  failed,
                );
              else setDialog({ type: action });
            }}
          />
          <span className={`save-state ${saveState}`} aria-live="polite">
            {saveLabel}
          </span>
          {saveState === 'conflict' && (
            <button className="small" onClick={() => void open(stored.id)}>
              Reload
            </button>
          )}
          <span className="spacer" />
          <button
            className="icon-button"
            aria-label="Preferences"
            title="Preferences"
            onClick={() => setDialog({ type: 'preferences' })}
          >
            <Gear />
          </button>
          <button onClick={() => setDialog({ type: 'pro' })}>Sign in</button>
          <input
            ref={fileInput}
            hidden
            type="file"
            accept=".json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              try {
                // An opened project file counts as new: its tabs are to be opened again.
                const document = { ...parseProject(JSON.parse(await file.text())), seenTabs: [] };
                await leave(() => create(document));
              } catch (reason) {
                failed(reason);
              }
            }}
          />
        </header>
        <nav className="tabs" aria-label="Views">
          {TABS.map((item) => (
            <button
              key={item.id}
              className={item.id === tab ? 'tab active' : 'tab'}
              aria-current={item.id === tab ? 'page' : undefined}
              onClick={() => setTab(item.id)}
            >
              {item.id === 'live' && running && <i className="live-dot" aria-hidden="true" />}
              {item.label}
              {item.id === 'parts' && (
                <span className="count">
                  {project.parts.reduce((sum, part) => sum + part.quantity, 0)}
                </span>
              )}
            </button>
          ))}
        </nav>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="small" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}
        <main className="main">
          {tab === 'parts' && <PartsView />}
          {tab === 'sheets' && <SheetsView />}
          {tab === 'machine' && <MachineView />}
          {tab === 'settings' && <SettingsView />}
          {tab === 'live' && <LiveView />}
          {tab === 'solution' && <SolutionView />}
        </main>
      </div>
      {dialog?.type === 'new' && (
        <NameDialog
          title="New project"
          initial="Untitled project"
          confirm="Create project"
          onClose={() => setDialog(undefined)}
          onConfirm={(name) =>
            void leave(() => create(newProject(name, preferences.defaultMachine))).catch(failed)
          }
        />
      )}
      {dialog?.type === 'rename' && (
        <NameDialog
          title="Rename project"
          initial={project.name}
          confirm="Rename"
          onClose={() => setDialog(undefined)}
          onConfirm={(name) => {
            edit((current) => ({ ...current, name }));
            setDialog(undefined);
          }}
        />
      )}
      {dialog?.type === 'projects' && (
        <ProjectsDialog
          currentId={stored.id}
          onClose={() => setDialog(undefined)}
          onOpen={(id) => void leave(() => open(id)).catch(failed)}
          onDeleted={() => void openLatest().catch(failed)}
        />
      )}
      {dialog?.type === 'examples' && (
        <ExamplesDialog
          onClose={() => setDialog(undefined)}
          onChoose={(file) =>
            void loadExample(file, preferences.defaultMachine)
              .then((example) => leave(() => create(example)))
              .catch(failed)
          }
        />
      )}
      {dialog?.type === 'pro' && <ProDialog onClose={() => setDialog(undefined)} />}
      {dialog?.type === 'about' && <AboutDialog onClose={() => setDialog(undefined)} />}
      {dialog?.type === 'preferences' && (
        <PreferencesDialog
          preferences={preferences}
          onChange={setPreferences}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.type === 'import-files' && (
        <ImportFilesDialog
          kind={dialog.kind}
          onClose={() => setDialog(undefined)}
          onAdd={(parts, widthMm) => {
            if (dialog.kind === 'sheets') {
              // Each outline is a sheet entry, in stock as often as the file asks for its part.
              edit((current) => ({
                ...current,
                stock: {
                  ...current.stock,
                  sheets: [
                    ...current.stock.sheets,
                    ...parts.map((part) => ({
                      id: newId(),
                      name: part.name,
                      shape: part.shape,
                      quantity: Math.max(1, part.quantity),
                    })),
                  ],
                },
              }));
              setDialog(undefined);
              return;
            }
            edit((previous) => {
              const current = addParts(
                previous,
                parts.map((part) => ({ ...part, id: newId() })),
              );
              return {
                ...current,
                stock: widthMm
                  ? { ...current.stock, strip: { ...current.stock.strip, widthMm } }
                  : current.stock,
              };
            });
            setDialog(undefined);
            setTab('parts');
          }}
        />
      )}
      {dialog?.type === 'import-project' && (
        <ImportFromProjectDialog
          kind={dialog.kind}
          currentId={stored.id}
          onClose={() => setDialog(undefined)}
          onImport={importContent}
        />
      )}
    </StudioContext.Provider>
  );
}

type MenuAction =
  | 'new'
  | 'projects'
  | 'examples'
  | 'rename'
  | 'duplicate'
  | 'export'
  | 'open-file'
  | 'undo'
  | 'redo';

function ProjectMenu({
  name,
  canUndo,
  canRedo,
  onAction,
}: {
  name: string;
  canUndo: boolean;
  canRedo: boolean;
  onAction: (action: MenuAction) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const item = (action: MenuAction, label: string, disabled = false) => (
    <button
      disabled={disabled}
      onClick={() => {
        menu.current!.open = false;
        onAction(action);
      }}
    >
      {label}
    </button>
  );
  return (
    <details className="menu" ref={menu}>
      <summary className="button" aria-label={`Project: ${name}`}>
        {name} <ChevronDown />
      </summary>
      <div className="menu-list">
        {item('new', 'New project…')}
        {item('projects', 'Projects…')}
        {item('examples', 'Open example…')}
        <hr />
        {item('rename', 'Rename…')}
        {item('duplicate', 'Duplicate')}
        {item('undo', 'Undo', !canUndo)}
        {item('redo', 'Redo', !canRedo)}
        <hr />
        {item('export', 'Export project file')}
        {item('open-file', 'Open project file…')}
      </div>
    </details>
  );
}
