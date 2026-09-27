#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="$ROOT/build"
APP="$BUILD/TSE.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RES="$CONTENTS/Resources"

rm -rf "$BUILD"
mkdir -p "$MACOS" "$RES/Web"

SDK="$(xcrun --sdk macosx --show-sdk-path)"
xcrun swiftc \
  "$ROOT/Sources/main.swift" \
  -O \
  -swift-version 5 \
  -target arm64-apple-macos13.0 \
  -sdk "$SDK" \
  -framework AppKit \
  -framework WebKit \
  -o "$MACOS/TSE"

cp "$ROOT/Info.plist" "$CONTENTS/Info.plist"
cp "$ROOT/Resources/Web/index.html" "$RES/Web/index.html"
cp "$ROOT/Resources/Web/style.css" "$RES/Web/style.css"
cp "$ROOT/Resources/Web/app.js" "$RES/Web/app.js"
if [[ -f "$ROOT/LICENSE-TSE.txt" ]]; then cp "$ROOT/LICENSE-TSE.txt" "$RES/LICENSE-TSE.txt"; fi

/usr/bin/codesign --force --deep --sign - "$APP"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP" "$BUILD/TSE-macOS-arm64.zip"

echo "Built: $BUILD/TSE-macOS-arm64.zip"
