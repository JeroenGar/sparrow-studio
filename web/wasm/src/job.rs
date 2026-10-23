//! The local backend's engine: jobs in the Sparrow Pro job format, solved by open-source sparrow.
//!
//! Open-source sparrow solves one problem: polygons on a strip of fixed height, with a minimum
//! separation between parts and a set of permitted rotations. [`check`] refuses every other
//! feature of the format as unavailable, except nesting inside holes: parts are solid instead; [`instance`] turns what is left into a sparrow
//! instance, and [`Mapping`] turns sparrow's layouts back into the format.

use jagua_rs::io::ext_repr::{ExtItem as BaseItem, ExtSPolygon, ExtShape};
use jagua_rs::probs::spp::io::ext_repr::{ExtItem, ExtSPInstance, ExtSPSolution};
use serde::Serialize;
use sparrow_pro_schema::v1::{
    Contour, FieldError, Input, Layout, LayoutStats, Placement, Problem, Reflection,
    Rotation, Segment, Solution, Stats, Transformation, ValidationError, validate,
};

/// Why a job input is refused, as the API's error code and the errors per field.
#[derive(Serialize, Debug, PartialEq)]
pub struct Refusal {
    pub code: &'static str,
    pub field_errors: Vec<FieldError>,
}

impl Refusal {
    fn new(code: &'static str, errors: Vec<FieldError>) -> Self {
        // The API names fields within the request body, which holds the input under `/input`.
        let field_errors = errors
            .into_iter()
            .map(|error| FieldError { param: format!("/input{}", error.param), message: error.message })
            .collect();
        Refusal { code, field_errors }
    }
}

fn unavailable(param: impl Into<String>, message: &str) -> FieldError {
    FieldError { param: param.into(), message: format!("{message} needs Sparrow Pro; open-source sparrow does not have it.") }
}

/// Checks an input against the format's rules, then against what open-source sparrow can solve.
pub fn check(input: &Input) -> Result<(), Refusal> {
    match validate(input) {
        Err(ValidationError::Invalid(errors)) => return Err(Refusal::new("invalid_job_input", errors)),
        Err(ValidationError::Unavailable(errors)) => return Err(Refusal::new("feature_unavailable", errors)),
        Ok(()) => {}
    }
    let mut errors = Vec::new();
    match &input.problem {
        Problem::MinimizeStripLength(strip) => {
            if !strip.locked_parts.is_empty() {
                errors.push(unavailable("/problem/locked_parts", "Locking placements"));
            }
        }
        Problem::MinimizeSheetsInOrder(_) => errors.push(unavailable("/problem/type", "Nesting into sheets")),
    }
    for (index, part) in input.parts.iter().enumerate() {
        if part.orientation.reflection != [Reflection::None] {
            errors.push(unavailable(format!("/parts/{index}/orientation/reflection"), "Reflecting parts"));
        }
    }
    if errors.is_empty() { Ok(()) } else { Err(Refusal::new("feature_unavailable", errors)) }
}

/// How sparrow's layouts relate to the input.
pub struct Mapping {
    /// The part ID of each sparrow item, by item ID.
    part_ids: Vec<String>,
    /// How far sparrow's strip edges lie inside the input's: sparrow keeps parts its separation
    /// away from its edges, so its strip is narrower by twice this, or wider when negative, and
    /// starts this much later.
    margin: f64,
    height: f64,
    placed_area: f64,
}

/// A sparrow instance for a checked input, and the separation to solve it with.
pub struct Instance {
    pub instance: ExtSPInstance,
    pub separation: f32,
    pub mapping: Mapping,
    /// The boundary separation as requested, when it is raised to half the parts' separation.
    pub raised_boundary: Option<(f64, f64)>,
}

