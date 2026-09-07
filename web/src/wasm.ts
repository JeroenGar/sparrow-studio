// Validate a tiny module using SIMD before downloading a solver binary.
export const supportsSIMD = WebAssembly.validate(new Uint8Array([
  0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11,
]));
export const loadSerialWasm = () => supportsSIMD
  ? import('../wasm/pkg/sparrow_web') : import('../wasm/pkg-nosimd/sparrow_web');
export const loadThreadedWasm = () => supportsSIMD
  ? import('../wasm/pkg-threads/sparrow_web') : import('../wasm/pkg-threads-nosimd/sparrow_web');
export type SolverBinary = 'serial-simd' | 'threaded-simd' | 'serial-nosimd' | 'threaded-nosimd';
