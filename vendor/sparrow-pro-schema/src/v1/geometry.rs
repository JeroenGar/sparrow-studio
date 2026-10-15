use serde::{Deserialize, Serialize};

/// A point `[x, y]`.
pub type Point = [f64; 2];

/// One outer contour and any number of holes, which are regions without material.
///
/// In a part's geometry, each hole lies inside the outer contour; holes may touch it and each
/// other, but not overlap, and the material stays one connected piece. Otherwise the input is
/// invalid. In a sheet's geometry, holes are unusable regions without further rules: they may
/// reach outside the sheet, overlap, or split it into pieces.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Shape {
    pub outer: Contour,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub holes: Vec<Contour>,
}

/// A closed boundary.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Contour {
    /// At least 3 points, in either winding; a last point equal to the first is allowed. The
    /// edges must not cross each other.
    Polygon { points: Vec<Point> },
    /// An axis-aligned rectangle with positive `width` and `height`.
    Rectangle {
        x_min: f64,
        y_min: f64,
        width: f64,
        height: f64,
    },
    /// A circle with a positive `radius`.
    Circle { center: Point, radius: f64 },
    /// A contour of segments, meant for curves; [`Contour::Polygon`] is the compact form for
    /// straight edges. Each segment runs from the previous segment's end, or `start`, to its own
    /// end, and a path that does not end at `start` is closed by a straight line. It must not
    /// cross itself; an error names the segments that cross.
    Path {
        start: Point,
        segments: Vec<Segment>,
    },
}

/// A piece of a [`Contour::Path`], running from the previous segment's end to its own.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Segment {
    Line {
        to: Point,
    },
    /// A circular arc. `bulge` is tan(θ/4) for the swept angle θ, positive counterclockwise, as
    /// in DXF; `0` is a straight line. Its ends must differ: a full circle is a
    /// [`Contour::Circle`] or two arcs.
    Arc {
        to: Point,
        bulge: f64,
    },
    /// A quadratic Bézier curve.
    Quadratic {
        control: Point,
        to: Point,
    },
    /// A cubic Bézier curve.
    Cubic {
        control1: Point,
        control2: Point,
        to: Point,
    },
    /// A clamped NURBS curve. `control_points` lists the control points after the segment's
    /// start, which is the first control point and is not repeated; the last is the segment's
    /// end. With m listed points, the curve has m + 1 control points:
    ///
    /// - 1 ≤ `degree` ≤ m;
    /// - `knots` has m + `degree` + 2 entries, nondecreasing, the first and last repeated exactly
    ///   `degree` + 1 times, no interior knot more than `degree` times;
    /// - `weights`, when given, has m + 1 positive entries, the start's first; omitted means
    ///   all 1.
    Nurbs {
        degree: u32,
        control_points: Vec<Point>,
        knots: Vec<f64>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "crate::v1::input::present"
        )]
        weights: Option<Vec<f64>>,
    },
}
