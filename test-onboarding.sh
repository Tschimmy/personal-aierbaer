#!/usr/bin/env bash
#
# Sandbox for testing Personal Aierbaer onboarding against a FRESH environment:
#   - no pi on PATH        (real pi in ~/.local/bin is hidden)
#   - no skill             (sandbox HOME has empty ~/.claude)
#   - no Copilot auth       (sandbox HOME has no ~/.pi/agent/auth.json)
#   - fresh app state       (WebView localStorage is keyed under sandbox HOME)
#
# Your real setup is never touched. Cargo/npm caches stay real so builds are fast.
#
# Usage:
#   ./test-onboarding.sh            launch the app in the sandbox (all steps "missing")
#   ./test-onboarding.sh install    install pi into the sandbox prefix (test the real command)
#   ./test-onboarding.sh skill      copy the skill into the sandbox (make skill step pass)
#   ./test-onboarding.sh copilot    seed real Copilot auth into the sandbox (make Copilot pass)
#   ./test-onboarding.sh clean      delete the sandbox
#
# Run `install` / `skill` / `copilot` in a SECOND terminal while the app runs,
# then hit "Re-check" in the wizard to watch a step flip to OK.
#
set -euo pipefail

SANDBOX="${AIERBAER_SANDBOX:-/tmp/aierbaer-sandbox}"
REAL_HOME="$HOME"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export HOME="$SANDBOX/home"
export npm_config_prefix="$SANDBOX/prefix"
mkdir -p "$HOME" "$npm_config_prefix/bin"

# Keep heavy toolchain caches on the real home so we don't re-download crates/pkgs.
export CARGO_HOME="$REAL_HOME/.cargo"
export RUSTUP_HOME="$REAL_HOME/.rustup"
export npm_config_cache="$REAL_HOME/.npm"

# Scrub the real ~/.local/bin (where pi lives) from PATH; prepend the sandbox prefix.
CLEAN_PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -vF "$REAL_HOME/.local/bin" | paste -sd: -)"
export PATH="$npm_config_prefix/bin:$CLEAN_PATH"

case "${1:-run}" in
  install)
    echo "Installing pi into sandbox prefix: $npm_config_prefix"
    npm install -g --ignore-scripts @earendil-works/pi-coding-agent
    echo "→ pi now at: $(command -v pi || echo NONE)"
    ;;

  skill)
    mkdir -p "$HOME/.claude/skills"
    cp -R "$REAL_HOME/.claude/skills/clickup-solve" "$HOME/.claude/skills/"
    echo "→ skill copied to $HOME/.claude/skills/clickup-solve"
    ;;

  copilot)
    if [ -f "$REAL_HOME/.pi/agent/auth.json" ]; then
      mkdir -p "$HOME/.pi/agent"
      cp "$REAL_HOME/.pi/agent/auth.json" "$HOME/.pi/agent/auth.json"
      echo "→ Copilot auth seeded into sandbox"
    else
      echo "! no ~/.pi/agent/auth.json found on real home"
    fi
    ;;

  clean)
    rm -rf "$SANDBOX"
    rm -rf "$REAL_HOME/Library/WebKit/personal-aierbaer"
    echo "→ sandbox removed: $SANDBOX"
    echo "→ app WebView storage wiped (onboarding will re-run)"
    ;;

  run|*)
    # WebView localStorage lives under the REAL ~/Library (WKWebView ignores the
    # HOME override), so wipe it here to force the wizard to re-appear.
    rm -rf "$REAL_HOME/Library/WebKit/personal-aierbaer"
    echo "Sandbox HOME   = $HOME"
    echo "npm prefix     = $npm_config_prefix"
    echo "pi on PATH     = $(command -v pi || echo 'NONE (expected — fresh)')"
    echo "skill present  = $([ -d "$HOME/.claude/skills/clickup-solve" ] && echo yes || echo 'no (expected)')"
    echo "copilot auth   = $([ -f "$HOME/.pi/agent/auth.json" ] && echo yes || echo 'no (expected)')"
    echo
    cd "$PROJECT_DIR"
    npm run tauri dev
    ;;
esac
