#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/release/PiUsageMenuBar.app"
CONTENTS="$APP/Contents"

rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"

swiftc "$ROOT/native/PiUsageMenuBar.swift" \
  -O \
  -framework AppKit \
  -framework Foundation \
  -o "$CONTENTS/MacOS/PiUsageMenuBar"

cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Pi Usage</string>
  <key>CFBundleExecutable</key>
  <string>PiUsageMenuBar</string>
  <key>CFBundleIdentifier</key>
  <string>com.raingor.pi-usage-menubar</string>
  <key>CFBundleName</key>
  <string>Pi Usage</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSUIElement</key>
  <true/>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
</dict>
</plist>
PLIST

# Ad-hoc signing lets macOS launch the local app without requiring a paid
# Apple Developer certificate. Gatekeeper may still ask for confirmation.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo "Built: $APP"
echo "Run:   open \"$APP\""
