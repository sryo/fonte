#!/bin/bash
#
# Fonte — macOS Installer
#
# Bootstraps everything from scratch:
#   1. Homebrew (if missing)
#   2. Node.js (if missing)
#   3. Transmission (torrent backend)
#   4. Jackett (torrent indexer)
#   5. npm dependencies + build
#   6. Fonte.app (magnet: and .torrent file handler)
#   7. Write default settings with Jackett API key
#   8. LaunchAgent so the daemon auto-starts at login
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_SOURCE="$SCRIPT_DIR/Fonte.app"
APP_DEST="$HOME/Applications/Fonte.app"
CONFIG_DIR="$HOME/.fonte"

echo ""
echo "  █▀█ █   ▀█▀ █▀█ █▀▄ █▀▄ █▀▀ █▄ █ ▀█▀"
echo "  █▀█ █    █  █ █ █▀▄ █▀▄ █▀▀ █ ▀█  █"
echo "  ▀ ▀ ▀    ▀   ▀  ▀ ▀ ▀ ▀ ▀▀▀ ▀  ▀  ▀"
echo ""
echo "  macOS Installer"
echo ""

# ── Step 1: Homebrew ─────────────────────────────────────────────────────────

echo "[1/8] Checking Homebrew..."

if command -v brew &>/dev/null; then
    echo "  Homebrew already installed."
else
    echo "  Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    if [ -f /opt/homebrew/bin/brew ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -f /usr/local/bin/brew ]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi

    if ! command -v brew &>/dev/null; then
        echo "  Error: Homebrew installation failed."
        exit 1
    fi
    echo "  Homebrew installed."
fi

# ── Step 2: Node.js ──────────────────────────────────────────────────────────

echo ""
echo "[2/8] Checking Node.js..."

if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v)
    echo "  Node.js $NODE_VERSION already installed."
else
    echo "  Installing Node.js via Homebrew..."
    brew install node
    if ! command -v node &>/dev/null; then
        echo "  Error: Node.js installation failed."
        exit 1
    fi
    echo "  Node.js $(node -v) installed."
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "  Node.js 18+ required (found v$NODE_MAJOR). Upgrading..."
    brew upgrade node
fi

# ── Step 3: Transmission ─────────────────────────────────────────────────────

echo ""
echo "[3/8] Checking Transmission..."

if command -v transmission-daemon &>/dev/null; then
    echo "  Transmission already installed."
else
    echo "  Installing Transmission via Homebrew..."
    brew install transmission-cli
    echo "  Transmission installed."
fi

if ! pgrep -x transmission-da &>/dev/null; then
    echo "  Starting Transmission daemon..."
    brew services start transmission-cli 2>/dev/null
    sleep 3
    if pgrep -x transmission-da &>/dev/null; then
        echo "  Transmission running on port 9091."
    else
        echo "  Warning: Transmission failed to start. Run: brew services start transmission-cli"
    fi
else
    echo "  Transmission already running."
fi

# ── Step 4: Jackett ──────────────────────────────────────────────────────────

echo ""
echo "[4/8] Checking Jackett..."

if command -v jackett &>/dev/null || [ -f /opt/homebrew/bin/jackett ]; then
    echo "  Jackett already installed."
else
    echo "  Installing Jackett via Homebrew..."
    brew install jackett
    echo "  Jackett installed."
fi

if ! pgrep -x jackett &>/dev/null; then
    echo "  Starting Jackett..."
    brew services start jackett 2>/dev/null
    sleep 5
    if pgrep -x jackett &>/dev/null; then
        echo "  Jackett running on port 9117."
    else
        echo "  Warning: Jackett failed to start. Run: brew services start jackett"
    fi
else
    echo "  Jackett already running."
fi

# Read Jackett API key
JACKETT_API_KEY=""
for config_path in \
    "$HOME/Library/Application Support/Jackett/ServerConfig.json" \
    "/opt/homebrew/var/jackett/ServerConfig.json" \
    "$HOME/.config/Jackett/ServerConfig.json"; do
    if [ -f "$config_path" ]; then
        JACKETT_API_KEY=$(python3 -c "import json; print(json.load(open('$config_path')).get('APIKey',''))" 2>/dev/null)
        break
    fi
done

if [ -n "$JACKETT_API_KEY" ]; then
    echo "  Jackett API key: ${JACKETT_API_KEY:0:8}..."
    echo "  Configuring public indexers..."
    bash "$SCRIPT_DIR/scripts/setup-jackett-indexers.sh" "$JACKETT_API_KEY" 2>/dev/null
else
    echo "  Warning: Could not read Jackett API key. Configure manually in settings."
fi

# ── Step 5: Build Fonte ──────────────────────────────────────────────────

echo ""
echo "[5/8] Installing dependencies and building..."
cd "$SCRIPT_DIR"
npm install 2>&1 | tail -1
npm run build 2>&1 | tail -1
echo "  Built successfully."

# ── Step 6: Install Fonte.app ────────────────────────────────────────────

echo ""
echo "[6/8] Installing Fonte.app..."

if [ ! -d "$APP_SOURCE" ]; then
    echo "  Error: Fonte.app not found at $APP_SOURCE"
    exit 1
fi

mkdir -p "$HOME/Applications"
rm -rf "$APP_DEST"
cp -R "$APP_SOURCE" "$APP_DEST"
chmod +x "$APP_DEST/Contents/MacOS/fonte-handler"

/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_DEST"

mkdir -p "$CONFIG_DIR"
echo "$SCRIPT_DIR/packages/cli/bin/fonte.mjs" > "$CONFIG_DIR/cli-path"

