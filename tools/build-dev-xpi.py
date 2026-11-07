"""Build a deterministic development XPI from an explicit source allowlist."""
from pathlib import Path
import hashlib
import io
import json
import zipfile
import subprocess
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--release', action='store_true', help='Build the manually installed plugin package')
args = parser.parse_args()

root = Path(__file__).resolve().parent.parent
files = {"manifest.json": "addon/manifest.json", "bootstrap.js": "addon/bootstrap.js",
         "src/main.js": "addon/src/main.js", "src/scroll-sync.js": "addon/src/scroll-sync.js", "src/zoom-sync.js": "addon/src/zoom-sync.js", "src/manual-import.js": "addon/src/manual-import.js", "LICENSE": "LICENSE", "NOTICE.md": "NOTICE.md"}
manifest = json.loads((root / files["manifest.json"]).read_text(encoding="utf-8"))
if manifest["applications"]["zotero"]["id"] != "doubao-translate@local.invalid":
    raise SystemExit("Unexpected development add-on ID")
if args.release:
    files['bootstrap.js'] = 'addon/bootstrap-release.js'
    manifest['name'] = 'PDF 译文对照阅读'
    manifest['description'] = '手动导入译文 PDF，保留原文批注，支持对照阅读与滚动和缩放同步。'
outdir = root / "dist"
if outdir.is_symlink() or (outdir.exists() and outdir.resolve() != outdir):
    raise SystemExit("Refuse a redirected output directory")
outdir.mkdir(exist_ok=True)
for relative in files.values():
    if relative.endswith('.js'):
        subprocess.run(['node','--check',str(root / relative)],check=True,capture_output=True)
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for name, relative in files.items():
        source = root / relative
        if source.is_symlink() or not source.resolve().is_relative_to(root):
            raise SystemExit("Refuse a redirected source")
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        data = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8') if args.release and name == 'manifest.json' else source.read_bytes()
        archive.writestr(info, data)
payload = buffer.getvalue()
digest = hashlib.sha256(payload).hexdigest()
output = outdir / (f"zotero-pdf-compare-{manifest['version']}.xpi" if args.release else "doubao-translate-dev-" + digest[:16] + ".xpi")
if output.is_symlink():
    raise SystemExit("Refuse a redirected output file")
if output.exists():
    if hashlib.sha256(output.read_bytes()).hexdigest() != digest:
        raise SystemExit("Existing build fingerprint mismatch")
else:
    with output.open("xb") as stream:
        stream.write(payload)
build = {"file": str(output), "filename": output.name, "version": manifest["version"],
         "entries": len(files), "bytes": len(payload), "sha256": digest}
marker = outdir / ("current-release-build.json" if args.release else "current-dev-build.json")
if marker.is_symlink():
    raise SystemExit("Refuse a redirected build marker")
marker.write_text(json.dumps(build, indent=2) + "\n", encoding="utf-8")
with zipfile.ZipFile(output) as archive:
    assert set(archive.namelist()) == set(files)
    assert archive.testzip() is None
print(json.dumps(build, indent=2))
