"""Build a test-only XPI into the owned development profile, never the default profile."""
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
config = json.loads((root / "runtime/environment.local.json").read_text(encoding="utf-8-sig"))
if config["projectId"] != "zotero-doubao-translate-dev-v1":
    raise SystemExit("Unknown development environment")
profile = Path(config["profile"])
expected = root / "runtime/zotero-profile"
if profile.resolve() != expected or profile != expected:
    raise SystemExit("Refusing unexpected profile or link")
for parent in (expected, *expected.parents):
    if parent.is_symlink() or (hasattr(parent, "is_junction") and parent.is_junction()):
        raise SystemExit("Refusing linked profile ancestor")
target = profile / "extensions/doubao-dev-probe@local.invalid.xpi"
target.parent.mkdir(exist_ok=True)
if target.is_symlink():
    raise SystemExit("Refusing linked XPI target")
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in ("manifest.json", "bootstrap.js"):
        archive.write(root / "tools/probe-addon" / name, name)
print(json.dumps({"probe": str(target), "files": 2, "mode": "xpi"}))
