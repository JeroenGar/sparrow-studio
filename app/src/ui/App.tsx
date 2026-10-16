import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { newId } from '../engine/model';
import { loadExample } from '../project/examples';
import { parseProject, projectFileName, serializeProject } from '../project/file';
import { addParts, newProject, startBlockers, type ProjectDocument } from '../project/model';
import { projectRequest } from '../project/solution';
import { client } from './client';
import { useJob } from './useJob';
import { readPreferences, writePreferences, type Preferences } from '../project/preferences';
import { browserStore, VersionConflict, type StoredProject } from '../project/store';
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
      const project = await browserStore.get(id);
      if (!project) throw Error('This project no longer exists in this browser.');
      setStored(project);
      setPreferences({ lastProjectId: id });
    },
    [setPreferences],
  );
  const create = useCallback(
    async (document: ProjectDocument) => {
      const project = await browserStore.create(document);
      setStored(project);
      setPreferences({ lastProjectId: project.id });
    },
    [setPreferences],
  );
  const openLatest = useCallback(async () => {
    // Open the most recent project that still reads; a draft-format project is skipped.
    for (const project of await browserStore.list()) {
      try {
        return await open(project.id);
      } catch {
        continue;
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
    (last ? open(last).catch(openLatest) : openLatest()).catch((reason: Error) =>
      setError(reason.message),
    );
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
  | { type: 'import-files' }
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
  const [dialog, setDialog] = useState<Dialogs>();
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error' | 'conflict'>('saved');
  const version = useRef(stored.version);
  const saved = useRef(stored.document);
  const fileInput = useRef<HTMLInputElement>(null);
  // A finished job becomes the project's solution when it completed with a layout.
  const job = useJob(client, (document) => {
    if (document.state.status !== 'completed' || !document.outcome) return;
    dispatch({
      type: 'solutions',
      solutions: [{ id: newId(), createdAt: new Date().toISOString(), document }],
    });
    setTab((current) => (current === 'live' ? 'solution' : current));
  });
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

  // Save to browser storage shortly after each change, one save at a time, and when the page is hidden.
  const latest = useRef(project);
  latest.current = project;
  const saving = useRef(false);
  const flush = useCallback(async () => {
    if (saving.current || latest.current === saved.current) return;
    saving.current = true;
    const document = latest.current;
    try {
      const next = await browserStore.save(stored.id, document, version.current);
      version.current = next.version;
      saved.current = document;
    } catch (reason) {
      setSaveState(reason instanceof VersionConflict ? 'conflict' : 'error');
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    } finally {
      saving.current = false;
    }
    if (latest.current !== saved.current) void flush();
    else setSaveState('saved');
  }, [stored.id]);
  useEffect(() => {
    if (project === saved.current) return;
    setSaveState((state) => (state === 'conflict' ? state : 'saving'));
    const timer = setTimeout(() => void flush(), 400);
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
    if (running || startBlockers(project).length) return;
    setError('');
    void job.start(projectRequest(project, Math.floor(Math.random() * 2 ** 53)));
    setTab('live');
  }

  useEffect(() => {
    if (!running) return;
    const leave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [running]);

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
        stock: content.strip
          ? {
              ...current.stock,
              strip: {
                ...current.stock.strip,
                name: content.strip.name,
                widthMm: content.strip.widthMm,
              },
            }
          : current.stock,
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
          source === 'files' && kind === 'parts'
            ? { type: 'import-files' }
            : { type: 'import-project', kind },
        ),
      showError,
      run: job.run,
      running,
      startRun,
      stopRun: job.stop,
    }),
    // startRun reads the current project; it is recreated with it.
    [project, edit, preferences, setPreferences, showError, job.run, running, job.stop],
  );

  const saveLabel = {
    saved: 'Saved in this browser',
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
                void create({ ...project, name: `${project.name} copy` }).catch((reason: Error) =>
                  setError(reason.message),
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
                await create(parseProject(JSON.parse(await file.text())));
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : String(reason));
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
            void create(newProject(name, preferences.defaultMachine)).catch((reason: Error) =>
              setError(reason.message),
            )
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
          onOpen={(id) => void open(id).catch((reason: Error) => setError(reason.message))}
          onDeleted={() => void openLatest().catch((reason: Error) => setError(reason.message))}
        />
      )}
      {dialog?.type === 'examples' && (
        <ExamplesDialog
          onClose={() => setDialog(undefined)}
          onChoose={(file) =>
            void loadExample(file, preferences.defaultMachine)
              .then(create)
              .catch((reason: Error) => setError(reason.message))
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
          onClose={() => setDialog(undefined)}
          onAdd={(parts, widthMm) => {
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
        {item('projects', 'Open project…')}
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
