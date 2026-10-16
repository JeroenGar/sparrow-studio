//! Schema version 1.
//!
//! - Coordinates: x to the right, y up, without unit. Separations use the same unit and areas its
//!   square. Coordinates and lengths lie within ±10⁷.
//! - Angles: degrees, counterclockwise.
//! - IDs: strings of 1 to 128 characters, compared exactly, unique within their list.
//! - Paths: JSON Pointers into the [`Input`], such as `/problem/sheets/0/defects/2`.
//! - Order: array order in the input is significant.
//! - The input is read strictly: unknown fields, explicit `null`s, and duplicate keys are
//!   rejected, also where the input appears inside a job document, so a reader of a job document
//!   must be at least as new as its writer. Unknown diagnostic kinds, termination reasons, and
//!   error codes are read as `Unknown`. Clients of the API read its responses tolerantly, through
//!   its OpenAPI specification.

mod document;
mod geometry;
mod input;
mod validate;

pub use document::*;
pub use geometry::*;
pub use input::*;
pub use validate::*;

/// The schema version of this module.
pub const SCHEMA_VERSION: u32 = 1;
