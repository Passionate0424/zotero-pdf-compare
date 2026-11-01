"""Validate an owned, closed-test snapshot and open a restored DB copy read-only."""
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
runtime = root / "runtime"
snapshot = Path(sys.argv[1]).resolve()
if not snapshot.is_relative_to((runtime / "backups").resolve()):
    raise SystemExit("Snapshot must be in the project backup directory")
manifest = json.loads((snapshot / "snapshot-manifest.json").read_text(encoding="utf-8"))
for item in manifest["files"]:
    file = (snapshot / item["path"]).resolve()
    if not file.is_relative_to(snapshot):
        raise SystemExit("Snapshot manifest escaped its directory")
    if file.stat().st_size != item["bytes"] or hashlib.sha256(file.read_bytes()).hexdigest() != item["sha256"]:
        raise SystemExit(f"Snapshot mismatch: {item['path']}")
restore_base = runtime / "restore-check"
restore_base.mkdir(exist_ok=True)
restore = Path(tempfile.mkdtemp(prefix="p0-", dir=restore_base))
shutil.copytree(snapshot / "data", restore / "data", symlinks=False)
restored_count = 0
for item in manifest["files"]:
    relative = Path(item["path"])
    if relative.parts[0] != "data":
        continue
    restored = restore / relative
    if hashlib.sha256(restored.read_bytes()).hexdigest() != item["sha256"]:
        raise SystemExit("Restored file mismatch")
    restored_count += 1
db = restore / "data/zotero.sqlite"
with sqlite3.connect(db.as_uri() + "?mode=ro", uri=True) as connection:
    integrity = connection.execute("PRAGMA quick_check").fetchall()
    item_count = connection.execute("SELECT COUNT(*) FROM items").fetchone()[0]
if integrity != [("ok",)] or item_count != 0:
    raise SystemExit("Restored empty library validation failed")
result = {
    "passed": True, "snapshot": str(snapshot), "restoreCopy": str(restore),
    "snapshotFilesVerified": len(manifest["files"]), "restoredDataFilesVerified": restored_count,
    "databaseQuickCheck": "ok", "itemCount": item_count,
    "scope": "P0 empty library copy integrity; P5 must test full app restore with real annotations",
}
(runtime / "snapshot-verification.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result))
