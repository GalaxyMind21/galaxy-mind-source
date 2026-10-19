"""Normalize an App Store Connect .p8 into a canonical PEM private key.

Accepts a PEM (BOM, CRLF, literal \\n, spaces, or junk around the markers),
base64 of that PEM, or the bare PKCS#8 body with no BEGIN/END lines.
Failure text is lengths and booleans only.
"""

from __future__ import annotations

import base64
import os
import re
import sys
from pathlib import Path

HEADER = "-----BEGIN PRIVATE KEY-----"
FOOTER = "-----END PRIVATE KEY-----"
MARKER_RE = re.compile(
    r"-{5}\s*BEGIN\s+PRIVATE\s+KEY\s*-{5}(.*?)-{5}\s*END\s+PRIVATE\s+KEY\s*-{5}",
    re.DOTALL,
)


class AscKeyFormatError(Exception):
    pass


def _unescape(text: str) -> str:
    return text.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "\n")


def _bom(text: str) -> bool:
    if text.startswith("\ufeff"):
        return True
    return text.lstrip(" \t\r\n").startswith("\ufeff")


def _drop_bom(text: str) -> str:
    if text.startswith("\ufeff"):
        return text[1:]
    i = 0
    while i < len(text) and text[i] in " \t\r\n":
        i += 1
    if text.startswith("\ufeff", i):
        return text[:i] + text[i + 1 :]
    return text


def _prepare(text: str) -> str:
    return _unescape(_drop_bom(text))


def _alphabet(body: str) -> str:
    return re.sub(r"[^A-Za-z0-9+/=]", "", body).replace("=", "")


def _bool(value: bool) -> str:
    return "true" if value else "false"


def _diag(original: str, body: str, decoded_utf8: bool, der: bool) -> str:
    searched = _prepare(original)
    alphabet = _alphabet(body)
    parts = [
        f"len={len(original)}",
        f"bom={_bool(_bom(original))}",
        f"has_begin={_bool(HEADER in searched)}",
        f"has_end={_bool(FOOTER in searched)}",
        f"has_begin_words={_bool('BEGIN PRIVATE KEY' in searched)}",
        f"has_end_words={_bool('END PRIVATE KEY' in searched)}",
        f"decoded_utf8={_bool(decoded_utf8)}",
        f"body_len={len(alphabet)}",
        f"mod4={len(alphabet) % 4}",
        f"der={_bool(der)}",
    ]
    return "ASC key PEM unusable " + " ".join(parts)


def _b64_error(secret: str, raw: str) -> str:
    return (
        "ASC_KEY_P8 is not valid base64 "
        f"len={len(secret)} body_len={len(raw)} mod4={len(raw) % 4}"
    )


def _asn1_header_size(data: bytes):
    if len(data) < 2 or data[0] != 0x30:
        return None
    n = data[1]
    if n < 0x80:
        return 2
    nbytes = n & 0x7F
    if nbytes == 0 or nbytes > 3 or len(data) < 2 + nbytes:
        return None
    return 2 + nbytes


def _asn1_total(data: bytes):
    header = _asn1_header_size(data)
    if header is None or len(data) < 2:
        return None
    n = data[1]
    if n < 0x80:
        return 2 + n
    nbytes = n & 0x7F
    length = int.from_bytes(data[2 : 2 + nbytes], "big")
    return header + length


def _is_pkcs8_der(data: bytes) -> bool:
    if len(data) < 8 or data[0] != 0x30:
        return False
    header = _asn1_header_size(data)
    total = _asn1_total(data)
    if header is None or total != len(data):
        return False
    if header + 2 >= len(data):
        return False
    return data[header] == 0x02 and data[header + 1] == 1 and data[header + 2] == 0x00


def _wrap(der: bytes) -> str:
    body = base64.b64encode(der).decode("ascii")
    lines = [body[i : i + 64] for i in range(0, len(body), 64)]
    return HEADER + "\n" + "\n".join(lines) + "\n" + FOOTER + "\n"


