# Native versus WASM baseline

Measured on an Apple M3 Max, macOS arm64, using Rust stable 1.97.0. Studio checkout `88cd3581b7d88a2bacc03dcfb6fc6e22d5e07ca4`, with the benchmark additions in this task. Both builds use Sparrow `9ef45676695ef94d045ac8bff0530822127f1437` and jagua-rs 0.8.1 from the same Cargo.lock.

## Workload

- `web/public/examples/swim.json`, 48 copies, Xoshiro256PlusPlus seed 42.
- Input SHA-256: `b296788340a3489c3d304b79ad8ca561735fe4ee3f79554f5170da8fcc4f3a0d`.
- Studio's standard solver configuration, exactly one search worker in both phases, no clearance or simplification, no phase deadlines.
- Stop after 109 completed separation attempts in exploration and 109 in compression. Attempts include both feasible and infeasible outcomes. Existing algorithmic stopping conditions remain enabled; this workload completes all 218 attempts.
- Count evaluations through Sparrow's existing `SeparationResult.total_evals` callback. This counts search evaluations, not geometry work during import or initial construction.
- Measure JSON input parsing, geometry import, initial placement, and search inside Rust. Final export/JSON serialization and browser module loading are outside the timer. Search time is also recorded separately.
- Native release and serial WASM release: optimization level 3, full LTO, one codegen unit. No native CPU override, explicit SIMD feature, relaxed arithmetic, WASM threads, or wasm-opt postprocessing.
- Three sequential repeats of the same seed per runtime; no concurrent benchmark processes. A short browser warm-up is excluded. Browser runs use Playwright's bundled engines, not the installed Safari application.

The runner asserts equality of every separation's success/evaluation/move/iteration tuple, total evaluations, report count, final layout, width, and density. Final placement coordinates and angles, and strip width, are additionally compared as raw f32 bits. Timing fields are excluded from equality checks.

This is a compiler/runtime baseline, not a universal algorithm benchmark. Equal seeds do not guarantee equal work after changes to arithmetic or search order. The runner deliberately fails if those changes produce a different trajectory. Calibration is not monotonic: changing the exploration budget changes the layout from which compression starts.

## Scalar baseline results

Each sample performed **28,657,430 evaluations**, with identical separation traces and final placement bits. Final width was 6024.60546875, with 73.42696% density. These are single-worker results, not threaded application performance.

| Runtime | Version | Run 1, s | Run 2, s | Run 3, s | Median, s | Relative to native |
|---|---|---:|---:|---:|---:|---:|
| native | Rust 1.97.0 | 28.206 | 28.004 | 27.742 | 28.004 | 1.000× |
| chromium | 153.0.8010.12 | 54.997 | 55.163 | 55.651 | 55.163 | 1.970× |
| firefox | 155.0 | 59.513 | 59.448 | 59.104 | 59.448 | 2.123× |
| webkit | 26.6 | 59.996 | 59.933 | 60.302 | 59.996 | 2.142× |

This baseline keeps the optional Sparrow SIMD kernel disabled on both targets. It does not establish the gap against a CPU-tuned native SIMD build. The benchmark-only stopping rule and lightweight listener also differ from production timing checks and live UI callbacks.

## Reproduce

From the repository root, build outside the checkout so ancestor Cargo configuration cannot inject target flags:

```sh
studio_root="$PWD"
cd /tmp
CARGO_ENCODED_RUSTFLAGS='' cargo +stable build \
  --manifest-path "$studio_root/web/wasm/Cargo.toml" \
  --release --example benchmark --features benchmark --locked
CARGO_ENCODED_RUSTFLAGS='' RUSTUP_TOOLCHAIN=stable wasm-pack build \
  "$studio_root/web/wasm" --target web --release \
  --out-dir target/bench-scalar --features benchmark --locked
cd "$studio_root/web"
BENCH_OUTPUT=/tmp/sparrow-baseline.json node scripts/benchmark-wasm.mjs bench-scalar > /tmp/sparrow-baseline-complete.json
```

`BENCH_OUTPUT` saves every completed sample so an interrupted browser session does not lose earlier results.

The benchmark is gated by the `benchmark` Cargo feature and is absent from production builds. It currently lives in sparrow-studio and calls the pinned Sparrow library; the sibling Sparrow repository has not been modified.

`BENCH_SEPARATIONS`, `BENCH_DATASETS`, and `BENCH_SEEDS` override the defaults of `109`, `swim`, and `42,42,42`. The input seed is a u32. Install the project's existing Playwright browser dependencies before running the browser comparison.

Run the stopping-rule check with:

```sh
CARGO_ENCODED_RUSTFLAGS='' cargo +stable test \
  --manifest-path "$studio_root/web/wasm/Cargo.toml" \
  --features benchmark --locked benchmark::tests
```

## SIMD-enabled comparison

After the scalar baseline, enable Sparrow’s existing portable-SIMD kernel on both targets. Use nightly-2026-08-30 on both; native additionally uses `-Ctarget-cpu=native`, and WASM uses `-Ctarget-feature=+simd128`. Release optimization level 3, full LTO, and one codegen unit remain enabled. No wasm-opt pass or relaxed floating-point flags are used.

One measured run per runtime, same SWIM/seed/218-attempt workload:

