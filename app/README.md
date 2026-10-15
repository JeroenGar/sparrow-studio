# sparrow studio (new app)

The new sparrow studio: six tabs that each pair a list with a canvas, several projects in browser storage, and local solving with the open-source sparrow algorithm through WebAssembly. Features marked _sparrow pro_ are planned and shown disabled. The current app in `web/` stays as it is until this one launches.

## Running it locally

The solver's WebAssembly builds are shared with `web/`; `web/README.md` lists the Rust toolchains they need. Then:

```bash
cd app
npm install
npm run wasm:build
npm run dev
```

The dev server sends the cross-origin isolation headers, so the solver can use up to 3 threads.

## Checks

```bash
npm run typecheck
npm test
npm run format:check
npm run build
```

GitHub Actions runs the same checks on every pull request.

`src/engine` keeps the compact style of the code it came from; the rest is formatted with Prettier (`npm run format`).

## Layout

- `src/engine`: solver workers, geometry checks, import and export.
- `src/project`: the project format, the browser project store, preferences and examples.
- `src/ui`: the shell, the six views, dialogs and shared components.
