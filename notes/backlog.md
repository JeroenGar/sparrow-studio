# Backlog

## Ghost mode during live optimization

- Default to ghost mode while showing Live optimization so collisions are easier to see.
- Treat this as a temporary view override: restore the previous ghost/normal preference when leaving Live, switching to Checked, or stopping/completing the solve. Do not overwrite the saved display preference.

## Exact material fit in the native solver — implemented

Fixed zero-range sampling and rectangular material-boundary contact in the vendored native dependencies, without padding the requested dimensions. Quadtree traversal also handles edges collinear with a node bisector. Native checks cover exact fits, out-of-bounds rejection and item collisions; the SVG browser workflow nests a 100 × 60 mm holed part in exactly 60 mm material.

## Preparation copies and keyboard shortcuts — implemented

- Show every demanded copy as its own movable entity, initially offset visibly toward the bottom-left near its parent (like PowerPoint duplication). Preserve copy identity, selection, shared shape-type geometry and responsive panning/zooming. Remove ×quantity canvas labels once copies are individual; keep quantities in the parts pane.
- R advances to the next permitted orientation (90° for continuous rotation). +/− adjusts copies; ⌘/Ctrl+D clones selected copies, and Backspace/Delete removes them, retaining zero-quantity shape types. Respect text-field focus, undo/redo, selection and geometry limits.

## Sample projects and shape library — implemented

- Clearly distinguish complete sample projects from reusable shapes.
- Browse all bundled shapes with consistent dimensions, grouped by source file; source categories on the left and shape selector on the right. Preserve multi-selection and local saved shapes.
- Normalize bundled library shapes with one uniform factor per source instance so the median shape-type area (outer minus holes) is 10,000 mm² (100 × 100 mm equivalent). Apply the same scale to sample projects, including material dimensions and clearance. Preserve relative sizes, proportions, demand and rotations; do not rescale saved user projects or imported drawings.

## Loading examples and library shapes — implemented

- Trace network requests and parsing/preparation costs; explain whether files are fetched from GitHub again.
- Compare existing caching, lazy loading, background preloading and a zipped bundle. Implement the simplest measured improvement without delaying startup or adding needless dependencies.

## Unified canvas and free manual placement — implemented

- Replace disconnected Prepare/Result views with one canvas: nesting repositions the existing shape copies on that plane.
- Allow manually dragged shapes to overlap without automatic displacement or repacking. Automatically arrange shapes only when importing or initially adding them.
- Preserve camera continuity, individually draggable copy identity, selection and correct checked-result/export ownership across solving and manual edits; review the interaction model before making a cosmetic tab-only change.

## Contact label — implemented

- Label the LinkedIn profile `in/jeroengardeyn/`, retaining its icon and destination.

## CLI-ready downloads — implemented

- Bundle a sparrow CLI-compatible instance JSON with downloaded projects/results, ideally in the requested ZIP package.
- Project menu offers a ZIP download; checked-result export includes a ZIP option. Archives contain the editable project, CLI input, README, and checked SVG/DXF when available. CLI footprints use outer contours, matching the browser solver; the README explains that holes remain in the project and drawing exports.

## Favicon — implemented

- Use 🪺 as the app favicon.

## Loading findings

The 34 static dataset files total 4,816,368 raw bytes (about 488 KB gzip versus 529 KB ZIP). GitHub Pages already serves gzip with a 600-second HTTP cache. Shared per-session fetch and parse caches now avoid duplicate work; failed requests can retry. Only the small catalog is warmed after startup; full datasets remain lazy.

## Completed

- Evenly spaced copy stacks, softer light-mode borders, theme-aware ghost fills, 12 shape colors, and lower canvas hints.

- Preparation shortcuts follow permitted rotations and support copying/deletion down to zero; undo and editable-field focus are respected.
- Manual position, rotation and resizing no longer automatically displace neighbouring parts.
- LinkedIn contact label is `in/jeroengardeyn/`.

- Compact rotation-freedom labels below dimensions in the parts list.
- Compact Safari dialogs: content-sized flex layout avoids stretched grid tracks and controls.
- Load `gardeyn2.json` on startup without automatically solving; New project still starts empty.
- Automatic solver termination by default, with optional time caps and manual Stop.
- Restore the original small circular spinner alongside the run button.

## Drag selection and group editing — implemented

- Shift-drag a selection rectangle around multiple individual copies; plain background drag continues to pan.
- Delete, clone or move selected copies together; preserve their relative positions when moving or cloning.
- Integrate with the new per-copy placement model, shape-type quantities, selection state, undo/redo and checked-result invalidation.

## Header and display polish — implemented

- Default to gardeyn2; use “sparrow/studio” in visible app branding.
- Dedicated example-project and light/dark buttons, matching project/save button heights.
- Transparent, larger nest favicon; quiet canvas pointer focus; larger spinner beside both status lines.
