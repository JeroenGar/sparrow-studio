import type { ReactNode } from 'react';
import { useStudio } from './context';

/**
 * Controls that change the project, disabled where it is shown rather than edited, such as the
 * inputs a job ran with: they still show every value.
 */
export function Editable({ className, children }: { className?: string; children: ReactNode }) {
  const { readOnly } = useStudio();
  return (
    <fieldset className={className ? `editable ${className}` : 'editable'} disabled={readOnly}>
      {children}
    </fieldset>
  );
}
