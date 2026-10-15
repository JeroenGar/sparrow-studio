import { Dialog } from '../Dialog';

/** Where signing in will live. sparrow pro does not exist yet, so this explains instead. */
export function ProDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="sparrow pro"
      onClose={onClose}
      actions={<button onClick={onClose}>Close</button>}
    >
      <p>
        sparrow pro will solve the same projects on a server, with more: sheets in order, remnants
        and irregular sheets, defects and clamp zones, locked placements, reflection and nesting
        inside holes.
      </p>
      <p>
        Without an account, sparrow studio solves with open-source sparrow, entirely in your browser
        and for free. That solver has a fixed set of features; nothing is held back. Signing in is
        not available yet.
      </p>
    </Dialog>
  );
}