/// Turns a checked input into a sparrow instance.
///
/// Sparrow nests polygons, so curves become polygons whose points lie on the curve, at most
/// `tolerance` apart from it. To keep the curves themselves apart, the separation grows by twice
/// the tolerance whenever a part has curves, and the distance to the strip's edges by the
/// tolerance. Open-source sparrow has no holes: every part is solid, its holes are left out, and
/// its area is that of its outer contour.
pub fn instance(input: &Input) -> Instance {
    let Problem::MinimizeStripLength(strip) = &input.problem else { unreachable!("checked input") };
    let geometry = |id: &str| &input.geometries.iter().find(|g| g.id == id).expect("checked input").shape;
    let extent = input.geometries.iter().flat_map(|g| std::iter::once(&g.shape.outer).chain(&g.shape.holes))
        .map(contour_extent).fold(0.0, f64::max);
    let tolerance = (extent * 1e-4).max(1e-9);
    let curved = input.parts.iter().any(|part| is_curved(&geometry(&part.geometry_id).outer));
    let slack = if curved { tolerance } else { 0.0 };
    let separation = input.minimum_separation_distance.parts + 2.0 * slack;
    // The format raises a boundary separation between 0 and half the parts' separation to half.
    let (half, boundary) = (input.minimum_separation_distance.parts / 2.0, input.minimum_separation_distance.boundary);
    let raised_boundary = (boundary > 0.0 && boundary < half).then_some((boundary, half));
    let margin = raised_boundary.map_or(boundary, |(_, used)| used) + slack - separation;
    let items = input.parts.iter().enumerate().map(|(index, part)| {
        let shape = geometry(&part.geometry_id);
        ExtItem {
            base: BaseItem {
                id: index as u64,
                allowed_orientations: match &part.orientation.rotation {
                    Rotation::Discrete { angles } => Some(angles.iter().map(|&a| a as f32).collect()),
                    Rotation::Continuous => None,
                },
                shape: ExtShape::SimplePolygon(ExtSPolygon(
                    flatten(&shape.outer, tolerance).into_iter().map(|[x, y]| (x as f32, y as f32)).collect(),
                )),
                min_quality: None,
            },
            demand: part.quantity as u64,
        }
    }).collect();
    let placed_area = input.parts.iter()
        .map(|part| part.quantity as f64 * area(&flatten(&geometry(&part.geometry_id).outer, tolerance)))
        .sum();
    Instance {
        instance: ExtSPInstance { name: "job".into(), items, strip_height: (strip.height - 2.0 * margin) as f32 },
        separation: separation as f32,
        mapping: Mapping { part_ids: input.parts.iter().map(|p| p.id.clone()).collect(), margin, height: strip.height, placed_area },
        raised_boundary,
    }
}

impl Mapping {
    /// A sparrow layout in the format: one layout on the strip.
    pub fn solution(&self, solution: &ExtSPSolution) -> Solution {
        let placements = solution.layout.placed_items.iter().map(|item| Placement {
            part_id: self.part_ids[item.item_id as usize].clone(),
            transformation: Transformation {
                reflection: Reflection::None,
                rotation: item.transformation.rotation as f64,
                translation: [
                    item.transformation.translation.0 as f64 + self.margin,
                    item.transformation.translation.1 as f64 + self.margin,
                ],
            },
        }).collect();
        Solution { layouts: vec![Layout { sheet_id: "strip".into(), placements }] }
    }

    /// The statistics of a feasible sparrow layout. Sparrow's strip ends its separation past the
    /// parts; the input's is cut its boundary separation past them.
    pub fn stats(&self, solution: &ExtSPSolution) -> Stats {
        let cut_x = solution.strip_width as f64 + 2.0 * self.margin;
        let consumed_area = cut_x * self.height;
        let density = if consumed_area > 0.0 { self.placed_area / consumed_area } else { 0.0 };
        Stats {
            consumed_area,
            placed_area: self.placed_area,
            density,
            layouts: vec![LayoutStats { cut_x: Some(cut_x), consumed_area, placed_area: self.placed_area, density }],
        }
    }
}

