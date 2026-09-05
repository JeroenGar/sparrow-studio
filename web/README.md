# sparrow-studio

An interactive browser demo of the sparrow nesting algorithm, developed from [the design plan](../notes/web-app-design.md). The app is independent of the original sparroWASM wrapper. Contact links to Jeroen’s LinkedIn and email appear after interaction.

## Build and run

Use Python 3, Node.js, stable Rust, nightly Rust 2026-08-30 with rust-src, and wasm-pack. From `web/`:

```sh
rustup target add wasm32-unknown-unknown --toolchain stable
rustup toolchain install nightly-2026-08-30 --component rust-src --target wasm32-unknown-unknown
npm ci
npm run wasm:build
npm run dev
npm run typecheck
npm test
npx playwright install chromium firefox webkit
npm run test:e2e
npm run build
npm run preview
```

Run `npm run wasm:build` before the first development session. Both `build` and `test:e2e` compile the actual WASM sources; neither depends on an untracked prebuilt binary. `test:e2e` tests production `dist` on port 4173 in Chromium, Firefox and WebKit. `npx playwright test --list` lists the current cases; `npx playwright test tests/theme.spec.ts` reuses an already built `dist`.

The build isolates Cargo from the ancestor wrapper configuration. It pins the real solver at `120cf937de5e74c292406bc9947276c9dd49217f` and jagua-rs 0.8.1. It does not use a sibling checkout or replace the optimizer. Serial WASM uses stable Rust; shared-memory WASM rebuilds the standard library with nightly and wasm-bindgen-rayon 1.3.0. Exact resolved dependencies are in the npm and Cargo lockfiles.

## Static hosting and threads

Publish the complete contents of `dist/` on one HTTPS origin, at either `/` or a repository subdirectory such as `/sparrow-studio/`. Vite's base is relative. Preserve the `assets/`, `examples/`, notice files and `isolation-worker.js` paths. Use a trailing slash for a subdirectory URL. There is no server API or client-side router.

Development sends cross-origin isolation headers. Production preview deliberately omits them to exercise the static-host fallback needed for GitHub Pages. A same-origin service worker adds isolation response headers and reloads once at startup, before the editable document exists. It caches nothing. Browsers that cannot establish isolation or initialize the pool use the serial solver.

Solver options offer Automatic or 1–3 threads. Automatic reserves one reported logical core and caps the solver at three threads. Diagnostics report the actual pool and fallback reason. Stop disposes both the solver coordinator and its Rayon workers; starting again creates a fresh pool. Native failure-based auto-termination can finish before the selected time cap. This is not a claim that threaded search is always faster.

## Deployment

`.github/workflows/pages.yml` builds and publishes GitHub Pages on pushes to `main`, or through its manual Run workflow action. It installs Node 24, stable Rust, nightly 2026-08-30 and wasm-pack 0.15.0, uses the dependency lockfiles, and builds both solver variants. Unit tests and the Chromium production browser suite must pass before the Pages artifact is published. A failed build leaves the previous deployment in place.

The initial Pages address is https://jeroengar.github.io/sparrow-studio/. The custom domain is `sparrowstudio.app`, registered at Spaceship. GitHub Pages remains the host when a custom domain is connected. The repository stays private; the website and its linked build-source download are public.

Domain setup uses GitHub's repository Pages setting, four apex A records pointing to `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`, and a `www` CNAME pointing to `jeroengar.github.io`. Keep the `_github-pages-challenge-JeroenGar` TXT record used for account-level domain verification. HTTPS is provided by GitHub Pages. The custom domain is configured in GitHub settings; Actions publishing does not use a CNAME file in the build.

After deployment, check a fresh browser session for startup isolation, a checked nesting result, Stop/restart, dataset loading and downloads. Browser-stored shapes are tied to the origin: localhost, github.io and the custom domain have separate libraries.

## Supported work

