import type { DisplayUnit } from '../engine/units';
import type { MachinePreset } from './model';

/** Per-browser conveniences. They become account settings with sparrow cloud. */
export type Preferences = {
  theme: 'system' | 'light' | 'dark';
  unit: DisplayUnit;
  lastProjectId?: string;
  /** Copied into every new project. */
  defaultMachine?: MachinePreset;
  hideExplanations: boolean;
};

const KEY = 'sparrow-studio-preferences';
const DEFAULTS: Preferences = { theme: 'system', unit: 'mm', hideExplanations: false };

export function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Preferences>;
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writePreferences(preferences: Preferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Preferences still apply for this visit when storage is unavailable.
  }
}
