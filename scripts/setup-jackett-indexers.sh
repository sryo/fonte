#!/bin/bash
#
# Fonte — Configure Jackett indexers
#
# Enables a set of public torrent indexers in Jackett.
# Requires Jackett to be running on localhost:9117.
#

JACKETT_URL="${JACKETT_URL:-http://localhost:9117}"

# Read API key from settings or argument
if [ -n "$1" ]; then
    API_KEY="$1"
elif [ -f "$HOME/.fonte/settings.json" ]; then
    API_KEY=$(python3 -c "import json; print(json.load(open('$HOME/.fonte/settings.json')).get('watchlist',{}).get('jackett_api_key',''))" 2>/dev/null)
fi

if [ -z "$API_KEY" ]; then
    # Try reading from Jackett config directly
    for config_path in \
        "$HOME/Library/Application Support/Jackett/ServerConfig.json" \
        "/opt/homebrew/var/jackett/ServerConfig.json" \
        "$HOME/.config/Jackett/ServerConfig.json"; do
        if [ -f "$config_path" ]; then
            API_KEY=$(python3 -c "import json; print(json.load(open('$config_path')).get('APIKey',''))" 2>/dev/null)
            break
        fi
    done
fi

if [ -z "$API_KEY" ]; then
    echo "Error: Could not find Jackett API key."
    echo "Usage: $0 <api_key>"
    exit 1
fi

echo "Configuring Jackett indexers..."

# Get session cookies (required for config API)
COOKIE_JAR=$(mktemp)
curl -sc "$COOKIE_JAR" -sL "${JACKETT_URL}/UI/Login?apikey=${API_KEY}" -o /dev/null

# Public indexers to enable (no auth required)
INDEXERS=(
    "thepiratebay"          # The Pirate Bay — largest public tracker
    "1337x"                 # 1337x — popular general tracker
    "yts"                   # YTS/YIFY — movies in small file sizes
    "eztv"                  # EZTV — TV shows
    "limetorrents"          # LimeTorrents — general
    "therarbg"              # TheRARBG — RARBG successor
    "kickasstorrents-to"    # KickassTorrents — general
    "nyaasi"                # Nyaa.si — anime
)

enabled=0
failed=0

for indexer in "${INDEXERS[@]}"; do
    # Fetch default config for this indexer
    config=$(curl -sb "$COOKIE_JAR" -sL "${JACKETT_URL}/api/v2.0/indexers/${indexer}/config?apikey=${API_KEY}" 2>&1)

    # Check if we got a valid JSON array
    if [[ "$config" == "["* ]]; then
        # POST the config back to enable it
        curl -sb "$COOKIE_JAR" -sL -X POST \
            "${JACKETT_URL}/api/v2.0/indexers/${indexer}/config?apikey=${API_KEY}" \
            -H "Content-Type: application/json" \
            -d "$config" -o /dev/null 2>&1
        echo "  + ${indexer}"
        enabled=$((enabled + 1))
    else
        echo "  - ${indexer} (not available)"
        failed=$((failed + 1))
    fi
done

rm -f "$COOKIE_JAR"

echo ""
echo "Done: ${enabled} indexers enabled, ${failed} skipped."

# Verify with a test search
echo ""
echo "Verifying search..."
result=$(curl -s "${JACKETT_URL}/api/v2.0/indexers/all/results?apikey=${API_KEY}&Query=test" 2>&1)
indexer_count=$(echo "$result" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('Indexers',[])))" 2>/dev/null)
echo "Active indexers: ${indexer_count:-0}"
