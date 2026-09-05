# Default auto-termination

The web bridge enables the pinned solver's native early-termination mode for every run, in both the single-threaded and threaded builds. It uses the same settings as the native CLI's `--early-termination` option and the original sparroWASM wrapper:

- Exploration ends after `DEFAULT_MAX_CONSEQ_FAILS_EXPL` consecutive failed separation attempts (10 at the pinned revision). A successful attempt resets that sequence.
- Compression reduces the shrink step after each failed attempt using `DEFAULT_FAIL_DECAY_RATIO_CMPR` (0.9 at the pinned revision), and ends when that step falls below the configured minimum.

The selected duration still caps the exploration and compression phases at 80% and 20% respectively. Initialization has its existing separate watchdog. Early termination does not declare optimality: the normal final solution still goes through the independent geometry validator, and only checked results can be downloaded.

No JavaScript protocol change is needed. A short hint beside the duration selector can describe it as a maximum: “Stops earlier when the search stalls.” An on/off override is not required by the current request.

Source: pinned sparrow revision `120cf937de5e74c292406bc9947276c9dd49217f`, `src/cli.rs`, `src/consts.rs`, and `src/optimizer/{explore,compress}.rs`.

## Verification

`npx playwright test tests/auto-termination.spec.ts` passed in Chromium, Firefox and WebKit against the production build. A single fixed-orientation rectangle with a 120-second cap completed in approximately 4.20, 5.90 and 6.22 solver seconds respectively, using three solver threads in each engine. The test requires completion within 45 seconds, verifies the independent geometry check and normal `Complete` stop reason, and downloads the retained one-part SVG. The native Cargo test also passed.
