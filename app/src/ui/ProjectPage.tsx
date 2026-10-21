import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newId } from '../engine/model';
import {
  addParts,
  copyCount,
  INPUT_TABS,
  jobInput,
  runningJobs,
  startBlockers,
  unseenTabs,
  type InputTab,
  type ProjectDocument,
} from '../project/model';
import type { Preferences } from '../project/preferences';
import { StudioContext, useStudio, type Studio, type Tab } from './context';
import { ImportFilesDialog } from './dialogs/ImportFilesDialog';
import { ImportFromProjectDialog, type ProjectImport } from './dialogs/ImportFromProjectDialog';
import { parseProject, serializeProject } from '../project/file';
import { beyondProject, projectFromJob } from '../project/solution';
import { explain } from './explain';
import { formatSeconds, formatWhen } from './format';
import { go, href, type JobView } from './route';
import type { Runner } from './runs';
import { JobsView } from './views/JobsView';
import { MachineView } from './views/MachineView';
import { PartsView } from './views/PartsView';
import { SettingsView } from './views/SettingsView';
import { SheetsView } from './views/SheetsView';
import type { OpenEntry, Workspace } from './workspace';

const TABS: { id: Tab; label: string }[] = [
  { id: 'parts', label: 'Parts' },
  { id: 'sheets', label: 'Sheets' },
  { id: 'machine', label: 'Machine' },
  { id: 'settings', label: 'Settings' },
  { id: 'jobs', label: 'Jobs' },
];

type Dialogs =
  | { type: 'import-files'; kind: 'parts' | 'sheets' }
  | { type: 'import-project'; kind: 'parts' | 'sheets' | 'machines' };

/**
 * One project: its input tabs and its jobs, with one job open in Jobs. Its document, edits and
 * saving belong to the workspace; its jobs are followed by the runner.
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
  // A job is open in the Jobs tab; its inputs are shown on their own.
  const tab: Tab | undefined =
    'tab' in shown ? shown.tab : shown.view === 'layout' ? 'jobs' : undefined;
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
  // An import dialog edits the project: it closes where the project is only shown, a job's inputs.
  const inputs = 'job' in shown && shown.view === 'inputs';
  useEffect(() => {
    if (inputs) setDialog(undefined);
  }, [inputs]);
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
  const copyJob = useCallback(
    (number: number) => {
      const job = project.jobs.find((job) => job.number === number);
      if (!job) return;
      // A job from a project file may ask what a project cannot hold, such as locked placements.
      let copy: ProjectDocument;
      try {
        const beyond = beyondProject(jobInput(job));
        if (beyond) throw Error(`${beyond}.`);
        copy = parseProject(JSON.parse(serializeProject(projectFromJob(project, job))));
      } catch (reason) {
        showError(`This job's inputs cannot become a project: ${explain(reason)}`);
        return;
      }
      workspace.create(copy).then(
        (copy) => go({ page: 'project', id: copy, tab: 'parts' }),
        (reason) => showError(explain(reason)),
      );
    },
    [workspace, project, showError],
  );
  const removeJob = useCallback(
    (number: number) =>
      workspace.results(id, (present) => ({
        // A running job stays: it is stopped first.
        jobs: present.jobs.filter((job) => job.number !== number || job.stage === 'running'),
      })),
    [workspace, id],
  );

  // A job's inputs are only shown: undo there would change the project unseen.
  const previewing = useRef(false);
  previewing.current = inputs;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      if (previewing.current) return;
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
      readOnly: false,
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
      copyJob,
    }),
    // startRun reads the current project; it is recreated with it.
    [
      id,
      project,
      edit,
      preferences,
      setPreferences,
      setTab,
      openPro,
      showError,
      runner,
      removeJob,
      copyJob,
    ],
  );
  const running = runningJobs(project).length;

  return (
    <StudioContext.Provider value={studio}>
      {'job' in shown && shown.view === 'inputs' ? (
        <JobPreview number={shown.job} />
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
                {item.id === 'jobs' && running > 0 && (
                  <i
                    className="live-dot"
                    role="img"
                    aria-label={`${running} ${running === 1 ? 'job' : 'jobs'} running`}
                  />
                )}
                {item.label}
                {item.id === 'parts' && <span className="count">{copyCount(project.parts)}</span>}
                {item.id === 'jobs' && project.jobs.length > 0 && (
                  <span className="count">{project.jobs.length}</span>
                )}
              </a>
            ))}
          </nav>
          <main className="main">
            {tab === 'parts' && <PartsView />}
            {tab === 'sheets' && <SheetsView />}
            {tab === 'machine' && <MachineView />}
            {tab === 'settings' && <SettingsView />}
            {tab === 'jobs' && <JobsView number={'job' in shown ? shown.job : undefined} />}
          </main>
        </>
      )}
      {!inputs && dialog?.type === 'import-files' && (
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
      {!inputs && dialog?.type === 'import-project' && (
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

/** The input tabs, with the one shown. */
const INPUT_TAB_LINKS = TABS.filter((item) => item.id !== 'jobs');

