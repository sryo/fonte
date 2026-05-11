#!/bin/bash
#
# AITorrent — macOS Installer
#
# Bootstraps everything from scratch:
#   1. Homebrew (if missing)
#   2. Node.js (if missing)
#   3. Transmission (torrent backend)
#   4. bitmagnet (DHT crawler + torrent indexer)
#   5. npm dependencies + build
#   6. AITorrent.app (magnet: and .torrent file handler)
#   7. Write default settings
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_SOURCE="$SCRIPT_DIR/AITorrent.app"
APP_DEST="$HOME/Applications/AITorrent.app"
CONFIG_DIR="$HOME/.aitorrent"

echo ""
echo "  █▀█ █   ▀█▀ █▀█ █▀▄ █▀▄ █▀▀ █▄ █ ▀█▀"
echo "  █▀█ █    █  █ █ █▀▄ █▀▄ █▀▀ █ ▀█  █"
echo "  ▀ ▀ ▀    ▀   ▀  ▀ ▀ ▀ ▀ ▀▀▀ ▀  ▀  ▀"
echo ""
echo "  macOS Installer"
echo ""

# ── Step 1: Homebrew ─────────────────────────────────────────────────────────

echo "[1/7] Checking Homebrew..."

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
echo "[2/7] Checking Node.js..."

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
echo "[3/7] Checking Transmission..."

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

# ── Step 4: bitmagnet (DHT crawler + torrent indexer) ────────────────────────

echo ""
echo "[4/7] Checking bitmagnet..."

# bitmagnet needs Docker (for PostgreSQL)
if ! command -v docker &>/dev/null; then
    echo "  Docker not found. Installing Docker via Homebrew..."
    brew install --cask docker
    echo "  Docker installed. Please open Docker Desktop to start the daemon."
    echo "  Then re-run this installer."
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &>/dev/null 2>&1; then
    echo "  Docker daemon not running. Starting Docker Desktop..."
    open -a Docker
    echo "  Waiting for Docker to start..."
    for i in $(seq 1 30); do
        if docker info &>/dev/null 2>&1; then break; fi
        sleep 2
    done
    if ! docker info &>/dev/null 2>&1; then
        echo "  Error: Docker failed to start. Open Docker Desktop manually, then re-run."
        exit 1
    fi
fi

# Write docker-compose for bitmagnet + postgres
BITMAGNET_DIR="$CONFIG_DIR/bitmagnet"
mkdir -p "$BITMAGNET_DIR"

if [ ! -f "$BITMAGNET_DIR/docker-compose.yml" ]; then
    cat > "$BITMAGNET_DIR/docker-compose.yml" <<'DCEOF'
services:
  bitmagnet:
    image: ghcr.io/bitmagnet-io/bitmagnet:latest
    restart: unless-stopped
    environment:
      - POSTGRES_HOST=postgres
      - POSTGRES_PASSWORD=bitmagnet
    ports:
      - "3333:3333"
      - "3334:3334/tcp"
      - "3334:3334/udp"
    depends_on:
      postgres:
        condition: service_healthy
    command:
      - worker
      - run
      - --all

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_PASSWORD=bitmagnet
      - POSTGRES_DB=bitmagnet
    volumes:
      - postgres-data:/var/lib/postgresql/data
    shm_size: 1g
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres-data:
DCEOF
    echo "  Docker Compose config written."
fi

# Start bitmagnet
echo "  Starting bitmagnet..."
(cd "$BITMAGNET_DIR" && docker compose up -d 2>&1 | tail -3)
sleep 5

# Verify
if curl -s http://localhost:3333/status &>/dev/null; then
    echo "  bitmagnet running on port 3333."
    echo "  Web UI: http://localhost:3333"
    echo "  DHT crawler is building index (may take a few hours for initial crawl)."
else
    echo "  Warning: bitmagnet not ready yet. It may take a minute to initialize."
    echo "  Check: cd $BITMAGNET_DIR && docker compose logs"
fi

# ── Step 5: Build AITorrent ──────────────────────────────────────────────────

echo ""
echo "[5/7] Installing dependencies and building..."
cd "$SCRIPT_DIR"
npm install 2>&1 | tail -1
npm run build 2>&1 | tail -1
echo "  Built successfully."

# ── Step 6: Install AITorrent.app ────────────────────────────────────────────

echo ""
echo "[6/7] Installing AITorrent.app..."

if [ ! -d "$APP_SOURCE" ]; then
    echo "  Error: AITorrent.app not found at $APP_SOURCE"
    exit 1
fi

mkdir -p "$HOME/Applications"
rm -rf "$APP_DEST"
cp -R "$APP_SOURCE" "$APP_DEST"
chmod +x "$APP_DEST/Contents/MacOS/aitorrent-handler"

/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_DEST"

echo "  Installed to $APP_DEST"

# ── Step 7: Write settings ───────────────────────────────────────────────────

echo ""
echo "[7/7] Writing settings..."

mkdir -p "$CONFIG_DIR/logs"
mkdir -p "$HOME/Downloads/aitorrent"

# Only write settings if they don't exist yet
if [ ! -f "$CONFIG_DIR/settings.json" ]; then
    cat > "$CONFIG_DIR/settings.json" <<EOF
{
  "workspace": {
    "path": "$HOME/aitorrent-workspace",
    "name": "AITorrent"
  },
  "models": {
    "provider": "anthropic"
  },
  "agents": {
    "aitorrent": {
      "name": "AITorrent Agent",
      "provider": "anthropic",
      "model": "sonnet",
      "working_directory": "$HOME/aitorrent-workspace/aitorrent"
    }
  },
  "torrent": {
    "download_dir": "$HOME/Downloads/aitorrent",
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
    "bitmagnet_url": "http://localhost:3333"
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
    echo "  Settings already exist, preserved."
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "============================================"
echo "  Installation complete!"
echo "============================================"
echo ""
echo "Usage:"
echo "  aitorrent start              Start the daemon"
echo "  aitorrent torrent add <url>  Add a magnet link"
echo "  aitorrent watchlist add \"Movie Name\" --year 2025"
echo "  aitorrent ui                 Open web dashboard"
echo ""
echo "File associations:"
echo "  - magnet: links → AITorrent"
echo "  - .torrent files → AITorrent"
echo ""
echo "bitmagnet UI: http://localhost:3333"
echo ""
