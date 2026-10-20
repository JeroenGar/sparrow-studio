import { useRef, useState } from 'react';
import { bounds } from '../../engine/geometry/normalize';
import { colors } from '../../engine/colors';
import type { ImportReview } from '../../engine/import/sparrow';
import type { Part } from '../../engine/model';
import type { ImportedSheet, Role } from '../../engine/import/drawing';
import type { ImportFile } from '../../engine/workers/protocol';
import { geometryTask } from '../../engine/workers/geometryTask';
import { ringsPath } from '../Canvas';
import { usesSparrowPro } from '../client';
import { useStudio } from '../context';
import { Dialog } from '../Dialog';
import { formatLength, inputLength, parseLength } from '../format';
import { outline } from '../../engine/geometry/contour';

/** How the files are read: units, accuracy, each layer's role once chosen, and merging copies. */
type Options = { scale: number; tolerance: number; roles?: Record<string, Role>; merge: boolean };

const ROLE_NAMES: Record<Role, string> = {
  parts: 'Parts',
  sheets: 'Sheets',
  defects: 'Defects of sheets',
  ignored: 'Leave out',
};

const MAX_FILE = 10 * 1024 * 1024;
const MAX_BATCH = 25 * 1024 * 1024;

/**
 * Import parts, sheets and their defects from files, after a preview. Each layer of a drawing
 * has a role, suggested from its name, else `kind`, the content the import was opened for.
 */
