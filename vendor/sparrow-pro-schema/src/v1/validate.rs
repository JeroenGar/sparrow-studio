use super::{
    Contour, FieldError, Input, LockedLayout, MinimizeSheetsInOrder, MinimizeStripLength,
    MinimumSeparationDistance, Part, Placement, Point, Problem, Reflection, Rotation,
    SCHEMA_VERSION, Segment, Shape, Transformation,
};
use std::collections::HashMap;
use std::fmt::Display;

/// The most errors [`validate`] reports.
pub const MAX_ERRORS: usize = 100;

/// The largest magnitude of a coordinate or length.
const MAX_COORDINATE: f64 = 1e7;

/// The largest count.
const MAX_COUNT: u32 = i32::MAX as u32;

/// Why [`validate`] refused an input; each error at the JSON Pointer of its field within the input.
#[derive(Clone, Debug, PartialEq)]
pub enum ValidationError {
    /// The input breaks the format's rules.
    Invalid(Vec<FieldError>),
    /// The input is valid, but uses a value the solver does not support yet.
    Unavailable(Vec<FieldError>),
}

impl ValidationError {
    pub fn field_errors(&self) -> &[FieldError] {
        match self {
            ValidationError::Invalid(errors) | ValidationError::Unavailable(errors) => errors,
        }
    }
}

/// Checks `input` against every rule that needs no geometry built: versions, IDs and references,
/// numbers and counts, separations, orientations, and the values of each contour and curve
/// segment. The rules that do, such as contours that cross themselves, are checked when the input
/// is imported for solving.
///
/// Reports at most [`MAX_ERRORS`] errors. An input with invalid values is
/// [`ValidationError::Invalid`], even when it also uses an unsupported value.
pub fn validate(input: &Input) -> Result<(), ValidationError> {
    let mut errors = Errors::default();
    let Input {
        schema_version,
        geometries,
        parts,
        minimum_separation_distance,
        problem,
    } = input;
    if *schema_version != SCHEMA_VERSION {
        errors.push(
            "/schema_version",
            format!("unsupported version {schema_version}"),
        );
    }
    let geometry_ids = ids(&mut errors, geometries.iter().map(|g| &g.id), "/geometries");
    for (idx, geometry) in geometries.iter().enumerate() {
        shape(
            &mut errors,
            &geometry.shape,
            &format!("/geometries/{idx}/shape"),
        );
    }
    if parts.is_empty() {
        errors.push("/parts", "must not be empty");
    }
    let part_ids = ids(&mut errors, parts.iter().map(|part| &part.id), "/parts");
    for (idx, part_) in parts.iter().enumerate() {
        part(&mut errors, &geometry_ids, part_, &format!("/parts/{idx}"));
    }
    let MinimumSeparationDistance { parts: s, boundary } = *minimum_separation_distance;
    for (name, value) in [("parts", s), ("boundary", boundary)] {
        if !(value.is_finite() && (0.0..=MAX_COORDINATE).contains(&value)) {
            errors.push(
                format!("/minimum_separation_distance/{name}"),
                "must be from 0 to 10⁷",
            );
        }
    }
    // Per part, its locked placements.
    let mut n_locked = vec![0u64; parts.len()];
    let mut placement = |errors: &mut Errors, placement: &Placement, path: String| {
        match part_ids.get(placement.part_id.as_str()) {
            Some(&idx) => n_locked[idx] += 1,
            None => errors.push(
                format!("{path}/part_id"),
                format!("unknown part {}", placement.part_id),
            ),
        }
        transformation(errors, &placement.transformation, &path);
    };
    match problem {
        Problem::MinimizeSheetsInOrder(MinimizeSheetsInOrder {
            sheets,
            locked_parts,
        }) => {
            if sheets.is_empty() {
                errors.push("/problem/sheets", "must not be empty");
            }
            let sheet_ids = ids(
                &mut errors,
                sheets.iter().map(|entry| &entry.id),
                "/problem/sheets",
            );
            for (idx, entry) in sheets.iter().enumerate() {
                let path = format!("/problem/sheets/{idx}");
                geometry_reference(&mut errors, &geometry_ids, &entry.geometry_id, &path);
                quantity(&mut errors, entry.quantity, &path);
                for (defect_idx, defect) in entry.defects.iter().enumerate() {
                    contour(&mut errors, defect, &format!("{path}/defects/{defect_idx}"));
                }
            }
            // Per sheet entry, the locked layouts that take its sheets.
            let mut n_layouts = vec![0u64; sheets.len()];
            for (layout_idx, layout) in locked_parts.iter().enumerate() {
                let LockedLayout {
                    sheet_id,
                    placements,
                } = layout;
                let path = format!("/problem/locked_parts/{layout_idx}");
                match sheet_ids.get(sheet_id.as_str()).copied() {
                    Some(entry_idx) => {
                        n_layouts[entry_idx] += 1;
                        if n_layouts[entry_idx] > u64::from(sheets[entry_idx].quantity) {
                            errors.push(
                                format!("{path}/sheet_id"),
                                format!("sheet {sheet_id} has no unused sheet left"),
                            );
                        }
                    }
                    None => errors.push(
                        format!("{path}/sheet_id"),
                        format!("unknown sheet {sheet_id}"),
                    ),
                }
                if placements.is_empty() {
                    errors.push(format!("{path}/placements"), "must not be empty");
                }
                for (idx, locked) in placements.iter().enumerate() {
                    placement(&mut errors, locked, format!("{path}/placements/{idx}"));
                }
            }
        }
        Problem::MinimizeStripLength(MinimizeStripLength {
            height,
            locked_parts,
        }) => {
            if !length(*height) {
                errors.push("/problem/height", "must be greater than 0 and at most 10⁷");
            }
            for (idx, locked) in locked_parts.iter().enumerate() {
                placement(&mut errors, locked, format!("/problem/locked_parts/{idx}"));
            }
        }
    }
    for (idx, (part, n_locked)) in parts.iter().zip(n_locked).enumerate() {
        if n_locked > u64::from(part.quantity) {
            errors.push(
                format!("/parts/{idx}/quantity"),
                format!("part {} has fewer copies than locked placements", part.id),
            );
        }
    }
    errors.result()
}

