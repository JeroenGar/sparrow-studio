# Backlog

## Exact material fit can panic in the native solver

A 100 × 60 mm rectangular SVG with a 20 × 20 mm hole triggers `RuntimeError: unreachable` when material width is exactly 60 mm, with zero clearance and a 10-second run. Reproduced in Chromium and Firefox during SVG export QC. Investigate the native placement/initialization boundary; preserve requested material dimensions and avoid silently padding the geometry.

## Preparation copies and keyboard shortcuts — in progress

- Show every demanded copy as a stacked silhouette behind its shape in Prepare, with successive copies offset toward the bottom-left. Preserve selection, editing, quantity labels and responsive panning/zooming.
- Add discoverable preparation shortcuts for 90° rotation and increasing/decreasing quantity. Respect text-field focus, undo/redo, selection and geometry limits.

## Sample projects and shape library — in progress

- Clearly distinguish complete sample projects from reusable shapes.
- Browse all bundled shapes with consistent dimensions, grouped by source file; shape selector on the left and source categories on the right. Preserve multi-selection and local saved shapes.
- Normalize bundled library shapes with one uniform factor per source instance so the median shape-type area (outer minus holes) is 100 mm². Preserve relative sizes, proportions and original sample-project dimensions.

## Loading examples and library shapes — investigation and implementation in progress

- Trace network requests and parsing/preparation costs; explain whether files are fetched from GitHub again.
- Compare existing caching, lazy loading, background preloading and a zipped bundle. Implement the simplest measured improvement without delaying startup or adding needless dependencies.

## Favicon

- Use 🪺 as the app favicon.

## Completed

- Compact rotation-freedom labels below dimensions in the parts list.
- Compact Safari dialogs: content-sized flex layout avoids stretched grid tracks and controls.
- Load `swim.json` on startup without automatically solving; New project still starts empty.
- Automatic solver termination by default, with optional time caps and manual Stop.
- Restore the original small circular spinner alongside the run button.
