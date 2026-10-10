import { useRef, useState } from 'react';
import { bounds } from '../../engine/geometry/normalize';
import { colors } from '../../engine/colors';
import type { ImportReview } from '../../engine/import/sparrow';
import type { Part } from '../../engine/model';
import type { ImportFile } from '../../engine/workers/protocol';
import { geometryTask } from '../../engine/workers/geometryTask';
import { ringsPath } from '../Canvas';
import { useStudio } from '../context';
import { Dialog } from '../Dialog';
import { formatLength, inputLength, parseLength } from '../format';

type Options = { scale: number; tolerance: number; enclosed: 'holes' | 'parts'; layers?: string[] };

const MAX_FILE = 10 * 1024 * 1024;
const MAX_BATCH = 25 * 1024 * 1024;

/** Import parts from drawing files, after a preview of units, contours and warnings. */
export function ImportFilesDialog({
  onAdd,
  onClose,
}: {
  onAdd: (parts: Part[], stripWidthMm?: number) => void;
  onClose: () => void;
}) {
  const { unit } = useStudio();
  const picker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ImportFile[]>();
  const [scale, setScale] = useState(1);
  const [toleranceText, setToleranceText] = useState(inputLength(0.01, unit));
  const [enclosed, setEnclosed] = useState<'holes' | 'parts'>('holes');
  const [layers, setLayers] = useState<string[]>();
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
  const options: Options = { scale, tolerance, enclosed, layers };
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
    // New files start with every layer.
    setFiles(read);
    setLayers(undefined);
    setReviewed(undefined);
    void preview(read, { ...options, layers: undefined });
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
        ...chosen,
      });
      if (request !== latest.current) return;
      if (reply.type !== 'import-review') throw Error('Could not read these files.');
      setReviewed({ files: list, options: chosen, review: reply.review });
    } catch (reason) {
      if (request !== latest.current) return;
      setReviewed(undefined);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === latest.current) setBusy(false);
    }
  }

  const hasDrawings = !!files?.some((file) => !file.text.trimStart().startsWith('{'));
  const hasDXF = !!files?.some((file) => !['<', '{'].includes(file.text.trimStart()[0]));
  const isInstance = files?.length === 1 && files[0].text.trimStart().startsWith('{');
  const availableLayers = review?.layers ?? [];
  const blocked =
    !review ||
    stale ||
    busy ||
    !review.document.parts.length ||
    (!!review.issues?.length && !exclude);
  const parts = review?.document.parts ?? [];

  return (
    <Dialog
      title="Import parts from files"
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
                  isInstance && useWidth ? review!.document.settings.materialWidthMm : undefined,
                )
              }
            >
              Add {parts.length} {parts.length === 1 ? 'part' : 'parts'}
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
          {hasDrawings && (
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
          {hasDXF && (
            <label className="field">
              Contours inside contours
              <select
                value={enclosed}
                onChange={(event) => setEnclosed(event.target.value as 'holes' | 'parts')}
              >
                <option value="holes">Are holes</option>
                <option value="parts">Are separate parts</option>
              </select>
            </label>
          )}
          {availableLayers.length > 0 && (
            <fieldset className="field">
              <legend>DXF layers</legend>
              {availableLayers.map((layer) => (
                <label key={layer} className="choice">
                  <input
                    type="checkbox"
                    checked={(layers ?? availableLayers).includes(layer)}
                    onChange={(event) => {
                      const current = layers ?? availableLayers;
                      setLayers(
                        event.target.checked
                          ? [...current, layer]
                          : current.filter((name) => name !== layer),
                      );
                    }}
                  />
                  {layer}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      )}
      {busy && <p className="muted">Reading the files…</p>}
      {error && <p className="field-error">{error}</p>}
      {review && !stale && (
        <>
          <p>
            {parts.length} part {parts.length === 1 ? 'type' : 'types'} ·{' '}
            {parts.reduce((sum, part) => sum + part.quantity, 0)} copies ·{' '}
            {parts.reduce((sum, part) => sum + part.holes.length, 0)} holes
          </p>
          <div className="import-preview">
            {parts.map((part, index) => {
              const b = bounds(part.outer);
              const size = Math.max(b[2] - b[0], b[3] - b[1]);
              return (
                <div key={part.id} className="import-part">
                  <svg
                    viewBox={`${b[0] - size * 0.05} ${-b[3] - size * 0.05} ${size * 1.1} ${size * 1.1}`}
                    aria-hidden="true"
                  >
                    <path
                      d={ringsPath([part.outer, ...part.holes])}
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
          {isInstance && (
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
