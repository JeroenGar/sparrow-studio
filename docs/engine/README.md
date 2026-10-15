# Solver bridge notes

Notes on the WebAssembly solver bridge in `web/wasm`, which both apps use. The measurements are dated and describe the machine and revisions they were taken on.

- [Default auto-termination](auto-termination.md): how a run without a time limit ends.
- [Native versus WebAssembly baseline](wasm-baseline.md): solver speed in the browser compared with the native build.
- [WebAssembly logging filter](wasm-logging.md): whether solver logging slows the search.
- [Dependency notices](notices-audit.md): how the third-party notices are generated and checked.
