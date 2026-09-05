Vendored from JeroenGar/sparrow commit 120cf937de5e74c292406bc9947276c9dd49217f.

Studio changes only src/sample/uniform_sampler.rs: a zero-width translation range is a valid fixed coordinate. Reversed ranges remain invalid; ordinary ranges keep their existing distribution. This enables exact material fits without changing input geometry or adding padding. Remove this vendored copy when the fix is available in a pinned upstream release.
