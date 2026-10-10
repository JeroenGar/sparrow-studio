import type { ProjectDocument } from '../project/model';

/** Undo history for project edits. Solutions are results, not edits, so undo never removes them. */
export type History = {
  present: ProjectDocument;
  past: ProjectDocument[];
  future: ProjectDocument[];
  lastKey?: string;
  lastAt: number;
};

export type HistoryAction =
  | { type: 'load'; project: ProjectDocument }
  | { type: 'edit'; project: ProjectDocument; key?: string; at: number }
  | { type: 'solutions'; solutions: ProjectDocument['solutions'] }
  | { type: 'undo' }
  | { type: 'redo' };

const LIMIT = 100;
const COALESCE_MS = 1200;

export const initialHistory = (project: ProjectDocument): History => ({
  present: project,
  past: [],
  future: [],
  lastAt: 0,
});

export function historyReducer(state: History, action: HistoryAction): History {
  switch (action.type) {
    case 'load':
      return initialHistory(action.project);
    case 'edit': {
      if (action.project === state.present) return state;
      const coalesce =
        action.key !== undefined &&
        action.key === state.lastKey &&
        action.at - state.lastAt < COALESCE_MS;
      return {
        present: action.project,
        past: coalesce ? state.past : [...state.past, state.present].slice(-LIMIT),
        future: [],
        lastKey: action.key,
        lastAt: action.at,
      };
    }
    case 'solutions':
      return { ...state, present: { ...state.present, solutions: action.solutions } };
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        present: { ...previous, solutions: state.present.solutions },
        past: state.past.slice(0, -1),
        future: [state.present, ...state.future],
        lastAt: 0,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        present: { ...next, solutions: state.present.solutions },
        past: [...state.past, state.present],
        future: state.future.slice(1),
        lastAt: 0,
      };
    }
  }
}
