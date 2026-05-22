#!/bin/bash
#
# Fonte — router for magnet: URLs and .torrent files
#
# Called from the AppleScript applet at Fonte.app/Contents/MacOS/applet, which
# forwards macOS AppleEvents (open document / open URL / plain run) as
# command-line arguments. Invoked with:
#   - A magnet URI as $1 (from URL scheme handler)
#   - A .torrent file path as $1 (from file association)
#   - No args (double-click the app icon)
#

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Resolve the fonte CLI — check common locations
find_cli() {
    # 0. Path pinned at install time (writes by install-app.sh or a one-off setup)
    if [ -f "$HOME/.fonte/cli-path" ]; then
        local pinned
        pinned=$(cat "$HOME/.fonte/cli-path" 2>/dev/null)
        if [ -n "$pinned" ] && [ -f "$pinned" ]; then
            echo "node" "$pinned"
            return
        fi
    fi

    # 1. Sibling to .app bundle (development install in the repo)
    local dev_cli="$APP_DIR/packages/cli/bin/fonte.mjs"
    if [ -f "$dev_cli" ]; then
        echo "node" "$dev_cli"
        return
    fi

    # 2. Global npm install
    if command -v fonte &>/dev/null; then
        echo "fonte"
        return
    fi

    # 3. npx fallback (only useful once published)
    echo "npx" "fonte"
}

CLI=($(find_cli))
API_PORT="${FONTE_API_PORT:-3777}"
API_URL="http://localhost:$API_PORT"

# Log to a file for debugging
LOG_FILE="$HOME/.fonte/handler.log"
mkdir -p "$(dirname "$LOG_FILE")"
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Move a file to ~/.Trash. Avoids talking to Finder (which would need an
# Automation permission grant) by doing the rename directly. Loses Finder's
# "Put Back" metadata, which isn't useful for an imported .torrent anyway.
move_to_trash() {
    local src="$1"
    local trash="$HOME/.Trash"
    local base dest
    base=$(basename "$src")
    dest="$trash/$base"
    if [ -e "$dest" ]; then
        dest="$trash/$base $(date +%H.%M.%S)"
    fi
    if mv "$src" "$dest" 2>/dev/null; then
        log "Moved to Trash: $src"
    else
        log "Failed to move to Trash: $src"
    fi
}

# Try to add via API first (if daemon is running), fall back to CLI
add_torrent() {
    local source="$1"
    log "Adding torrent: $source"

    # Try the API (fast, non-blocking)
    local response
    response=$(curl -s -X POST "$API_URL/api/torrents" \
        -H "Content-Type: application/json" \
        -d "{\"magnetUri\": \"$source\"}" \
        --connect-timeout 2 2>/dev/null)

    if echo "$response" | grep -q '"ok":true'; then
        log "Added via API: $response"
        return 0
    fi

    log "API not available, falling back to CLI"
    # Start daemon if not running, then add. Notify so the user knows something
    # off-path happened (daemon down, slow start, etc.) — silent success only
    # happens on the fast API path above.
    "${CLI[@]}" torrent add "$source" &
    osascript -e "display notification \"Daemon down — adding via CLI\" with title \"Fonte\"" 2>/dev/null
}

add_torrent_file() {
    local filepath="$1"
    log "Adding .torrent file: $filepath"

    # Try the API first with filePath param
    local response
    response=$(curl -s -X POST "$API_URL/api/torrents" \
        -H "Content-Type: application/json" \
        -d "{\"filePath\": \"$filepath\"}" \
        --connect-timeout 2 2>/dev/null)

    if echo "$response" | grep -q '"ok":true'; then
        log "Added file via API: $response"
        move_to_trash "$filepath"
        return 0
    fi

    log "API not available, falling back to CLI"
    "${CLI[@]}" torrent add "$filepath" &
    osascript -e "display notification \"Daemon down — adding via CLI\" with title \"Fonte\"" 2>/dev/null
}

# ── Main ──────────────────────────────────────────────────────────────────────

log "Handler invoked with args: $*"

if [ $# -eq 0 ]; then
    log "Double-click launch — checking services"

    if ! curl -sf --connect-timeout 1 "$API_URL/api/status" >/dev/null 2>&1; then
        log "Daemon down, starting"
        nohup "${CLI[@]}" start >>"$LOG_FILE" 2>&1 &
        disown
    fi

    if ! curl -sf --connect-timeout 1 "http://localhost:3000" >/dev/null 2>&1; then
        log "Dashboard down, starting"
        nohup "${CLI[@]}" office >>"$LOG_FILE" 2>&1 &
        disown
    fi

    for _ in $(seq 1 30); do
        if curl -sf --connect-timeout 1 "http://localhost:3000" >/dev/null 2>&1; then break; fi
        sleep 0.5
    done

    open "http://localhost:3000" 2>/dev/null || true
    log "Opened dashboard"
    exit 0
fi

for arg in "$@"; do
    case "$arg" in
        magnet:*)
            add_torrent "$arg"
            ;;
        *.torrent)
            if [ -f "$arg" ]; then
                add_torrent_file "$arg"
            else
                log "File not found: $arg"
            fi
            ;;
        *)
            log "Unknown argument: $arg"
            ;;
    esac
done
