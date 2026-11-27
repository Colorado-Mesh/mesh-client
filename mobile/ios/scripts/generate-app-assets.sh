#!/usr/bin/env bash
# Regenerates the iOS AppIcon and launch Splash images from the desktop icon under resources/.
# Requires ImageMagick 7 (`magick`). Run from anywhere; writes into mobile/ios/App/App/Assets.xcassets.
#
# AppIcon: the macOS render (resources/icons/mac/iconset/icon_1024x1024@1x.png) is cropped past its
# glass rim and rounded corners, scaled back to 1024 px and flattened over the same top-to-bottom
# gradient (iOS icons must be opaque squares; the system applies the corner mask).
# Splash: slate #0f172a (the app background) with the rounded icon centred.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
src="$root/resources/icons/mac/iconset/icon_1024x1024@1x.png"
assets="$root/mobile/ios/App/App/Assets.xcassets"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

magick -size 1024x1024 gradient:'rgb(16,24,40)'-'rgb(2,72,139)' "$work/gradient.png"
magick "$src" -crop 896x896+64+64 +repage -resize 1024x1024 "$work/crop.png"
magick "$work/gradient.png" "$work/crop.png" -compose over -composite -alpha off -strip \
  "PNG24:$assets/AppIcon.appiconset/AppIcon-1024.png"

magick -size 1024x1024 xc:black -fill white -draw 'roundrectangle 0,0,1023,1023,229,229' "$work/mask.png"
magick "$assets/AppIcon.appiconset/AppIcon-1024.png" "$work/mask.png" -alpha off \
  -compose copy-opacity -composite -resize 400x400 "$work/rounded.png"
magick -size 2732x2732 'xc:#0f172a' "$work/rounded.png" -gravity center -compose over -composite \
  -alpha off -strip "PNG24:$work/splash.png"
for name in splash-2732x2732.png splash-2732x2732-1.png splash-2732x2732-2.png; do
  cp "$work/splash.png" "$assets/Splash.imageset/$name"
done
echo "Wrote AppIcon-1024.png and Splash images to $assets"
