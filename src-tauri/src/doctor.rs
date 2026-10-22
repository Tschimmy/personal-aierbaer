use serde::Serialize;

#[derive(Serialize)]
pub struct ClaudeStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub logged_in: bool,
    pub auth_method: Option<String>,
    pub email: Option<String>,
}

#[derive(Serialize)]
pub struct SkillStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub bundled: Option<String>,
    pub up_to_date: bool,
    pub path: String,
}

fn augmented_path() -> String {
    crate::env_path::augmented_path()
}

/// Is `claude` on PATH, and is it signed in? Version from `--version`, login
/// state from `claude auth status` (JSON on stdout; may exit non-zero when
/// logged out, so we parse stdout regardless of exit code).
pub async fn check_claude() -> ClaudeStatus {
    let ver = tokio::process::Command::new("claude")
        .arg("--version")
        .env("PATH", augmented_path())
        .stdin(std::process::Stdio::null())
        .output()
        .await;
    let version = match ver {
        Ok(o) if o.status.success() => {
            Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
        }
        _ => {
            return ClaudeStatus {
                installed: false,
                version: None,
                logged_in: false,
                auth_method: None,
                email: None,
            }
        }
    };
    let auth = tokio::process::Command::new("claude")
        .args(["auth", "status", "--json"])
        .env("PATH", augmented_path())
        .stdin(std::process::Stdio::null())
        .output()
        .await;
    let v: serde_json::Value = auth
        .ok()
        .and_then(|o| serde_json::from_slice(&o.stdout).ok())
        .unwrap_or(serde_json::Value::Null);
    ClaudeStatus {
        installed: true,
        version,
        logged_in: v["loggedIn"].as_bool() == Some(true),
        auth_method: v["authMethod"].as_str().map(String::from),
        email: v["email"].as_str().map(String::from),
    }
}

/// Are the bundled skills installed and current? The primary skill
/// (clickup-aierbaer-solve) drives the displayed version; `up_to_date` also
/// requires the aierbaer-api skill to be present and current.
pub async fn check_skill() -> SkillStatus {
    let home = std::env::var("HOME").unwrap_or_default();
    let path = format!("{home}/.claude/skills/clickup-aierbaer-solve/SKILL.md");
    let bundled = parse_frontmatter_version(SOLVE_SKILL_MD);
    let api_ok = skill_current(&home, "aierbaer-api", API_SKILL_MD).await;
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => {
            let version = parse_frontmatter_version(&content);
            let up_to_date = version.is_some() && version == bundled && api_ok;
            SkillStatus { installed: true, version, bundled, up_to_date, path }
        }
        Err(_) => SkillStatus { installed: false, version: None, bundled, up_to_date: false, path },
    }
}

/// True when an installed skill's version matches the bundled copy.
async fn skill_current(home: &str, name: &str, bundled_md: &str) -> bool {
    let path = format!("{home}/.claude/skills/{name}/SKILL.md");
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => {
            let v = parse_frontmatter_version(&content);
            v.is_some() && v == parse_frontmatter_version(bundled_md)
        }
        Err(_) => false,
    }
}

/// Pull `version:` out of a leading `---` YAML frontmatter block.
fn parse_frontmatter_version(md: &str) -> Option<String> {
    let mut lines = md.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    for line in lines {
        let t = line.trim();
        if t == "---" {
            break;
        }
        if let Some(rest) = t.strip_prefix("version:") {
            return Some(rest.trim().trim_matches('"').trim_matches('\'').to_string());
        }
    }
    None
}

/// Open Terminal.app and run a command (macOS). Used for install / login actions
/// that need an interactive TTY (e.g. `claude auth login`).
pub fn open_terminal(command: &str) -> Result<(), String> {
    let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "tell application \"Terminal\"\nactivate\ndo script \"{escaped}\"\nend tell"
    );
    std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Install Claude Code with the official native installer, headless (no
/// Terminal, no Node needed). Installs into ~/.local/bin, which respects $HOME
/// (so the sandbox test installs into its throwaway home).
pub async fn install_claude() -> Result<(), String> {
    let out = tokio::process::Command::new("bash")
        .args(["-c", "curl -fsSL https://claude.ai/install.sh | bash"])
        .env("PATH", augmented_path())
        .stdin(std::process::Stdio::null())
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { err })
    }
}

/// Canonical skills bundled with the app; written out on install.
const SOLVE_SKILL_MD: &str = include_str!("../assets/clickup-aierbaer-solve/SKILL.md");
const API_SKILL_MD: &str = include_str!("../assets/aierbaer-api/SKILL.md");

async fn write_skill(home: &str, name: &str, md: &str) -> Result<(), String> {
    let dir = format!("{home}/.claude/skills/{name}");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    tokio::fs::write(format!("{dir}/SKILL.md"), md).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Install/refresh both bundled skills (clickup-aierbaer-solve + aierbaer-api)
/// into ~/.claude/skills, headless. Respects $HOME (sandbox-friendly).
pub async fn install_skill() -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    write_skill(&home, "clickup-aierbaer-solve", SOLVE_SKILL_MD).await?;
    write_skill(&home, "aierbaer-api", API_SKILL_MD).await?;
    Ok(())
}
