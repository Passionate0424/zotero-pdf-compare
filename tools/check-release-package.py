"""Check the actual release archive and its published metadata."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
meta = json.loads((root / 'dist/current-release-build.json').read_text(encoding='utf-8'))
package = root / 'dist' / meta['filename']
assert package.name == f"zotero-pdf-compare-{meta['version']}.xpi"
assert hashlib.sha256(package.read_bytes()).hexdigest() == meta['sha256']
expected = {'manifest.json', 'bootstrap.js', 'src/main.js', 'src/scroll-sync.js',
            'src/zoom-sync.js', 'src/manual-import.js', 'LICENSE', 'NOTICE.md'}
with zipfile.ZipFile(package) as archive:
    assert set(archive.namelist()) == expected
    assert archive.testzip() is None
    manifest = json.loads(archive.read('manifest.json'))
    assert manifest['name'] == 'PDF 译文对照阅读'
    assert manifest['version'] == meta['version'] == json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    assert 'expectedProfile' not in archive.read('bootstrap.js').decode('utf-8')
    assert all(archive.read(name) == (root / 'addon' / name).read_bytes() for name in expected if name.startswith('src/'))
updates = json.loads((root / 'dist/updates.json').read_text(encoding='utf-8'))
update = updates['addons'][manifest['applications']['zotero']['id']]['updates'][0]
assert update['version'] == meta['version']
assert update['update_link'].endswith(f"/v{meta['version']}/{package.name}")
assert (root / 'dist' / (package.name + '.sha256')).read_text(encoding='utf-8').split()[0] == meta['sha256']
print(f"Verified {package.name}: 8 entries, version, checksum, reader sources and update metadata")