/// The errors found so far, at most [`MAX_ERRORS`] together.
#[derive(Default)]
struct Errors {
    invalid: Vec<FieldError>,
    unavailable: Vec<FieldError>,
}

impl Errors {
    fn push(&mut self, param: impl Into<String>, message: impl Display) {
        if self.invalid.len() + self.unavailable.len() < MAX_ERRORS {
            self.invalid.push(FieldError {
                param: param.into(),
                message: message.to_string(),
            });
        }
    }

    fn push_unavailable(&mut self, param: impl Into<String>, message: impl Display) {
        if self.invalid.len() + self.unavailable.len() < MAX_ERRORS {
            self.unavailable.push(FieldError {
                param: param.into(),
                message: message.to_string(),
            });
        }
    }

    fn result(self) -> Result<(), ValidationError> {
        match (self.invalid.is_empty(), self.unavailable.is_empty()) {
            (true, true) => Ok(()),
            (true, false) => Err(ValidationError::Unavailable(self.unavailable)),
            (false, _) => Err(ValidationError::Invalid(self.invalid)),
        }
    }
}

/// Checks the IDs of a list at `path`, and returns where each first appears.
fn ids<'a>(
    errors: &mut Errors,
    ids: impl Iterator<Item = &'a String>,
    path: &str,
) -> HashMap<&'a str, usize> {
    let mut first = HashMap::new();
    let mut unique = true;
    for (idx, id) in ids.enumerate() {
        if !(1..=128).contains(&id.chars().count()) {
            errors.push(
                format!("{path}/{idx}/id"),
                "IDs must have 1 to 128 characters",
            );
        }
        unique &= first.insert(id.as_str(), idx).is_none();
    }
    if !unique {
        errors.push(path, "IDs must be unique");
    }
    first
}

fn geometry_reference(
    errors: &mut Errors,
    geometry_ids: &HashMap<&str, usize>,
    geometry_id: &str,
    path: &str,
) {
    if !geometry_ids.contains_key(geometry_id) {
        errors.push(
            format!("{path}/geometry_id"),
            format!("unknown geometry {geometry_id}"),
        );
    }
}

