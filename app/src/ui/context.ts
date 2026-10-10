import { createContext, useContext } from 'react';
import type { Job } from '../engine/model';
import type { DisplayUnit } from '../engine/units';
import type { useSolver } from '../engine/workers/useSolver';
import type { ProjectDocument } from '../project/model';
import type { Preferences } from '../project/preferences';

export type Tab = 'parts' | 'sheets' | 'machine' | 'settings' | 'live' | 'solution';

/** What every view needs: the current project, how to change it, and app-wide actions. */
export type Studio = {
  project: ProjectDocument;
  /** Apply an edit. Edits with the same key in quick succession form one undo step. */
  edit: (change: (project: ProjectDocument) => ProjectDocument, key?: string) => void;
  unit: DisplayUnit;
  preferences: Preferences;
  setPreferences: (change: Partial<Preferences>) => void;
  setTab: (tab: Tab) => void;
  /** Open the dialog explaining that sparrow cloud needs signing in. */
  openCloud: () => void;
  /** Open an import dialog for one kind of project content. */
  openImport: (kind: 'parts' | 'sheets' | 'machines', source: 'files' | 'project') => void;
  showError: (message: string) => void;
  solver: ReturnType<typeof useSolver>;
  /** The job of the current or last run in this session. */
  runJob?: Job;
  running: boolean;
  startRun: () => void;
  stopRun: () => void;
};

export const StudioContext = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const studio = useContext(StudioContext);
  if (!studio) throw Error('useStudio must be used inside the studio.');
  return studio;
}