- Start with the bundled `swim.json` demo, ready to nest without automatically running the solver. New project starts empty. The project-name menu groups New, Open, Rename and examples; Save downloads a named `.sparrow-project.json` file, including empty projects. Replacing unsaved work offers Download and continue, Discard, or Cancel. Undo stays within the current project.
- Import shapes adds sparrow instance JSON, closed-contour SVG and the documented planar ASCII DXF subset without changing the current name or material settings. Import is reviewed before changing the drawing. Saved project files restore a complete job; instance JSON also offers an explicit Open as new project action.
- Examples can be opened for preparation or opened and nested. Shape-library collections provide reusable ingredients; Command/Control-click toggles selection and Shift-click selects a range for one bulk import.
- Prepare parts with exact position and proportional size fields, group movement, rotation, drag handles, grid/angle snapping, duplicate/delete, and undo/redo. New/imported parts are arranged compactly without overlap; moving or resizing a part displaces neighbours as needed. Copy counts are placed inside each part, outside its holes.
- The coordinate grid subdivides as you zoom, with linear top/left rulers in the active units. Part properties open separately from Material & run; click the selected part in the list, click the canvas background, press Escape, or close the inspector to deselect. The orange nesting action stays at the bottom left.
- Switch between millimetres and inches in About. Display preferences persist; geometry and exports stay in canonical millimetres. Changing units or leaving an unchanged numeric field does not round geometry or invalidate checked results.
- Browse all 34 main/Gardeyn benchmark files. Original benchmarks retain their coordinates, demand and rotations. The shape library uses one scale factor per dataset, giving a median net area of 2,500 mm² across distinct part types.
- Save personal shapes in IndexedDB on this browser/device. Geometry is validated on read/write. Web Locks serialize mutations across tabs. Personal shapes are subject to the same 500-type/100,000-vertex guard as a project. Browser storage can be cleared; explicit project downloads are backups.
- View intermediate search layouts with red overlap regions or the best independently checked result. Ghost mode keeps thin outlines and a 10% white shape fill, with a transparent material background.
- Download checked polygonal SVG, ASCII DXF, projects and diagnostics. Dark is the initial theme; explicit Light and System preferences persist.

SVG supports physical sizing, affine transforms, local references, bounded curve flattening and compound holes. Nested SVG viewports, scripts, external references, clipping/masks, CSS-driven geometry and open contours are rejected. For `preserveAspectRatio="slice"`, complete cutting contours are imported with an explicit warning; viewport cropping is not applied.

DXF supports planar LINE, ARC, CIRCLE, LWPOLYLINE with bulges and ordinary 2D POLYLINE/VERTEX. Recognized INSUNITS are honored. Layer selection and explicit exclusion of invalid contours are available. Endpoint gaps up to 0.01 mm join only when unambiguous. Binary DXF, splines, ellipses, inserts/blocks and 3D entities are outside this subset. DXF export is R2000 with closed LWPOLYLINE entities on PARTS/HOLES layers.

Holes remain in geometry and exports, but the solver reserves each entire outer footprint. Other parts cannot nest inside holes. Clearance is part-to-part distance; the solver also reserves an edge allowance, disclosed in settings. Original curves are exported as the same polygonal approximation used for validation. This is not a toolpath generator or manufacturing certification.

Limits are 10 MiB/file, 25 MiB/import batch, 500 demanded copies, 5,000 vertices/part including holes, 100,000 demanded vertices and coordinate extents of 100,000 mm. Validation uses 1e-6 mm linear tolerance and 1e-8 mm² overlap tolerance per pair. A failed check never silently loosens either tolerance.

## Verification

On 2026-09-05, `npm test` passed **88 tests in 12 files**. The production build compiled both WASM variants and type-checked the application; Playwright passed **130 browser checks** across Chromium, Firefox and WebKit. Two instances of the Chromium-specific touch-input test are intentionally skipped in the other engines. Coverage includes imports/exports, checked-result ownership, Stop/restart, thread fallback and disposal, privacy, CAD gestures and rapid numeric edits, copy labels, local library persistence, display units, keyboard and 390 px layouts.

