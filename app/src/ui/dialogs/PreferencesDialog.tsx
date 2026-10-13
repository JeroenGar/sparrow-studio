import type { DisplayUnit } from '../../engine/units';
import type { Preferences } from '../../project/preferences';
import { Dialog } from '../Dialog';

export function PreferencesDialog({
  preferences,
  onChange,
  onClose,
}: {
  preferences: Preferences;
  onChange: (change: Partial<Preferences>) => void;
  onClose: () => void;
}) {
  return (
    <Dialog title="Preferences" onClose={onClose} actions={<button onClick={onClose}>Done</button>}>
      <label className="field">
        Units
        <select
          value={preferences.unit}
          onChange={(event) => onChange({ unit: event.target.value as DisplayUnit })}
        >
          <option value="mm">Millimetres</option>
          <option value="in">Inches</option>
        </select>
      </label>
      <label className="field">
        Appearance
        <select
          value={preferences.theme}
          onChange={(event) => onChange({ theme: event.target.value as Preferences['theme'] })}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label className="choice">
        <input
          type="checkbox"
          checked={!preferences.hideExplanations}
          onChange={(event) => onChange({ hideExplanations: !event.target.checked })}
        />
        Show explanations in the Machine and Settings tabs
      </label>
      <p className="muted">Preferences are kept in this browser.</p>
    </Dialog>
  );
}
