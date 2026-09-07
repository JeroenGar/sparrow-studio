// Run after building the native benchmark example and WASM benchmark packages.
// Usage: node scripts/benchmark-wasm.mjs bench-scalar > results.json
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const packages = process.argv.slice(2);
assert(packages.length > 0, 'Supply benchmark package directory names under wasm/target.');
const separations = Number(process.env.BENCH_SEPARATIONS || 109);
const datasets = (process.env.BENCH_DATASETS || 'swim').split(',');
const seeds = (process.env.BENCH_SEEDS || '42,42,42').split(',').map(Number);
const server = createServer((request, response) => {
  const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { response.writeHead(403).end(); return; }
  try {
    response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    response.end(readFileSync(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
function record(result) {
  results.push(result);
  if (process.env.BENCH_OUTPUT) writeFileSync(process.env.BENCH_OUTPUT, JSON.stringify({ separations, results }, null, 2));
}
const comparable = r => ({ evaluations: r.evaluations, reports: r.reports,
  trace: r.separationTrace, bits: r.placementBits, widthBits: r.widthBits,
  layout: r.solution.layout, width: r.solution.strip_width, density: r.solution.density });

const native = process.env.BENCH_NATIVE_BINARY || resolve(root, 'wasm/target/release/examples/benchmark');
try {
  for (const dataset of datasets) {
    const path = resolve(root, `public/examples/${dataset}.json`);
    for (const seed of seeds) {
      const result = JSON.parse(execFileSync(native, [path, String(seed), String(separations)]));
      const reference = results.find(r => r.runtime === 'native' && r.dataset === dataset && r.seed === seed);
      if (reference) assert.deepStrictEqual(comparable(result), comparable(reference));
      record({ runtime: 'native', dataset, seed, ...result });
      console.error('native', dataset, seed, Math.round(result.elapsedMs), 'ms');
    }
  }
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.goto(origin + '/bridge.html');
      for (const pkg of packages) {
        await page.evaluate(async pkg => {
          window.bench = await import(`/wasm/target/${pkg}/sparrow_web.js`);
          await window.bench.default();
        }, pkg);
        // Exclude one warm-up from measurements; compilation/startup is separate.
        await page.evaluate(async () => window.bench.benchmark(await (await fetch('/public/examples/swim.json')).text(), 42, 2));
        for (const dataset of datasets) {
          for (const seed of seeds) {
            const result = await page.evaluate(async ({ dataset, seed, separations }) => {
              const input = await (await fetch(`/public/examples/${dataset}.json`)).text();
              return JSON.parse(window.bench.benchmark(input, seed, separations));
            }, { dataset, seed, separations });
            assert(result.evaluations > 0 && result.solution.strip_width > 0);
            const reference = results.find(r => r.runtime === 'native' && r.dataset === dataset && r.seed === seed);
            assert.deepStrictEqual(comparable(result), comparable(reference), `${name}/${pkg}: native and WASM performed different work`);
            record({ runtime: name, version: browser.version(), pkg, dataset, seed, ...result });
            console.error(name, pkg, dataset, seed, Math.round(result.elapsedMs), 'ms');
          }
        }
      }
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({ separations, results }, null, 2));
} finally { server.close(); }
