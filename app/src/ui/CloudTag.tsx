import { Cloud } from './icons';
import { useStudio } from './context';

/** Marks a feature that needs sparrow cloud. It is shown, never hidden, and leads to signing in. */
export function CloudTag({ label = 'sparrow cloud' }: { label?: string }) {
  const { openCloud } = useStudio();
  return (
    <button
      type="button"
      className="cloud-tag"
      title="Needs sparrow cloud. Sign in to use it."
      onClick={openCloud}
    >
      <Cloud />
      {label}
    </button>
  );
}

/** A row describing a sparrow cloud feature, with its marker. */
export function CloudRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="cloud-row">
      <span>{children}</span>
      <CloudTag />
    </div>
  );
}
