import { mkdtempSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Isolate Cargo from the original wrapper's ancestor configuration. The serial
// build stays on stable; only the shared-memory build rebuilds std with atomics.
const cwd = mkdtempSync(join(tmpdir(), 'sparrow-build-'));
try {
  for (const threaded of [false, true]) {
    const args = ['build', fileURLToPath(new URL('../wasm', import.meta.url)),
      '--target', 'web', '--release', '--out-dir', threaded ? 'pkg-threads' : 'pkg', '--locked'];
    if (threaded) args.push('--features', 'threads', '-Z', 'build-std=panic_abort,std');
    const result = spawnSync('wasm-pack', args, {
      cwd, stdio: 'inherit', env: { ...process.env,
        RUSTUP_TOOLCHAIN: threaded ? 'nightly-2026-08-30' : 'stable',
        CARGO_ENCODED_RUSTFLAGS: threaded ? [
          '-C', 'target-feature=+atomics,+bulk-memory,+mutable-globals',
          '-C', 'link-arg=--shared-memory', '-C', 'link-arg=--max-memory=1073741824',
          '-C', 'link-arg=--import-memory',
          '-C', 'link-arg=--export=__wasm_init_tls', '-C', 'link-arg=--export=__tls_size',
          '-C', 'link-arg=--export=__tls_align', '-C', 'link-arg=--export=__tls_base',
        ].join('\x1f') : '',
      },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
    if (threaded) {
      const snippets = fileURLToPath(new URL('../wasm/pkg-threads/snippets', import.meta.url));
      const rayon = readdirSync(snippets).filter(name => name.startsWith('wasm-bindgen-rayon-'));
      if (rayon.length !== 1) throw new Error('Expected one pinned wasm-bindgen-rayon helper.');
      copyFileSync(fileURLToPath(new URL('./rayon-helpers.js', import.meta.url)), join(snippets, rayon[0], 'src/workerHelpers.js'));
    }
  }
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
