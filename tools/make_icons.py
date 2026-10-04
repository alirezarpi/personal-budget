"""Render the Monat app icon (the three-quarter ring from the notification design) as PNGs, stdlib only."""

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "web" / "icons"
BG = (0x1B, 0x19, 0x16)
INK = (0xF5, 0xF2, 0xEC)
TRACK_ALPHA = 0.3
SS = 4  # supersamples per axis


def render(size: int) -> bytes:
    c = size / 2
    r = size * 0.235
    half = size * 0.092 / 2
    rows = []
    for y in range(size):
        row = bytearray([0])  # filter type: none
        for x in range(size):
            ink = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    px = x + (sx + 0.5) / SS - c
                    py = y + (sy + 0.5) / SS - c
                    if abs(math.hypot(px, py) - r) <= half:
                        angle = math.degrees(math.atan2(px, -py)) % 360  # clockwise from 12 o'clock
                        ink += 1.0 if angle <= 270 else TRACK_ALPHA
            a = ink / (SS * SS)
            row += bytes(round(BG[i] + (INK[i] - BG[i]) * a) for i in range(3))
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in [("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)]:
        (OUT / name).write_bytes(render(size))
        print("wrote", OUT / name)