fn quantity(errors: &mut Errors, quantity: u32, path: &str) {
    if !(1..=MAX_COUNT).contains(&quantity) {
        errors.push(format!("{path}/quantity"), "must be from 1 to 2147483647");
    }
}

/// A coordinate: finite and within ±10⁷.
fn coordinate(value: f64) -> bool {
    value.is_finite() && value.abs() <= MAX_COORDINATE
}

/// A length: greater than 0 and at most 10⁷.
fn length(value: f64) -> bool {
    value.is_finite() && value > 0.0 && value <= MAX_COORDINATE
}

fn transformation(errors: &mut Errors, transformation: &Transformation, path: &str) {
    let Transformation {
        reflection: _,
        rotation,
        translation,
    } = transformation;
    if !rotation.is_finite() {
        errors.push(format!("{path}/transformation/rotation"), "must be finite");
    }
    if !coordinates(&[*translation]) {
        errors.push(
            format!("{path}/transformation/translation"),
            "coordinates must be finite and within ±10⁷",
        );
    }
}

fn part(errors: &mut Errors, geometry_ids: &HashMap<&str, usize>, part: &Part, path: &str) {
    geometry_reference(errors, geometry_ids, &part.geometry_id, path);
    quantity(errors, part.quantity, path);
    match &part.orientation.rotation {
        Rotation::Continuous => {}
        Rotation::Discrete { angles } => {
            let path = format!("{path}/orientation/rotation");
            if angles.is_empty() || angles.len() > 65_536 {
                errors.push(&path, "discrete rotation requires 1..=65536 angles");
            }
            if !angles.iter().all(|angle| angle.is_finite()) {
                errors.push(&path, "rotation angles must be finite");
            }
        }
    }
    let reflection = &part.orientation.reflection;
    let path = format!("{path}/orientation/reflection");
    if reflection.is_empty()
        || (1..reflection.len()).any(|i| reflection[..i].contains(&reflection[i]))
    {
        errors.push(&path, "reflection must be nonempty and without repeats");
    }
    if !reflection.contains(&Reflection::None) {
        errors.push_unavailable(&path, "reflection without \"none\" is not supported yet");
    }
}

/// Checks one contour the way [`validate`] checks every contour of an input, with paths relative
/// to the contour, such as `/segments/2/knots`.
pub fn validate_contour(contour_: &Contour) -> Result<(), Vec<FieldError>> {
    let mut errors = Errors::default();
    contour(&mut errors, contour_, "");
    debug_assert!(errors.unavailable.is_empty());
    match errors.invalid.is_empty() {
        true => Ok(()),
        false => Err(errors.invalid),
    }
}

fn shape(errors: &mut Errors, shape: &Shape, path: &str) {
    contour(errors, &shape.outer, &format!("{path}/outer"));
    for (idx, hole) in shape.holes.iter().enumerate() {
        contour(errors, hole, &format!("{path}/holes/{idx}"));
    }
}

fn coordinates(points: &[Point]) -> bool {
    points.iter().flatten().all(|&c| coordinate(c))
}

fn contour(errors: &mut Errors, contour: &Contour, path: &str) {
    match contour {
        Contour::Polygon { points } => {
            if points.len() < 3 {
                errors.push(
                    format!("{path}/points"),
                    "a polygon needs at least 3 points",
                );
            }
            if !coordinates(points) {
                errors.push(
                    format!("{path}/points"),
                    "coordinates must be finite and within ±10⁷",
                );
            }
        }
        Contour::Rectangle {
            x_min,
            y_min,
            width,
            height,
        } => {
            if !(coordinate(*x_min) && coordinate(*y_min)) {
                errors.push(path, "coordinates must be finite and within ±10⁷");
            }
            for (name, value) in [("width", width), ("height", height)] {
                if !length(*value) {
                    errors.push(
                        format!("{path}/{name}"),
                        "must be greater than 0 and at most 10⁷",
                    );
                }
            }
        }
        Contour::Circle { center, radius } => {
            if !coordinates(&[*center]) {
                errors.push(
                    format!("{path}/center"),
                    "coordinates must be finite and within ±10⁷",
                );
            }
            if !length(*radius) {
                errors.push(
                    format!("{path}/radius"),
                    "radius must be greater than 0 and at most 10⁷",
                );
            }
        }
        Contour::Path { start, segments } => {
            if !coordinates(&[*start]) {
                errors.push(
                    format!("{path}/start"),
                    "coordinates must be finite and within ±10⁷",
                );
            }
            if segments.is_empty() {
                errors.push(format!("{path}/segments"), "must not be empty");
            }
            let mut from = *start;
            for (idx, segment_) in segments.iter().enumerate() {
                from = segment(errors, from, segment_, &format!("{path}/segments/{idx}"));
            }
        }
    }
}