Native Safari 26.6 also completed a production run, Stop and restart using three solver threads. Desktop and mobile normal/ghost views were inspected with computer use. All three browser engines passed a separate `/repo/` static-host test, including isolation-worker scope and thread restart; Chromium additionally verified worker-pool disposal directly.

Independent XML/GEOS checks passed 12 exported SVGs, and ezdxf/GEOS checks passed three holed DXF exports. An extracted source archive successfully rebuilt both WASM variants and the complete static app using only its contents and the documented installed toolchains/dependency caches.

Two generated 100,000-vertex preparation workloads imported and remained interactive with no measured main-thread task over 50 ms. Those extreme workloads reached the solver initialization watchdog before producing a candidate; being under the import limits does not guarantee a completed nesting result. Stop remained responsive. High-limit candidate-validation responsiveness was therefore not measured. See [the performance record](../notes/preparation-performance.md) and [acceptance audit](../notes/web-app-acceptance-audit.md) for the machine, methods and precise scope. Physical iPhone/iPad testing has not been performed.

Independent export checks, from `web/`:

```sh
uv run --with shapely==2.1.2 python tests/audit_bridge.py path/to/candidates.json
uv run --with shapely==2.1.2 python tests/audit_export.py path/to/layout.svg
uv run --with ezdxf==1.4.3 --with shapely==2.1.2 python tests/audit_dxf.py path/to/plate.dxf --copies 1 --holes 1 --area 5600
```

Playwright saves downloads/screenshots under `test-results/`. For the native clearance fixture, isolate Cargo flags:

```sh
cd /tmp
CARGO_ENCODED_RUSTFLAGS='' cargo +stable test --manifest-path /absolute/path/to/sparrow-studio/web/wasm/Cargo.toml --locked -- --nocapture
```

The historical native fixture requested a 2 mm gap between 10 mm rectangles in a 16 mm strip and measured a 2.0056553 mm gap. A nominally exact-fit 14 mm strip failed solver initialization. That failure must remain recoverable rather than relaxing geometry checks.

## Privacy and notices

Files, geometry and diagnostics are processed locally. Ordinary static asset requests still reach the host and can appear in its access logs. Explicit GitHub/LinkedIn/paper links navigate externally. No analytics, social embeds, external fonts, account service or upload endpoint is included. The privacy browser test permits only known built-asset GETs and checks import/export content is absent from request URLs, bodies and headers.

Third-party full texts and source references are in `public/THIRD_PARTY_NOTICES.txt`, the two `public/RUST-LIBRARY-*.html` files and `public/examples/NOTICE.txt`. Regenerate/check from the repository root:

```sh
python3 web/scripts/generate-notices.py
python3 web/scripts/generate-notices.py --check
```

See [the notices audit](../notes/notices-audit.md) for exact upstream packaging gaps and source availability. The build includes corresponding application source in `sparrow-source.zip`, linked from About and the notices. Preserve that archive and the notice files when publishing, and verify their deployed relative links. The public demo includes the source archive.

## Downloadable build source

Every `npm run build` creates `public/sparrow-source.zip` before Vite copies it to `dist/`. The archive contains the exact local frontend and WASM bridge sources, lockfiles, build scripts, configuration, repository license, implementation notes and required static runtime assets. Benchmark files are included once, so rebuilding retains the dataset picker. Dependencies, generated WASM, test fixtures and build outputs are excluded. This is a build-source archive; the repository workspace contains the separate developer test suite.

Extract the archive, enter its `web/` directory, install the toolchains listed above, then run `npm ci` and `npm run build`. The build fetches dependencies identified by the included lockfiles. No original wrapper checkout or sibling solver directory is required. `SOURCE-MANIFEST.json` records every archived file's SHA-256. Archive metadata and ordering are fixed; unchanged inputs produce identical archive bytes.

```sh
python3 scripts/package-source.py
python3 scripts/package-source.py --check
python3 tests/test_source_archive.py
```

The last command runs from the repository's `web/` workspace. The static notices identify the sibling archive; its relative path works at a GitHub Pages repository subdirectory as well as at the origin root. Providing this local artifact does not publish a site.
