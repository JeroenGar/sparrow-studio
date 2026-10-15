import type { ReactNode } from 'react';
import { useStudio } from '../context';

/** The canvas area of the Machine and Settings tabs: an explanation of the selected item. */
export function Explanation({ title, children }: { title: string; children: ReactNode }) {
  const { preferences, setPreferences } = useStudio();
  if (preferences.hideExplanations)
    return (
      <section className="explanation collapsed" aria-label="Explanation">
        <button className="small" onClick={() => setPreferences({ hideExplanations: false })}>
          Show explanations
        </button>
      </section>
    );
  return (
    <section className="explanation" aria-label="Explanation">
      <button
        className="small hide-explanation"
        onClick={() => setPreferences({ hideExplanations: true })}
      >
        Hide explanations
      </button>
      <article className="card">
        <span className="label">{title}</span>
        {children}
      </article>
    </section>
  );
}
