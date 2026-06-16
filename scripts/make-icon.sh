#!/usr/bin/env bash
# Generate the Recap app icon (assets/icon.icns) — dark squircle + coral soundwave.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets

python3 - <<'PY'
from PIL import Image, ImageDraw

S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

# Warm dark vertical gradient for the squircle fill.
grad = Image.new('RGB', (S, S))
gp = grad.load()
top, bot = (28, 16, 17), (8, 4, 5)
for y in range(S):
    t = y / (S - 1)
    gp_row = tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3))
    for x in range(S):
        gp[x, y] = gp_row

# Squircle mask (macOS-style inset rounded rect).
mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
m, r = 96, 200
md.rounded_rectangle([m, m, S - m, S - m], radius=r, fill=255)

icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
icon.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(icon)

# Soundwave: 7 rounded bars, tallest in the middle, coral with amber outers.
heights = [150, 300, 470, 580, 470, 300, 150]
coral, amber = (255, 90, 105, 255), (255, 157, 108, 255)
colors = [amber, coral, coral, coral, coral, coral, amber]
bw, gap = 64, 42
total = len(heights) * bw + (len(heights) - 1) * gap
x = (S - total) // 2
cy = S // 2
for h, c in zip(heights, colors):
    d.rounded_rectangle([x, cy - h // 2, x + bw, cy + h // 2], radius=bw // 2, fill=c)
    x += bw + gap

# Record dot, top-left of the wave group, for the "capture" cue.
d.ellipse([m + 70, m + 70, m + 134, m + 134], fill=(255, 90, 105, 255))

icon.save('assets/icon-1024.png')
print('wrote assets/icon-1024.png')
PY

# Build the .icns from the master PNG.
ICONSET="assets/Recap.iconset"
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
for sz in 16 32 128 256 512; do
  sips -z $sz $sz assets/icon-1024.png --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null
  sips -z $((sz*2)) $((sz*2)) assets/icon-1024.png --out "$ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o assets/icon.icns
rm -rf "$ICONSET"
echo "✓ assets/icon.icns"
