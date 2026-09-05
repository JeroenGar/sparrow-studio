# Backlog

## Exact material fit can panic in the native solver

A 100 × 60 mm rectangular SVG with a 20 × 20 mm hole triggers `RuntimeError: unreachable` when material width is exactly 60 mm, with zero clearance and a 10-second run. Reproduced in Chromium and Firefox during SVG export QC. Investigate the native placement/initialization boundary; preserve requested material dimensions and avoid silently padding the geometry.

## Preparation copies and keyboard shortcuts — in progress

- Show every demanded copy as its own movable entity, initially offset visibly toward the bottom-left near its parent (like PowerPoint duplication). Preserve copy identity, selection, shared shape-type geometry and responsive panning/zooming. Remove ×quantity canvas labels once copies are individual; keep quantities in the parts pane.
- Add discoverable preparation shortcuts for 90° rotation and increasing/decreasing quantity. Respect text-field focus, undo/redo, selection and geometry limits.

## Sample projects and shape library — implemented

- Clearly distinguish complete sample projects from reusable shapes.
- Browse all bundled shapes with consistent dimensions, grouped by source file; shape selector on the left and source categories on the right. Preserve multi-selection and local saved shapes.
- Normalize bundled library shapes with one uniform factor per source instance so the median shape-type area (outer minus holes) is 100 mm². Preserve relative sizes, proportions and original sample-project dimensions.

## Loading examples and library shapes — implemented

- Trace network requests and parsing/preparation costs; explain whether files are fetched from GitHub again.
- Compare existing caching, lazy loading, background preloading and a zipped bundle. Implement the simplest measured improvement without delaying startup or adding needless dependencies.

## Unified canvas and free manual placement — in progress

- Replace disconnected Prepare/Result views with one canvas: nesting repositions the existing shape copies on that plane.
- Allow manually dragged shapes to overlap without automatic displacement or repacking. Automatically arrange shapes only when importing or initially adding them.
- Preserve camera continuity, individually draggable copy identity, selection and correct checked-result/export ownership across solving and manual edits; review the interaction model before making a cosmetic tab-only change.

## Contact label — implemented

- Label the LinkedIn profile `in/jeroengardeyn/`, retaining its icon and destination.

## CLI-ready downloads

- Bundle a sparrow CLI-compatible instance JSON with downloaded projects/results, ideally in the requested ZIP package.
- Current project downloads are Studio-schema JSON and results are standalone SVG/DXF; neither includes a CLI-ready instance. Reuse the existing solver-input conversion where appropriate, preserving dimensions, demand and rotations and handling holes explicitly.

## Favicon

- Use 🪺 as the app favicon.

## Loading findings

The 34 static dataset files total 4,816,368 raw bytes (about 488 KB gzip versus 529 KB ZIP). GitHub Pages already serves gzip with a 600-second HTTP cache. Shared per-session fetch and parse caches now avoid duplicate work; failed requests can retry. Only the small catalog is warmed after startup; full datasets remain lazy.

## Completed

- Preparation shortcuts: R rotates 90°, +/− adjusts quantity; undo and editable-field focus are respected.
- Manual position, rotation and resizing no longer automatically displace neighbouring parts.
- LinkedIn contact label is `in/jeroengardeyn/`.

- Compact rotation-freedom labels below dimensions in the parts list.
- Compact Safari dialogs: content-sized flex layout avoids stretched grid tracks and controls.
- Load `swim.json` on startup without automatically solving; New project still starts empty.
- Automatic solver termination by default, with optional time caps and manual Stop.
- Restore the original small circular spinner alongside the run button.