/**
 * The project as a job ran it, shown and not saved: its input tabs, read-only, under a banner that
 * goes back to the job or saves these inputs as a new project.
 */
function JobPreview({ number }: { number: number }) {
  const studio = useStudio();
  const { projectId, project, copyJob } = studio;
  const job = project.jobs.find((job) => job.number === number);
  const [tab, setTab] = useState<InputTab>('parts');
  // Built once for the job's record, from the project as it was then: its other jobs ending
  // meanwhile change nothing shown, such as which machine is open.
  const opened = useRef(project);
  const preview = useMemo(() => job && projectFromJob(opened.current, job), [job]);
  const asked = job && (job.stage === 'ended' ? job.document.settings : job.request.settings);
  const beyond = useMemo(() => job && beyondProject(jobInput(job)), [job]);
  const shown: Studio | undefined = useMemo(
    () =>
      preview && {
        ...studio,
        project: preview,
        readOnly: true,
        edit: () => {},
        openImport: () => {},
        setTab: (tab: Tab) => tab !== 'jobs' && setTab(tab),
      },
    [studio, preview],
  );
  if (!job || !shown)
    return (
      <div className="boot stack">
        <p>
          {project.name} has no job #{number}. It may have been removed.
        </p>
        <span>
          <a href={href({ page: 'project', id: projectId, tab: 'jobs' })}>
            Show the jobs of {project.name}
          </a>
        </span>
      </div>
    );
  return (
    <StudioContext.Provider value={shown}>
      <div className="preview-banner" role="status">
        <span className="grow">
          <strong>
            A preview of {project.name} as job #{number} ran it,{' '}
            {formatWhen(job.submittedAt).toLowerCase()}.
          </strong>{' '}
          Nothing here can be changed or is saved.
          {asked &&
            preview &&
            asked.time_limit_seconds !== preview.settings.timeLimitSeconds &&
            ` It searched for up to ${formatSeconds(asked.time_limit_seconds)}; a project offers ${formatSeconds(preview.settings.timeLimitSeconds)} at the nearest, as shown here and saved.`}
          {beyond && ` It shows less than the job asked, as ${beyond}, so it cannot be saved.`}
        </span>
        <a
          className="button small"
          href={href({ page: 'job', id: projectId, number, view: 'layout' })}
        >
          Back to #{number}
        </a>
        <button className="small primary" disabled={!!beyond} onClick={() => copyJob(number)}>
          Save as a new project
        </button>
      </div>
      <nav className="tabs" aria-label={`Inputs of job #${number}`}>
        {INPUT_TAB_LINKS.map((item) => (
          <button
            key={item.id}
            className={item.id === tab ? 'tab active' : 'tab'}
            aria-current={item.id === tab ? 'page' : undefined}
            onClick={() => setTab(item.id as InputTab)}
          >
            {item.label}
            {item.id === 'parts' && <span className="count">{copyCount(preview!.parts)}</span>}
          </button>
        ))}
      </nav>
      <main className="main">
        {tab === 'parts' && <PartsView />}
        {tab === 'sheets' && <SheetsView />}
        {tab === 'machine' && <MachineView />}
        {tab === 'settings' && <SettingsView />}
      </main>
    </StudioContext.Provider>
  );
}
