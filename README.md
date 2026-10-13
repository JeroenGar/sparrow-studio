# sparrow studio

**Free, open-source nesting software that runs in your browser.**

Arrange parts to use less material when laser cutting, CNC routing, or cutting fabric. sparrow studio runs the open-source [sparrow nesting algorithm](https://github.com/JeroenGar/sparrow) in your browser through WebAssembly: import your parts, set up the job, and get a checked layout back, with no installation or account.

**[Open sparrow studio →](https://sparrowstudio.app/)**

[![sparrow studio showing the parts list, the canvas and the nesting controls](https://github.com/user-attachments/assets/4d84bb67-ff98-4310-82de-5350baa02427)](https://sparrowstudio.app/)

## Two apps in one repository

- **`web/`** is the app published at [sparrowstudio.app](https://sparrowstudio.app/). It stays online as it is until the new app launches. See [its README](web/README.md).
- **`app/`** is the new sparrow studio, in development and not published yet. Each tab pairs a list with a canvas: Parts, Sheets, Machine, Settings, Live and Solution. Projects are kept in browser storage, and solving runs locally. Features marked _sparrow cloud_ are planned and not available yet. See [its README](app/README.md).

Both apps share the solver bridge in `web/wasm`, the bundled examples and the third-party notices in `web/public`.

## Your files stay on your device

Import, editing, geometry checks and nesting all run locally. No drawings are uploaded. The public site uses Cloudflare Web Analytics for traffic and performance, without sending project names, geometry or file contents.

## Development

The solver is Rust compiled to WebAssembly and runs in Web Workers, with SIMD and threaded builds when the browser supports them. Building it needs stable Rust, nightly Rust 2026-08-30 with rust-src, wasm-pack and Node.js; [web/README.md](web/README.md) lists the exact steps. Then, for the new app:

```sh
cd app
npm install
npm run wasm:build
npm run dev
```

Measurements and notes on the shared solver bridge are in [docs/engine](docs/engine). GitHub Actions checks `app/` on every pull request, and publishes `web/` to GitHub Pages on every push to `main`.

For the algorithm and native command-line solver, visit [sparrow](https://github.com/JeroenGar/sparrow) and read [An open-source heuristic to reboot 2D nesting research](https://doi.org/10.48550/arXiv.2509.13329).

## License

sparrow studio is licensed under the [MIT License](LICENSE). Dependencies retain their own licenses, including MPL-2.0 for jagua-rs; see the bundled [third-party notices](web/public/THIRD_PARTY_NOTICES.txt).
