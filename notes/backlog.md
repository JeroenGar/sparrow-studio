# Backlog

## Exact material fit can panic in the native solver

A 100 × 60 mm rectangular SVG with a 20 × 20 mm hole triggers `RuntimeError: unreachable` when material width is exactly 60 mm, with zero clearance and a 10-second run. Reproduced in Chromium and Firefox during SVG export QC. Investigate the native placement/initialization boundary; preserve requested material dimensions and avoid silently padding the geometry.

## Completed

- Compact rotation-freedom labels below dimensions in the parts list.
- Compact Safari dialogs: content-sized flex layout avoids stretched grid tracks and controls.
- Load `swim.json` on startup without automatically solving; New project still starts empty.
- Automatic solver termination by default, with optional time caps and manual Stop.
- Restore the original small circular spinner alongside the run button.
