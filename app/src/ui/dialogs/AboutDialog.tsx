import { Dialog } from '../Dialog';
import { Logo } from '../Logo';

/** About studio: its logo, where its source is, and the notices of what it is built with. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="About" onClose={onClose} actions={<button onClick={onClose}>Close</button>}>
      <Logo name="sparrow-studio-wordmark" className="about-logo" alt="sparrow studio" />
      <p className="about-links">
        <a href="https://github.com/JeroenGar/sparrow-studio" target="_blank" rel="noreferrer">
          Source code
        </a>
        <span className="muted">· open source under the MIT license ·</span>
        <a
          href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`}
          target="_blank"
          rel="noreferrer"
        >
          Third-party notices
        </a>
      </p>
    </Dialog>
  );
}
