import { useCallback, useEffect, useRef, useState } from 'react';
import { loadExample } from '../project/examples';
import { parseProject, projectFileName, serializeProject } from '../project/file';
import { newProject, type ProjectDocument } from '../project/model';
import { readPreferences, writePreferences, type Preferences } from '../project/preferences';
import { backend, client } from './client';
import { AboutDialog } from './dialogs/AboutDialog';
import { ExamplesDialog } from './dialogs/ExamplesDialog';
import { NameDialog } from './dialogs/NameDialog';
import { PreferencesDialog } from './dialogs/PreferencesDialog';
import { ProDialog } from './dialogs/ProDialog';
import { Dialog } from './Dialog';
import { download } from './download';
import { explain } from './explain';
import { HomePage } from './HomePage';
import { ChevronDown, Gear } from './icons';
import { Logo } from './Logo';
import { ProjectPage } from './ProjectPage';
import { isProjectLimit } from './projects';
import { go, useRoute } from './route';
import {
  createWorkspace,
  entryName,
  useWorkspace,
  type OpenEntry,
  type ProjectEntry,
} from './workspace';

const FIRST_EXAMPLE = 'albano.json';

/** Every project of the account, loaded once at startup. */
const workspace = createWorkspace(client);

type Dialogs =
  | { type: 'new' }
  | { type: 'examples' }
  | { type: 'pro' }
  | { type: 'preferences' }
  | { type: 'about' }
  | { type: 'rename'; id: string; name: string }
  | { type: 'delete'; entry: ProjectEntry };