type Point = [f64; 2];

fn is_curved(contour: &Contour) -> bool {
    match contour {
        Contour::Polygon { .. } | Contour::Rectangle { .. } => false,
        Contour::Circle { .. } => true,
        Contour::Path { segments, .. } => segments.iter().any(|segment| match segment {
            Segment::Line { .. } => false,
            Segment::Arc { bulge, .. } => *bulge != 0.0,
            Segment::Quadratic { .. } | Segment::Cubic { .. } | Segment::Nurbs { .. } => true,
        }),
    }
}

/// The largest coordinate size of a contour's points, controls included.
fn contour_extent(contour: &Contour) -> f64 {
    let points: Vec<Point> = match contour {
        Contour::Polygon { points } => points.clone(),
        Contour::Rectangle { x_min, y_min, width, height } => vec![[*x_min, *y_min], [x_min + width, y_min + height]],
        Contour::Circle { center, radius } => vec![[center[0] - radius, center[1] - radius], [center[0] + radius, center[1] + radius]],
        Contour::Path { start, segments } => std::iter::once(*start).chain(segments.iter().flat_map(|s| match s {
            Segment::Line { to } | Segment::Arc { to, .. } => vec![*to],
            Segment::Quadratic { control, to } => vec![*control, *to],
            Segment::Cubic { control1, control2, to } => vec![*control1, *control2, *to],
            Segment::Nurbs { control_points, .. } => control_points.clone(),
        })).collect(),
    };
    let (mut min, mut max) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
    for [x, y] in points {
        min = [min[0].min(x), min[1].min(y)];
        max = [max[0].max(x), max[1].max(y)];
    }
    (max[0] - min[0]).max(max[1] - min[1])
}

/// A contour as a counterclockwise polygon, its points on the contour and its edges within
/// `tolerance` of it.
pub fn flatten(contour: &Contour, tolerance: f64) -> Vec<Point> {
    let mut points: Vec<Point> = match contour {
        Contour::Polygon { points } => points.clone(),
        Contour::Rectangle { x_min, y_min, width, height } => {
            vec![[*x_min, *y_min], [x_min + width, *y_min], [x_min + width, y_min + height], [*x_min, y_min + height]]
        }
        Contour::Circle { center, radius } => {
            let mut points = vec![[center[0] + radius, center[1]]];
            sample(&|t: f64| {
                let angle = t * std::f64::consts::TAU;
                [center[0] + radius * angle.cos(), center[1] + radius * angle.sin()]
            }, 0.0, 1.0, tolerance, 0, &mut points);
            points
        }
        Contour::Path { start, segments } => {
            let mut points = vec![*start];
            for segment in segments {
                let from = *points.last().unwrap();
                match segment {
                    Segment::Line { to } => points.push(*to),
                    Segment::Arc { to, bulge } if *bulge == 0.0 => points.push(*to),
                    Segment::Arc { to, bulge } => sample(&arc(from, *to, *bulge), 0.0, 1.0, tolerance, 0, &mut points),
                    Segment::Quadratic { control, to } => {
                        let (c, to) = (*control, *to);
                        sample(&|t: f64| bezier(&[from, c, to], t), 0.0, 1.0, tolerance, 0, &mut points)
                    }
                    Segment::Cubic { control1, control2, to } => {
                        let (c1, c2, to) = (*control1, *control2, *to);
                        sample(&|t: f64| bezier(&[from, c1, c2, to], t), 0.0, 1.0, tolerance, 0, &mut points)
                    }
                    Segment::Nurbs { degree, control_points, knots, weights } => {
                        let controls: Vec<Point> = std::iter::once(from).chain(control_points.iter().copied()).collect();
                        let weights = weights.clone().unwrap_or_else(|| vec![1.0; controls.len()]);
                        let degree = *degree as usize;
                        let (low, high) = (knots[degree], knots[controls.len()]);
                        let curve = |t: f64| nurbs(degree, &controls, knots, &weights, low + (high - low) * t);
                        sample(&curve, 0.0, 1.0, tolerance, 0, &mut points)
                    }
                }
            }
            points
        }
    };
    points.dedup();
    if points.len() > 1 && points.first() == points.last() { points.pop(); }
    if area(&points) < 0.0 { points.reverse(); }
    points
}

