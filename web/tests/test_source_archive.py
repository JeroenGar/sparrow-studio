"""Check deterministic archive metadata, source coverage and per-file hashes."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import zipfile

script = Path(__file__).resolve().parents[1] / 'scripts/package-source.py'
spec = importlib.util.spec_from_file_location('package_source', script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
data, count = module.archive_bytes()
assert data == module.archive_bytes()[0], 'Unchanged inputs must produce identical bytes'
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    names = archive.namelist()
    assert len(names) == count == len(set(names))
    assert names == sorted(names)
    for required in ('LICENSE', 'web/src/App.tsx', 'web/wasm/src/lib.rs',
                     'web/wasm/Cargo.lock', 'web/package-lock.json',
                     'web/scripts/build-wasm.mjs', 'web/scripts/package-source.py',
                     'web/public/isolation-worker.js', 'web/public/examples/catalog.json'):
        assert required in names, required
    forbidden = {'node_modules', 'target', 'dist', 'pkg', 'pkg-threads', 'test-results', 'tests', '__pycache__'}
    assert not any(forbidden.intersection(Path(name).parts) for name in names)
    assert 'web/public/sparrow-source.zip' not in names
    manifest = json.loads(archive.read('SOURCE-MANIFEST.json'))['files']
    assert set(manifest) == set(names) - {'SOURCE-MANIFEST.json'}
    for name, digest in manifest.items():
        assert hashlib.sha256(archive.read(name)).hexdigest() == digest, name
        assert archive.getinfo(name).date_time == (1980, 1, 1, 0, 0, 0)
print(f'Source archive checked: {count} entries; deterministic bytes and all hashes match.')