/** The page for the location: home, or a project, under the top bar. */
export default function App() {
  const [preferences, setPreferencesState] = useState(readPreferences);
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

  const state = useWorkspace(workspace);
  const route = useRoute();
  const [dialog, setDialog] = useState<Dialogs>();
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const showError = useCallback((message: string) => setError(message), []);
  const openPro = useCallback(() => setDialog({ type: 'pro' }), []);
  /** Shows why something failed; a full account goes home, where projects can be deleted. */
  const failed = (reason: unknown) => {
    setError(explain(reason));
    if (isProjectLimit(reason)) go({ page: 'home' });
  };
  /** Creates a project and opens it. */
  const create = async (document: ProjectDocument) => {
    const id = await workspace.create(document);
    setDialog(undefined);
    go({ page: 'project', id, tab: 'parts' });
  };

  useEffect(() => {
    const start = async () => {
      try {
        await workspace.load();
      } catch {
        // The page says why, with a way to try again.
        return;
      }
      const loaded = workspace.get();
      if (loaded.status !== 'ready' || loaded.projects.length) return;
      // An account without projects starts with an example to try.
      const example = await loadExample(FIRST_EXAMPLE, readPreferences().defaultMachine).catch(() =>
        newProject('Untitled project'),
      );
      const id = await workspace.create(example);
      go({ page: 'project', id, tab: 'parts' }, { replace: true });
    };
    start().catch(failed);
    // Load once, at startup.
  }, []);

  // Save at once when the page is hidden, and ask before leaving with changes not saved yet.
  useEffect(() => {
    const now = () => void workspace.flushAll();
    const hidden = () => document.visibilityState === 'hidden' && now();
    window.addEventListener('pagehide', now);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', now);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  const unsaved = state.status === 'ready' && workspace.unsaved();
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const entry = route.page === 'project' ? workspace.find(route.id) : undefined;
  const open = entry?.status === 'open' ? entry : undefined;

  let page;
  if (state.status === 'loading') page = <p className="boot">Opening sparrow studio…</p>;
  else if (state.status === 'failed')
    page = (
      <div className="boot stack">
        <p>sparrow studio could not load your projects: {state.error}</p>
        <span>
          <button onClick={() => void workspace.load().catch(() => {})}>Try again</button>
        </span>
      </div>
    );
  else if (route.page === 'home')
    page = (
      <HomePage
        state={state}
        onNew={() => setDialog({ type: 'new' })}
        onExample={() => setDialog({ type: 'examples' })}
        onOpenFile={() => fileInput.current?.click()}
        onRetry={(id) => void workspace.reload(id)}
        onDelete={(entry) => setDialog({ type: 'delete', entry })}
      />
    );
  else if (!entry)
    page = (
      <div className="boot stack">
        <p>This project is not here. It may have been deleted.</p>
        <span>
          <a href="#/">Go to your projects</a>
        </span>
      </div>
    );
  else if (entry.status === 'loading') page = <p className="boot">Opening {entry.name}…</p>;
  else if (entry.status === 'failed')
    page = (
      <div className="boot stack">
        <p>
          Could not open {entry.name}: {entry.error}
        </p>
        <span className="row-actions">
          <button onClick={() => void workspace.reload(entry.id)}>Try again</button>
          <a href="#/">Go to your projects</a>
        </span>
      </div>
    );
  else
    page = (
      <ProjectPage
        key={entry.id}
        workspace={workspace}
        entry={entry}
        tab={route.page === 'project' ? route.tab : 'parts'}
        preferences={preferences}
        setPreferences={setPreferences}
        openPro={openPro}
        showError={showError}
      />
    );

  return (
    <>
      <div className="app">
        <header className="top-bar">
          <button
            className="brand"
            title="About sparrow studio"
            onClick={() => setDialog({ type: 'about' })}
          >
            <Logo name="sparrow-studio-wordmark" className="brand-wordmark" alt="sparrow studio" />
          </button>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            {route.page === 'home' ? (
              <span className="crumb" aria-current="page">
                Home
              </span>
            ) : (
              <>
                <a className="crumb" href="#/">
                  Home
                </a>
                <span aria-hidden="true">›</span>
                <span className="crumb" aria-current="page">
                  {entry ? entryName(entry) : 'Project'}
                </span>
                {open && <SaveState entry={open} />}
              </>
            )}
          </nav>
          <span className="spacer" />
          {open && (
            <ProjectMenu
              canUndo={open.history.past.length > 0}
              canRedo={open.history.future.length > 0}
              onAction={(action) => {
                const project = open.history.present;
                if (action === 'undo') workspace.undo(open.id);
                else if (action === 'redo') workspace.redo(open.id);
                else if (action === 'rename')
                  setDialog({ type: 'rename', id: open.id, name: project.name });
                else if (action === 'delete') setDialog({ type: 'delete', entry: open });
                else if (action === 'export')
                  download(
                    projectFileName(project.name, 'sparrow-project.json'),
                    serializeProject(project),
                    'application/json',
                  );
                // A copy has the project's inputs; its jobs stay with the project.
                else
                  void create({ ...project, name: `${project.name} copy`, jobs: [] }).catch(failed);
              }}
            />
          )}
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
                await create({ ...parseProject(JSON.parse(await file.text())), seenTabs: [] });
              } catch (reason) {
                failed(reason);
              }
            }}
          />
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="small" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}
        {page}
      </div>
      {dialog?.type === 'new' && (
        <NameDialog
          title="New project"
          initial="Untitled project"
          confirm="Create project"
          onClose={() => setDialog(undefined)}
          onConfirm={(name) =>
            void create(newProject(name, preferences.defaultMachine)).catch(failed)
          }
        />
      )}
      {dialog?.type === 'rename' && (
        <NameDialog
          title="Rename project"
          initial={dialog.name}
          confirm="Rename"
          onClose={() => setDialog(undefined)}
          onConfirm={(name) => {
            workspace.edit(dialog.id, (current) => ({ ...current, name }));
            setDialog(undefined);
          }}
        />
      )}
      {dialog?.type === 'delete' && (
        <DeleteDialog
          entry={dialog.entry}
          onClose={() => setDialog(undefined)}
          onDelete={async () => {
            const id = dialog.entry.id;
            if (route.page === 'project' && route.id === id)
              go({ page: 'home' }, { replace: true });
            setDialog(undefined);
            await workspace.remove(id).catch(failed);
          }}
        />
      )}
      {dialog?.type === 'examples' && (
        <ExamplesDialog
          onClose={() => setDialog(undefined)}
          onChoose={(file) =>
            void loadExample(file, preferences.defaultMachine).then(create).catch(failed)
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
    </>
  );
}

/** Whether the project's edits are saved, and a way to load it again when another tab changed it. */
function SaveState({ entry }: { entry: OpenEntry }) {
  const { save } = entry;
  const label = {
    saved: `Saved ${backend.saves}`,
    saving: 'Saving…',
    error: 'Not saved',
    conflict: 'Changed in another tab',
  }[save.state];
  return (
    <>
      <span
        className={`save-state ${save.state}`}
        title={'message' in save ? save.message : undefined}
        aria-live="polite"
      >
        · {label}
      </span>
      {save.state === 'conflict' && (
        <button className="small" onClick={() => void workspace.reload(entry.id)}>
          Reload
        </button>
      )}
    </>
  );
}

/** Asks before deleting a project, with its jobs. */
function DeleteDialog({
  entry,
  onDelete,
  onClose,
}: {
  entry: ProjectEntry;
  onDelete: () => void;
  onClose: () => void;
}) {
  const jobs = entry.status === 'open' ? entry.history.present.jobs.length : 0;
  return (
    <Dialog
      title="Delete project"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Keep</button>
          <button className="danger" onClick={onDelete}>
            Delete
          </button>
        </>
      }
    >
      <p>
        Delete <strong>{entryName(entry)}</strong>
        {jobs > 0 && ` and its ${jobs === 1 ? 'job' : `${jobs} jobs`}`}? This cannot be undone.
      </p>
    </Dialog>
  );
}

type MenuAction = 'rename' | 'duplicate' | 'undo' | 'redo' | 'export' | 'delete';

function ProjectMenu({
  canUndo,
  canRedo,
  onAction,
}: {
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
    <details className="menu right" ref={menu}>
      <summary className="button">
        Project <ChevronDown />
      </summary>
      <div className="menu-list">
        {item('rename', 'Rename…')}
        {item('duplicate', 'Duplicate')}
        {item('undo', 'Undo', !canUndo)}
        {item('redo', 'Redo', !canRedo)}
        <hr />
        {item('export', 'Export project file')}
        <hr />
        {item('delete', 'Delete project…')}
      </div>
    </details>
  );
}
