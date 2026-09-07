# Backlog

## Optimize loading times — implemented

- Measure cold and repeat startup, including example download, geometry preparation, and time until the interface is usable.
- Render the interface before the default example finishes downloading and preparing. Show its loading state and preserve any project the user opens or creates while it loads.
- Keep the initial download small and reuse existing caching. Verify slow-network and failed-example startup as well as ordinary loading.
- The editor now mounts before example download and preparation; user-created, opened, or edited projects take precedence over late responses. In a local Chromium check with a two-second example-download delay, editor availability improved from 2,328 ms to 65 ms. See [measurements and validation](startup-loading.md).

## Search and sharing metadata — implemented, publication and indexing pending

- Target discovery for "2D nesting" and "open-source 2D nesting". Add the production canonical URL, Open Graph and social-card metadata, and a sitemap. Verify indexing and rendered content through Google Search Console when account access is available.
- Reuse the Studio screenshot embedded in the upstream sparrow README: https://github.com/user-attachments/assets/4d84bb67-ff98-4310-82de-5350baa02427. Prepare a locally hosted sharing image from it and verify preview cropping and legibility.
- Add a direct live-demo link to the Studio README using "Try 2D nesting with sparrow in your browser" and use that wording in the upstream README's existing prominent demo callout. Keep its screenshot and placement.
- Add a small "About 2D nesting" expandable section inside the About dialog, collapsed by default, with useful explanatory content present in the initial HTML and accessible to visitors. Explain browser-based nesting, intended uses, supported inputs, and local processing. Keep the canvas prominent; do not add text hidden solely for search engines.
- Metadata changes should not alter the workspace layout. Personal LinkedIn posting is not part of this work.
- Implemented canonical and social tags, a locally hosted README screenshot, robots.txt, sitemap, and the native HTML disclosure covering textiles, wood, metal, printing, signage, packaging, foam, rubber, leather, composites, and research. Both local README callouts are updated. See [validation and remaining publication steps](search-discovery.md).

## Subtle contact invitation — implemented

- Keep "Say hello" visible from startup and retain the existing contact dialog and LinkedIn destination.
- Give the button one small wave after the first successful download of a checked nested result in a session. Respect reduced-motion preferences and do not open the dialog automatically.
- Keep the existing GitHub star link. Use search, GitHub, documentation, and organic sharing to attract visitors; LinkedIn is a contact destination, with no personal posting requirement.
- The hand uses a 1.4-second CSS wrist rotation after the first checked SVG, DXF, ZIP, or project download per editor session. Unchecked project downloads and diagnostics do not trigger it. No timers or new dependencies. Type checking and the frontend build passed; 24 browser checks passed across Chromium, Firefox, and WebKit, covering export paths, no repeat animation, reduced motion, keyboard contact access, and responsive layout.

## Show mixed rotation settings for multi-selection — implemented

- Show "Mixed" when selected parts have different permitted rotations, instead of displaying only the first part's setting.
- Apply a rotation rule to all selected parts only when the user explicitly chooses one.
- Compare the actual angle sets after normalizing full turns, duplicates, and ordering. Cancelling custom-angle entry preserves "Mixed"; Undo restores each part's original rule. Type checking and the frontend build passed, plus nine browser checks across Chromium, Firefox, and WebKit.

## Name exports after the project — implemented

- Use the existing project-name sanitization for SVG, DXF, and ZIP downloads, replacing generic layout and project filenames.
- SVG, DXF, ZIP, and saved project files now share the existing sanitized project name. Updated the contact invitation to "I’d like to hear how you’re using sparrow and what you’d like to do with it next." Type checking and frontend build passed. Filename, contact, and ZIP checks passed across Chromium, Firefox, and WebKit; the keyboard test now waits for an enabled checked-result button and passed in all three browsers on rerun.

## Remove vendoring through graceful initialization errors — implemented with temporary PR pin

- Implemented the [plan](../2026-09-07-remove-vendoring-plan.md) with sparrow [PR #159](https://github.com/JeroenGar/sparrow/pull/159), temporarily pinned to `bd8fdb7560243a49d54c573a59b0146a86d72662`. Replace this pin with a merged upstream revision when available.
- Removed both vendored libraries and the jagua-rs patch. jagua-rs now resolves to unmodified crates.io 0.8.1. Updated lockfile, solver revision, documentation and generated license notices.
- Construction errors reach the existing Studio error state before `finished` is sent. Exact boundary contact is rejected; users can edit material settings and start a fresh solve.
- Native checks, 111 frontend tests, both WASM builds, and serial/threaded SVG failure-to-edit-to-export checks in Chromium, Firefox and WebKit passed. Chromium pool restart and startup fallback checks passed. No separate jagua-rs quadtree failure appeared in these checks.
- This supersedes the vendored approach recorded under "Exact material fit in the native solver" below.

## Refine SVG and DXF import

- SVG and DXF import are not yet properly supported in practice. Review the current import flow and identify where real files fail, lose geometry, or produce confusing results.
- Collect representative SVG and DXF files, reproduce the problems, and define the supported behavior before implementing targeted fixes.
- Preserve geometry, dimensions, units, and holes within the supported scope. Explain unsupported content and partial imports clearly before changing the project.
- Add regression coverage for the identified failures and verify the complete import-to-edit-to-solve workflow.

## Ghost mode during live optimization — implemented

- Default to ghost mode while showing Live optimization so collisions are easier to see.
- Treat this as a temporary view override: restore the previous ghost/normal preference when leaving Live, switching to Checked, or stopping/completing the solve. Do not overwrite the saved display preference.

## Exact material fit in the native solver — superseded by upstream migration

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

## Nesting viewport — implemented

- Put the origin 10% from the left at solve start and after viewport resizing, preserving zoom and vertical positioning. Subsequent candidates and manual panning do not recenter it.

## Group field edits into one Undo step — low priority

- Commit part-name and other applicable field edits on blur or Enter, following the existing position/size controls, rather than consuming history per keystroke.
- Verify that one Undo restores the previous field value and earlier geometry edits remain available. Keep this behind the other refinements.
