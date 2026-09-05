#!/usr/bin/env python3
"""Package the local web application sources and runtime assets reproducibly."""
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile

WEB = Path(__file__).resolve().parents[1]
ROOT = WEB.parent
ARCHIVE = WEB / 'public/sparrow-source.zip'


def source_files():
    files = [ROOT / 'LICENSE']
    files += sorted((ROOT / 'notes').glob('*.md'))
    files += [WEB / name for name in (
        'README.md', 'package.json', 'package-lock.json', 'index.html', 'bridge.html',
        'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts',
        'wasm/Cargo.toml', 'wasm/Cargo.lock')]
    for directory in ('src', 'wasm/src', 'scripts', 'public'):
        files += [path for path in (WEB / directory).rglob('*')
                  if path.is_file() and path != ARCHIVE
                  and '__pycache__' not in path.parts and path.name != '.DS_Store']
    return sorted(set(files), key=lambda path: path.relative_to(ROOT).as_posix())


def archive_bytes():
    contents = {path.relative_to(ROOT).as_posix(): path.read_bytes() for path in source_files()}
    manifest = {
        'description': 'Exact local web application source and runtime assets. No generated WASM, dependencies, tests or build outputs. Install locked dependencies and follow web/README.md to rebuild.',
        'files': {name: hashlib.sha256(content).hexdigest() for name, content in contents.items()},
    }
    contents['SOURCE-MANIFEST.json'] = (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(contents.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return output.getvalue(), len(contents)


if __name__ == '__main__':
    data, count = archive_bytes()
    if '--check' in sys.argv:
        if not ARCHIVE.exists() or ARCHIVE.read_bytes() != data:
            raise SystemExit('Source archive is stale. Run python3 scripts/package-source.py.')
    else:
        ARCHIVE.write_bytes(data)
    print(f'{count} source/archive entries, {len(data)} bytes, SHA-256 {hashlib.sha256(data).hexdigest()}')
