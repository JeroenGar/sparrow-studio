//! The Sparrow Pro job format: the input a client submits, the solution live snapshots carry,
//! and the self-contained job document that records a job from input to outcome.
//!
//! Each schema version is a module. The specification is `docs/io_format.md`; the rustdoc on
//! these types restates it field by field.

pub mod v1;

#[cfg(feature = "openapi")]
pub mod openapi;
