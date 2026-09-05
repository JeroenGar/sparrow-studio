# Web app acceptance audit

Final local verification: 2026-09-05. Branch: `jg-web-app`. The implementation follows the design plan and later owner requests. No public deployment, push or commit was performed.

## Completed evidence

- `npm test`: **86 passed in 11 files**.
- `npm run test:e2e`: both WASM builds and typecheck passed; **100 browser checks passed**, with two deliberate skips for the Chromium-specific touch-input scenario in Firefox/WebKit. All other scenarios run across the three engines.
- Real JSON, SVG and DXF imports reach checked, serialized downloads. Projects revalidate saved results. Export coordinates and holes are reparsed and checked; a failed candidate never replaces a better checked result.
- Validators cover copy ownership, reflection, rotations, containment/ordinary overlap, boundary/clearance errors and the 1e-7 mm² sliver against the unchanged 1e-8 mm² threshold. Worker regressions cover stale run/revision/sequence data, latest-only pending validation and late errors after disposal.
- CAD checks cover numeric and pointer movement/scaling/rotation, group transforms, snapping, Alt bypass, cancellation and atomic undo. A deterministic regression protects one draft field from an unrelated external coordinate update. Actual Chromium touch input verifies vertical dragging without page scrolling.
- Preparation places shapes compactly without overlap; moving a part preserves its requested position and nudges neighbours. Copy labels lie inside concave shapes and outside holes. Quantity changes update counts without recalculating label geometry.
- All 34 original main/Gardeyn datasets are available from the example selector. Library scaling uses one common factor per dataset and a 2,500 mm² median distinct-type area. Resized personal copies persist in validated IndexedDB storage, including corruption and cross-tab mutation protections.
- Dark defaults, saved Light/System preferences, vivid palette, stronger normal borders, thin ghost borders, 10% white ghost fill and fully transparent ghost bins were checked. Display-unit switching preserves exact canonical millimetre geometry and checked results; inch edits convert correctly.
- Import review shows per-part geometry and dimensions, re-previews enclosed-contour interpretation immediately, and reports excluded contours. Field/aggregate quantity errors are visible. Diagnostics retain import warnings and can be downloaded from About on mobile.
- Privacy tests exercise SVG/DXF/project imports, actual nesting and local downloads. Requests are restricted to known same-origin static assets with no file names, geometry, diagnostic payloads or WebSocket transmission.
- Native Safari 26.6 completed a production run, an explicit Stop with checked output retained, and another completed run. Downloaded diagnostics confirm three threads and 12 valid workshop placements. This is separate from the automated WebKit engine evidence.
- Chromium, Firefox and WebKit passed static `/repo/` hosting, scoped isolation service-worker setup, checked multithreaded runs, Stop/restart and notice retrieval. Chromium directly observed pool workers disappear after Stop.
- Independent Python XML/Shapely audits passed 12 SVG exports; ezdxf 1.4.3 and GEOS passed three DXF exports with preserved holes. No overlap or boundary violation was measured in those files.
- Full notices and exact source links are distributed. The build creates a deterministic `sparrow-source.zip`, linked from About and the notices. Its manifest hashes and reproducibility were checked; an isolated extraction passed `npm ci` and `npm run build` without using the original checkout or generated artifacts.

## Scope and known limits

Two generated 100,000-demanded-vertex workloads (500 × 200 and 20 × 5,000 vertices) imported successfully after a conservative edge-box rejection was added before exact segment predicates. The measured preparation and search-start/Stop phases had no main-thread task over 50 ms on the recorded machine. Both extreme solver inputs reached the 15-second initialization watchdog without a candidate in the longer run; candidate-validation performance at that limit is **not proven**. Import limits are guards, not a promise that every admitted input will finish nesting. See `preparation-performance.md` for before/after timings and Stop measurements.

The app is a local, static prototype. Physical iPhone/iPad testing and an actual public host have not been exercised. Publishing and checking links on that chosen host remain a separate owner action. The current relative-path build, source archive and notices are prepared for it.

The solver reserves full outer footprints: holes are preserved and exported, but cannot receive other parts. Exports contain the polygonal approximation used for checking, not original curves or toolpaths. Email remains unconfigured at the owner's request; the subtle contact route links to the supplied LinkedIn destination after interaction.
