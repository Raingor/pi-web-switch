#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

build_app() {
  local source="$1"
  local app="$2"
  local executable="$3"
  local display_name="$4"
  local bundle_id="$5"
  local app_path="$ROOT/release/$app.app"
  local contents="$app_path/Contents"

  rm -rf "$app_path"
  mkdir -p "$contents/MacOS" "$contents/Resources"

  swiftc "$ROOT/native/NativeUsageSupport.swift" "$ROOT/native/$source" \
    -O \
    -framework AppKit \
    -framework Foundation \
    -o "$contents/MacOS/$executable"

  cat > "$contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>$display_name</string>
  <key>CFBundleExecutable</key>
  <string>$executable</string>
  <key>CFBundleIdentifier</key>
  <string>$bundle_id</string>
  <key>CFBundleName</key>
  <string>$display_name</string>
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

  # Ad-hoc signing lets macOS launch the local app without a paid
  # Apple Developer certificate. Gatekeeper may still ask for confirmation.
  codesign --force --deep --sign - "$app_path" >/dev/null 2>&1 || true

  echo "Built: $app_path"
}

build_app "PiUsageMenuBar.swift" "PiUsageMenuBar" "PiUsageMenuBar" "Pi Usage" "com.raingor.pi-usage-menubar"
build_app "ChatGPTUsageMenuBar.swift" "ChatGPTUsageMenuBar" "ChatGPTUsageMenuBar" "ChatGPT Usage" "com.raingor.chatgpt-usage-menubar"
echo "Run:   open \"$ROOT/release/PiUsageMenuBar.app\" \"$ROOT/release/ChatGPTUsageMenuBar.app\""
