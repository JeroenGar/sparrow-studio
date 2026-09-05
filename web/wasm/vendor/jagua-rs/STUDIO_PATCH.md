Vendored from jagua-rs 0.8.1. Studio changes src/collision_detection/cd_engine.rs to accept exact contact with axis-aligned rectangular exterior boundaries when the entire query is within those bounds. No tolerance or geometry padding is introduced. Other hazard checks and nonrectangular exterior behavior are unchanged. Binary and collection queries share the same containment rule.

The quadtree edge classifier checks unresolved quadrants directly instead of assuming no collision; this preserves traversal for edges collinear with a node bisector.
