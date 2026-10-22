#!/usr/bin/env bash
#
# Sandbox for testing Personal Aierbaer onboarding against a FRESH environment:
#   - no claude on PATH    (real claude in ~/.local/bin is hidden)
#   - no skill             (sandbox HOME has empty ~/.claude)
#   - not signed in        (sandbox HOME has no ~/.claude credentials)
#   - fresh app state       (WebView localStorage is keyed under sandbox HOME)
#
# Your real setup is never touched. Cargo/npm caches stay real so builds are fast.
#
# Usage:
#   ./test-onboarding.sh            launch the app in the sandbox (all steps "missing")
#   ./test-onboarding.sh install    run the real Claude Code installer into the sandbox HOME
#   ./test-onboarding.sh skill      copy the skill into the sandbox (make skill step pass)
#   ./test-onboarding.sh login      run `claude auth login` in the sandbox (make sign-in pass)
#   ./test-onboarding.sh clean      delete the sandbox
#
# Run `install` / `skill` / `login` in a SECOND terminal while the app runs,
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

# Scrub the real ~/.local/bin (where claude lives) from PATH; prepend the sandbox prefix.
CLEAN_PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -vF "$REAL_HOME/.local/bin" | paste -sd: -)"
export PATH="$npm_config_prefix/bin:$CLEAN_PATH"

case "${1:-run}" in
  install)
    echo "Installing Claude Code into sandbox HOME: $HOME"
    curl -fsSL https://claude.ai/install.sh | bash
    export PATH="$HOME/.local/bin:$PATH"
    echo "→ claude now at: $(command -v claude || echo NONE)"
    ;;

  skill)
    mkdir -p "$HOME/.claude/skills"
    cp -R "$REAL_HOME/.claude/skills/clickup-solve" "$HOME/.claude/skills/"
    echo "→ skill copied to $HOME/.claude/skills/clickup-solve"
    ;;

  login)
    export PATH="$HOME/.local/bin:$PATH"
    claude auth login
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
    echo "claude on PATH = $(command -v claude || echo 'NONE (expected — fresh)')"
    echo "skill present  = $([ -d "$HOME/.claude/skills/clickup-solve" ] && echo yes || echo 'no (expected)')"
    echo "signed in      = $(claude auth status 2>/dev/null | grep -q '"loggedIn": true' && echo yes || echo 'no (expected)')"
    echo
    cd "$PROJECT_DIR"
    npm run tauri dev
    ;;
esac
