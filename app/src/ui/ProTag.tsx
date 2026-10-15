import { Cloud } from './icons';
import { useStudio } from './context';

/** Marks a feature that needs sparrow pro. It is shown, never hidden, and leads to signing in. */
export function ProTag({ label = 'sparrow pro' }: { label?: string }) {
  const { openPro } = useStudio();
  return (
    <button
      type="button"
      className="pro-tag"
      title="Needs sparrow pro. Sign in to use it."
      onClick={openPro}
    >
      <Cloud />
      {label}
    </button>
  );
}

/** A row describing a sparrow pro feature, with its marker. */
export function ProRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="pro-row">
      <span>{children}</span>
      <ProTag />
    </div>
  );
}
