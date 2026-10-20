import { createContext, useContext } from 'react';
import type { DisplayUnit } from '../engine/units';
import type { InputTab, ProjectDocument } from '../project/model';
import type { Preferences } from '../project/preferences';
import type { Runner } from './runs';

/** A project's tabs: its inputs, and its jobs. */
export type Tab = InputTab | 'jobs';

/** What every view needs: the current project, how to change it, and app-wide actions. */
export type Studio = {
  projectId: string;
  project: ProjectDocument;
  /** Apply an edit. Edits with the same key in quick succession form one undo step. */
  edit: (change: (project: ProjectDocument) => ProjectDocument, key?: string) => void;
  unit: DisplayUnit;
  preferences: Preferences;
  setPreferences: (change: Partial<Preferences>) => void;
  setTab: (tab: Tab) => void;
  /** Open the dialog explaining that sparrow pro needs signing in. */
  openPro: () => void;
  /** Open an import dialog for one kind of project content. */
  openImport: (kind: 'parts' | 'sheets' | 'machines', source: 'files' | 'project') => void;
  showError: (message: string) => void;
  /** Follows the jobs of every project. */
  runner: Runner;
  /** Starts a job of the project's inputs as they are now, and shows it. */
  startRun: () => void;
  /** Removes a job that is no longer running, with its result. */
  removeJob: (number: number) => void;
  /** Makes a new project with a job's inputs, and opens it. */
  copyJob: (number: number) => void;
};

export const StudioContext = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const studio = useContext(StudioContext);
  if (!studio) throw Error('useStudio must be used inside the studio.');
  return studio;
}
