# Sparrow web app design and implementation plan

Status: proposed implementation specification. No web application is implemented by this document.
Date: 2026-09-05. Repository inspected at `120cf93`, Sparrow 0.2.0 with jagua-rs 0.8.1.

## 1. Purpose and decisions

Build a clean browser app where someone can import parts, make small adjustments, run Sparrow, and download a checked layout. The app should help people discover the algorithm and contact Jeroen Gardeyn when they need additional algorithm functionality or integration into their own workflow.

The owner understands combinatorial optimization but does not need to learn web development or CAD to review this plan. Technical decisions below are defaults for implementation. An implementer should follow them, record any necessary departure beside the relevant section, and avoid inventing additional product requirements.

Decisions:

- Build the interface from scratch. Borrow useful interactions from vector editors, without embedding or forking SVG-Edit.
- Make nesting the main activity. Include a small set of drawing and preparation tools.
- Run Rust compiled to WebAssembly locally in the visitor's browser.
- Start with one strip of fixed material width and variable used length.
- Launch with SVG, a specified subset of ASCII DXF, and Sparrow instance JSON import. Support a versioned app project file too.
- Export SVG, ASCII DXF polylines, and app project JSON. Preserve part holes, but do not nest other parts inside them in version 1.
- Version 1 optimizes, displays, validates, and exports the same polygonal approximation. Original curves can be retained in project provenance, but curve-preserving manufacturing export is a later feature.
- No account, subscription, server-side solver, cloud file storage, or email gate on downloads.
- The deliverable is a usable tool with an optional contact route. Contact is for requirements beyond the tool, not permission to use it.

This document authorizes no deployment, domain purchase, or external messages. Implementation can be completed and previewed locally before those launch decisions.

Implementation updates from the owner: the brand is always lowercase `sparrow`; contact remains explicitly unconfigured for this prototype. Live search should show intermediate layouts with overlap regions in red, with a `Live / Checked` toggle. Only independently checked results have export authority.

Additional lower-priority scope requested by the owner: dynamic dark mode; all datasets in the main and gardeyn benchmark collections; a shape library covering those datasets; and resizing shapes in that library. Library normalization is **per dataset**, preserving relative part sizes within each dataset. The chosen initial target median is 2,500 mm², calculated over distinct part types; benchmark loading itself retains original coordinates and demand.

Thread-count update from the owner: cap both automatic and manual settings at **3 solver threads**; the algorithm regresses beyond that.

Threading update from the owner: browser multithreading is now important for this prototype, rather than a deferred milestone. Reuse the existing wrapper’s `wasm-bindgen-rayon` integration where appropriate, with the current solver revision, a real shared-memory pool, cancellation, and a single-thread fallback. GitHub Pages compatibility remains required.

Further owner updates: polish the interface with useful symbols and loading indicators; add GitHub links and a star prompt; retain shapes between sessions; and prepare for initial hosting on GitHub Pages as a purely static site. Use IndexedDB for local geometry persistence, with explicit project downloads as backups. This updates the initial preference-only persistence scope below. Publishing remains separate from preparing the static build.

Contact update: use `https://www.linkedin.com/in/jeroengardeyn/` after visitors have tried the tool. Remove the overt commercial prompt; use a quiet `Say hello` route after an import/edit/run, and a small creator note with the checked result. Email remains unconfigured because no address has been supplied. This supersedes the commercial wording in sections 10–11.

Current priority from the owner: concentrate on the core mini CAD functionality before the lower-priority library and visual extras. The selected next direction is **precise manipulation: move, resize, rotate, and snapping**. This expands the original preparation-tool scope to include precise positioning, direct resize/rotate interaction and configurable grid snapping; geometry edits must keep the existing validation, revision and undo guarantees.

## 2. Terms for the owner

| Term | Meaning here |
| --- | --- |
| Frontend | The interface and code running on the visitor's device. |
| WebAssembly / WASM | A compilation target that lets the browser execute the Rust solver. |
| Worker | A separate browser execution context that keeps search or parsing from freezing buttons and drawing. |
| Static hosting | A server sends the app's files; it does not run the optimization. |
| SVG | An XML vector drawing format. It can contain curves, transforms, text, and many things that are not cutting contours. |
| DXF | A CAD interchange format. It contains entities such as lines, arcs, and polylines, often without explicit part identities. |
| Contour | A closed boundary. One part has an outer contour and can have inner contours representing holes. |
| Flattening | Replacing curves with short straight segments within a specified geometric error. |
| Kerf | Material removed by the cutting tool. It is different from the clearance between nested parts. This app does not calculate cutting toolpaths. |
| Acceptance test | A concrete scenario that must work before a milestone is complete. |

