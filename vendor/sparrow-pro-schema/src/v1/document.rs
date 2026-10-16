use super::{Input, Placement};
use serde::{Deserialize, Serialize};

/// The self-contained record of a job, from input to outcome. It holds the job's own data only:
/// credits, timestamps, and the job's ID belong to the API's job resource.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
pub struct JobDocument {
    /// [`SCHEMA_VERSION`](super::SCHEMA_VERSION).
    pub schema_version: u32,
    /// The input as submitted.
    pub input: Input,
    pub settings: Settings,
    /// Present once the job has started.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run: Option<Run>,
    pub state: State,
    /// Present only for a completed job.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<Outcome>,
}

/// How the solver ran on the input, including the values the service chose.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
pub struct Settings {
    /// The maximum solver time, in whole seconds.
    pub time_limit_seconds: u32,
    /// Whether the search ended early once it stopped improving.
    pub auto_termination: bool,
    /// The random seed, from 0 to 2⁵³ − 1.
    #[cfg_attr(feature = "openapi", schemars(range(max = 9_007_199_254_740_991_u64)))]
    pub seed: u64,
    pub on_input_error: OnInputError,
}

/// What happens to input that cannot be used as given.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum OnInputError {
    /// Used with a fallback and reported as a [`Diagnostic`].
    #[default]
    Fallback,
    /// The job fails instead, with `invalid_job_input` and the errors listed.
    Fail,
}

/// How the job runs, known from its start.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
pub struct Run {
    pub engine: Engine,
    pub threads: u32,
}

/// What the search did, so that the same input, settings, threads, and build repeat it exactly.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
pub struct Replay {
    pub exploration_attempts: u64,
    pub compression_attempts: u64,
}

/// The engine that ran a job.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
pub struct Engine {
    pub version: String,
    /// Identifies the exact build.
    pub build_id: String,
}

/// Where a job stands.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum State {
    Queued,
    Running,
    Completed {
        termination: Termination,
        fulfillment: Fulfillment,
        /// Solver time used, from the start of import, in whole seconds rounded up.
        solver_seconds: u32,
    },
    /// Only a queued job is cancelled.
    Cancelled,
    Failed {
        error: JobError,
        /// Solver time used, as for a completed job; absent for a job that never started.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        solver_seconds: Option<u32>,
    },
}

/// What ended the search.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", schemars(transform = crate::openapi::open_enum))]
pub enum Termination {
    TimeLimit,
    AutoTerminated,
    Stopped,
    #[serde(other)]
    Unknown,
}

/// Whether all demand was placed.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum Fulfillment {
    Complete,
    /// Some demand is [unplaced](Outcome::unplaced).
    Partial,
}

/// Why a job failed, in the shape of an API error.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
pub struct JobError {
    #[serde(flatten)]
    pub code: JobErrorCode,
    /// For people; it may change.
    pub message: String,
    /// The JSON Pointer of the field at fault, if any, within the request body.
    #[cfg_attr(feature = "openapi", schemars(extend("x-always-sent" = true)))]
    pub param: Option<String>,
    /// Explains the code.
    #[cfg_attr(feature = "openapi", schemars(extend("x-always-sent" = true)))]
    pub doc_url: Option<String>,
}

/// What made a job fail, machine-readable and stable, with what belongs to it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(tag = "code", rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", schemars(transform = crate::openapi::open_tagged))]
pub enum JobErrorCode {
    /// The worker's import refused the input: with [`OnInputError::Fail`], a fallback would have
    /// been needed. The errors found, at least one, each tied to a field.
    InvalidJobInput { field_errors: Vec<FieldError> },
    /// The search ended before it found any feasible solution.
    NoFeasibleSolution {
        /// What ended the search.
        termination: Termination,
    },
    /// The time limit ran out during import, before any search.
    ImportTimeout,
    /// The worker stopped responding.
    WorkerLost,
    /// The job could not be run, such as one not started within 24 hours.
    InternalError,
    #[serde(other)]
    Unknown,
}

