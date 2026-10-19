"""asc_key.write_private must create the key file owner-only from the start.

CodeQL review 2026-10: write_bytes() then chmod() left the key at the umask
default for a moment. This pins the replacement: mode 0600 even under a
permissive umask, a stale file is replaced, and a planted symlink is never
followed. Uses a throwaway test value, never a real key.
"""

from __future__ import annotations

import os
import stat
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from asc_key import write_private  # noqa: E402

DATA = b"-----BEGIN PRIVATE KEY-----\ntest-only\n-----END PRIVATE KEY-----\n"


def mode_of(path: Path) -> int:
    return stat.S_IMODE(os.lstat(path).st_mode)


def main() -> None:
    old_umask = os.umask(0o000)  # most permissive: a plain open would make 0666
    try:
        with tempfile.TemporaryDirectory() as tmp:
            key = Path(tmp) / "AuthKey_TEST.p8"
            write_private(key, DATA)
            if mode_of(key) != 0o600:
                raise SystemExit(f"key file mode is {oct(mode_of(key))}, want 0o600")
            if key.read_bytes() != DATA:
                raise SystemExit("key file contents differ")

            # A stale, world-readable file from an earlier step is replaced.
            key.chmod(0o644)
            write_private(key, DATA)
            if mode_of(key) != 0o600:
                raise SystemExit("stale key file was not recreated at 0600")

            # A symlink planted at the path is removed, not followed.
            target = Path(tmp) / "elsewhere"
            target.write_bytes(b"untouched")
            key.unlink()
            key.symlink_to(target)
            write_private(key, DATA)
            if key.is_symlink():
                raise SystemExit("write_private wrote through a symlink")
            if target.read_bytes() != b"untouched":
                raise SystemExit("symlink target was modified")
            if mode_of(key) != 0o600:
                raise SystemExit("replaced key file is not 0600")
    finally:
        os.umask(old_umask)
    print("asc key file: created 0600, stale file replaced, symlink not followed")


if __name__ == "__main__":
    main()
