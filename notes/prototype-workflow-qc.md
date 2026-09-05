# Project workflow and canvas QC — 2026-09-05

Implemented the project lifecycle follow-up in project-workflow-review.md, library multi-selection, footer status placement and dot-matrix animation, two-decimal millimetre display, canvas navigation caching, and material-width focus band. Rotation summaries remain in backlog.md. No deployment was performed.

Validation:

- Production build and TypeScript checks passed.
- 88 unit tests passed, including empty-project round trips and invalid empty layouts.
- Full Playwright run: 130 passed, 2 intentionally skipped. Chromium, Firefox and WebKit exercised imports, project replacement and cancellation, downloads, empty projects, exact stored geometry, selection/resize/rotation, grid alignment, wheel bursts, material-width focus, library multi-selection, live/checked results, worker lifecycle, and privacy checks. Touch-drag simulation is Chromium-only.
- Visually inspected desktop and mobile project layouts and the focused material-width band. The band follows the actual material width on the y axis, keeps parts visible, dims outside the band and disappears on blur without moving the camera.
- Navigation profiling and its limitations are recorded in navigation-performance.md.

TypeScript emission is disabled in tsconfig.json so direct compiler invocations cannot leave JavaScript siblings that shadow the source files in Vite. Generated siblings from a tooling invocation were removed before the final build and full test run.
