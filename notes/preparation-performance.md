# Preparation performance at the vertex limit

Measured on 2026-09-05, Apple M3 Max, macOS 26.6.1, headless Chromium 153.0.8010.12, 1280 × 900 viewport, production assets served without isolation headers. The application's service worker supplied isolation. The initial comparison measured preparation only; the follow-up below also exercises Nest and Stop.

The generated project files each contain exactly 100,000 demanded vertices, with one copy per shape. One stresses the 500-part ceiling; the other stresses the 5,000-vertex-per-part ceiling. Files are written to disk and selected through the native file input. Passing large Playwright buffers was excluded because automation's buffer decoding itself created a long task absent with disk-backed files.

| Fixture | Phase | Before | After strict segment-box rejection |
| --- | --- | ---: | ---: |
| 500 shapes × 200 vertices | File / preview | 6,399 ms | 268 ms |
| 500 shapes × 200 vertices | Accept / render / labels | 7,940 ms | 635 ms |
| 20 shapes × 5,000 vertices | File / preview | 30-second worker timeout | 1,866 ms |
| 20 shapes × 5,000 vertices | Accept / render / labels | Not reached | 6,188 ms |

In the completed after-runs, Chromium reported **no main-thread long task of 50 ms or longer** during preview, acceptance, selection or zoom. The largest animation-frame gap was 50 ms while accepting the 500-part project; selection and zoom stayed at approximately 16.7 ms. The earlier 500-part run also had no long tasks: the improvement is worker-side import latency, not an asserted UI speedup.

The change rejects segment pairs only when their axis-aligned boxes are strictly disjoint. Touching boxes still use the existing robust predicates. No topology rule, coordinate rounding or geometric tolerance changed. All 71 focused geometry, SVG, DXF, manipulation and dataset tests passed, including a new regression for endpoint contact, collinear overlap, 1e-12 near-crossings and separated parallel segments.

Reproduce from `web/` after building and serving production assets:

```sh
node tests/measure-preparation.mjs http://127.0.0.1:4173/
```

The script writes `/tmp/sparrow-preparation-performance.json` and screenshots, and fails if import fails or a measured main-thread long task exceeds 100 ms. The after-run raw report is also retained at `/tmp/sparrow-preparation-performance.json`; the disk-file baseline is `/tmp/sparrow-preparation-before.json` for this session.

These are single-run measurements on named hardware, not cross-device guarantees or exhaustive coverage of all valid 100,000-vertex topology. They do not establish solve-time or candidate-validation responsiveness at that limit. No UI memoization was added: the measured preparation interactions did not justify it.

## Nest and Stop at the same limit

The harness now starts nesting and clicks Stop after three seconds. Both fixtures started a three-thread pool and stopped cleanly before a candidate arrived. There were no main-thread long tasks of 50 ms or longer. Measured Playwright click-to-`Stopped` latency was 117 ms for 500 × 200 and 91 ms for 20 × 5,000; this includes automation input dispatch and state observation rather than measuring a single JavaScript task.

A separate bounded run that waited for search reached the existing 15-second solver-initialization watchdog for **both** fixtures, with zero candidates. Its largest main-thread long task was 50 ms. The app remained responsive, but **candidate validation at the full vertex limit remains unverified**. The saved watchdog report is `/tmp/sparrow-limit-initialization.json`; the current performance report records explicit Stop instead.

The product limits are resource guards, not promises that every supported input can initialize within 15 seconds. No solver heuristic, initialization timeout or geometry tolerance was changed to make these fixtures pass.


## Native Safari production check

On 2026-09-05 at approximately 04:25 CEST, the production build was exercised through Safari 26.6's native UI at `http://127.0.0.1:4175/`, using the static-host isolation service worker. A workshop run completed, a second run was explicitly stopped with a checked result retained, and an example run after Stop completed again. The downloaded diagnostics confirmed **3 solver threads**, 12 placements, passed validation, zero overlap and zero boundary violation. The final restart reported 23.12 ms initialization; its first candidate arrived 1.64 ms after search began and took 4.82 ms to validate. These candidate timings exclude page loading, input normalization and UI display throttling.

Desktop normal/ghost borders and the 390 px preparation layout were inspected through computer use. The native Safari check supplements the automated WebKit engine tests; it does not establish behavior on an iPhone or iPad.

## Independent export audit

The production browser run's 12 SVG exports passed the separate Python XML + Shapely/GEOS audit, including swim's 48-copy layouts and holed plates. Three DXF exports passed ezdxf 1.4.3's structural audit and GEOS checks: one part, one hole and 5,600 mm² net area each. All audited exports had zero measured pair overlap; SVG exports had zero measured boundary violation. Runtime export validation remains separate and reparses the actual serialized coordinates.