/// Checks `segment`, which starts at `from`, and returns its end.
fn segment(errors: &mut Errors, from: Point, segment: &Segment, path: &str) -> Point {
    let (points, to): (Vec<Point>, Point) = match segment {
        Segment::Line { to } => (vec![*to], *to),
        Segment::Arc { to, bulge } => {
            if !bulge.is_finite() {
                errors.push(format!("{path}/bulge"), "bulge must be finite");
            } else if *bulge != 0.0 && from == *to {
                errors.push(path, "an arc must end where it does not start");
            }
            (vec![*to], *to)
        }
        Segment::Quadratic { control, to } => {
            if [*control, *to].iter().all(|p| *p == from) {
                errors.push(path, "a curve needs distinct control points");
            }
            (vec![*control, *to], *to)
        }
        Segment::Cubic {
            control1,
            control2,
            to,
        } => {
            if [*control1, *control2, *to].iter().all(|p| *p == from) {
                errors.push(path, "a curve needs distinct control points");
            }
            (vec![*control1, *control2, *to], *to)
        }
        Segment::Nurbs {
            degree,
            control_points,
            knots,
            weights,
        } => {
            nurbs(
                errors,
                *degree,
                control_points.len() + 1,
                knots,
                weights.as_deref(),
                path,
            );
            let to = control_points.last().copied().unwrap_or(from);
            (control_points.clone(), to)
        }
    };
    if !coordinates(&points) {
        errors.push(path, "coordinates must be finite and within ±10⁷");
    }
    to
}

/// Checks a NURBS segment's numbers, with `n` control points including its start.
fn nurbs(
    errors: &mut Errors,
    degree: u32,
    n: usize,
    knots: &[f64],
    weights: Option<&[f64]>,
    path: &str,
) {
    let degree = degree as usize;
    if !(degree >= 1 && degree < n) {
        errors.push(
            format!("{path}/degree"),
            format!("degree must be at least 1 and below the number of control points, {n}"),
        );
        return;
    }
    let knots_path = format!("{path}/knots");
    if knots.len() != n + degree + 1 {
        errors.push(
            &knots_path,
            format!("expected {} knots, found {}", n + degree + 1, knots.len()),
        );
    } else if !(knots.iter().all(|k| k.is_finite()) && knots.windows(2).all(|w| w[0] <= w[1])) {
        errors.push(&knots_path, "knots must be finite and nondecreasing");
    } else {
        let (first, last) = (knots[0], knots[knots.len() - 1]);
        let interior = &knots[degree + 1..knots.len() - degree - 1];
        if !(first < last
            && knots[..=degree].iter().all(|k| *k == first)
            && knots[knots.len() - degree - 1..].iter().all(|k| *k == last)
            && interior.iter().all(|k| first < *k && *k < last))
        {
            errors.push(
                &knots_path,
                "the first and last knot must each be repeated exactly degree + 1 times",
            );
        } else if interior
            .chunk_by(|a, b| a == b)
            .any(|run| run.len() > degree)
        {
            errors.push(
                &knots_path,
                "no interior knot may be repeated more than degree times",
            );
        }
    }
    if let Some(weights) = weights {
        let path = format!("{path}/weights");
        if weights.len() != n {
            errors.push(
                &path,
                format!("expected {n} weights, found {}", weights.len()),
            );
        } else if !weights.iter().all(|w| w.is_finite() && *w > 0.0) {
            errors.push(&path, "weights must be finite and positive");
        }
    }
}