## 3. What exists in this repository

Inspect these files again when implementation starts, since this document records one revision:

| Existing code | How the app uses it |
| --- | --- |
| [`src/lib.rs`](../src/lib.rs) | Import Sparrow as a Rust library. Do not run `bench.rs` or the CLI inside the app. |
| [`src/optimizer/mod.rs`](../src/optimizer/mod.rs) | Call `optimize`; it accepts an optional initial solution and listener. |
| [`src/util/listener.rs`](../src/util/listener.rs) | Implement `SolutionListener` for structured progress and candidate placements. |
| [`src/util/terminator.rs`](../src/util/terminator.rs) | Time termination interface. Browser cancellation needs the worker strategy in section 9. |
| [`src/config.rs`](../src/config.rs) | Phase times, worker count, and item separation settings. |
| [`src/util/io.rs`](../src/util/io.rs) | Existing external instance/output structures and CLI conventions. Reuse formats without its filesystem logging. |
| [`src/optimizer/separator.rs`](../src/optimizer/separator.rs) | WASM uses the global Rayon pool; `move_items_multi` still uses `par_iter_mut` with one worker. |
| [`data/input/swim.json`](../data/input/swim.json) | Integration fixture with explicit orientations and repeated items. |

Important limits found in the pinned jagua-rs dependency:

- `ExtShape::Polygon` exists in the JSON schema, but its item importer ignores holes. Schema support does not imply geometric support.
- Disjoint multipolygons are not a supported rigid item in that importer.
- Omitted `allowed_orientations` means continuous rotation. An empty list must not accidentally stand for a fixed orientation.
- The solver uses `f32`; the frontend normally uses `f64` JavaScript numbers. Validate the returned placements against the frontend's normalized input, not only the solver's internal geometry.

