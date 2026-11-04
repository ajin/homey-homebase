#!/bin/sh
# Render the Homebase app images from the SVG sources in this folder (needs Google Chrome).
# Usage: sh tools/art/render.sh   (from the repo root)
set -e
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ART="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$ART/../.." && pwd)"
cp "$ART/icon.svg" "$ROOT/assets/icon.svg"
for size in small:250:175 large:500:350 xlarge:1000:700; do
  name=${size%%:*}; wh=${size#*:}; w=${wh%%:*}; h=${wh#*:}
  printf '<html><body style="margin:0"><img src="file://%s/store.svg" width="%s" height="%s" style="display:block"></body></html>' "$ART" "$w" "$h" > "$ART/.page.html"
  "$C" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --screenshot="$ROOT/assets/images/$name.png" --window-size="$w,$h" "file://$ART/.page.html" 2>/dev/null
done
rm -f "$ART/.page.html"
