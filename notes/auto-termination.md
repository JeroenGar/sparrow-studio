# Default auto-termination

The web bridge enables the pinned solver's native early-termination mode for every run, in both the single-threaded and threaded builds. It uses the same settings as the native CLI's `--early-termination` option and the original sparroWASM wrapper:

- Exploration ends after `DEFAULT_MAX_CONSEQ_FAILS_EXPL` consecutive failed separation attempts (10 at the pinned revision). A successful attempt resets that sequence.
- Compression reduces the shrink step after each failed attempt using `DEFAULT_FAIL_DECAY_RATIO_CMPR` (0.9 at the pinned revision), and ends when that step falls below the configured minimum.

Automatic is the default for new projects and examples. `timeLimitSeconds: null` means no search deadline; the bridge ignores phase timeout requests and relies on the native stopping rules. Optional timed runs still cap exploration and compression at 80% and 20% respectively. Existing saved projects retain their selected time caps. Initialization has its existing separate watchdog. Early termination does not declare optimality: the normal final solution still goes through the independent geometry validator, and only checked results can be downloaded.

The Stop condition selector offers Automatic and the existing time caps. Automatic runs have no JavaScript search watchdog; initialization and independent validation retain their watchdogs. Manual Stop terminates the runtime worker in either mode.

Source: pinned sparrow revision `120cf937de5e74c292406bc9947276c9dd49217f`, `src/cli.rs`, `src/consts.rs`, and `src/optimizer/{explore,compress}.rs`.

## Verification

`npx playwright test tests/auto-termination.spec.ts` passed in Chromium, Firefox and WebKit against the production build. The regression fixture is a single fixed-orientation rectangle using Automatic with no time cap. The test requires completion within 45 seconds, verifies the independent geometry check and normal `Complete` stop reason, and downloads the retained one-part SVG. The native Cargo test also passed.
