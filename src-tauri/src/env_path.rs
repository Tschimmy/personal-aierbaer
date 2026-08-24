//! Resolve a usable PATH for spawning user-installed CLIs (`pi`, `npm`).
//!
//! GUI apps launched from Finder inherit launchd's minimal PATH
//! (`/usr/bin:/bin:/usr/sbin:/sbin`), so they miss node/npm/pi installed via
//! nvm, fnm, volta, Homebrew, or the official Node installer. We recover the
//! real PATH by asking the user's login+interactive shell, then merge in a few
//! well-known fallbacks. Result is cached for the process lifetime.

use std::sync::OnceLock;

static CACHED: OnceLock<String> = OnceLock::new();

/// Ask the user's login+interactive shell for its PATH (sources .zprofile and
/// .zshrc, where nvm/fnm/volta typically hook in). Returns None on any failure.
fn shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let out = std::process::Command::new(&shell)
        // -l login, -i interactive: sources the files that set up version managers.
        .args(["-lic", "echo \"__PATH__:$PATH\""])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    // Grab our marker line; rc files may print banners we must ignore.
    let line = stdout.lines().find_map(|l| l.strip_prefix("__PATH__:"))?;
    let trimmed = line.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// PATH for spawning `pi` / `npm`: login-shell PATH (if resolvable) plus the
/// current PATH and static fallbacks, deduped, order-preserving.
pub fn augmented_path() -> String {
    CACHED.get_or_init(build).clone()
}

fn build() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let base = std::env::var("PATH").unwrap_or_default();
    let fallbacks = format!(
        "{home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    );

    let mut parts: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let sources = [shell_path().unwrap_or_default(), base, fallbacks];
    for src in sources {
        for dir in src.split(':') {
            if !dir.is_empty() && seen.insert(dir.to_string()) {
                parts.push(dir.to_string());
            }
        }
    }
    parts.join(":")
}