echo "  Installed to $APP_DEST"

# ── Step 7: Write settings ───────────────────────────────────────────────────

echo ""
echo "[7/8] Writing settings..."

mkdir -p "$CONFIG_DIR/logs"
mkdir -p "$HOME/Downloads/fonte"

# Only write settings if they don't exist yet
if [ ! -f "$CONFIG_DIR/settings.json" ]; then
    cat > "$CONFIG_DIR/settings.json" <<EOF
{
  "workspace": {
    "path": "$HOME/fonte-workspace",
    "name": "Fonte"
  },
  "models": {
    "provider": "anthropic"
  },
  "agents": {
    "fonte": {
      "name": "Fonte Agent",
      "provider": "anthropic",
      "model": "sonnet",
      "working_directory": "$HOME/fonte-workspace/fonte"
    }
  },
  "torrent": {
    "download_dir": "$HOME/Downloads/fonte",
    "max_concurrent": 5,
    "max_download_speed": 0,
    "max_upload_speed": 0,
    "seed_ratio_limit": 2.0,
    "auto_start": true,
    "dht": true
  },
  "watchlist": {
    "enabled": true,
    "check_interval_minutes": 30,
    "auto_add": true,
    "preferred_quality": "1080p",
    "jackett_url": "http://localhost:9117",
    "jackett_api_key": "$JACKETT_API_KEY"
  },
  "subtitles": {
    "enabled": true,
    "auto_download": true,
    "translate": true,
    "target_languages": ["en", "es"]
  }
}
EOF
    echo "  Settings written to $CONFIG_DIR/settings.json"
else
    # Update Jackett API key if we found one and settings exist
    if [ -n "$JACKETT_API_KEY" ]; then
        python3 -c "
import json
with open('$CONFIG_DIR/settings.json') as f:
    s = json.load(f)
s.setdefault('watchlist', {})['jackett_api_key'] = '$JACKETT_API_KEY'
s.setdefault('watchlist', {})['jackett_url'] = 'http://localhost:9117'
with open('$CONFIG_DIR/settings.json', 'w') as f:
    json.dump(s, f, indent=2)
" 2>/dev/null && echo "  Updated Jackett API key in existing settings."
    fi
    echo "  Settings already exist, preserved."
fi

# ── Step 8: Auto-start LaunchAgent ───────────────────────────────────────────

echo ""
echo "[8/8] Configuring auto-start at login..."

NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
FONTE_BIN="$SCRIPT_DIR/packages/cli/bin/fonte.mjs"
DASHBOARD_DIR="$SCRIPT_DIR/dashboard"
DAEMON_PLIST="$HOME/Library/LaunchAgents/com.fonte.daemon.plist"
DASHBOARD_PLIST="$HOME/Library/LaunchAgents/com.fonte.dashboard.plist"

mkdir -p "$HOME/Library/LaunchAgents"

# Daemon LaunchAgent (API on :3777) — one-shot launcher; daemon self-detaches
if [ -f "$DAEMON_PLIST" ]; then
    launchctl unload "$DAEMON_PLIST" 2>/dev/null || true
fi

cat > "$DAEMON_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.fonte.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$FONTE_BIN</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>$CONFIG_DIR/logs/launchd.log</string>
    <key>StandardErrorPath</key>
    <string>$CONFIG_DIR/logs/launchd.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>$HOME</string>
        <key>FONTE_NO_OPEN</key>
        <string>1</string>
    </dict>
</dict>
</plist>
EOF

launchctl load "$DAEMON_PLIST" 2>/dev/null && \
    echo "  Daemon (port 3777) will auto-start at login." || \
    echo "  Warning: failed to load daemon LaunchAgent. Run: launchctl load $DAEMON_PLIST"

# Dashboard LaunchAgent (Next.js on :3000) — long-running; launchd keeps it alive
if [ -f "$DASHBOARD_PLIST" ]; then
    launchctl unload "$DASHBOARD_PLIST" 2>/dev/null || true
fi

cat > "$DASHBOARD_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.fonte.dashboard</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NPM_BIN</string>
        <string>run</string>
        <string>start</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$DASHBOARD_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$CONFIG_DIR/logs/dashboard.log</string>
    <key>StandardErrorPath</key>
    <string>$CONFIG_DIR/logs/dashboard.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>$HOME</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
</dict>
</plist>
EOF

launchctl load "$DASHBOARD_PLIST" 2>/dev/null && \
    echo "  Dashboard (port 3000) will auto-start at login." || \
    echo "  Warning: failed to load dashboard LaunchAgent. Run: launchctl load $DASHBOARD_PLIST"

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "============================================"
echo "  Installation complete!"
echo "============================================"
echo ""
echo "Usage:"
echo "  fonte start              Start the daemon"
echo "  fonte torrent add <url>  Add a magnet link"
echo "  fonte watchlist add \"Movie Name\" --year 2025"
echo "  fonte ui                 Open web dashboard"
echo ""
echo "File associations:"
echo "  - magnet: links → Fonte"
echo "  - .torrent files → Fonte"
echo ""
echo "Auto-start at login:"
echo "  - Daemon  → http://localhost:3777"
echo "  - Dashboard → http://localhost:3000"
echo "  - Transmission, Jackett (via brew services)"
echo "  Disable: launchctl unload $DAEMON_PLIST"
echo "           launchctl unload $DASHBOARD_PLIST"
echo ""
echo "Manage Jackett indexers: http://localhost:9117"
echo ""
