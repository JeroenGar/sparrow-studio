import { Dialog } from '../Dialog';

/** Where signing in will live. sparrow cloud does not exist yet, so this explains instead. */
export function CloudDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="sparrow cloud"
      onClose={onClose}
      actions={<button onClick={onClose}>Close</button>}
    >
      <p>
        sparrow cloud will solve the same projects on a server, with more: sheets in order, remnants
        and irregular sheets, defects and clamp zones, locked placements, reflection and nesting
        inside holes.
      </p>
      <p>
        Signing in is not available yet. Everything in sparrow studio keeps working without an
        account.
      </p>
    </Dialog>
  );
}
