"""Renders the flat app icon. Usage: python3 design/render-icon.py src-tauri/app-icon.png

Then regenerate platform icons: bunx tauri icon src-tauri/app-icon.png
"""
import math
import sys

from PIL import Image, ImageChops, ImageDraw

SS = 4  # supersampling factor for anti-aliased edges
W = 1024 * SS

TILE = (255, 255, 255, 255)    # white tile
EDGE = (222, 227, 238, 255)    # hairline so the white tile stays visible on light backgrounds
GLYPH = (47, 91, 234)          # brand blue arrow, tray and ring
# Ring parts get solid tints (no transparency) so the icon stays flat on any background.
PART_TINTS = [1.0, 0.72, 0.48, 0.28]


def s(v):
    return int(round(v * SS))


def tint(t):
    """Solid colour between the white tile (t=0) and brand blue (t=1)."""
    return tuple(int(TILE[i] + (GLYPH[i] - TILE[i]) * t) for i in range(3)) + (255,)


def main(out):
    canvas = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)

    # Tile on the macOS icon grid: 824px body inside the 1024 canvas.
    d.rounded_rectangle((s(100), s(100), s(924), s(924)), s(185), fill=TILE, outline=EDGE, width=s(5))

    # Segmented ring: four parts, a nod to multi-connection downloads.
    cx, cy, r, sw = 512, 492, 262, 34
    parts = [(-82, -22), (26, 68), (112, 154), (198, 256)]  # degrees, 0 = 3 o'clock, clockwise
    for (a0, a1), t in zip(parts, PART_TINTS):
        layer = Image.new('L', (W, W), 0)
        ld = ImageDraw.Draw(layer)
        ld.arc((s(cx - r), s(cy - r), s(cx + r), s(cy + r)), a0, a1, fill=255, width=s(sw))
        for a in (a0, a1):  # round caps
            rad = math.radians(a)
            px = cx + (r - sw / 2) * math.cos(rad)
            py = cy + (r - sw / 2) * math.sin(rad)
            ld.ellipse((s(px - sw / 2), s(py - sw / 2), s(px + sw / 2), s(py + sw / 2)), fill=255)
        canvas.paste(Image.new('RGBA', (W, W), tint(t)), (0, 0), layer)

    # Arrow and tray.
    aw = 58

    def stroke(p, q):
        d.line((s(p[0]), s(p[1]), s(q[0]), s(q[1])), fill=GLYPH, width=s(aw))
        for x, y in (p, q):
            d.ellipse((s(x - aw / 2), s(y - aw / 2), s(x + aw / 2), s(y + aw / 2)), fill=GLYPH)

    stroke((512, 352), (512, 582))
    stroke((412, 492), (512, 592))
    stroke((612, 492), (512, 592))
    d.rounded_rectangle((s(402), s(652), s(622), s(696)), s(22), fill=GLYPH)

    canvas.resize((1024, 1024), Image.LANCZOS).save(out)


if __name__ == '__main__':
    main(sys.argv[1])
