import { useEffect, useState } from 'react';
import { browserStore, type ProjectSummary } from '../../project/store';
import { Dialog } from '../Dialog';
import { Trash } from '../icons';

/** The projects saved in this browser. */
export function ProjectsDialog({
  currentId,
  onOpen,
  onDeleted,
  onClose,
}: {
  currentId: string;
  onOpen: (id: string) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>();
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string>();
  const refresh = () =>
    browserStore
      .list()
      .then(setProjects)
      .catch((reason: Error) => setError(reason.message));
  useEffect(() => void refresh(), []);
  return (
    <Dialog title="Projects in this browser" onClose={onClose} wide>
      {error && <p className="field-error">{error}</p>}
      {!projects && !error && <p className="muted">Loading…</p>}
      <ul className="project-list">
        {projects?.map((project) => (
          <li key={project.id}>
            <button
              className="row"
              disabled={project.id === currentId}
              onClick={() => onOpen(project.id)}
            >
              <span className="row-text">
                <span>{project.name}</span>
                <span className="muted">
                  {project.id === currentId ? 'Open now · ' : ''}Changed{' '}
                  {new Date(project.updatedAt).toLocaleString()}
                </span>
              </span>
            </button>
            {confirming === project.id ? (
              <span className="row-actions">
                <button
                  className="small danger"
                  onClick={async () => {
                    await browserStore.remove(project.id);
                    setConfirming(undefined);
                    if (project.id === currentId) onDeleted();
                    else void refresh();
                  }}
                >
                  Delete
                </button>
                <button className="small" onClick={() => setConfirming(undefined)}>
                  Keep
                </button>
              </span>
            ) : (
              <button
                className="icon-button"
                aria-label={`Delete ${project.name}`}
                onClick={() => setConfirming(project.id)}
              >
                <Trash />
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="muted">
        Projects are saved in this browser only. Export a project file to keep a copy elsewhere.
      </p>
    </Dialog>
  );
}
