#!/usr/bin/env python3
"""找出截圖目錄中位元組相同或像素相同的 PNG。

用法：
    python3 scripts/screenshots/check-duplicates.py [目錄 ...]

未指定目錄時檢查 docs/screenshots。可同時傳入新拍攝的目錄與
docs/screenshots，在 commit 前確認新圖沒有重複既有的截圖。
發現重複時以結束碼 1 結束；需要 Pillow。
"""

import hashlib
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image


def pngs(roots):
    # 根目錄可能互相包含（例如新拍攝目錄位於 docs/screenshots 之下），以實際路徑去重
    seen = set()
    for root in roots:
        for path in sorted(Path(root).rglob("*.png")):
            real = path.resolve()
            if real not in seen:
                seen.add(real)
                yield path


def groups(paths, key):
    buckets = defaultdict(list)
    for path in paths:
        buckets[key(path)].append(path)
    return [group for group in buckets.values() if len(group) > 1]


def file_digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pixel_digest(path):
    # 解碼後比較像素，抓出編碼不同但畫面完全相同的檔案
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        return rgba.size, hashlib.sha256(rgba.tobytes()).hexdigest()


def main(argv):
    roots = argv or ["docs/screenshots"]
    paths = list(pngs(roots))
    byte_groups = groups(paths, file_digest)
    # 位元組相同的組只留第一張參與像素比較，避免同一組重複回報
    seen = {path for group in byte_groups for path in group[1:]}
    pixel_groups = groups([p for p in paths if p not in seen], pixel_digest)
    for label, found in (("byte-identical", byte_groups), ("pixel-identical", pixel_groups)):
        for group in found:
            print(label)
            for path in group:
                print(f"  {path}")
    print(f"checked {len(paths)} PNG files, {len(byte_groups) + len(pixel_groups)} duplicate groups")
    return 1 if byte_groups or pixel_groups else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