def _decode_body(original: str, body: str) -> bytes:
    raw = _alphabet(body)
    if not raw or len(raw) % 4 == 1:
        raise AscKeyFormatError(_diag(original, body, True, False))
    padded = raw + "=" * ((-len(raw)) % 4)
    try:
        decoded = base64.b64decode(padded, validate=True)
    except Exception:
        raise AscKeyFormatError(_diag(original, body, True, False))
    if not decoded:
        raise AscKeyFormatError("ASC key file is empty")
    if not _is_pkcs8_der(decoded):
        raise AscKeyFormatError(_diag(original, body, True, False))
    return decoded


def _canonical_pem(secret: str) -> str:
    searched = _prepare(secret)
    match = MARKER_RE.search(searched)
    if not match:
        raise AscKeyFormatError(_diag(secret, "", True, False))
    return _wrap(_decode_body(secret, match.group(1)))


def _looks_like_pem(text: str) -> bool:
    searched = _prepare(text)
    return MARKER_RE.search(searched) is not None or "BEGIN PRIVATE KEY" in searched


def normalize(secret: str):
    if not isinstance(secret, str):
        secret = "" if secret is None else str(secret)
    if secret.strip(" \t\r\n\ufeff") == "":
        raise AscKeyFormatError("ASC_KEY_P8 is empty")
    if _looks_like_pem(secret):
        return _canonical_pem(secret), "pem"
    raw = _alphabet(secret)
    if not raw or len(raw) % 4 == 1:
        raise AscKeyFormatError(_b64_error(secret, raw))
    padded = raw + "=" * ((-len(raw)) % 4)
    try:
        decoded = base64.b64decode(padded, validate=True)
    except Exception:
        raise AscKeyFormatError(_b64_error(secret, raw))
    if not decoded:
        raise AscKeyFormatError("ASC key file is empty")
    try:
        text = decoded.decode("utf-8")
        utf8 = True
    except Exception:
        text = ""
        utf8 = False
    if utf8 and _looks_like_pem(text):
        return _canonical_pem(text), "base64"
    if _is_pkcs8_der(decoded):
        return _wrap(decoded), "der"
    raise AscKeyFormatError(_diag(secret, raw, utf8, False))


def write_private(path: Path, data: bytes) -> None:
    """Write a key file that is owner-only (0600) from the moment it exists.

    write_bytes() then chmod() leaves the file at the umask default (often
    0644) between the two calls. os.open with the mode creates it 0600, and
    O_EXCL refuses to follow a pre-planted file or symlink at that path. A
    stale key from an earlier step on the same runner is removed first.
    """
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
    try:
        os.fchmod(fd, 0o600)  # umask can only narrow the mode; make it exact
        view = memoryview(data)
        while view:
            n = os.write(fd, view)
            view = view[n:]
    finally:
        os.close(fd)


def main() -> None:
    missing = [
        name
        for name in ("ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_P8", "APPLE_TEAM_ID")
        if not os.environ.get(name, "").strip()
    ]
    if missing:
        raise SystemExit("missing " + missing[0])
    key_id = os.environ["ASC_KEY_ID"].strip()
    if not re.fullmatch(r"[A-Za-z0-9]+", key_id):
        raise SystemExit("ASC_KEY_ID is not a key id")
    runner = os.environ.get("RUNNER_TEMP", "").strip()
    if not runner:
        raise SystemExit("missing RUNNER_TEMP")
    try:
        pem, kind = normalize(os.environ["ASC_KEY_P8"])
    except AscKeyFormatError as exc:
        raise SystemExit(str(exc))
    path = Path(runner) / f"AuthKey_{key_id}.p8"
    write_private(path, pem.encode("ascii"))
    written = path.read_bytes()
    if not written or not written.startswith(HEADER.encode("ascii")):
        raise SystemExit("ASC key file is empty")
    print("ASC key format: " + kind)


if __name__ == "__main__":
    main()
