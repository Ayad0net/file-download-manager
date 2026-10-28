"""Renders the system tray / menu bar icons: a bold down-arrow into a tray.

Kept deliberately simpler than the app icon (no ring) so it stays crisp at 16-22px.

Usage: python3 design/render-tray-icon.py src-tauri/icons/tray

Writes:
  tray-template.png  44x44 black-on-transparent (macOS menu bar template: tinted by the system)
  tray.png           64x64 brand-blue glyph (Windows notification area, Linux tray)
"""
import os
import sys

from PIL import Image, ImageDraw

SS = 8
BLUE = (47, 91, 234)


def render(size, color):
    W = size * SS
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fill = color + (255,)

    def s(v):  # design units: 0..100 across the canvas
        return v / 100 * W

    sw = 15  # stroke width

    def stroke(p, q):
        d.line((s(p[0]), s(p[1]), s(q[0]), s(q[1])), fill=fill, width=round(s(sw)))
        for x, y in (p, q):
            d.ellipse((s(x - sw / 2), s(y - sw / 2), s(x + sw / 2), s(y + sw / 2)), fill=fill)

    # Arrow
    stroke((50, 12), (50, 60))
    stroke((26, 38), (50, 62))
    stroke((74, 38), (50, 62))
    # Tray: open-top box under the arrow
    stroke((12, 66), (12, 86))
    stroke((88, 66), (88, 86))
    stroke((12, 86), (88, 86))
    return img.resize((size, size), Image.LANCZOS)


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    render(44, (0, 0, 0)).save(os.path.join(out_dir, 'tray-template.png'))
    render(64, BLUE).save(os.path.join(out_dir, 'tray.png'))


if __name__ == '__main__':
    main(sys.argv[1])
