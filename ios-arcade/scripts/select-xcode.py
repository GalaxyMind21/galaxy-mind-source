"""Print the newest /Applications/Xcode_<version>.app, or nothing.

macOS BSD sort has no -V, so the version tuple is compared here.
A runner with only the default Xcode.app keeps whatever xcode-select already points at.
"""

from __future__ import annotations

import os
import re


def main() -> None:
    root = "/Applications"
    if not os.path.isdir(root):
        return
    apps = []
    for name in os.listdir(root):
        match = re.fullmatch(r"Xcode_(\d+(?:\.\d+)*)\.app", name)
        if match:
            apps.append((tuple(int(part) for part in match.group(1).split(".")), name))
    if not apps:
        return
    apps.sort()
    print(os.path.join(root, apps[-1][1]))


if __name__ == "__main__":
    main()
