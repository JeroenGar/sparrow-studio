# sparrow-studio UI and repository separation — 2026-09-05

The app is now independently buildable under `web/` in the private `JeroenGar/sparrow-studio` repository. The original wrapper was not committed to or archived. The local development preview uses this checkout on port 4174. No website deployment or domain configuration was performed.

Implemented adaptive linear coordinate rulers and a 1/2/5 grid, floating canvas tools and selection inspector, selection clearing, 50% opacity for unselected shapes, a bottom-left orange nesting action, consistent header links, email/LinkedIn contact links and sparrow-studio naming.

Validation:

- Clean `npm ci` and full serial/threaded WASM production build from the separate checkout passed.
- All 87 unit checks passed; source archive deterministic bytes and manifest hashes passed.
- The full browser suite passed 108 checks, skipped two Chromium-specific touch cases, and exposed one WebKit drag-coordinate failure caused by the inspector resizing the canvas. Making the inspector float fixed that cause.
- The subsequent 30 focused browser checks passed across Chromium, Firefox and WebKit, covering grid/ruler alignment, background selection clearing and panning, resize/rotation handles, compact preparation and drag displacement/undo, keyboard solve/export, unit conversion and the new UI. The background-click test was updated to target exposed canvas instead of the new floating inspector.
- Desktop, tablet and 390px mobile screenshots were visually inspected. No horizontal page overflow was found. A final spacing check keeps the inspector below the floating toolbar.

Historical wider solver/export/performance coverage and its limits remain recorded in web-app-acceptance-audit.md and preparation-performance.md. This batch did not repeat physical Safari or independent GEOS export audits; no physical mobile-device check or public-host check was performed.
