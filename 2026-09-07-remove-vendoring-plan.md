# Remove vendoring through graceful initialization errors

Implemented on 2026-09-07 using temporary sparrow PR #159 pin `bd8fdb7560243a49d54c573a59b0146a86d72662` and unmodified registry jagua-rs 0.8.1. Both vendor directories are removed. Native, frontend, serial/threaded WASM builds, and browser failure/recovery checks passed. Replace the PR pin with a merged upstream revision when available. The original investigation and plan follow.

Plan based on local source inspection on 2026-09-07. No implementation changes or reproductions have been run. The linked GitHub discussion was not independently checked; this plan relies on the checked-out code.

## Verified starting point

- Studio is clean on `main`, with origin `JeroenGar/sparrow-studio`. `web/wasm/Cargo.toml` uses vendored sparrow and patches jagua-rs 0.8.1 to its vendor directory.
- `/Users/jeroengardeyn/Documents/personal/sparrow` is on `release/v0.2.0` at `0c5229db8bc29026ac75b8e84f3c290720a7fd2a`, with origin `JeroenGar/sparrow`. It has an unrelated modification to Cargo's logging features and untracked files. Preserve these. Compared with Studio's recorded sparrow base, `120cf937de5e74c292406bc9947276c9dd49217f`, the committed difference is README-only.
- `/Users/jeroengardeyn/Documents/personal/jagua-rs` is on `jg-issue-86-assertion-hardening` at `350aa772da68b17f680b69bbba050f3d1f3951ce`. It has untracked investigation files. Use the registry dependency for this migration, not that investigation branch.
- Sparrow's `LBFBuilder::place_item` retries recursively, grows the variable strip dimension by 1.2, and panics when `strip_width_is_in_check` fails. That predicate limits the dimension to less than twice the sum of item diameters, weighted by demand.
- `optimize` returns `SPSolution` directly. No dedicated error type was found in sparrow's source. CLI and TUI already use `anyhow` at their outer boundaries.
- Construction runs before phase timeouts are installed. Studio's automatic mode deliberately ignores phase timeouts. A timeout alone cannot guarantee construction termination across current callers.
- Studio already catches WASM errors, disposes runtime and pool workers, and routes errors into `useSolver`'s terminal state. Start by reusing this path.

Sparrow calls the growing dimension `strip_width`; Studio presents the fixed dimension as material width. Keep that distinction out of user-facing diagnostics.

## Implementation order

### 1. Establish an unmodified dependency baseline

Create an isolated sparrow worktree on a `jg-` branch from the verified commit. Do not stash, reset, or incorporate the sibling checkout's unrelated edits. Recheck applicable instructions and status before implementation.

Add a small fixed-seed reproduction using a fixed-rotation 100 by 60 rectangle, material width 60, and zero clearance. Include demand one and the existing Studio demand-two fixture. Resolve jagua-rs 0.8.1 from the registry and verify with Cargo metadata that no local patch is active. Run the failing baseline under an external process deadline so an unexpected hang cannot stall the investigation.

Record the actual failure before changing code. If unmodified jagua-rs hits the separate quadtree problem, retain a minimal reproduction and treat it as a migration blocker. Do not import either jagua-rs vendor patch automatically.

### 2. Make sparrow construction fallible

Primary files: `src/sample/uniform_sampler.rs`, `src/optimizer/lbf.rs`, and `src/optimizer/mod.rs` in sparrow.

- Port only the equal-coordinate sampler behavior. Accept equal finite endpoints and return that coordinate without calling `random_range`; reject reversed or invalid intervals. Preserve the existing half-open sampling distribution for ordinary ranges. Exercise the public sampler API, including the shared path used by focused and container sampling.
- Add a small public `ConstructionError` beside `LBFBuilder`, implementing `Display` and `std::error::Error`. Carry the affected item ID and a construction-failure reason. Do not add an error dependency or a general optimizer error framework.
- Change `construct` to return `Result<Self, ConstructionError>` and `place_item` to return `Result<(), ConstructionError>`.
- Replace recursive retry with a loop. Keep the existing 1.2 expansion factor and existing geometry-based growth ceiling as the initial policy. Turn exhaustion into `Err`, checking before applying an excessive next expansion. Handle a non-finite or non-increasing next dimension so iteration always makes progress or terminates.
- Change `optimize` to return `Result<SPSolution, ConstructionError>` and propagate construction failure with `?`. Preserve the supplied-initial-solution path.

This ceiling already ends the current search by panic. Reusing it avoids inventing a new retry count or changing successful placement search unnecessarily. It is a heuristic budget, not an infeasibility proof. Validate it against successful instances and a fixture requiring real expansion before accepting it. Keep sampling and growth settings unchanged unless those checks demonstrate a specific problem.

Do not require threading a `Terminator` through construction for this first patch. The existing timeout behavior cannot provide the required bound; cancellation during construction can be considered separately if needed.

### 3. Propagate failure through every caller