/// Appends points of `curve` on `(t0, t1]`, subdividing until each piece's midpoint lies within
/// `tolerance` of its chord.
fn sample(curve: &dyn Fn(f64) -> Point, t0: f64, t1: f64, tolerance: f64, depth: u32, out: &mut Vec<Point>) {
    let (a, b, mid) = (curve(t0), curve(t1), curve((t0 + t1) / 2.0));
    let deviation = distance(mid, [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]);
    // Every curve is split a few times first, so a piece that happens to be symmetric about its
    // chord's midpoint, such as a full turn, cannot pass unsplit.
    if depth < 16 && (depth < 3 || deviation > tolerance) {
        let half = (t0 + t1) / 2.0;
        sample(curve, t0, half, tolerance, depth + 1, out);
        sample(curve, half, t1, tolerance, depth + 1, out);
    } else {
        out.push(b);
    }
}

/// The circular arc from `from` to `to` with `bulge`, as a function on [0, 1].
fn arc(from: Point, to: Point, bulge: f64) -> impl Fn(f64) -> Point {
    let chord = [to[0] - from[0], to[1] - from[1]];
    let factor = (1.0 - bulge * bulge) / (4.0 * bulge);
    let center = [
        (from[0] + to[0]) / 2.0 - chord[1] * factor,
        (from[1] + to[1]) / 2.0 + chord[0] * factor,
    ];
    let radius = distance(from, center);
    let start = (from[1] - center[1]).atan2(from[0] - center[0]);
    let sweep = 4.0 * bulge.atan();
    move |t| {
        let angle = start + sweep * t;
        [center[0] + radius * angle.cos(), center[1] + radius * angle.sin()]
    }
}

fn bezier(points: &[Point], t: f64) -> Point {
    let mut points = points.to_vec();
    while points.len() > 1 {
        points = points.windows(2).map(|w| lerp(w[0], w[1], t)).collect();
    }
    points[0]
}

/// A rational B-spline at `t`, by de Boor's algorithm on homogeneous points.
fn nurbs(degree: usize, controls: &[Point], knots: &[f64], weights: &[f64], t: f64) -> Point {
    let last = controls.len() - 1;
    let span = (degree..=last).rev().find(|&i| knots[i] <= t).unwrap_or(degree);
    let mut d: Vec<[f64; 3]> = (0..=degree).map(|j| {
        let (p, w) = (controls[span - degree + j], weights[span - degree + j]);
        [p[0] * w, p[1] * w, w]
    }).collect();
    for r in 1..=degree {
        for j in (r..=degree).rev() {
            let i = span - degree + j;
            let denominator = knots[i + degree + 1 - r] - knots[i];
            let alpha = if denominator == 0.0 { 0.0 } else { (t - knots[i]) / denominator };
            d[j] = [0, 1, 2].map(|k| (1.0 - alpha) * d[j - 1][k] + alpha * d[j][k]);
        }
    }
    let [x, y, w] = d[degree];
    [x / w, y / w]
}

