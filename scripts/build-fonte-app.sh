#!/bin/bash
#
# Rebuild Fonte.app from sources in scripts/fonte-app/.
#
# Compiles Fonte.applescript into an applet bundle, drops in fonte-router.sh,
# and patches Info.plist with magnet:/.torrent associations. Run this whenever
# you edit Fonte.applescript or fonte-router.sh.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$SCRIPT_DIR/fonte-app"
OUT="$ROOT_DIR/Fonte.app"

PB=/usr/libexec/PlistBuddy

rm -rf "$OUT"

osacompile -o "$OUT" "$SRC_DIR/Fonte.applescript"

cp "$SRC_DIR/fonte-router.sh" "$OUT/Contents/Resources/fonte-router.sh"
chmod +x "$OUT/Contents/Resources/fonte-router.sh"

PLIST="$OUT/Contents/Info.plist"

set_or_add() {
    local key="$1" type="$2" value="$3"
    $PB -c "Set :$key $value" "$PLIST" 2>/dev/null || \
        $PB -c "Add :$key $type $value" "$PLIST"
}

set_or_add CFBundleName string Fonte
set_or_add CFBundleDisplayName string Fonte
set_or_add CFBundleIdentifier string com.fonte.app
set_or_add CFBundleShortVersionString string 0.1.0
set_or_add CFBundleVersion string 0.1.0
set_or_add LSMinimumSystemVersion string 12.0

# magnet: URL scheme
$PB -c "Delete :CFBundleURLTypes" "$PLIST" 2>/dev/null || true
$PB -c "Add :CFBundleURLTypes array" "$PLIST"
$PB -c "Add :CFBundleURLTypes:0 dict" "$PLIST"
$PB -c "Add :CFBundleURLTypes:0:CFBundleURLName string 'Magnet Link'" "$PLIST"
$PB -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST"
$PB -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string magnet" "$PLIST"

# .torrent document type
$PB -c "Delete :CFBundleDocumentTypes" "$PLIST" 2>/dev/null || true
$PB -c "Add :CFBundleDocumentTypes array" "$PLIST"
$PB -c "Add :CFBundleDocumentTypes:0 dict" "$PLIST"
$PB -c "Add :CFBundleDocumentTypes:0:CFBundleTypeName string 'BitTorrent File'" "$PLIST"
$PB -c "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer" "$PLIST"
$PB -c "Add :CFBundleDocumentTypes:0:LSHandlerRank string Owner" "$PLIST"
$PB -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes array" "$PLIST"
$PB -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string org.bittorrent.torrent" "$PLIST"
$PB -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions array" "$PLIST"
$PB -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:0 string torrent" "$PLIST"

# org.bittorrent.torrent UTI declaration
$PB -c "Delete :UTImportedTypeDeclarations" "$PLIST" 2>/dev/null || true
$PB -c "Add :UTImportedTypeDeclarations array" "$PLIST"
$PB -c "Add :UTImportedTypeDeclarations:0 dict" "$PLIST"
$PB -c "Add :UTImportedTypeDeclarations:0:UTTypeIdentifier string org.bittorrent.torrent" "$PLIST"
$PB -c "Add :UTImportedTypeDeclarations:0:UTTypeDescription string 'BitTorrent File'" "$PLIST"
$PB -c "Add :UTImportedTypeDeclarations:0:UTTypeConformsTo array" "$PLIST"
$PB -c "Add :UTImportedTypeDeclarations:0:UTTypeConformsTo:0 string public.data" "$PLIST"
$PB -c "Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification dict" "$PLIST"
$PB -c "Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension array" "$PLIST"
$PB -c "Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:0 string torrent" "$PLIST"
$PB -c "Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.mime-type string 'application/x-bittorrent'" "$PLIST"

echo "Built $OUT"
