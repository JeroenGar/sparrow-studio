# sparrow-studio

An interactive browser demo of [sparrow](https://github.com/JeroenGar/sparrow), the irregular nesting algorithm. Files and nesting calculations stay on your device.

## Architecture

sparrow-studio is a browser-only frontend for [sparrow](https://github.com/JeroenGar/sparrow). The Rust nesting solver is compiled to WebAssembly and runs locally in Web Workers, keeping the interface responsive during searches.

The TypeScript application manages the editable canvas, project state, imports and exports, while worker-based geometry processing handles preparation, live previews and independent validation. Browsers with cross-origin isolation use threaded WebAssembly through Rayon; others fall back to the serial build. No server-side solver or geometry service is required.

The application lives in `web/`. See [build, development and testing instructions](web/README.md). Design notes and prior acceptance records live in `notes/`.

This prototype was developed separately from the original sparroWASM wrapper. GitHub Pages builds and tests the app before publishing each push to `main`. The repository retains its MPL-2.0 license and bundled third-party notices.
