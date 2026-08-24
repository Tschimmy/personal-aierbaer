#!/usr/bin/env bash
#
# Personal Aierbaer installer.
# Downloads the latest release .dmg from GitHub, installs the app into
# /Applications, and strips the Gatekeeper quarantine flag so it opens without
# the "app is damaged" prompt.
#
# Usage:
#   ./install.sh
#
set -euo pipefail

REPO="Tschimmy/personal-aierbaer"
APP="Personal Aierbaer.app"
DEST="/Applications/$APP"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
err()  { printf '\033[1;31mError:\033[0m %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null || err "curl is required."

# --- Find the latest .dmg asset ----------------------------------------------
info "Fetching latest release info for $REPO ..."
API="https://api.github.com/repos/$REPO/releases/latest"
JSON="$(curl -fsSL -H "Accept: application/vnd.github+json" "$API")" \
  || err "Could not reach GitHub."

VERSION="$(printf '%s' "$JSON" | grep -o '"tag_name":[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\(v\{0,1\}[^"]*\)"$/\1/')"

ASSET_URL="$(printf '%s' "$JSON" \
  | grep -o '"browser_download_url":[[:space:]]*"[^"]*\.dmg"' \
  | sed 's/.*"\(https[^"]*\)"$/\1/' | head -1)"
[[ -n "${ASSET_URL:-}" ]] || err "No .dmg asset found in the latest release."

# --- Download -----------------------------------------------------------------
TMP="$(mktemp -d)"
DMG="$TMP/aierbaer.dmg"
trap 'hdiutil detach "$MNT" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

info "Downloading ${VERSION:-latest} ..."
curl -fsSL -o "$DMG" "$ASSET_URL" || err "Download failed."

# --- Mount, copy, unmount -----------------------------------------------------
MNT="$TMP/mnt"
mkdir -p "$MNT"
info "Mounting disk image ..."
hdiutil attach -nobrowse -quiet -mountpoint "$MNT" "$DMG" || err "Failed to mount .dmg."

SRC="$MNT/$APP"
[[ -d "$SRC" ]] || SRC="$(/usr/bin/find "$MNT" -maxdepth 1 -name '*.app' | head -1)"
[[ -d "$SRC" ]] || err "No .app found inside the .dmg."

info "Installing to $DEST ..."
rm -rf "$DEST"
cp -R "$SRC" "$DEST"

hdiutil detach "$MNT" >/dev/null 2>&1 || true

# --- Strip quarantine ---------------------------------------------------------
info "Removing Gatekeeper quarantine flag ..."
xattr -cr "$DEST"

info "Done. Launch it with:  open \"$DEST\""
