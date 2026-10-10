import { useEffect, useState } from 'react';
import { loadCatalog, type Example } from '../../project/examples';
import { Dialog } from '../Dialog';

/** Bundled benchmark instances, opened as new projects. */
export function ExamplesDialog({
  onChoose,
  onClose,
}: {
  onChoose: (file: string) => void;
  onClose: () => void;
}) {
  const [examples, setExamples] = useState<Example[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    loadCatalog()
      .then(setExamples)
      .catch((reason: Error) => setError(reason.message));
  }, []);
  const groups = [...new Set(examples?.map((example) => example.group))];
  return (
    <Dialog title="Open an example" onClose={onClose} wide>
      <p className="muted">
        Benchmark instances from nesting research, scaled to a typical part size. Each opens as a
        new project.
      </p>
      {error && <p className="field-error">{error}</p>}
      {groups.map((group) => (
        <section key={group} className="stack">
          <span className="label">{group}</span>
          <div className="example-grid">
            {examples!
              .filter((example) => example.group === group)
              .map((example) => (
                <button key={example.id} className="example" onClick={() => onChoose(example.file)}>
                  <strong>{example.id}</strong>
                  <span className="muted">
                    {example.partTypes} types · {example.copies} copies
                    {example.continuous ? ' · free rotation' : ''}
                  </span>
                </button>
              ))}
          </div>
        </section>
      ))}
    </Dialog>
  );
}
