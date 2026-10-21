import { Dialog } from '../Dialog';
import { Logo } from '../Logo';

/** About studio: its logo, until its text is written again. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="About" onClose={onClose} actions={<button onClick={onClose}>Close</button>}>
      <Logo name="sparrow-studio-wordmark" className="about-logo" alt="sparrow studio" />
    </Dialog>
  );
}
