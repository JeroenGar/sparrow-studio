use super::{Contour, Point, Shape};
use serde::{Deserialize, Deserializer, Serialize};

/// The input a client submits: one complete nesting problem.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Input {
    /// [`SCHEMA_VERSION`](super::SCHEMA_VERSION).
    pub schema_version: u32,
    /// The shapes that parts and sheets refer to, nonempty.
    pub geometries: Vec<Geometry>,
    /// What is to be produced, nonempty.
    pub parts: Vec<Part>,
    pub minimum_separation_distance: MinimumSeparationDistance,
    /// The material and the goal.
    pub problem: Problem,
}

/// A shape that any number of parts and sheets may use. A geometry is never altered: fallbacks
/// apply to the part or sheet that uses it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Geometry {
    pub id: String,
    pub shape: Shape,
}

/// Something to produce, in copies that cannot be told apart.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Part {
    pub id: String,
    pub geometry_id: String,
    /// Copies to produce, at least 1, locked ones included.
    pub quantity: u32,
    pub orientation: Orientation,
    #[serde(default)]
    pub hole_mode: HoleMode,
}

/// Whether other parts may be placed in a part's holes, locked copies included.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum HoleMode {
    #[default]
    Nestable,
    Solid,
}

/// The permitted orientations of a part's copies: every combination of a permitted reflection
/// and a permitted rotation.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Orientation {
    pub rotation: Rotation,
    /// Nonempty and without repeats. A mirror across another axis is the x-axis mirror plus a
    /// rotation.
    #[serde(default = "no_reflection")]
    pub reflection: Vec<Reflection>,
}

fn no_reflection() -> Vec<Reflection> {
    vec![Reflection::None]
}

/// The permitted rotations.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Rotation {
    /// A nonempty list of at most 65,536 angles; equivalent angles are merged, and 0° is not
    /// implicit.
    Discrete { angles: Vec<f64> },
    /// Any angle.
    Continuous,
}

/// A mirror of a geometry before it is rotated.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum Reflection {
    /// Keeps the geometry as it is.
    None,
    /// Mirrors the geometry across its own x-axis: (x, y) ↦ (x, −y).
    XAxis,
}

/// Minimum clearances, both nonnegative.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct MinimumSeparationDistance {
    /// Between any two parts, also between a part and the edge of another part's hole it lies in.
    pub parts: f64,
    /// Between a part and the edge of its material, a sheet hole, or a defect. A value between 0
    /// and half of `parts` is raised to half of `parts`, with
    /// [`Diagnostic::BoundarySeparationRaised`](super::Diagnostic::BoundarySeparationRaised).
    pub boundary: f64,
}

/// The material and the goal.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Problem {
    MinimizeSheetsInOrder(MinimizeSheetsInOrder),
    MinimizeStripLength(MinimizeStripLength),
}

/// One strip, from y = 0 to `height` and from x = 0 to the right without end. Every copy of every
/// part is placed, and the solver minimizes the length used,
/// [`LayoutStats::cut_x`](super::LayoutStats::cut_x). The solution has one layout, whose
/// `sheet_id` is `"strip"`. The boundary separation applies to the strip's bottom, top, and left
/// edges.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct MinimizeStripLength {
    /// Greater than 0.
    pub height: f64,
    /// Placements that are given, which the solver completes, in strip coordinates; as for
    /// [`LockedLayout::placements`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub locked_parts: Vec<Placement>,
}

/// Every copy of every part is placed. The expanded sheets are opened strictly in order, as a
/// prefix of the list, and the solver opens as few as possible. On the last opened sheet, the
/// parts are packed to the left and the sheet is cut vertically at
/// [`LayoutStats::cut_x`](super::LayoutStats::cut_x), as far left as possible; the material right
/// of the cut is kept as a remnant. Every opened sheet but the last is used in full.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct MinimizeSheetsInOrder {
    /// The material, in the order it is used, nonempty.
    pub sheets: Vec<SheetEntry>,
    /// Placements that are given, which the solver completes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub locked_parts: Vec<LockedLayout>,
}

/// Identical, anonymous sheets in a row. Sheets with different defects, or that must be told
/// apart, need separate entries.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct SheetEntry {
    pub id: String,
    pub geometry_id: String,
    /// How many sheets the entry expands to, at least 1.
    #[serde(default = "one")]
    pub quantity: u32,
    /// Unusable regions in the sheet's coordinates, such as flaws or clamp areas. They may overlap
    /// each other and reach outside the sheet.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub defects: Vec<Contour>,
}

fn one() -> u32 {
    1
}

/// Given placements on one sheet, which the solver completes.
///
/// - Each locked layout takes the next unused sheet of its entry, in input order; an entry with
///   fewer sheets than locked layouts is invalid.
/// - Each placement uses up one copy of its part; a part with fewer copies than locked
///   placements is invalid.
/// - A sheet holding a locked layout, and every sheet before it, is opened.
/// - Placements stand as given, also when they conflict, see
///   [`Diagnostic::LockedPlacementConflict`](super::Diagnostic::LockedPlacementConflict). They
///   are not checked against the part's permitted orientations.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct LockedLayout {
    pub sheet_id: String,
    /// At least one placement.
    pub placements: Vec<Placement>,
}

/// A copy of a part, placed on a sheet or the strip.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Placement {
    pub part_id: String,
    pub transformation: Transformation,
}

/// Maps a part's original geometry onto its sheet:
/// p_sheet = R(`rotation`) · F(`reflection`) · p_geometry + `translation`,
/// about the geometry's own origin, which need not lie on or inside the shape. Every placement,
/// including a part inside another part's hole, is in sheet coordinates.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Transformation {
    pub reflection: Reflection,
    /// Degrees, counterclockwise.
    pub rotation: f64,
    pub translation: Point,
}

/// Deserializes an optional field that, when present, is not `null`, for strictly read types.
pub fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}