The existing [sparroWASM wrapper](https://github.com/JeroenGar/sparroWASM/blob/main/Cargo.toml) pins an older Sparrow revision and uses `wasm-bindgen-rayon`. Reuse its experience, but prove compatibility with the chosen current revision. Do not copy its old dependency pins into this repo as an unnoticed downgrade.

Implementation note: this task's checkout is the sparroWASM wrapper, rather than the neighboring solver repository described in the table. `web/wasm` therefore uses a Git dependency pinned to solver revision `120cf937de5e74c292406bc9947276c9dd49217f`, with jagua-rs 0.8.1. The root wrapper and native solver remain unchanged; no sibling directory is needed to build.

## 4. First visit and main workflow

The page opens directly into the workspace. A bundled example is visible without running an optimizer or downloading a large dataset. Above the drawing, show:

> Pack irregular parts with Sparrow.
> Open your drawing or try an example. Nesting runs on your device.

Primary actions are `Open files` and `Try example`. The example action starts a 10-second run. The default example should be an original small set of roughly 12 recognizable parts. Offer `swim` as a second, more demanding example. Verify distribution rights before adding any other real-world data.

The regular workflow is:

1. Open one or several files by picker or drag and drop.
2. Review units, part interpretation, dimensions, and any excluded entities in one import dialog.
3. Confirm import. Parts appear in a list and preparation view.
4. Set material width, quantities, permitted rotations, and clearance.
5. Press `Nest parts`. Switch to the result view as soon as a checked candidate exists.
6. Watch used length improve. Press `Stop` at any time to retain the best checked result received so far.
7. Download the checked layout, save the project, or choose `Run again`.

Never start an expensive run merely because someone opened the page or imported a file. Use the interface within a few clicks, without a tutorial or registration.

## 5. Visual and interaction specification

Use this desktop layout at widths of at least 1100 px:

```text
+-----------------------------------------------------------------------+
| Sparrow          Open files   Examples      About Sparrow   Contact    |
+------------------+----------------------------------------------------+
| Parts            | Prepare / Result                     Fit   -   +   |
| thumbnail  name  |                                                    |
| quantity         |                                                    |
| ...              |                  Drawing workspace                 |
|                  |                                                    |
| Add shape        |                                                    |
|------------------|                                                    |
| Material width   |                                                    |
| Clearance        |                                                    |
| Rotations        |                                                    |
| Run for          |                                                    |
| [ Nest parts ]   |                                                    |
+------------------+----------------------------------------------------+
| Ready / Running / Checking    Used length   Utilization   [Download]    |
+-----------------------------------------------------------------------+
```

- Header 56 px, sidebar 280 px, status bar at least 48 px. Drawing fills the remaining area; lists scroll independently.
- Light theme only initially. Background `#f5f6f8`, panels white, text `#18212f`, muted text `#596579`, separators `#dde2e9`, accent `#176b58`, error `#b42318`.
- Use the system sans-serif font, 14 px body, 12 px secondary labels, 20 px page title. Numeric results use tabular digits. Use 8 px spacing increments, 8 px control corners, and 36 px minimum desktop control height.
- Parts use a stable muted color per part type with a darker outline. Selection has a stronger outline and handles; color alone never identifies selection or errors.
- Show physical dimensions on the material. The screen grid is optional and never changes precision or silently snaps imports.
- Keep labels on important actions. Avoid icon-only toolbars, gradients, large marketing cards, decorative animations, and unexplained CAD symbols.
- Animate no movement between solutions. Replace complete layouts; interpolation would show overlaps that the solver never reported.
- Under 1100 px, use a collapsible settings panel. Under 700 px, stack the drawing and settings. Keep import, example, run, stop, and download usable at 390 px. Touch drawing can wait.
- All controls have keyboard focus, accessible labels, and readable errors. Respect reduced-motion settings. Use touch targets of at least 44 px on narrow screens.

Preparation tools required at launch:

| Tool | Exact behavior |
| --- | --- |
| Select | Click part or list row; Shift-click toggles multiple selection. Background click clears selection. |
| Pan and zoom | Wheel zoom around pointer; space-drag pans. Include visible Fit, zoom-in, and zoom-out buttons. |
| Quantity | Positive integer per part type. Changing quantity changes demand; no need to draw every copy in preparation view. |
| Size | Enter width or height with aspect ratio locked. This edits physical geometry and requires a new run. |
| Rotations | Defaults to 0 and 180 degrees for imported SVG/DXF; controls for fixed 0, half-turns, quarter-turns, free, and a custom nonempty degree list. Preserve JSON restrictions until explicitly edited. |
| Move | Drag part types in preparation view only; this changes visual arrangement, not the optimization start. |
| Duplicate / delete | Duplicate creates an independently editable part type; delete removes the selected type after normal undo history capture. |
| Add shape | Rectangle with width/height, circle with diameter, or a polygon clicked vertex by vertex. Enter closes polygon; Escape cancels. Reject invalid geometry. |
| Undo / redo | Cmd/Ctrl-Z and Cmd/Ctrl-Shift-Z; store up to 50 document snapshots. A drag is one edit. Selection and zoom are not undo entries. |

Do not implement node editing, boolean shape tools, constraints, fillets, text drawing, manual result rearrangement, or snapping in version 1. These can be added when they serve a demonstrated preparation need.

Changing geometry, quantities, material width, clearance, or orientations increments a document revision and invalidates its result. Selection, view changes, and preparation dragging do not. Disable document edits during a run; keep pan, zoom, selection, Stop, and contact available.

Revision numbers increase monotonically even through undo/redo. Undo restores document content, never an old revision counter or an old result's validation authority.

## 6. File formats and import rules

File extension is a hint; validate content. Import is transactional: preview first, then commit the accepted parts together. Cancel or a fatal error leaves the current project intact. Multiple drawing files append by default. Opening a project file replaces the project after confirming unsaved changes.

| Format | Launch support | Explicit exclusions / later work |
| --- | --- | --- |
| SVG | Closed paths, rectangles including rounded corners, circles, ellipses, polygons, closed polylines; path curves; groups and affine transforms; local `<use>` references. | Text must be outlined elsewhere; no raster tracing, clipping/masks, external references, filters, embedded HTML, or CSS-driven geometry. |
| ASCII DXF | Planar LINE, ARC, CIRCLE, LWPOLYLINE including bulges, and ordinary 2D POLYLINE/VERTEX sequences; layer selection; join unambiguous chains into closed contours. | Reject binary DXF; no SPLINE, ELLIPSE, INSERT/BLOCK expansion, HATCH interpretation, 3D entities, dimensions, or text as parts in version 1. List unsupported entity counts. |
| Sparrow JSON | `ExtSPInstance`: name, strip_height, item IDs, demand, allowed orientations, supported rectangle/simple-polygon/polygon shape fields. | No arbitrary JSON guessing. Native solution import/warm start is a later extension; warn if an input contains a solution that will not be imported. |
| `.sparrow-project.json` | App schema version 1, normalized geometry, settings, and optional checked result with provenance. | Reject unknown schema versions; never guess a migration. Recheck stored results on load. |
| DWG, PDF, EPS/AI, PNG/JPEG, STEP/STL | Explain why the file cannot be imported and suggest exporting SVG or supported DXF. | DWG needs a separate reader/licensing decision; PDF has ambiguous cut geometry; images need tracing; 3D needs an explicit slicing/projection workflow. |

### Units and axes

Use millimeters internally, Cartesian x-right/y-up, and degrees counterclockwise. In UI, `Material width` means the fixed cross-strip dimension, passed as `strip_height`. `Used length` is the solver's `strip_width`. Draw material length horizontally and fixed width vertically. Never transpose these merely because the solver calls them width and height.

- SVG: resolve root physical width/height, viewBox, and preserveAspectRatio before conversion. Explicit CSS px are 25.4/96 mm. A viewBox alone gives no physical scale: request mm per drawing unit or a known overall width. Percentage root dimensions require user sizing. For launch reject nested SVG viewports, CSS transforms, stylesheets, and ambiguous unit mappings with a specific message.
- DXF: honor a recognized `$INSUNITS`; ask for mm/inches when missing, zero, or unsupported. Reject non-XY extrusion, nonzero elevations, and 3D polylines.
- Sparrow JSON: coordinates have no intrinsic physical unit. Ask whether one coordinate unit means mm or inches, default mm visibly. Examples specify their display scale explicitly. Do not claim benchmark units are known manufacturing units.
- Unit display switching changes displayed values, not geometry. A deliberate import scale correction changes geometry and invalidates results.
- Convert SVG's downward y axis exactly once. Keep local part geometry in canonical coordinates and render through a shared screen transform. Test with an asymmetric L-shaped part.

### Contours, holes, and part identity

Resolve SVG transforms and references before extracting contours. Never insert imported markup into the live DOM. Recreate preview elements from approved numeric geometry. Reject scripts, event handlers, foreignObject, entities/DOCTYPE, external URLs, and reference cycles. Ignore metadata without fetching anything. Display file names as text.

Use a documented closed-contour interpretation rather than rendered fill alone: a closed stroke-only cutting outline is a candidate; stroke thickness is not part size or kerf. Show this rule in the import preview. Open lines cannot silently become parts.

For SVG compound paths, honor even-odd/nonzero fill rules to determine actual holes, and reject unsupported self-crossing or ambiguous topology. For separate SVG paths or DXF contours nested inside each other, ask once in the preview whether enclosed contours are holes or separate parts. Default to holes, show part/hole counts, and show the change immediately. Disjoint outer contours become separate part types. A group does not imply a rigid assembly. Warn when a group or source item must be split; never silently change a JSON multipolygon demand into independent parts.

Each part can retain a simple outer ring and valid, disjoint inner rings. For Sparrow send only the outer ring and reserve the entire interior. Show `Holes are preserved; nesting inside holes is not supported.` This is a conservative packing choice, not native hole-aware nesting.

For DXF chain assembly, join endpoints within 0.01 mm only when each junction is unambiguous. Report the number of joined gaps and largest adjustment. Require preview confirmation. Branches, remaining open ends, duplicate edges, and intersecting loops are blocking issues for the affected contours. Do not silently drop such contours; the user may explicitly exclude them and continue.

### Curve approximation and limits

Flatten after applying physical scaling and transforms. Default maximum deviation is 0.01 mm. Retain each original entity's ID in errors. Use adaptive subdivision with a geometric error bound, not a fixed number of points or a midpoint-only test. For Beziers, use de Casteljau subdivision and control-hull distance to the chord segment. For circular/elliptical arcs, use a sagitta/curvature bound that includes affine scale. A parser's conversion of arcs to cubics is not by itself a proof of this error bound.

Remove consecutive duplicate vertices; normalize ring orientation; reject fewer than three distinct vertices, non-finite coordinates, zero-area rings, self-intersections, and invalid holes. Do not repair by taking the convex hull. Preserve concavity.

Initial product ceilings: 10 MiB per file, 25 MiB per import batch, 500 demanded copies, 5,000 vertices per part including holes, and 100,000 vertices across demanded copies. These are resource guards, not claims about Sparrow limits. Enforce them before a run and during flattening. If exceeded, offer cancel or explicit coarser flattening with a new preview; never silently simplify. Limit recursive SVG references to depth 32 and bound total expanded entities. Run expensive geometry work outside the UI thread.

## 7. Data model and ownership

Keep one versioned app model in `web/src/model.ts`. The following is the intended contract, not an existing API:

```ts
type Point = [number, number];
type Ring = Point[]; // no duplicate closing vertex in memory
type RotationRule = { kind: 'discrete'; degrees: number[] }
                  | { kind: 'continuous' };
type Part = {
  id: string;
  name: string;
  source: { format: 'svg' | 'dxf' | 'sparrow' | 'drawn'; fileName?: string; entityId?: string };
  outer: Ring;
  holes: Ring[];
  approximationToleranceMm: number; // zero for polygonal source geometry
  quantity: number;
  rotations: RotationRule;
  preparationPosition: Point;
};
type Settings = {
  materialWidthMm: number;
  clearanceMm: number;
  timeLimitSeconds: 10 | 30 | 60 | 120;
};
type Placement = { partId: string; copyIndex: number; xMm: number; yMm: number; angleDeg: number };
type Validation = {
  status: 'pending' | 'passed' | 'failed';
  overlapAreaMm2: number;
  maxBoundaryViolationMm: number;
  minClearanceMm: number | null;
  errors: string[];
};
type Result = {
  documentRevision: number;
  solverRevision: string;
  seed: string; // exact integer encoded as decimal text
  elapsedSeconds: number;
  usedLengthMm: number;
  placements: Placement[];
  validation: Validation;
};
type Project = {
  schemaVersion: 1;
  name: string;
  revision: number;
  parts: Part[];
  settings: Settings;
  result?: Result;
};
```

Assign stable string IDs on import. The bridge creates an explicit map to numeric solver IDs and back. It assigns copy indices by occurrence within a returned layout and checks multiplicity. Do not use transient scene IDs as solver identities. Normalize parts near their local origin and keep the transform consistent in the bridge. Use jagua-rs's external export conversion to undo any internal centering.

Add run diagnostics outside the editable document: initialization/search/validation times, actual solver revision, build mode, seed, every improving candidate's elapsed time/length, validation outcome, and import warnings. Geometry snapshots need only retain the best checked layout plus a bounded pending candidate; the timing history is compact. Download diagnostics on request. Do not upload them automatically.

Default width is 1000 mm for a new project, clearance 0 mm, regular run duration 30 seconds. JSON imports retain their material width. Blank or invalid numeric inputs block Run with a field-level error. Changing duration does not invalidate an existing result; it only affects the next run.

Clearance in this app means minimum part-to-part distance. Version 1 has no separate material-edge margin setting. Verify the exact effect of `min_item_separation` in jagua-rs with a two-rectangle fixture before mapping it: if it also reserves space at material edges, disclose that effective edge allowance in the settings. Do not assume the parameter means a per-part offset of the same magnitude or accidentally double the requested gap.

## 8. Implementation stack and file placement

Implement later under `web/`, with its own npm package and Rust bridge crate. Keep the existing root Cargo package and CLI behavior intact. Use a Rust path dependency from `web/wasm` to this repository; its lockfile must resolve a compatible jagua-rs version. Do not duplicate the optimizer.

| Choice | Purpose |
| --- | --- |
| React + TypeScript, built with Vite | Conventional component UI, checked message/data types, static production output. |
| Plain CSS and native form controls | Implement the specified visual design without a theme framework. |
| Browser SVG rendering + Pointer Events | Sharp outlines, selection, pan/zoom, and small drawing tools. No full CAD or scene framework. |
| `wasm-bindgen` and `wasm-pack` | Compile and expose the Rust bridge to a worker. |
| `dxf-parser` | Read DXF entities; app code still assembles/validates contours. |
| `svgpath` | Parse and normalize SVG path commands and transformations. Add the bounded flattening logic separately. |
| `polygon-clipping`, `robust-predicates` | Independent overlap operations and robust orientation tests. Neither is a complete validator alone. |
| Vitest + Playwright | Geometry/contracts tests and actual browser workflow tests. |
| Python + Shapely, development only | Independent GEOS audit of exported geometry in release checks. Never a browser runtime dependency. |

Pin compatible versions when scaffolding, commit lockfiles, and document their licenses. Do not add a backend, database, router, global state library, or authentication framework. React state/reducer and worker messages are sufficient. Optional libraries require a concrete need within this spec.

Suggested organization, created only as each milestone needs it:

```text
web/
  README.md                 build, run, test, supported formats
  package.json
  src/
    App.tsx                 workspace and document reducer
    model.ts                shared document and result types
    styles.css
    components/             workspace, parts panel, settings, import review
    import/                 svg.ts, dxf.ts, sparrow.ts, project.ts
    geometry/               normalize.ts, flatten.ts, validate.ts
    export/                 svg.ts, dxf.ts, project.ts
    workers/                solver.worker.ts, geometry.worker.ts, protocol.ts
  wasm/
    Cargo.toml
    src/lib.rs              library bridge and listener
  tests/                    small fixtures, browser tests, GEOS export audit
  public/examples/
```

The host only serves built files. Use same-origin WASM and worker files; honor Vite's base URL rather than hardcoding `/`. Select a static host when publishing. No production host is chosen by this document.

## 9. Solver bridge, progress, and stopping

First prove one-worker execution on `wasm32-unknown-unknown` with stable Rust and the SIMD feature off. A single worker setting is not proof that Rayon initialization is unnecessary. If the current Rayon path cannot run serially in a browser, add a narrowly scoped serial execution path for one worker or document the actual thread requirement. Do not redesign search. Preserve existing native behavior and verify it if code changes.

Browser multithreading is a later performance milestone. It requires its own build setup, thread initialization, cross-origin isolation headers, and a one-worker fallback. Do not block the first working product on it or claim the browser achieves a particular fraction of native speed without measuring this revision.

Worker messages use a discriminated union and always include `runId` and `documentRevision`:

- UI to solver: `start` with normalized instance, settings, and decimal seed.
- Solver to UI: `ready`, `phase`, `candidate`, `finished`, `error`.
- Candidate carries a complete placement snapshot, used length, and elapsed milliseconds measured from solver start. Capture timestamps when the candidate is found, not when the UI receives it.
- UI to geometry worker: `validate` with candidate and immutable document snapshot. Reply `validation-result` with the same IDs and candidate sequence number.

Do not send an ordinary `stop` message and expect synchronous Rust to process it. A long WASM call occupies that worker's event loop. Version 1 Stop calls `worker.terminate()` from the UI and retains candidates already delivered. Create a fresh worker for a new run. On worker error, keep the best checked result and show a recoverable message. A stopped run can finish validation of its last received candidate; it must never wait for a final Rust callback.

Use the same 80% exploration / 20% compression split as the CLI. Explain that initialization precedes search. The wrapper must separately measure initialization and solve time. A UI watchdog terminates the worker at selected solve duration plus 2 seconds, or if initialization exceeds 15 seconds. Retain the best checked result and report the actual stop reason. Background tabs may throttle browser timers, so show actual elapsed time rather than promising an exact hard deadline.

Send only feasible report types `ExplFeas`, `CmprFeas`, and `Final` as result candidates. `ExplInfeas` and `ExplImproving` must never become the downloadable result. Preserve all improving-candidate timing records; cap visual rendering at 4 updates per second. Send the initial feasible construction if feasible to expose through the bridge, and always flush the final candidate.

Validation uses a latest-pending queue while retaining the best passed result. If a new candidate arrives during validation, finish the active validation, then check the latest pending candidate. The final candidate must be checked before declaring completion. Do not replace a passed layout with a shorter failed layout.

State transitions:

| State | UI behavior |
| --- | --- |
| Ready | Editable project; Run available if inputs pass preflight. |
| Initializing | Load WASM and prepare instance; Stop enabled. |
| Running | Show elapsed search time and best checked layout; Stop enabled. |
| Checking | Search finished/stopped; wait for final relevant validation. |
| Complete / Stopped | Enable export if a matching checked result exists. Run again starts from scratch in version 1. |
| Error | Retain editable project and any passed result; show specific recovery action. |

Ignore every late message with a superseded run ID or revision. Disable Download during a run for the first release to keep result ownership simple.

## 10. Geometric validity and export

This is a release requirement. Sparrow's feasible flag is evidence to trigger validation, not the final export authorization.

Validate using the normalized original polygons and returned rigid transforms, before any rendering simplification. Check:

1. Exactly the demanded copies, unique part/copy pairs, known IDs, finite coordinates, and allowed orientations. Discrete angles compare modulo 360 with tolerance 0.0001 degrees. Continuous means any finite angle, never reflection.
2. Each transformed outer/hole ring remains valid. No scaling or mirroring is introduced by a placement.
3. All outer boundaries fit inside `[0, usedLength] × [0, materialWidth]`.
4. No positive-area intersection between different outer footprints. Test containment and coincident polygons as well as edge crossings; segment intersection alone misses both.
5. Minimum distance between outer footprints meets the requested clearance. At zero clearance, touching boundaries are allowed. At positive clearance, compute boundary segment distances after bounding-box pruning. Reject overlap regardless of the clearance setting.

Use `polygon-clipping` for intersection geometry and robust predicates for ring validity. Do not infer validity from pixels. Exceptions, non-finite results, or exhausted resource guards mean validation failed, never passed.

Numerical policy for version 1: linear boundary/clearance tolerance 0.000001 mm; overlap area threshold 0.00000001 mm² per pair; discrete angle tolerance as above. Report raw measured violations and the tolerances in diagnostics. These are fixed starting policies to test, not a mathematical proof. Never enlarge them automatically until a failing layout passes. Restrict normalized coordinate extents to at most 100,000 mm at launch; reject numerically degenerate inputs. A precision problem should produce an actionable failure and a diagnostic download.

The badge says `Geometry checked` with details: check type, tolerances, and polygon approximation error. Do not label it exact CAD validation or manufacturing certification. Retained holes are excluded from material-area calculations, but packing/clearance conservatively uses outer footprints.

For export, serialize world coordinates with at least 9 significant digits without display rounding. Use exactly the same serialized coordinates for SVG and DXF. Reparse that export representation and validate it before enabling the download, since rounding can introduce overlap. SVG sets explicit physical dimensions in mm and a matching viewBox. DXF uses a defined ASCII version supporting LWPOLYLINE, `$INSUNITS = 4`, closed polylines, and separate `PARTS` and `HOLES` layers. Omit the material border from cutting entities.

SVG/DXF exports contain polygonal contours. Display `Curves approximated to 0.01 mm` or the chosen tolerance before download. Project JSON preserves the tolerance and import provenance. Exact arcs/Bezier export is deferred until conservative approximation and validation of original curves are designed together.

Utilization is `sum(net part area × demand) / (material width × used length)`. Label it material utilization. Improvement is reduction in used length relative to this run's first checked candidate. Do not present that as guaranteed purchasing savings or a comparison with another solver.

In development, run Shapely/GEOS on exported coordinates for representative fixtures and compare with browser validation. Preserve failures as regression fixtures. GEOS is independent evidence and still a numerical computation; report disagreement rather than relaxing thresholds. Include a tiny sliver overlap fixture that a coarse area threshold would miss.

## 11. Contact, privacy, and persistence

Provide `About Sparrow` with a short explanation, Jeroen's name, and links to the paper and repository. Keep solver settings such as shrink ratios out of the main user interface.

Below results, show:

> Need additional constraints or integration into your workflow?
> Contact Jeroen about Sparrow.

Version 1 contact uses a configured email link plus a copy-address button. Do not invent the address. A local preview may show an explicit unconfigured state; the real address is required before public launch. Offer a downloadable diagnostic summary for users to attach themselves. No file attachment or message is sent automatically. Do not promise support for holes, multiple sheets, defects, or other requested features merely because the contact text mentions custom requirements.

Save projects through explicit downloads; load them through the file picker. Store only UI preferences locally initially. Show an unsaved-change warning on page departure. A database and project autosave can be added later if users need them.

No analytics in the first release. Imported files and geometry stay on the device. Verify this in browser network tests. Static-host access logs are outside that promise; avoid saying that no data at all leaves the device. The optional contact action uses the visitor's mail application. No social embeds or external font requests are required.

## 12. Milestones for implementation by a smaller model

Complete one milestone at a time. Read its referenced interfaces, implement only its requirements, run its checks, and leave a short completion note with commands and known failures. Do not continue building UI over an unproven solver or geometry assumption.

### M0. Prove the current browser bridge

- Add the smallest Rust bridge and worker test page under `web/`.
- Load `swim.json` using existing external structs, run one worker for 10 seconds, and receive actual feasible placements.
- Record toolchain/dependency versions and any required compatibility change.
- Verify Chrome, Firefox, and Safari with a real run, a Stop, and a second run after Stop. A browser engine test alone is not a Safari device test.
- Pass when search stays off the UI thread, callbacks arrive before completion, cancellation retains received data, and native tests still pass if native code changed.
- If blocked, finish a small reproducible failure report and isolate the failing dependency. Do not fabricate live progress or substitute another algorithm.

### M1. Complete one end-to-end JSON workflow

- Build the specified workspace, part list, settings, and example flow.
- Import Sparrow JSON; normalize IDs, units, and rotation semantics.
- Implement candidate validation, best-passed ownership, counters, Stop, SVG export, and run diagnostics.
- Pass when `swim` has all 48 copies, rotations restricted to 0/180, and an exported result checked by browser validation and GEOS. No required width target: stochastic output varies.

### M2. SVG and small preparation tools

- Implement the defined SVG subset, import review, flattening, hole policy, and rejection messages.
- Add the specified drawing, quantity, scaling, undo, and selection tools.
- Pass with fixtures for asymmetric transforms, physical units, circles/ellipses, cubic curves, local references, compound holes, stroke-only outlines, open paths, scripts, and reference cycles.
- Verify that an imported 100 mm shape exports at 100 mm after nesting, within the stated tolerance, and that edits invalidate an old result.

### M3. DXF and project round trips

- Implement only the listed DXF entities, unit handling, layers, and explicit chain assembly.
- Add DXF export and versioned project save/load, including result revalidation.
- Pass with a bulged polyline, connected line/arc loop, nested hole, unitless import, inch conversion, ambiguous junction, and unsupported spline/block/3D fixtures.
- Reimport exported SVG and DXF and compare demanded counts, dimensions, holes, and checked geometry. Test output with a separate DXF reader so writer/reader bugs cannot merely cancel each other.

### M4. Public-release readiness

- Complete narrow-screen and keyboard behavior, specific errors, contact configuration, About text, and format help.
- Run the acceptance scenarios below against a production build, not just the development server.
- Record initial download size, initialization time, first checked solution time, and stop responsiveness on named hardware/browsers. These are measurements, not cross-device guarantees.
- Build a static output directory and document hosting/base-path requirements. Keep publication separate from implementation.

### Later, only after the first release is useful

WASM multithreading; original-curve export; broader DXF support; automatic project recovery; node editing; CAD constraints; part-in-hole nesting; multiple fixed sheets; remnants/defects; grain constraints beyond allowed orientations; integrations and server-side large-instance solving. Each needs its own small specification and verified solver support.

## 13. Acceptance checklist

Completed locally on 2026-09-05. See `web-app-acceptance-audit.md` for exact evidence and scope; the launch-limit performance checks use recorded fixtures and do not prove candidate-validation performance for every admitted input. Publication and physical iOS-device testing remain outside this local verification.

- [x] A first-time visitor can run an example without an account, file, or instructions.
- [x] Opening/importing alone does not start optimization.
- [x] JSON, SVG, and the stated DXF subset each reach a checked downloadable result.
- [x] Missing units and unsupported entities are visible before import acceptance.
- [x] A part with a hole preserves its hole in export; no other part is placed inside it.
- [x] Every demanded copy appears exactly once; a missing, duplicated, or unknown copy fails validation.
- [x] A reflected asymmetric part, wrong discrete angle, overlap, containment overlap, coincident duplicate, short clearance, and out-of-bounds placement fail validation.
- [x] A 1e-7 mm² sliver overlap fails under the declared 1e-8 mm² threshold.
- [x] Stop before the first solution, during search, and after a solution all leave a recoverable state.
- [x] An old worker/result cannot overwrite a newer project or run.
- [x] A shorter failed candidate does not displace a longer passed result.
- [x] Final rounded export coordinates, including hole contours, are rechecked.
- [x] The UI remains interactive during parse, solve, and validation; no geometry work blocks it for more than 100 ms on the recorded test machine under launch limits.
- [x] Supported workflows work by keyboard and at 390 px width.
- [x] No geometry, filename, or diagnostic content is transmitted during import, solve, or download.
- [x] Contact has a real configured destination and makes no unsupported feature promises.
- [x] Lockfiles, notices, build commands, supported formats, and known limitations are documented.

Expected developer commands to provide when implementing: `npm ci`, `npm run wasm:build`, `npm run dev`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`, and a documented GEOS audit command. These commands are now provided in `web/`; see `web/README.md`. The web build must compile the WASM artifact rather than depend on an untracked local binary.

## 14. Instructions to the implementing model

Start with M0. Follow this document's names, scope, states, and numeric policies. Read the source at the current revision and identify drift before editing. Prefer small typed functions and direct worker messages. Do not substitute mock optimization for real Rust execution, silently omit an import requirement, increase geometric tolerances to make tests pass, or turn the project into a general CAD suite. An unsupported file must receive an honest explanation.

For each completed milestone, report what now works, the exact checks run, and unresolved issues. If a requirement needs a geometry or algorithm decision not settled here, provide a minimal failing fixture and a concrete proposed change to this document. Leave the owner to decide algorithm changes; routine web implementation choices should not require repeated clarification.

## 15. Source notes

Repository interfaces above were read locally at the recorded revision. External references checked on 2026-09-05:

- [sparroWASM manifest](https://github.com/JeroenGar/sparroWASM/blob/main/Cargo.toml), an existing wrapper with older pinned solver dependencies.
- [SVG-Edit documentation](https://github.com/SVG-Edit/svgedit), interaction reference only; no dependency planned.
- [dxf-parser](https://github.com/gdsestimating/dxf-parser), entity parser used beneath the deliberately narrower app contract.
- [svgpath](https://github.com/fontello/svgpath), path normalization helper, not a complete SVG document importer.
- [polygon-clipping](https://github.com/mfogel/polygon-clipping) and [robust-predicates](https://github.com/mourner/robust-predicates), geometry components whose behavior must be tested with the chosen tolerances.
- [Worker termination](https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate), immediate worker cancellation without a cleanup callback.
- [Vite static deployment](https://vite.dev/guide/static-deploy.html), production output and base-path configuration.

These references support implementation choices. They do not establish that this future app already supports the specified workflow.
