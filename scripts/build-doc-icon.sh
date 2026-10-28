#!/usr/bin/env bash
# Renders the .torrent document icon: icons/torrent.icns (macOS), torrent.ico (Windows), torrent/<size>.png (Linux).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=src-tauri/icons
TMP=$(mktemp -d)
python3 design/render-doc-icon.py "$OUT/torrent.png"
SET="$TMP/torrent.iconset"; mkdir -p "$SET"
for size in 16 32 128 256 512; do
  sips -z $size $size "$OUT/torrent.png" --out "$SET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$OUT/torrent.png" --out "$SET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$OUT/torrent.icns"
magick "$OUT/torrent.png" -define icon:auto-resize=256,64,48,32,16 "$OUT/torrent.ico"
# Linux: PNGs for the hicolor icon theme (see src-tauri/linux/torrent-mime.xml).
mkdir -p "$OUT/torrent"
for size in 16 24 32 48 64 128 256 512; do
  sips -z $size $size "$OUT/torrent.png" --out "$OUT/torrent/${size}.png" >/dev/null
done
rm -rf "$TMP"
echo "Wrote $OUT/torrent.icns, $OUT/torrent.ico and $OUT/torrent/*.png"