| Caller | Concrete change |
| --- | --- |
| Sparrow `src/cli.rs` | Use `?`; report a normal command error and do not export a final solution on failure. |
| Sparrow `src/tui/runtime.rs` | Return a result from the optimizer thread; propagate both join failure and construction failure through the existing terminal-restoration path. |
| Sparrow `src/bench.rs` | Store each parallel run's result and propagate a failed construction after joining the scoped workers, before aggregating or exporting that run. Do not unwrap it or silently omit it. |
| Sparrow `tests/tests.rs` | Explicitly unwrap expected successes and assert the typed error for the new failure fixture. |
| Studio `web/wasm/src/lib.rs` | Map construction failure to `JsValue` and return before sending `finished`. |
| Studio `web/wasm/src/tests.rs` | Update result handling and replace the exact-fit success expectation. |

Suggested Studio message: "No valid initial placement could be constructed for item {id} with the current geometry and material settings. Review the part size, allowed rotations, material width, and clearance."

Reuse `solver-runtime.worker.ts` → `solver.worker.ts` → `useSolver.ts`. Modify these only if recovery tests expose missing cleanup or state transitions. A construction failure after WASM readiness must not trigger the thread-startup serial fallback.

### 4. Publish sparrow, then remove Studio vendoring

Deliver the sparrow change first as a focused commit and upstream PR. Studio's final dependency must reference a remotely fetchable immutable Git revision, or a release containing it. Local overrides are acceptable only for temporary integration checks and must not enter the final manifest or lockfile.

Once the revision is available:

1. Replace Studio's sparrow path dependency with the pinned upstream revision. Keep ordinary compatible registry jagua-rs, initially 0.8.1, and remove `[patch.crates-io]`.
2. Regenerate `web/wasm/Cargo.lock`. Inspect Cargo metadata/tree for one compatible jagua-rs dependency and no vendor or sibling paths.
3. Remove both `web/wasm/vendor` libraries and their patch documents.
4. Update `SOLVER_REVISION` in `web/src/model.ts` and the dependency explanation in `web/README.md`.
5. Remove vendor-source handling and stale vendor prose from `web/scripts/generate-notices.py`; regenerate `web/public/THIRD_PARTY_NOTICES.txt` with upstream source references and required license text.
6. Preserve the original dataset provenance in `web/public/examples/NOTICE.txt` and `catalog.json` unless the datasets themselves change. Their recorded revision is not automatically the new solver revision.

If the upstream revision cannot be published or fetched, report the remaining publication dependency. Do not mark the Studio migration complete with a local path.

## Acceptance checks

Use the existing Rust, Vitest, and Playwright infrastructure. Add focused regression cases, not another test framework.

| Behavior | Required evidence |
| --- | --- |
| Sampler | Equal x, equal y, both equal, reversed intervals, invalid numeric ranges, ordinary range bounds and fixed-seed behavior. |
| Failed construction | Exact-fit fixtures return the typed item-specific error under a process deadline in debug and release. No panic, stack overflow, or excessive growth. |
| Successful construction | Ordinary fixture, existing upstream instance tests, and a fixture that requires expansion still succeed with conservative collision checks. |
| Collision policy | Exact boundary contact and out-of-bounds queries are rejected by both binary and collection queries. Retain separate interior-clear and item-overlap checks so exterior collision does not mask an item-collision regression. |
| Native callers | CLI exits with an explanatory error; TUI restores the terminal; benchmark failure is reported rather than panicking or contaminating results. |
| Studio recovery | One browser flow fails exact-fit construction, shows the explanation, re-enables editing and Run, then solves successfully after the user changes the material setting. Test serial and actual threaded execution, and verify pool cleanup. |
| Dependency removal | Both WASM release builds succeed with `--locked`; notices regenerate; Cargo metadata contains no vendored libraries or unpublished paths. |

Commands to run during implementation, with exact outputs recorded then:

- In the isolated sparrow worktree: `rtk cargo test --locked`, `rtk cargo test --locked --release`, and `rtk cargo test --locked --features tui`. Add focused CLI, TUI, and benchmark reproduction commands using the checked-in fixture.
- From `/private/tmp`, following Studio's existing isolation from ancestor Cargo configuration: `rtk cargo +stable test --locked --manifest-path /Users/jeroengardeyn/Documents/personal/sparrow-studio/web/wasm/Cargo.toml`.
- From Studio's `web` directory: `rtk npm test`, `rtk npm run build`, and `rtk python3 scripts/generate-notices.py`. The build script already builds serial stable WASM and threaded WASM with `nightly-2026-08-30`.
- After building: `rtk npx playwright test tests/initialization-error.spec.ts tests/threads.spec.ts tests/bridge.spec.ts`. Add the failure/recovery case in `initialization-error.spec.ts`, reusing the existing project helpers and thread-test setup.

Record baseline failures separately from regressions. No tests have been run for this planning pass.

## Deliverables and remaining uncertainty

Produce two reviewable changes: the upstream sampler/construction/caller patch, followed by the Studio dependency/test/notice migration. The upstream API change must be called out because direct Rust callers now receive `Result`.

The remaining technical question is whether unmodified jagua-rs supports the full regression set without exposing the separate quadtree issue. The plan does not assume that away. No geometry padding, dimension rewriting, boundary exemption, or collision-engine redesign belongs in this migration.
