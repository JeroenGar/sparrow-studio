import { useEffect, useRef, type ReactNode } from 'react';
import { Close } from './icons';

/** A modal dialog on the native element, which handles focus and Escape. */
export function Dialog({
  title,
  onClose,
  children,
  actions,
  size,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  /** Wider than a form, or large, over most of the page. */
  size?: 'wide' | 'large';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // Start in the first field, not on the close button, so Enter submits the dialog's form.
    dialog.querySelector<HTMLElement>('.dialog-body :is(input, select, textarea)')?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className={size ? `dialog ${size}` : 'dialog'}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="dialog-header">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <Close />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
      {actions && <footer className="dialog-actions">{actions}</footer>}
    </dialog>
  );
}
