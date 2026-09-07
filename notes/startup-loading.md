# Startup loading

Implemented on 2026-09-07. The editor mounts after the existing isolation check, while the default example downloads, imports, and prepares in the background. The status bar shows "Loading example…". Project creation, file opening, geometry edits, and drawing take precedence over the pending default. Late errors do not replace errors belonging to the user's work.

Existing dataset caches and lazy WASM loading remain in use. No new dependency or preloading of the full dataset collection was added. Isolation still runs before mounting because it can reload the page to enable shared-memory WASM safely.

## Measurements

Local production Vite preview, headless Chromium, service workers blocked to isolate example loading from the one-time isolation reload. Each condition uses a fresh browser context, followed by a second navigation in that context. The delayed condition intercepts only `examples/gardeyn2.json` and waits two seconds before continuing the request.

Times are `performance.now()` when Playwright observes the project menu and then the first part row. These are individual local observations, including test-observation overhead, not production percentiles or full-network throttling results.

| Condition | Editor before | Editor after | Example before | Example after |
| --- | ---: | ---: | ---: | ---: |
| Cold, normal | 193 ms | 70 ms | 195 ms | 151 ms |
| Repeat, normal | 102 ms | 20 ms | 104 ms | 96 ms |
| Cold, delayed example | 2,328 ms | 65 ms | 2,330 ms | 2,355 ms |
| Repeat, delayed example | 2,331 ms | 41 ms | 2,333 ms | 2,335 ms |

The improvement removes example work from the path to an editable interface. It does not claim to accelerate the download itself. The main application bundle changed from 90.98 kB to 91.12 kB gzip; geometry-worker and WASM assets were unchanged.

## Validation

Run from `web`:

- `rtk npm run typecheck`: passed.
- `rtk npm test`: 111 tests passed.
- `rtk npx vite build`: passed using the existing compiled WASM assets. No Rust or WASM source changed, so WASM was not rebuilt.
- `rtk npx playwright test tests/startup.spec.ts tests/backlog.spec.ts tests/example-picker.spec.ts tests/threads.spec.ts`: 33 tests passed across Chromium, Firefox, and WebKit.

New browser cases hold the default-example request pending while checking immediate editor access, ordinary eventual loading, creating a project, editing material width, opening a saved project, and ignoring a late download failure after project creation. Existing cases cover a visible initial download error, the default example's layout, example selection, isolation, serial fallback, and threaded solve/restart.

Not deployed.
