import { useEffect, useState } from 'react';
import { backend, usesSparrowPro } from '../client';
import { deleteProject, listProjects, projectVersion, type ProjectSummary } from '../projects';
import { Dialog } from '../Dialog';
import { Trash } from '../icons';
import { explain } from '../explain';

/** The saved projects. */
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
  // The project to delete, with its version when asked: a deletion removes only what was seen.
  const [confirming, setConfirming] = useState<{ id: string; version: string }>();
  const [deleting, setDeleting] = useState(false);
  const fail = (reason: unknown) => setError(explain(reason));
  const refresh = () =>
    listProjects()
      .then(setProjects)
      .catch((reason) => setError(explain(reason)));
  useEffect(() => void refresh(), []);
  return (
    <Dialog title={`Projects ${backend.saves}`} onClose={onClose} wide>
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
                  {new Date(project.updated_at).toLocaleString()}
                </span>
              </span>
            </button>
            {confirming?.id === project.id ? (
              <span className="row-actions">
                <button
                  className="small danger"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      await deleteProject(confirming.id, confirming.version);
                      setConfirming(undefined);
                      if (project.id === currentId) onDeleted();
                      else void refresh();
                    } catch (reason) {
                      // Such as a project changed since: it stays, and the list shows it as it is now.
                      fail(reason);
                      setConfirming(undefined);
                      void refresh();
                    } finally {
                      setDeleting(false);
                    }
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
                onClick={() =>
                  projectVersion(project.id).then(
                    (version) => setConfirming({ id: project.id, version }),
                    fail,
                  )
                }
              >
                <Trash />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!usesSparrowPro && (
        <p className="muted">
          Projects are saved in this browser only. Export a project file to keep a copy elsewhere.
        </p>
      )}
    </Dialog>
  );
}
