#!/usr/bin/env python3
"""Regenerate static notices from installed locked packages and pinned license sources."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

WEB = Path(__file__).resolve().parents[1]
SOURCES = WEB / 'scripts/license-sources'
PUBLIC = WEB / 'public'


def output(path, content):
    if '--check' in sys.argv:
        if not path.exists() or path.read_bytes() != content:
            raise RuntimeError(f'Stale notices: run python3 scripts/generate-notices.py ({path.name})')
    else:
        path.write_bytes(content)


def run(*args):
    return subprocess.check_output(args, cwd=tempfile.gettempdir(),
                                   env={**os.environ, 'CARGO_ENCODED_RUSTFLAGS': ''}, text=True)


def license_files(root):
    return sorted(p for p in root.iterdir() if p.is_file()
                  and re.match(r'(?i)^(licen[cs]e|copying|copyright|notice)(?:$|[-.])', p.name))


texts = {}
entries = []


def entry(label, license_name, source, documents, extra=''):
    if not documents:
        raise RuntimeError(f'No license text found for {label}')
    refs = []
    for origin, content in documents:
        if not content.strip():
            raise RuntimeError(f'Empty license: {origin}')
        digest = hashlib.sha256(content.encode()).hexdigest()
        texts[digest] = content
        refs.append(f'  {origin}\n  Text SHA-256: {digest}')
    entries.append(f'{label}\nDeclared license: {license_name}\nSource: {source}\n'
                   + (extra + '\n' if extra else '') + '\n'.join(refs))


lock = json.loads((WEB / 'package-lock.json').read_text())
npm_count = 0
for relative, package in sorted(lock['packages'].items()):
    if not relative or package.get('dev'):
        continue
    root = WEB / relative
    installed = json.loads((root / 'package.json').read_text())
    assert installed['version'] == package['version'], f'Run npm ci: {relative}'
    docs = [(p.name, p.read_text()) for p in license_files(root)]
    if installed['name'] == 'splaytree' and not docs:
        docs = [('Readme.md, License section', (root / 'Readme.md').read_text().split('## License\n', 1)[1])]
    repository = installed.get('repository', '')
    if isinstance(repository, dict):
        repository = repository.get('url', '')
    entry(f"npm {installed['name']} {installed['version']}", installed['license'],
          package['resolved'], docs, f'Repository: {repository}\nIntegrity: {package["integrity"]}')
    npm_count += 1

metadata = json.loads(run('cargo', '+stable', 'metadata', '--manifest-path',
                         str(WEB / 'wasm/Cargo.toml'), '--locked', '--format-version', '1',
                         '--filter-platform', 'wasm32-unknown-unknown', '--features', 'threads'))
resolved = {node['id'] for node in metadata['resolve']['nodes']}
fallbacks = json.loads((SOURCES / 'sources.json').read_text())
rust_count = 0
for package in sorted(metadata['packages'], key=lambda p: (p['name'], p['version'])):
    if package['id'] not in resolved or package['name'] == 'sparrow-web':
        continue
    root = Path(package['manifest_path']).parent
    docs = [(p.name, p.read_text()) for p in license_files(root)]
    for fallback in fallbacks:
        if (fallback['package'], fallback['version']) == (package['name'], package['version']):
            content = (SOURCES / fallback['file']).read_bytes()
            assert hashlib.sha256(content).hexdigest() == fallback['sha256'], fallback['file']
            docs.append((fallback['url'], content.decode()))
    source = package['source']
    if source is None:
        assert root.parent == WEB / 'wasm/vendor', f'Unexpected local dependency: {root}'
        source = f'https://github.com/JeroenGar/sparrow-studio/tree/main/web/wasm/vendor/{package["name"]} (upstream provenance and changes: STUDIO_PATCH.md)'
    if source.startswith('registry+'):
        source = f"https://crates.io/api/v1/crates/{package['name']}/{package['version']}/download"
    extra = f"Repository: {package.get('repository') or 'not declared'}\nAuthors: {', '.join(package['authors']) or 'not declared'}"
    vcs = root / '.cargo_vcs_info.json'
    if vcs.exists():
        extra += '\nPackage VCS metadata: ' + json.dumps(json.loads(vcs.read_text()), sort_keys=True)
    if package['name'] == 'wasm_sync':
        extra += ('\nThis package declares MIT OR Apache-2.0 but includes no license file. '
                  'Its exact upstream commit also contains none. Apache-2.0 terms are reproduced '
                  'from apache.org; no package copyright notice has been invented.')
    license_name = package['license']
    if package['name'] == 'sparrow':
        license_name = 'MIT (from the pinned repository LICENSE; Cargo omits this field)'
    entry(f"Rust {package['name']} {package['version']}", license_name, source, docs, extra)
    rust_count += 1

# Rust publishes the library's own dependency notices with each installed toolchain.
toolchains = []
for toolchain in ['stable', 'nightly-2026-08-30']:
    root = Path(run('rustc', '+' + toolchain, '--print', 'sysroot').strip())
    version = run('rustc', '+' + toolchain, '-Vv').strip()
    content = (root / 'share/doc/rust/COPYRIGHT-library.html').read_bytes()
    filename = f'RUST-LIBRARY-{toolchain}.html'
    output(PUBLIC / filename, content)
    toolchains.append(f'{version}\nLibrary notices: {filename}\nSHA-256: {hashlib.sha256(content).hexdigest()}')

header = f'''sparrow web prototype: third-party notices

Generated by scripts/generate-notices.py. Do not edit this file manually.
Includes all {npm_count} production npm packages from package-lock.json and a
conservative superset of {rust_count} packages resolved by Cargo.lock for the
wasm32 target with the threads feature, including build/proc-macro dependencies.
This is not a claim that every listed package contributes bytes to every bundle.
Full license texts below are deduplicated by SHA-256; each package references its
original file or exact source URL. Declared dual-license choices are preserved.

Rust standard-library notices are distributed alongside this file. See the
toolchain section below. Dataset provenance and license: examples/NOTICE.txt.

jagua-rs 0.8.1 is MPL-2.0. Its upstream source is available at:
https://github.com/JeroenGar/jagua-rs/tree/824ab31cf8a58eecf5d87527260c92510626661b/jagua-rs
https://crates.io/api/v1/crates/jagua-rs/0.8.1/download
The modified jagua-rs source is available in the public sparrow-studio repository
under web/wasm/vendor/jagua-rs, with changes documented in STUDIO_PATCH.md. The
MPL text is included below. The solver sparrow is MIT at its pinned revision;
it is distinct from the original sparroWASM wrapper repository's MPL license.
The corresponding web application, WASM bridge and patched solver sources are
available at:
https://github.com/JeroenGar/sparrow-studio
Upstream dependencies are identified by the exact source references above/below.

PACKAGE INDEX
'''
body = header + '\n\n'.join(entries) + '\n\nRUST TOOLCHAINS\n\n' + '\n\n'.join(toolchains)
body += '\n\nFULL LICENSE TEXTS\n'
for digest, content in sorted(texts.items()):
    body += f'\n===== SHA-256 {digest} =====\n{content}\n'
output(PUBLIC / 'THIRD_PARTY_NOTICES.txt', body.encode())
print(f'{npm_count} npm packages, {rust_count} Rust packages, {len(texts)} distinct license texts; Rust library notices copied.')