fn lerp(a: Point, b: Point, t: f64) -> Point {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

fn distance(a: Point, b: Point) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

/// The signed area of a polygon: positive when counterclockwise.
fn area(points: &[Point]) -> f64 {
    let n = points.len();
    (0..n).map(|i| {
        let (a, b) = (points[i], points[(i + 1) % n]);
        a[0] * b[1] - b[0] * a[1]
    }).sum::<f64>() / 2.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use sparrow_pro_schema::v1::HoleMode;
    use jagua_rs::Instant;
    use jagua_rs::io::import::Importer;
    use jagua_rs::probs::spp::io::{export, import_instance};
    use rand::{SeedableRng, rngs::Xoshiro256PlusPlus};
    use serde_json::json;
    use sparrow::config::DEFAULT_SPARROW_CONFIG;
    use sparrow::consts::LBF_SAMPLE_CONFIG;
    use sparrow::optimizer::lbf::LBFBuilder;

    /// Two part types, one with an arc and one with a hole, on a strip 60 high.
    fn input(changes: serde_json::Value) -> Input {
        let mut input = json!({
            "schema_version": 1,
            "geometries": [
                {"id": "plate", "shape": {"outer": {"type": "rectangle", "x_min": 0, "y_min": 0, "width": 40, "height": 20},
                    "holes": [{"type": "circle", "center": [10, 10], "radius": 4}]}},
                {"id": "wedge", "shape": {"outer": {"type": "path", "start": [0, 0], "segments": [
                    {"type": "line", "to": [30, 0]}, {"type": "arc", "to": [0, 30], "bulge": 0.41421356237309503}]}}}
            ],
            "parts": [
                {"id": "plate", "geometry_id": "plate", "quantity": 3, "hole_mode": "solid",
                    "orientation": {"rotation": {"type": "discrete", "angles": [0, 180]}}},
                {"id": "wedge", "geometry_id": "wedge", "quantity": 2,
                    "orientation": {"rotation": {"type": "discrete", "angles": [0, 90, 180, 270]}}}
            ],
            "minimum_separation_distance": {"parts": 1, "boundary": 1},
            "problem": {"type": "minimize_strip_length", "height": 60}
        });
        merge(&mut input, changes);
        serde_json::from_value(input).unwrap()
    }

    fn merge(target: &mut serde_json::Value, changes: serde_json::Value) {
        match (target, changes) {
            (serde_json::Value::Object(target), serde_json::Value::Object(changes)) => {
                for (key, value) in changes { merge(target.entry(key).or_insert(serde_json::Value::Null), value); }
            }
            (target, changes) => *target = changes,
        }
    }

    fn refusal(input: &Input) -> (&'static str, Vec<String>) {
        let refusal = check(input).unwrap_err();
        (refusal.code, refusal.field_errors.into_iter().map(|e| e.param).collect())
    }

    #[test]
    fn accepts_what_open_source_sparrow_solves() {
        assert_eq!(check(&input(json!({}))), Ok(()));
    }

    #[test]
    fn tells_invalid_input_from_features_it_lacks() {
        assert_eq!(refusal(&input(json!({"parts": []}))).0, "invalid_job_input");
        let mut sheets = input(json!({}));
        sheets.problem = serde_json::from_value(json!({"type": "minimize_sheets_in_order",
            "sheets": [{"id": "s", "geometry_id": "plate"}]})).unwrap();
        assert_eq!(refusal(&sheets), ("feature_unavailable", vec!["/input/problem/type".into()]));
        let mut reflected = input(json!({}));
        reflected.parts[1].orientation.reflection = vec![Reflection::None, Reflection::XAxis];
        assert_eq!(refusal(&reflected), ("feature_unavailable", vec!["/input/parts/1/orientation/reflection".into()]));
    }

    #[test]
    fn solves_parts_that_allow_nesting_inside_their_holes_as_solid() {
        let mut nestable = input(json!({}));
        nestable.parts[0].hole_mode = HoleMode::Nestable;
        assert_eq!(check(&nestable), Ok(()));
    }

    fn on_circle(points: &[Point], center: Point, radius: f64) -> f64 {
        points.iter().map(|&p| (distance(p, center) - radius).abs()).fold(0.0, f64::max)
    }

    #[test]
    fn flattens_curves_onto_the_curve() {
        let circle = flatten(&Contour::Circle { center: [5.0, 5.0], radius: 10.0 }, 0.01);
        assert!(on_circle(&circle, [5.0, 5.0], 10.0) < 1e-9);
        assert!((area(&circle) / (std::f64::consts::PI * 100.0) - 1.0).abs() < 1e-3);
        let wedge = input(json!({})).geometries[1].shape.outer.clone();
        let points = flatten(&wedge, 0.01);
        assert!(on_circle(&points[2..], [0.0, 0.0], 30.0) < 1e-9, "the arc is a quarter circle around the origin");
        assert!(area(&points) > 0.0, "counterclockwise");
        // A quarter circle as a rational quadratic NURBS curve.
        let nurbs = Contour::Path { start: [1.0, 0.0], segments: vec![Segment::Nurbs {
            degree: 2, control_points: vec![[1.0, 1.0], [0.0, 1.0]],
            knots: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0], weights: Some(vec![1.0, std::f64::consts::FRAC_1_SQRT_2, 1.0]) }] };
        let points = flatten(&nurbs, 0.001);
        assert!(points.len() > 8);
        assert!(on_circle(&points[1..], [0.0, 0.0], 1.0) < 1e-9);
    }

    /// Solves `input` with sparrow's first construction, and returns the placed outlines in the
    /// input's coordinates with the layout's statistics.
    fn solve(input: &Input) -> (Vec<Vec<Point>>, Stats) {
        let Instance { instance: external, separation, mapping, .. } = instance(input);
        let importer = Importer::new(DEFAULT_SPARROW_CONFIG.cde_config, None, (separation > 0.0).then_some(separation), None);
        let imported = import_instance(&importer, &external).unwrap();
        let built = LBFBuilder::new(imported.clone(), Xoshiro256PlusPlus::seed_from_u64(7), LBF_SAMPLE_CONFIG).construct().unwrap();
        let solution = export(&imported, &built.prob.save(), Instant::now());
        let outlines = mapping.solution(&solution).layouts[0].placements.iter().map(|placement| {
            let part = input.parts.iter().find(|p| p.id == placement.part_id).unwrap();
            let shape = &input.geometries.iter().find(|g| g.id == part.geometry_id).unwrap().shape;
            let Transformation { rotation, translation, .. } = placement.transformation;
            let (sin, cos) = rotation.to_radians().sin_cos();
            flatten(&shape.outer, 1e-4).into_iter()
                .map(|[x, y]| [cos * x - sin * y + translation[0], sin * x + cos * y + translation[1]]).collect()
        }).collect();
        (outlines, mapping.stats(&solution))
    }

    #[test]
    fn keeps_the_boundary_separation_and_cuts_past_it() {
        for boundary in [0.0, 0.2, 1.0, 3.0] {
            let input = input(json!({"minimum_separation_distance": {"parts": 1, "boundary": boundary}}));
            let used = if boundary > 0.0 && boundary < 0.5 { 0.5 } else { boundary };
            let (outlines, stats) = solve(&input);
            assert_eq!(outlines.len(), 5);
            let points = || outlines.iter().flatten();
            let (left, bottom) = (points().map(|p| p[0]).fold(f64::INFINITY, f64::min), points().map(|p| p[1]).fold(f64::INFINITY, f64::min));
            let (right, top) = (points().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max), points().map(|p| p[1]).fold(f64::NEG_INFINITY, f64::max));
            let cut_x = stats.layouts[0].cut_x.unwrap();
            println!("boundary {boundary}: left {left}, bottom {bottom}, top {top}, right {right}, cut at {cut_x}");
            assert!(left >= used - 1e-3 && bottom >= used - 1e-3 && 60.0 - top >= used - 1e-3, "boundary {boundary}");
            assert!(cut_x >= right + used - 1e-3, "boundary {boundary}: the parts lie left of the cut");
            assert!((stats.consumed_area - cut_x * 60.0).abs() < 1e-6);
        }
    }
}