export function ImportFilesDialog({
  kind,
  onAdd,
  onClose,
}: {
  kind: 'parts' | 'sheets';
  onAdd: (parts: Part[], sheets: ImportedSheet[], stripWidthMm?: number) => void;
  onClose: () => void;
}) {
  const { unit } = useStudio();
  const picker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ImportFile[]>();
  const [scale, setScale] = useState(1);
  const [toleranceText, setToleranceText] = useState(inputLength(0.01, unit));
  // Unset until the first preview suggests them.
  const [roles, setRoles] = useState<Record<string, Role>>();
  const [merge, setMerge] = useState(true);
  // A preview remembers what it was made from; it is outdated as soon as any of that changes.
  const [reviewed, setReviewed] = useState<{
    files: ImportFile[];
    options: Options;
    review: ImportReview;
  }>();
  const [exclude, setExclude] = useState(false);
  const [useWidth, setUseWidth] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(0);

  const tolerance = parseLength(toleranceText, unit);
  const toleranceValid = Number.isFinite(tolerance) && tolerance > 0 && tolerance <= 100;
  const options: Options = { scale, tolerance, roles, merge };
  const review = reviewed?.review;
  const stale =
    !!reviewed &&
    (reviewed.files !== files || JSON.stringify(reviewed.options) !== JSON.stringify(options));

  async function read(list: FileList | File[]) {
    const batch = Array.from(list);
    if (!batch.length) return;
    if (
      batch.some((file) => file.size > MAX_FILE) ||
      batch.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH
    ) {
      setError('Import limit: 10 MiB per file, 25 MiB per batch.');
      return;
    }
    setError('');
    const read = await Promise.all(
      batch.map(async (file) => ({ name: file.name, text: await file.text() })),
    );
    // New files start with suggested roles.
    setFiles(read);
    setRoles(undefined);
    setReviewed(undefined);
    void preview(read, { ...options, roles: undefined });
  }

  async function preview(list: ImportFile[], chosen: Options) {
    const request = ++latest.current;
    setBusy(true);
    setError('');
    setExclude(false);
    try {
      const reply = await geometryTask({
        type: 'import',
        runId: request,
        documentRevision: 1,
        files: list,
        kind,
        ...chosen,
        // Sparrow Pro nests curves as they are; open-source sparrow nests polygons.
        curves: usesSparrowPro ? 'keep' : 'flatten',
      });
      if (request !== latest.current) return;
      if (reply.type !== 'import-review') throw Error('Could not read these files.');
      // The roles the files were read with, suggested ones included, are the ones shown.
      const used = { ...chosen, roles: reply.review.roles };
      setRoles(used.roles);
      setReviewed({ files: list, options: used, review: reply.review });
    } catch (reason) {
      if (request !== latest.current) return;
      setReviewed(undefined);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === latest.current) setBusy(false);
    }
  }

  const hasDrawings = !!files?.some((file) => !file.text.trimStart().startsWith('{'));
  const isInstance = files?.length === 1 && files[0].text.trimStart().startsWith('{');
  const availableLayers = review?.layers ?? [];
  const parts = review?.document.parts ?? [];
  const sheets = review?.sheets ?? [];
  const blocked =
    !review ||
    stale ||
    busy ||
    !(parts.length + sheets.length) ||
    (!!review.issues?.length && !exclude);
  const copies = parts.reduce((sum, part) => sum + part.quantity, 0);
  const sheetCount = sheets.reduce((sum, sheet) => sum + sheet.quantity, 0);
  const adding = [
    parts.length && `${copies} ${copies === 1 ? 'part' : 'parts'}`,
    sheets.length && `${sheetCount} ${sheetCount === 1 ? 'sheet' : 'sheets'}`,
  ]
    .filter(Boolean)
    .join(' and ');
  // A role chosen for a layer takes effect at once.
  const setRole = (layer: string, role: Role) => {
    if (!files) return;
    const next = { ...roles, [layer]: role };
    setRoles(next);
    void preview(files, { ...options, roles: next });
  };

  return (
    <Dialog
      title="Import from files"
      onClose={onClose}
      wide
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          {stale ? (
            <button
              className="primary"
              disabled={busy || !toleranceValid}
              onClick={() => files && void preview(files, options)}
            >
              Update preview
            </button>
          ) : (
            <button
              className="primary"
              disabled={blocked}
              onClick={() =>
                onAdd(
                  parts,
                  sheets,
                  isInstance && useWidth ? review!.document.settings.materialWidthMm : undefined,
                )
              }
            >
              {adding ? `Add ${adding}` : 'Add'}
            </button>
          )}
        </>
      }
    >
      <div
        className="drop-zone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void read(event.dataTransfer.files);
        }}
      >
        <p>
          {files
            ? files.map((file) => file.name).join(', ')
            : 'Drop DXF, SVG or sparrow JSON files here.'}
        </p>
        <button onClick={() => picker.current?.click()}>
          {files ? 'Choose other files…' : 'Choose files…'}
        </button>
        <input
          ref={picker}
          hidden
          type="file"
          multiple
          accept=".json,.svg,.dxf"
          onChange={(event) => {
            if (event.target.files) void read(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
      {files && (
        <div className="import-options">
          <label className="field">
            One drawing unit
            <select value={scale} onChange={(event) => setScale(Number(event.target.value))}>
              <option value="1">1 mm</option>
              <option value="25.4">1 inch · 25.4 mm</option>
            </select>
            <span className="muted">Used when a file has no units of its own.</span>
          </label>
          {hasDrawings && !usesSparrowPro && (
            <label className="field">
              Curve accuracy, {unit}
              <input
                className="mono"
                value={toleranceText}
                aria-invalid={!toleranceValid}
                onChange={(event) => setToleranceText(event.target.value)}
              />
              {!toleranceValid && (
                <span className="field-error">Enter a positive distance up to 100 mm.</span>
              )}
              <span className="muted">Curves become straight segments within this distance.</span>
            </label>
          )}
          {hasDrawings && (
            <label className="choice">
              <input
                type="checkbox"
                checked={merge}
                onChange={(event) => {
                  setMerge(event.target.checked);
                  if (files) void preview(files, { ...options, merge: event.target.checked });
                }}
              />
              Count identical outlines as one item with a quantity
            </label>
          )}
          {availableLayers.length > 0 && roles && (
            <fieldset className="field layer-roles">
              <legend>Layers</legend>
              {availableLayers.map((layer) => (
                <label key={layer} className="layer-role">
                  <span className="grow">
                    {layer}
                    <span className="muted mono"> · {review?.outlines?.[layer] ?? 0} outlines</span>
                  </span>
                  <select
                    value={roles[layer] ?? 'ignored'}
                    onChange={(event) => setRole(layer, event.target.value as Role)}
                  >
                    {(Object.keys(ROLE_NAMES) as Role[]).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_NAMES[role]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <span className="muted">
                Holes are outlines on the same layer entirely inside another. Defects keep their
                place and belong to the sheets they overlap.
              </span>
            </fieldset>
          )}
        </div>
      )}
      {busy && <p className="muted">Reading the files…</p>}
      {error && <p className="field-error">{error}</p>}
      {review && !stale && (
        <>
          <p>
            {parts.length} part {parts.length === 1 ? 'type' : 'types'} · {copies}{' '}
            {copies === 1 ? 'copy' : 'copies'} ·{' '}
            {parts.reduce((sum, part) => sum + (part.shape.holes?.length ?? 0), 0)} holes
            {sheets.length > 0 &&
              ` · ${sheetCount} ${sheetCount === 1 ? 'sheet' : 'sheets'} with ${sheets.reduce((n, sheet) => n + sheet.defects.length * sheet.quantity, 0)} defects`}
          </p>
          <div className="import-preview">
            {sheets.map((sheet, index) => {
              const { outer, holes } = outline(sheet.shape);
              const b = bounds(outer);
              const size = Math.max(b[2] - b[0], b[3] - b[1]);
              const defects = sheet.defects.map((defect) => outline({ outer: defect }).outer);
              return (
                <div key={`sheet-${index}`} className="import-part">
                  <svg
                    viewBox={`${b[0] - size * 0.05} ${-b[3] - size * 0.05} ${size * 1.1} ${size * 1.1}`}
                    aria-hidden="true"
                  >
                    <path
                      d={ringsPath([outer, ...holes])}
                      fillRule="evenodd"
                      fill="var(--sheet)"
                      stroke="var(--ink)"
                      strokeWidth={size * 0.02}
                    />
                    {defects.length > 0 && (
                      <path d={ringsPath(defects)} className="defect" strokeWidth={size * 0.01} />
                    )}
                  </svg>
                  <span>
                    Sheet {sheet.name}
                    <span className="muted block mono">
                      {formatLength(b[2] - b[0], unit)} × {formatLength(b[3] - b[1], unit)} {unit} ·
                      ×{sheet.quantity}
                      {sheet.defects.length > 0 && ` · ${sheet.defects.length} defects`}
                    </span>
                  </span>
                </div>
              );
            })}
            {parts.map((part, index) => {
              const { outer, holes } = outline(part.shape);
              const b = bounds(outer);
              const size = Math.max(b[2] - b[0], b[3] - b[1]);
              return (
                <div key={part.id} className="import-part">
                  <svg
                    viewBox={`${b[0] - size * 0.05} ${-b[3] - size * 0.05} ${size * 1.1} ${size * 1.1}`}
                    aria-hidden="true"
                  >
                    <path
                      d={ringsPath([outer, ...holes])}
                      fillRule="evenodd"
                      fill={colors[index % colors.length]}
                      stroke="var(--ink)"
                      strokeWidth={size * 0.02}
                    />
                  </svg>
                  <span>
                    {part.name}
                    <span className="muted block mono">
                      {formatLength(b[2] - b[0], unit)} × {formatLength(b[3] - b[1], unit)} {unit} ·
                      ×{part.quantity}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          {review.warnings.length > 0 && (
            <ul className="warnings">
              {review.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
          {!!review.issues?.length && (
            <>
              <p className="field-error">These contours cannot be imported:</p>
              <ul className="warnings">
                {review.issues.map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
              </ul>
              <label className="choice">
                <input
                  type="checkbox"
                  checked={exclude}
                  onChange={(event) => setExclude(event.target.checked)}
                />
                Leave out the contours listed above
              </label>
            </>
          )}
          {isInstance && kind === 'parts' && (
            <label className="choice">
              <input
                type="checkbox"
                checked={useWidth}
                onChange={(event) => setUseWidth(event.target.checked)}
              />
              Also use its strip width,{' '}
              {formatLength(review.document.settings.materialWidthMm, unit)} {unit}
            </label>
          )}
        </>
      )}
    </Dialog>
  );
}
