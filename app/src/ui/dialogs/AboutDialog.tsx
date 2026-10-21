import { Dialog } from '../Dialog';
import { Logo } from '../Logo';

const links = [
  { href: 'https://github.com/JeroenGar/sparrow-studio', label: 'Source code of sparrow studio' },
  { href: 'https://github.com/JeroenGar/sparrow', label: 'The sparrow nesting algorithm' },
  { href: 'https://doi.org/10.48550/arXiv.2509.13329', label: 'The paper behind sparrow' },
];

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="About sparrow studio"
      onClose={onClose}
      actions={<button onClick={onClose}>Close</button>}
    >
      <Logo name="sparrow-studio-wordmark" className="about-logo" alt="sparrow studio" />
      <p>
        Nest parts to use less material, with the open-source sparrow algorithm running in your
        browser.
      </p>
      <p className="muted">
        Your files and parts stay on this device. Projects are saved in this browser; export a
        project file to keep a copy elsewhere.
      </p>
      <ul className="about-links">
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          </li>
        ))}
        <li>
          <a
            href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`}
            target="_blank"
            rel="noreferrer"
          >
            Third-party notices
          </a>
        </li>
      </ul>
      <p className="muted">Open source under the MIT license.</p>
    </Dialog>
  );
}
