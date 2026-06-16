#!/usr/bin/env bash
# Creates a double-clickable "Recap.app" launcher (default: on the Desktop) that starts the
# app with one click — no terminal needed. It's a thin wrapper that runs the project, so it
# stays reliable (full shell env, native diarization addon, claude/node all resolve).
set -euo pipefail
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$HOME/Desktop/Recap.app}"

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# App icon (generate it if missing).
[ -f "$PROJECT/assets/icon.icns" ] || bash "$PROJECT/scripts/make-icon.sh"
cp "$PROJECT/assets/icon.icns" "$APP/Contents/Resources/icon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Recap</string>
  <key>CFBundleDisplayName</key><string>Recap</string>
  <key>CFBundleIdentifier</key><string>com.ayush.recap.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleExecutable</key><string>Recap</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/Recap" <<LAUNCH
#!/bin/zsh
# Ensure node / npm / claude resolve when launched from Finder (no login shell).
export PATH="\$HOME/.local/opt/node-current/bin:\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "$PROJECT" || exit 1
[ -d node_modules ] || npm install
[ -f "src/renderer/public/models/Xenova/whisper-base.en/onnx/decoder_model_merged.onnx" ] || npm run setup-models
exec npm run dev
LAUNCH

chmod +x "$APP/Contents/MacOS/Recap"
echo "✓ Created $APP — double-click it (or drag to your Dock) to launch Recap."

# Also drop a .command fallback (opens Terminal; works on double-click in any session).
CMD="$(dirname "$APP")/Launch Recap.command"
cat > "$CMD" <<CMDEOF
#!/bin/zsh
cd "$PROJECT" || exit 1
[ -d node_modules ] || npm install
[ -f "src/renderer/public/models/Xenova/whisper-base.en/onnx/decoder_model_merged.onnx" ] || npm run setup-models
npm run dev
CMDEOF
chmod +x "$CMD"
echo "✓ Created $CMD — double-click fallback if the app icon doesn't open."
