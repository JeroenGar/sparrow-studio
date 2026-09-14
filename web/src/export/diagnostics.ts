import type {Diagnostics} from '../workers/useSolver';
import type {ZipEntry} from '../zip';
import wrapper from '../../wasm/src/lib.rs?raw';
import manifest from '../../wasm/Cargo.toml?raw';
import buildScript from '../../scripts/build-wasm.mjs?raw';
import lockfile from '../../wasm/Cargo.lock?raw';

export function reproductionFiles(diagnostics:Diagnostics|undefined):ZipEntry[] {
  const attempts=diagnostics?.attempts??[];
  return [
    {name:'reproduction/README.txt',data:`These files capture the actual solver invocation, not the current edited project.
${attempts.length?'Each attempt includes native Sparrow input, seed, wrapper arguments and the resolved Rust configuration.':'No solver invocation was captured in this session. A loaded project does not restore a previous run history.'}
Use the pinned Sparrow revision and dependencies in Cargo.toml/Cargo.lock, and the attached Studio wrapper source.
The stock Sparrow CLI does not expose all Studio settings. Simply passing input.json to it is not an equivalent run.
Importer uses the resolved Sparrow defaults for polygon simplification and narrow-concavity removal, plus the requested clearance.
Seed: decimal u64, Xoshiro256PlusPlus::seed_from_u64. Keep it as a string when reading JSON.
Normal attempts call optimize with the exploration and compression configs and no initial solution.
Skip interrupts exploration through the terminator, then optimize transitions to compression with its existing state and RNG. It requires shared memory; it does not restart the runtime.
Automatic mode ignores phase timeouts; timed mode applies the resolved phase budgets. Manual Stop terminates workers immediately; diagnostics.json records elapsed time, phase transitions and stop reason.
The native input contains outer footprints only. Original holes and copy identity mapping remain in the Studio project in diagnostics.json under runDocument.
Exact bitwise replay is not guaranteed across WASM/native, CPU/SIMD implementations, worker scheduling, wall-clock limits, or manual Stop/Skip timing. This archive reproduces inputs and configuration, not the scheduling history.
`},
    ...attempts.flatMap((attempt,index)=>{
      const {input,configuration,...request}=attempt;
      const prefix=`reproduction/attempt-${index+1}/`;
      return [
        {name:prefix+'input.json',data:input},
        {name:prefix+'request.json',data:JSON.stringify(request,null,2)},
        {name:prefix+'effective-config.txt',data:configuration??'Configuration was not resolved before the run failed.'},
      ];
    }),
    {name:'reproduction/studio-wrapper.rs',data:wrapper},
    {name:'reproduction/Cargo.toml',data:manifest},
    {name:'reproduction/Cargo.lock',data:lockfile},
    {name:'reproduction/build-wasm.mjs',data:buildScript},
  ];
}