impl JobError {
    /// The public error for `code`, with its message, the first field error's path as `param`,
    /// and its documentation link.
    pub fn new(code: JobErrorCode) -> Self {
        let message = match &code {
            JobErrorCode::InvalidJobInput { .. } => {
                "The input cannot be used as given, and the job asked to fail instead of taking \
                 a fallback."
            }
            JobErrorCode::NoFeasibleSolution { .. } => {
                "The search ended before it found a feasible solution."
            }
            JobErrorCode::ImportTimeout => {
                "The time limit ran out during import, before any search."
            }
            JobErrorCode::WorkerLost => {
                "The worker running the job stopped responding; the job is not retried."
            }
            JobErrorCode::InternalError => "The service failed while running this job.",
            JobErrorCode::Unknown => "The job failed.",
        };
        let param = match &code {
            JobErrorCode::InvalidJobInput { field_errors } => {
                field_errors.first().map(|error| error.param.clone())
            }
            JobErrorCode::NoFeasibleSolution { .. }
            | JobErrorCode::ImportTimeout
            | JobErrorCode::WorkerLost
            | JobErrorCode::InternalError
            | JobErrorCode::Unknown => None,
        };
        let doc_url = format!("https://sparrownesting.com/docs/errors#{}", code.as_str());
        JobError {
            code,
            message: message.to_owned(),
            param,
            doc_url: Some(doc_url),
        }
    }
}

impl JobErrorCode {
    /// The code as it appears in JSON.
    pub fn as_str(&self) -> &'static str {
        match self {
            JobErrorCode::InvalidJobInput { .. } => "invalid_job_input",
            JobErrorCode::NoFeasibleSolution { .. } => "no_feasible_solution",
            JobErrorCode::ImportTimeout => "import_timeout",
            JobErrorCode::WorkerLost => "worker_lost",
            JobErrorCode::InternalError => "internal_error",
            JobErrorCode::Unknown => "unknown",
        }
    }
}

/// An error in one field of invalid input.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
pub struct FieldError {
    /// The JSON Pointer of the field at fault.
    pub param: String,
    pub message: String,
}

/// The result of a completed job.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
pub struct Outcome {
    pub solution: Solution,
    pub stats: Stats,
    /// Per part with copies not placed. For every part, its quantity equals its placed copies,
    /// locked ones included, plus its unplaced copies.
    pub unplaced: Vec<Unplaced>,
    /// The fallbacks the import took.
    pub diagnostics: Vec<Diagnostic>,
    pub replay: Replay,
}

/// The placements per opened sheet; live snapshots carry solutions.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
pub struct Solution {
    /// One layout per opened sheet, in the order the sheets are used.
    pub layouts: Vec<Layout>,
}

/// The placements on one opened sheet. Sheets of one entry repeat its `sheet_id`; their order
/// tells them apart. A layout that completes a locked layout starts with its placements,
/// unchanged and in their input order.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
pub struct Layout {
    pub sheet_id: String,
    pub placements: Vec<Placement>,
}

/// Statistics in total; [`Stats::layouts`] has them per layout.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
pub struct Stats {
    pub consumed_area: f64,
    pub placed_area: f64,
    pub density: f64,
    pub layouts: Vec<LayoutStats>,
}

/// Statistics of one layout.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
pub struct LayoutStats {
    /// Where the last opened sheet is cut, as an x coordinate in the sheet's own coordinates: the
    /// parts lie left of it, the boundary separation included. `None` for the sheets before the
    /// last, which are used in full.
    #[cfg_attr(feature = "openapi", schemars(extend("x-always-sent" = true)))]
    pub cut_x: Option<f64>,
    /// The sheet's material in use: the area of its outline left of `cut_x`, minus the area its
    /// holes cover, with defects counted as consumed.
    pub consumed_area: f64,
    /// The material area of the placed parts, locked ones included.
    pub placed_area: f64,
    /// `placed_area / consumed_area`; 0 when `consumed_area` is 0.
    pub density: f64,
}

/// Copies of a part that were not placed.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
pub struct Unplaced {
    pub part_id: String,
    pub quantity: u32,
}

/// A fallback the import took. With [`OnInputError::Fail`], any of them fails the job instead.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "openapi", derive(schemars::JsonSchema))]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", schemars(transform = crate::openapi::open_tagged))]
pub enum Diagnostic {
    /// The search found no placement for the part on any empty sheet; its movable copies are
    /// left unplaced. It means none was found, not that none exists.
    NoValidPlacement { part_id: String, quantity: u32 },
    /// A locked placement reaches outside its sheet, overlaps another locked placement, a sheet
    /// hole, or a defect, or comes closer to them than the separations allow; it is kept as given.
    /// `path` points to the placement in the input.
    LockedPlacementConflict { path: String },
    /// A hole of the part's geometry reaches outside its outer contour, overlaps another hole, or
    /// splits the part into pieces; it is ignored, so the part is solid there. `hole_index`
    /// indexes the geometry's holes.
    HoleIgnored { part_id: String, hole_index: u32 },
    /// The boundary separation lay between 0 and half the parts' separation and was raised to
    /// half of it.
    BoundarySeparationRaised { requested: f64, used: f64 },
    #[serde(other)]
    Unknown,
}
