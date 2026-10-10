import { useState } from 'react';
import { Dialog } from '../Dialog';

export function NameDialog({
  title,
  initial,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string;
  initial: string;
  confirm: string;
  onConfirm: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onConfirm(name.trim());
        }}
      >
        <label className="field">
          Project name
          <input
            required
            maxLength={200}
            value={name}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="dialog-actions inline">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!name.trim()}>
            {confirm}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
