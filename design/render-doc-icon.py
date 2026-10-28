"""Renders the flat .torrent document icon (macOS Finder file icon).

Usage: python3 design/render-doc-icon.py src-tauri/icons/torrent.png
Then build the .icns: see scripts/build-doc-icon.sh
"""
import math
import sys

from PIL import Image, ImageDraw, ImageFont

SS = 4
W = 1024 * SS

BLUE = (47, 91, 234, 255)       # same brand blue as the app icon
PAGE = (255, 255, 255, 255)
FOLD = (220, 227, 245, 255)
EDGE = (205, 212, 228, 255)
LABEL_FONT = '/System/Library/Fonts/SFNS.ttf'
FALLBACK_FONT = '/System/Library/Fonts/HelveticaNeue.ttc'


def s(v):
    return int(round(v * SS))


def tint(t):
    """Solid colour between white (t=0) and brand blue (t=1)."""
    return tuple(int(255 + (BLUE[i] - 255) * t) for i in range(3)) + (255,)


def main(out):
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Page on the macOS document grid: ~ 3:4 portrait, folded top-right corner.
    x0, y0, x1, y1, r, fold = 192, 100, 832, 924, 56, 190
    page = [
        (s(x0 + r), s(y0)), (s(x1 - fold), s(y0)), (s(x1), s(y0 + fold)),
        (s(x1), s(y1 - r)), (s(x1 - r), s(y1)), (s(x0 + r), s(y1)),
        (s(x0), s(y1 - r)), (s(x0), s(y0 + r)),
    ]
    # Outline drawn as a slightly larger page underneath, then the page itself.
    edge = Image.new('L', (W, W), 0)
    ed = ImageDraw.Draw(edge)
    ed.polygon(page, fill=255)
    for cx, cy in ((x0 + r, y0 + r), (x1 - r, y1 - r), (x0 + r, y1 - r)):
        ed.ellipse((s(cx - r), s(cy - r), s(cx + r), s(cy + r)), fill=255)
    ed.rectangle((s(x0), s(y0 + r), s(x0 + r), s(y1 - r)), fill=255)
    ed.rectangle((s(x0 + r), s(y1 - r), s(x1 - r), s(y1)), fill=255)
    grown = edge.resize((W, W))
    border = Image.new('RGBA', (W, W), EDGE)
    # 6px border: paste edge colour on a dilated mask, then the white page on the original mask.
    from PIL import ImageFilter
    dilated = grown.filter(ImageFilter.MaxFilter(s(6) | 1))
    img.paste(border, (0, 0), dilated)
    img.paste(Image.new('RGBA', (W, W), PAGE), (0, 0), grown)

    # Folded corner.
    d.polygon([(s(x1 - fold), s(y0)), (s(x1 - fold), s(y0 + fold - 24)),
               (s(x1 - fold + 24), s(y0 + fold)), (s(x1), s(y0 + fold))], fill=FOLD)
    d.line([(s(x1 - fold), s(y0)), (s(x1), s(y0 + fold))], fill=EDGE, width=s(6))

    # Glyph: the app's segmented ring + arrow, in brand blue.
    cx, cy, rr, sw = 512, 470, 170, 26
    parts = [(-82, -22), (26, 68), (112, 154), (198, 256)]
    for (a0, a1), t in zip(parts, [1.0, 0.8, 0.58, 0.36]):
        layer = Image.new('L', (W, W), 0)
        ld = ImageDraw.Draw(layer)
        ld.arc((s(cx - rr), s(cy - rr), s(cx + rr), s(cy + rr)), a0, a1, fill=255, width=s(sw))
        for a in (a0, a1):
            rad = math.radians(a)
            px, py = cx + (rr - sw / 2) * math.cos(rad), cy + (rr - sw / 2) * math.sin(rad)
            ld.ellipse((s(px - sw / 2), s(py - sw / 2), s(px + sw / 2), s(py + sw / 2)), fill=255)
        img.paste(Image.new('RGBA', (W, W), tint(t)), (0, 0), layer)

    aw = 40

    def stroke(p, q):
        d.line((s(p[0]), s(p[1]), s(q[0]), s(q[1])), fill=BLUE, width=s(aw))
        for x, y in (p, q):
            d.ellipse((s(x - aw / 2), s(y - aw / 2), s(x + aw / 2), s(y + aw / 2)), fill=BLUE)

    stroke((512, 378), (512, 528))
    stroke((447, 468), (512, 533))
    stroke((577, 468), (512, 533))
    d.rounded_rectangle((s(440), s(573), s(584), s(603)), s(15), fill=BLUE)

    # Extension label pill.
    try:
        font = ImageFont.truetype(LABEL_FONT, s(84))
        font.set_variation_by_name('Bold')
    except Exception:
        font = ImageFont.truetype(FALLBACK_FONT, s(84), index=1)
    text = 'TORRENT'
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad_x, pad_y = 44, 26
    px0 = 512 - tw / SS / 2 - pad_x
    py0 = 712
    d.rounded_rectangle((s(px0), s(py0), s(1024 - px0), s(py0 + th / SS + pad_y * 2)), s(26), fill=BLUE)
    d.text((s(512) - tw / 2 - bbox[0], s(py0 + pad_y) - bbox[1]), text, font=font, fill=(255, 255, 255, 255))

    img.resize((1024, 1024), Image.LANCZOS).save(out)


if __name__ == '__main__':
    main(sys.argv[1])