| Runtime | Time, s | Relative to native SIMD |
|---|---:|---:|
| native | 14.518 | 1.000× |
| chromium | 26.860 | 1.850× |
| firefox | 37.428 | 2.578× |
| webkit | 28.085 | 1.934× |

All four runs performed **18,146,070 evaluations**, and passed the same exact trace, layout, and f32-bit comparisons. An earlier native SIMD calibration took 14.356 seconds and produced the same evaluation count. Final width was 6004.150390625, with 73.67712% density.

SIMD and scalar trajectories differ. Do not divide their total runtimes to claim a SIMD speedup: the SIMD run performs fewer evaluations and finishes with a different layout. Native/WASM ratios within each table compare matching work. The SIMD table is preliminary because it has one run per browser.

Build and run the SIMD comparison from `/tmp`, with `studio_root` set as above:

```sh
CARGO_ENCODED_RUSTFLAGS='-Ctarget-cpu=native' cargo +nightly-2026-08-30 build \
  --manifest-path "$studio_root/web/wasm/Cargo.toml" \
  --release --example benchmark --features benchmark,sparrow/simd \
  --target-dir "$studio_root/web/wasm/target/native-simd" --locked
CARGO_ENCODED_RUSTFLAGS='-Ctarget-feature=+simd128' RUSTUP_TOOLCHAIN=nightly-2026-08-30 wasm-pack build \
  "$studio_root/web/wasm" --target web --release \
  --out-dir target/bench-kernel-simd --features benchmark,sparrow/simd --locked
cd "$studio_root/web"
BENCH_SEEDS=42 \
BENCH_NATIVE_BINARY="$PWD/wasm/target/native-simd/release/examples/benchmark" \
BENCH_OUTPUT=/tmp/sparrow-simd-comparison.json \
node scripts/benchmark-wasm.mjs bench-kernel-simd > /tmp/sparrow-simd-complete.json
```

After these baseline measurements, the production build was changed to enable Sparrow’s SIMD kernel and `+simd128` in both serial and threaded WASM. Both now use nightly-2026-08-30. SIMD changes rounding and therefore may change the search trajectory; the independent geometry validator remains in place.

## Binaryen wasm-opt experiment

Binaryen 132.0.0, standard `-O3`, applied to the SIMD benchmark binary. No fast-math or relaxed-SIMD options. One run per variant/browser. All optimized results matched native SIMD exactly.

| Browser | SIMD, s | SIMD + wasm-opt, s |
|---|---:|---:|
| chromium | 26.824 | 26.858 |
| firefox | 36.941 | 39.398 |
| webkit | 27.912 | 27.946 |

No repeatable runtime benefit was demonstrated; Firefox was slower in this run. Keep wasm-opt disabled.

- bench-kernel-simd: 1,466,183 bytes, 518,845 bytes gzip.
- bench-kernel-opt: 1,149,353 bytes, 480,196 bytes gzip.

Reproduce the transform with Binaryen 132.0.0:

```sh
cp -R web/wasm/target/bench-kernel-simd web/wasm/target/bench-kernel-opt
wasm-opt web/wasm/target/bench-kernel-opt/sparrow_web_bg.wasm -O3 \
  -o web/wasm/target/bench-kernel-opt/sparrow_web_bg.wasm
```

Pass both package names to the benchmark runner, using the native SIMD binary as above. Binaryen was installed temporarily for this experiment and is not a project dependency.

## Rebuilding the serial standard library

Built the serial SIMD benchmark with nightly-2026-08-30 and `-Z build-std=panic_abort,std`, keeping `-Ctarget-feature=+simd128`. One run per browser, compared with the same prebuilt-standard-library benchmark measured in the wasm-opt experiment.

| Browser | Prebuilt std, s | Rebuilt std, s |
|---|---:|---:|
| chromium | 26.824 | 26.962 |
| firefox | 36.941 | 37.476 |
| webkit | 27.912 | 28.098 |

All results matched the native SIMD trace and placement bits. No runtime gain was demonstrated, so the serial production build retains the prebuilt standard library. The threaded build still rebuilds std as required for atomics.

Reproduce from `/tmp`, with `studio_root` set as above:

```sh
CARGO_ENCODED_RUSTFLAGS='-Ctarget-feature=+simd128' RUSTUP_TOOLCHAIN=nightly-2026-08-30 wasm-pack build \
  "$studio_root/web/wasm" --target web --release \
  --out-dir target/bench-std-simd --features benchmark,sparrow/simd --locked \
  -Z build-std=panic_abort,std
```

Run `bench-std-simd` with the native SIMD reference binary using the same runner.

## Production SIMD verification

- Production build and TypeScript check passed.
- Confirmed `simd` in both generated WASM modules; only the threaded module requires shared memory.
- All 121 unit tests and 6 native Rust tests passed with the SIMD feature enabled for Rust.
- All 42 selected browser checks passed across Chromium, Firefox, and WebKit: thread startup/restart, serial and pool-failure fallback, automatic stopping, SVG export, and the SWIM bridge. Valid-result tests check geometry independently.
- Updated build-mode diagnostics and corresponding expectations from `no SIMD` to `SIMD`.
- No wasm-opt dependency or additional production optimization flags were added.
