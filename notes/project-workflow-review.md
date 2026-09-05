# A project workflow for sparrow-studio

Reviewed the current checkout on 2026-09-05. This is a source-based review of `App.tsx`, the import worker, project serialization, personal storage, the example/library components, and their tests. No application changes or browser tests were made for this review.

## The underlying problem

The app has the pieces of a project editor, but its commands describe entry points rather than the user's intent. One file picker can add shapes or replace the entire project; the same dataset can enter through three routes with different consequences. Adding isolated buttons would leave those ambiguities intact.

Use one model: **a project is the current nesting job; shapes are ingredients that can be added to it; the library stores reusable shapes independently of any job.** The project owns its name, parts, quantities, permitted rotations, preparation positions, material settings and optional checked result. Appearance and display units remain application preferences.

## What the code does today

| Current path | Observed behavior and gap |
| --- | --- |
| `App.openFiles` → worker `import` → `accept` | `Open files` accepts SVG, DXF, instance JSON and project JSON. Content decides the route. The default append choice depends on `dirty` or file count. Saving therefore changes what the next drawing import defaults to. Unchecking append replaces project name/settings/parts without the saved-project replacement confirmation. |
| `import/project.ts` | Saved projects already validate their schema and recheck stored results. Invalid results are discarded while valid parts remain available. This is the correct foundation for `Open project…`. |
| `App.saveProject` | Always downloads `sparrow-studio.sparrow-project.json`, then sets `dirty=false`. It neither overwrites an opened file nor maintains a local project store. There is no New or Rename command; `doc.name` is read-only in the workspace bar. |
| `commit`, `restore`, `dirty` | Whole-project replacements enter the same undo history as shape edits. Undoing back to saved content still marks it dirty. A new checked result can change the downloadable project without setting dirty. |
| `ExamplePicker` and `App.swim` | `Run example` replaces the current job and starts nesting without a shared unsaved-changes guard. The separate swim shortcut and library's `Open original benchmark` route use import review with replacement selected. |
| `ShapeLibrary` and `storage/shapes.ts` | Personal shapes persist in IndexedDB, normalized to quantity 1 and position zero. Saving creates an independent copy; adding creates a new project part. Dataset library shapes use median-area normalization. Full examples retain original scale and demand. These distinctions are sound but insufficiently visible. |
| Empty projects | Delete can produce zero parts, but `normalizeDocument`, project import/export, and the Save button reject that state. New project requires a real empty-document policy, not just a button that clears the array. |

Current tests establish geometry and persistence correctness, but also encode the existing inconsistent workflow: project-load Undo crosses into the previous job, and import tests rely on replacement/append checkboxes. Change those expectations deliberately rather than preserving them accidentally.

## Proposed commands and layout

Keep one compact project bar. Make the name a button, `Workshop parts ▾`, with an accessible `Project: Workshop parts` label. Its menu contains `New project…`, `Open project…`, `Save project…`, and `Rename project…`. Show a small `Unsaved changes` status next to the name. Keep Save directly reachable on desktop if space permits; do not retain a second unrelated project title at the right of the tabs. Preserve the current floating inspector and canvas controls; project commands do not need another canvas-resizing panel.

Group shape sources together in the parts panel: `Draw shape…`, `Import shapes…`, `Shape library…`. The empty canvas repeats these actions with `Open project…` and `Try an example…` as secondary routes. It should not contain a large marketing banner. On a fresh visit, start with `Untitled project`, zero parts, and the existing default material settings. Workshop remains one click away through examples.

| Command | Contract |
| --- | --- |
| `New project…` | Create an empty named job with defaults. Preserve personal shapes and preferences. Ask about unsaved changes before replacing the current job. |
| `Open project…` | Pick one `.sparrow-project.json`; parse and validate it before replacing anything. Show project name, shape/copy counts and saved-result status. Opening never starts nesting. |
| `Save project…` | Download `<project-name>.sparrow-project.json`. Explain once in the action surface: `Downloads a project file. Open it later to continue.` Do not imply an existing disk file was overwritten or cloud storage exists. |
| `Rename project…` | Also accessible by clicking the displayed name. Trim whitespace, reject an empty name, and derive a safe download filename. Rename is undoable metadata, marks the project changed, and preserves a checked result. |
| `Import shapes…` | Pick SVG, DXF or **sparrow instance JSON**, then review units, interpretation, dimensions and warnings. Default action: `Add N shapes to project`. Preserve the project name/material settings and existing positions. Apply the whole batch as one undoable edit. |
| `Shape library…` | Reuse the current picker, labeled collections `My shapes` and `Dataset shapes`. Actions become `Add to project` and `Save selected shapes to My shapes`. Resizing a library preview changes the pending copy; it never edits the original dataset or project implicitly. |
| `Try an example…` | Choose an original-scale dataset as a new project. Primary action `Open example`; optional explicit `Open and nest`. Both use the same project replacement guard. Remove the separate swim entry point. |

