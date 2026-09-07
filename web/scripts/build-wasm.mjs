import { mkdtempSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Isolate Cargo from ancestor configuration. Sparrow's portable SIMD kernel
// needs nightly; only the shared-memory build rebuilds std with atomics.
const cwd = mkdtempSync(join(tmpdir(), 'sparrow-build-'));
try {
  builds: for (const simd of [true, false]) for (const threaded of [false, true]) {
    const outDir = `pkg${threaded ? '-threads' : ''}${simd ? '' : '-nosimd'}`;
    const features = [threaded && 'threads', simd && 'sparrow/simd'].filter(Boolean);
    const args = ['build', fileURLToPath(new URL('../wasm', import.meta.url)),
      '--target', 'web', '--release', '--out-dir', outDir, '--locked'];
    if (features.length) args.push('--features', features.join(','));
    if (threaded) args.push('-Z', 'build-std=panic_abort,std');
    const result = spawnSync('wasm-pack', args, {
      cwd, stdio: 'inherit', env: { ...process.env,
        RUSTUP_TOOLCHAIN: 'nightly-2026-08-30',
        CARGO_ENCODED_RUSTFLAGS: threaded ? [
          '-C', `target-feature=${simd ? '+' : '-'}simd128,+atomics,+bulk-memory,+mutable-globals`,
          '-C', 'link-arg=--shared-memory', '-C', 'link-arg=--max-memory=1073741824',
          '-C', 'link-arg=--import-memory',
          '-C', 'link-arg=--export=__wasm_init_tls', '-C', 'link-arg=--export=__tls_size',
          '-C', 'link-arg=--export=__tls_align', '-C', 'link-arg=--export=__tls_base',
        ].join('\x1f') : `-Ctarget-feature=${simd ? '+' : '-'}simd128`,
      },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break builds; }
    if (threaded) {
      const snippets = fileURLToPath(new URL(`../wasm/${outDir}/snippets`, import.meta.url));
      const rayon = readdirSync(snippets).filter(name => name.startsWith('wasm-bindgen-rayon-'));
      if (rayon.length !== 1) throw new Error('Expected one pinned wasm-bindgen-rayon helper.');
      copyFileSync(fileURLToPath(new URL('./rayon-helpers.js', import.meta.url)), join(snippets, rayon[0], 'src/workerHelpers.js'));
    }
  }
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
