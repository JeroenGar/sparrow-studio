# WASM logging filter comparison

Measured 2026-09-14 on the local macOS Apple Silicon machine. Related discussion: https://github.com/JeroenGar/sparrow/issues/158

## Result

No material, consistent runtime regression from removing `log/release_max_level_info` was demonstrated with Studio's current logging setup. Across 72 runs, the median paired runtime difference ranged from -0.38% to +1.03%. This is not a statistical proof of zero overhead. The Firefox gardeyn2 case showed a small increase, while Firefox swim showed a decrease.

| Engine | Dataset | Uncapped median ms | Info cap median ms | Median paired uncapped overhead |
|---|---|---:|---:|---:|
| chromium | gardeyn2 | 1068.5 | 1064.7 | +0.22% |
| chromium | swim | 239.6 | 238.5 | +0.40% |
| firefox | gardeyn2 | 1155.5 | 1139.5 | +1.03% |
| firefox | swim | 269.0 | 269.5 | -0.38% |
| webkit | gardeyn2 | 1222.0 | 1223.0 | +0.00% |
| webkit | swim | 253.5 | 253.5 | -0.35% |

## Method

- Sparrow `ed1c72cf244759e61f9881a93326e2e35e0514e6`, Studio committed source `64a5610`; excluded the user's uncommitted compression experiment.
- Optimized release WASM, serial SIMD, nightly-2026-08-30, normal wasm-pack settings. Both packages use the same source, lockfile, and configuration. The sole feature difference is `log/release_max_level_info`, enabled through an application-level direct log dependency.
- Existing benchmark entry point: 20 completed separation attempts per phase, not a wall-clock stopping budget. No UI, live serialization callbacks, or runtime logger. This isolates the optimization work from loading and rendering.
- Datasets gardeyn2 and swim, seeds 42 and 73, three repetitions of each seed per variant per engine. Alternated variant order; warm-up excluded. Browser engines run sequentially.
- Chromium 153.0.8010.12, Firefox 155.0, WebKit 26.6 via Playwright. These are bundled engines, not the user's installed browser applications.
- Asserted identical evaluation counts, report counts, complete separation traces, bitwise placement coordinates, and final widths for each paired comparison.
- Instrumented `performance.now` to count WASM clock accesses. Identical instrumentation in both variants. Every paired count matched: gardeyn2 531/1105 calls for seeds 42/73; swim 575/819.
- This is a single-worker SIMD experiment; it does not measure threaded scheduling, scalar WASM, debug-enabled loggers, or console output.

## Why the timestamp concern does not show up here

Studio installs no Rust logger and never raises `log`'s runtime maximum, whose default is Off. The log macros check both the compile-time and runtime levels before evaluating format arguments. Removing the static cap therefore does not enable Debug output or timestamp formatting by itself.

Sparrow's separator also calls `Instant::now()` and `start.elapsed()` outside its final log macro to collect throughput statistics. A static Info cap does not remove these calls. Time checks for termination are a separate cost as well.

If a consuming application enables Debug logging with timestamp formatting, that is a different workload and may be costly in WASM. This experiment does not estimate that cost.

## Size

Benchmark WASM, uncapped versus capped:

- Raw: 1,485,011 versus 1,447,967 bytes, saving 37,044 bytes.
- Gzip: 525,349 versus 514,483 bytes, saving 10,866 bytes.

These are benchmark binaries, not exact production download sizes.

## Recommendation

Keep the library free of the global compile-time cap, as requested in issue 158. There is no evidence here of a meaningful Studio runtime penalty. Studio could opt into the cap at the application level for code-size savings if desired, independently of Sparrow's library dependency.

## Reproduction artifacts

The isolated crate, two built packages, runner, and full raw results are retained at:

/var/folders/hj/gj7_18s17lb66yxvc9tymz380000gn/T/sparrow-log-bench-rpxqsb77

Run `node run.mjs` in that directory to repeat the browser measurements. The runner uses this checkout's installed Playwright dependency and datasets. No application source or local compression settings were changed by this measurement.

## Info logger and timestamp follow-up

Compared runtime Off, Info without timestamps, and Info with timestamps in the same optimized WASM binary. 108 runs total: same datasets, seeds, alternating order, and three browser engines as above. Identical work/layout checks passed. The logger formats a level, target, and message and calls browser postMessage; no console output. Timestamped messages additionally read performance.timeOrigin and performance.now. Browser-side collection and ZIP construction are outside the measured solver interval. The test runs the benchmark inside a page; production worker-to-coordinator transfer and main-thread log retention are not measured here.

| Engine | Dataset | Plain Info vs Off, paired median | Timestamped vs plain Info, paired median |
|---|---|---:|---:|
| chromium | gardeyn2 | +0.39% | -0.23% |
| chromium | swim | +1.39% | -0.10% |
| firefox | gardeyn2 | +0.04% | +0.00% |
| firefox | swim | +0.59% | -0.33% |
| webkit | gardeyn2 | -0.03% | -0.01% |
| webkit | swim | -0.25% | +0.19% |

No consistent timestamp penalty was established. Keep timestamps for diagnostic correlation. Individual runs showed noise/outliers, so sub-percent differences should not be treated as precise speedups. Info emitted 123/196 records on gardeyn2 and 152/147 on swim for seeds 42/73; timestamp mode added exactly one clock access per record. The other clock calls were unchanged.

Logger benchmark artifacts: `logger-run.mjs`, `logger-results.json`, and `logger/` in the temporary reproduction directory above. Production collection has been tested separately through actual serial, threaded, SIMD and non-SIMD runs, phase skipping, stopping, and ZIP downloads.

### Collection choices

- Console logging: unnecessary output and potentially expensive developer-tools handling. Not used.
- Keep logs only inside WASM until completion: loses them when Stop/Skip terminates the worker. Not used.
- Transfer Info messages to diagnostics while solving, without any UI rendering: implemented. Info includes Warn and Error; Debug/Trace remain disabled. Capture monotonic timestamps at emission rather than receipt, so queue delay is not mistaken for solver timing.
- Retain at most 10,000 recent records. Old records are dropped in chunks of 1,000, and the exported file states the omitted count.
- Download diagnostics as a ZIP with `diagnostics.json` and `solver.log`; empty logs are valid before a run. Nothing is uploaded and logs are not printed live.