File types should describe meaning, not just extensions. Project JSON restores a job; sparrow instance JSON supplies shapes, quantities and orientation rules. For a single instance file, offer `Open as new project` in its review to retain its supplied name and material width. Adding its shapes to an existing project leaves that project's material width unchanged and says so. This preserves the original benchmark-import capability without silently changing a user's job.

Drop handling uses the same content classification and routes. Dropping one saved project opens the project review; dropping drawings opens shape import. A project mixed with drawing files is rejected with a clear instruction to open it separately. Picking the wrong kind in either picker offers the appropriate route instead of treating every JSON as interchangeable.

Remove the generic append checkbox. Adding shapes always adds. Replacing an entire job is always an explicit New/Open/example action. If replacing all shapes within the same project proves necessary, expose a separately named action later, with explicit scope and one-step Undo.

## State and safety rules to implement together

- Build and validate the prospective project before the replacement decision. Canceling a file picker, preview, validation error or confirmation leaves the active project, result, selection and history intact.
- Use one replacement guard for New, Open, examples and instance-as-project. With changes, offer `Download project and continue`, `Discard changes`, `Cancel`. If serialization fails, stay in the current project. A browser download request is not proof that a disk write completed; phrase its status accordingly.
- A successful project switch clears project undo/redo, selection, pending drawing, transient import state and the previous solver session. A shape import remains one undoable edit inside the current history. Keep geometry revisions monotonic so late workers cannot attach results to a different job.
- Track the last downloaded/opened project snapshot separately from geometry validity. Name, preparation arrangement, quantities/settings and saved checked result matter for unsaved changes. Theme/display-unit changes do not. Returning to the saved document via Undo should clear the document-change indicator; it must not resurrect invalidated solver results.
- Allow valid empty projects to be named, downloaded and reopened. Nesting and layout export still require parts; an empty project cannot carry a checked result. Do not weaken contour validation or silently save malformed numeric input. A failed Save must explain the field to fix and retain the current job.
- Personal storage remains explicitly separate: `Stored in this browser. Project files are portable backups.` Saving a project does not save its parts into My shapes; opening a project does not overwrite that collection. No autosave dashboard, accounts or server are required for this change.

## Minimal staged implementation

1. **Project lifecycle, as one change.** Add the empty-document policy, editable project identity, meaningful filename, shared replacement guard and saved-state tracking. Route New/Open/example replacement through it. Reuse existing schema validation, result rechecking and `Modal`; retain the solver's invalidation rules. Verify lifecycle behavior before rearranging buttons.
2. **Unify shape entry.** Separate picker intent from the existing content detection, keep the geometry worker/parsers, and make every shape source append through the same validated preparation/commit path. Reuse import thumbnails/warnings and the existing library. Consolidate dataset entry through `ExamplePicker`; make normalized library copies versus original jobs explicit.
3. **Present and verify the whole flow.** Ship the project menu, grouped shape actions and empty canvas together. Review desktop, 390 px, keyboard and error states as one journey. Update workflow tests and user documentation to the chosen contracts. Avoid further sidebar restructuring or a generic state framework unless these changes expose a concrete need.

Acceptance journeys:

1. New → name → import a 100 mm SVG → save → reload → open the project: same name, dimensions, quantities, positions and settings; valid saved result rechecked when present.
2. Rename a job with a checked result, focus/blur unchanged fields, change display units, then save: rename persists; only actual project changes affect unsaved status; checked geometry remains available.
3. Add DXF, instance JSON and a personal library shape to an existing job: existing material/name/parts remain, each added batch separates in preparation and undoes in one step. Native instance restrictions survive.
4. New/Open/example from a changed job: Cancel preserves everything; discard switches cleanly; failed download/parse cannot replace it; Undo cannot cross project boundaries.
5. Delete the final part, save the empty job and reopen it: no crash, no stale result, clear add/import/library actions, Nest disabled.
6. My shapes survive project switches; a dataset resize affects only the added copy. Full examples retain original scale and material settings.
7. Wrong JSON kind, mixed project/drawing drop, unsupported CAD format and invalid import entities produce specific recovery paths without changing the current project.
8. Every essential command is reachable at 390 px and by keyboard; the project name is visibly editable, and library persistence is not presented as project autosave.
