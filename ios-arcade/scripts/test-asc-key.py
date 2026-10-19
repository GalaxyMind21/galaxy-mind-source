"""The ASC key normalizer must rebuild one PEM from every paste shape.

Generated EC P-256 only. openssl pkey -noout has to accept each success,
and a failure message must not contain the key.
"""

from __future__ import annotations

import base64
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from asc_key import HEADER, AscKeyFormatError, normalize  # noqa: E402


def openssl_ok(pem: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "key.pem"
        path.write_text(pem, encoding="ascii")
        result = subprocess.run(
            ["openssl", "pkey", "-in", str(path), "-noout"],
            capture_output=True,
        )
        if result.returncode != 0:
            raise SystemExit("openssl rejected a normalized test key")


def ruby_normalize(secret: str):
    script = r"""
require_relative "fastlane/asc_key"
secret = STDIN.binmode.read
begin
  pem, kind = AscKey.normalize(secret)
  STDOUT.binmode.write(kind + "\n" + pem)
rescue AscKey::FormatError => e
  STDOUT.write(e.message)
  exit 1
end
"""
    result = subprocess.run(
        ["ruby", "-e", script],
        input=secret.encode("utf-8"),
        cwd=ROOT,
        capture_output=True,
    )
    text = result.stdout.decode("utf-8")
    if result.returncode == 0:
        kind, pem = text.split("\n", 1)
        return pem, kind
    if result.returncode != 1:
        raise SystemExit("ruby normalizer crashed")
    raise AscKeyFormatError(text)


def both(secret: str):
    py = normalize(secret)
    rb = ruby_normalize(secret)
    if py != rb:
        raise SystemExit("python and ruby normalizers diverged")
    return py


def fails(secret: str) -> str:
    py_msg = None
    try:
        normalize(secret)
    except AscKeyFormatError as exc:
        py_msg = str(exc)
    if py_msg is None:
        raise SystemExit("python accepted a key that should fail")
    try:
        ruby_normalize(secret)
    except AscKeyFormatError as exc:
        rb_msg = str(exc)
    else:
        raise SystemExit("ruby accepted a key that should fail")
    if py_msg != rb_msg:
        raise SystemExit("python and ruby error text diverged")
    return py_msg


def assert_clean(message: str, *needles: str) -> None:
    for needle in needles:
        if needle and needle in message:
            raise SystemExit("key material leaked into an error")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        pem_path = Path(tmp) / "ec.pem"
        subprocess.run(
            [
                "openssl",
                "genpkey",
                "-algorithm",
                "EC",
                "-pkeyopt",
                "ec_paramgen_curve:P-256",
                "-out",
                str(pem_path),
            ],
            check=True,
            capture_output=True,
        )
        clean = pem_path.read_text(encoding="ascii")
        if not clean.startswith(HEADER):
            raise SystemExit("openssl did not emit a PKCS#8 PEM")
        der = subprocess.run(
            ["openssl", "pkcs8", "-topk8", "-nocrypt", "-in", str(pem_path), "-outform", "DER"],
            check=True,
            capture_output=True,
        ).stdout

    body = "".join(clean.splitlines()[1:-1])
    token = "ZZMARKERZZ12345"
    cases = {
        "clean": clean,
        "crlf": clean.replace("\n", "\r\n"),
        "bom": "\ufeff" + clean,
        "spaces": "  \n" + clean + "  \n",
        "collapsed": " ".join(clean.splitlines()),
        "literal-n": clean.replace("\n", "\\n"),
        "no-final-nl": clean.rstrip("\n"),
        "spaced-header": clean.replace("BEGIN PRIVATE KEY", "BEGIN  PRIVATE  KEY", 1),
        "leading-junk": "note\n" + clean,
        "base64-pem": base64.b64encode(clean.encode("ascii")).decode("ascii"),
        "base64-percent": base64.b64encode(clean.encode("ascii")).decode("ascii") + "%",
        "der-body": body,
        "der-body-wrapped": "\n".join(body[i : i + 64] for i in range(0, len(body), 64)) + "\n%",
        "der-bytes": base64.b64encode(der).decode("ascii"),
    }

    canonical = None
    for name, secret in cases.items():
        pem, kind = both(secret)
        openssl_ok(pem)
        if canonical is None:
            canonical = pem
        elif pem != canonical:
            raise SystemExit(f"{name} did not rebuild the same PEM")
        if name.startswith("base64"):
            expect = "base64"
        elif name.startswith("der"):
            expect = "der"
        else:
            expect = "pem"
        if kind != expect:
            raise SystemExit(f"{name} kind was {kind}")

    leaked = body[:24]
    empty = fails("")
    if empty != "ASC_KEY_P8 is empty":
        raise SystemExit("empty secret message drifted")
    no_markers = fails(token + "not-a-pem")
    assert_clean(no_markers, token, leaked)
    if not no_markers.startswith("ASC key PEM unusable ") or "der=false" not in no_markers:
        raise SystemExit("junk secret was not rejected")
    bare = fails("-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----\n")
    assert_clean(bare, "BEGIN PRIVATE KEY")
    if "body_len=" not in bare or "bom=" not in bare:
        raise SystemExit("missing-marker failure omitted lengths")
    random_der = fails(base64.b64encode(b"\x30\x03\x01\x02\x03").decode("ascii"))
    assert_clean(random_der, "AAE", "AQID")
    if "der=false" not in random_der:
        raise SystemExit("non-pkcs8 body was not rejected")

    with tempfile.TemporaryDirectory() as tmp:
        env = os.environ.copy()
        env.update(
            {
                "ASC_KEY_ID": "TESTKEY01",
                "ASC_ISSUER_ID": "test-issuer",
                "ASC_KEY_P8": "\ufeff" + clean.replace("\n", "\\n") + "%",
                "APPLE_TEAM_ID": "TEAMTEAM10",
                "RUNNER_TEMP": tmp,
            }
        )
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "asc_key.py")],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise SystemExit("key writer failed on a messy PEM")
        if result.stdout.strip() != "ASC key format: pem":
            raise SystemExit("key writer did not report pem")
        if "PRIVATE" in result.stdout or leaked in result.stdout or leaked in result.stderr:
            raise SystemExit("key writer printed key material")
        written = Path(tmp) / "AuthKey_TESTKEY01.p8"
        file_pem = written.read_text(encoding="ascii")
        if file_pem != canonical:
            raise SystemExit("key writer did not write the canonical PEM")
        openssl_ok(file_pem)
        if written.stat().st_mode & 0o077:
            raise SystemExit("key file is group or world readable")

    print("asc key normalizer ok")


if __name__ == "__main__":
    main()
