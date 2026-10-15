# sparrow-pro-schema

The Sparrow Pro job format as Rust types: the input a client submits, the solution live updates carry, and the job document that records a job from input to outcome. Each schema version is a module, such as `v1`.

The format's specification is the job format document of Sparrow Pro; the rustdoc on these types restates it. The job API that carries it is described by `openapi.json`, which is vendored next to this crate.

## In sparrow-studio

This crate is maintained in the private sparrow-pro repository. Its copy in sparrow-studio's `vendor/` directory is generated: a workflow in sparrow-pro packages the crate and opens a pull request in sparrow-studio whenever it, or `openapi.json`, changes. Do not edit the copy; changes made there are overwritten by the next sync.

The crate depends only on serde. The `openapi` feature, which adds JSON Schema derives for generating `openapi.json`, is for sparrow-pro and stays off in studio.

## License

MIT.
