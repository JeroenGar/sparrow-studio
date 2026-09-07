# Web dependency notices

Verified on 2026-09-05 against the current `web/package-lock.json` and `web/wasm/Cargo.lock`, including the `threads` feature.

## Artifacts

- `web/public/THIRD_PARTY_NOTICES.txt` contains 12 production npm packages, 111 resolved Rust packages, and 81 distinct full license texts. Texts are indexed by package and deduplicated by SHA-256, preserving original copyright and attribution text.
- `web/public/RUST-LIBRARY-stable.html` and `web/public/RUST-LIBRARY-nightly-2026-08-30.html` reproduce the installed toolchains' standard-library notices byte for byte. The main notice records their hashes and compiler commits. These cover stable 1.97.0 and nightly 1.100.0 from 2026-08-30 respectively.
- `web/scripts/license-sources/` stores the missing upstream license files with their exact URLs and hashes. The Rust package VCS metadata provides their revision pins. This makes regeneration independent of GitHub availability.
- Dataset attribution remains in `web/public/examples/NOTICE.txt`.

The Rust inventory deliberately includes a superset, including build and procedural macro dependencies. It does not claim that every entry contributes bytes to every Wasm output. Development npm tools are excluded. Rust standard-library dependencies are covered separately by the toolchain notices. The three public notice files total 2,157,557 bytes; they are static documentation, not initial application imports.

## Regeneration and verification

After installing the locked npm dependencies and the build's Rust toolchains:

```sh
python3 web/scripts/generate-notices.py
python3 web/scripts/generate-notices.py --check
```

The generator runs locked Cargo metadata in a temporary directory with inherited Rust flags cleared, so it does not pick up the original wrapper's ancestor Cargo configuration. It checks installed npm versions against the lockfile, requires license text for every inventoried package, and verifies the pinned fallback license hashes. `--check` fails if any generated public file differs from the installed dependency/toolchain evidence. It performs no network requests or builds.

Both commands passed. An independent extraction check recomputed all 81 embedded text hashes and matched every index reference. Regeneration was byte-for-byte stable. No manifests, locks, application components, or build scripts were changed for this audit. Vite copies `public/` into builds; the next application build still needs to verify these files are present in `dist/` and reachable through the app's notices link.

## Exact upstream gaps and source availability

The published crate archives for `defmt-parser`, `geo`, `rstar`, and `jagua-rs` omit their workspace license files. Their complete texts were retrieved from the exact commits recorded in each archive's `.cargo_vcs_info.json`, not from a moving default branch. `splaytree` includes the full MIT text in its distributed README, which the generator extracts directly.

`wasm_sync` 0.1.2 declares `MIT OR Apache-2.0` in Cargo metadata but has no license file in its archive or its recorded upstream commit `cc027b3b27c2e24e3cd5c7a6cc63306eff724af5`. Its entry discloses this and includes the canonical Apache-2.0 text from apache.org. No package-specific copyright statement was invented. This is an upstream packaging gap, not evidence of a different license.

The pinned solver `sparrow` has a full MIT LICENSE even though its Cargo license field is absent. `jagua-rs` is MPL-2.0. The original `sparroWASM` wrapper's MPL license is a separate artifact and was not substituted for the solver's license.

Both the exact jagua-rs source tree and the published 0.8.1 crate download returned HTTP 200 during this audit. Their links and the full MPL text are included in the public notice. The public sparrow-studio repository exposes the corresponding application source and modified MPL-covered files; the deployed About link points to that repository.

## Interior label dependency

The preparation label worker adds exact `polylabel` 2.1.0 and locked `tinyqueue` 3.0.0, both ISC. The upstream API and installed source were inspected before use. This provides the requested pole-of-inaccessibility labels without maintaining a second polygon search implementation. Both full license texts are included in the regenerated notices. `npm install` reported no known vulnerabilities.

## Public source availability

As of 2026-09-07, the public sparrow-studio repository contains the application and WASM bridge. The solver is temporarily pinned to commit `bd8fdb7560243a49d54c573a59b0146a86d72662` from sparrow PR #159, and jagua-rs uses the unmodified crates.io 0.8.1 release. Both vendor directories have been removed. Generated notices identify the exact Git revision and crate download, and retain the full license texts. The About panel links to the application repository; third-party license notices remain published with the site.


## DXF library migration

The browser now uses `dxf` 5.3.1 for import parsing, spline evaluation, and export verification. Direct module imports avoid pulling the package's unused rendering helpers into the geometry worker. `dxf-parser` and its `loglevel` dependency were removed. Notices inventory all locked production npm packages, including `dxf`'s transitive dependencies.

`vecks` 3.9.2 declares MIT but ships no license file; upstream tag `3.9.2` also contains none. Its npm `gitHead` does not resolve through the upstream GitHub API. The notice records this packaging gap and includes the canonical SPDX MIT template without inventing copyright attribution. The bundled `dxf` spline evaluator's original copyright statement is retained in its notice entry.

SVG importer migration: replaced npm svgpath with usvg 0.48.1 (default features disabled: no font loading, text conversion or SVGZ). Regenerated notices for the locked Rust dependency graph. Image resolvers are disabled; imported resources remain local.
