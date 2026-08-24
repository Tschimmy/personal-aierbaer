use serde::Serialize;

#[derive(Serialize)]
pub struct PiStatus {
    pub installed: bool,
    pub version: Option<String>,
}

#[derive(Serialize)]
pub struct SkillStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub bundled: Option<String>,
    pub up_to_date: bool,
    pub path: String,
}

#[derive(Serialize)]
pub struct CopilotStatus {
    pub ready: bool,
    pub auth_type: Option<String>,
}

fn augmented_path() -> String {
    crate::env_path::augmented_path()
}

/// Is `pi` on PATH? Returns its version string when found.
pub async fn check_pi() -> PiStatus {
    let out = tokio::process::Command::new("pi")
        .arg("--version")
        .env("PATH", augmented_path())
        .output()
        .await;
    match out {
        Ok(o) if o.status.success() => {
            let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
            PiStatus { installed: true, version: Some(v) }
        }
        _ => PiStatus { installed: false, version: None },
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

/// Is GitHub Copilot auth ready for pi? Uses `pi auth check`.
pub async fn check_copilot() -> CopilotStatus {
    let out = tokio::process::Command::new("pi")
        .args(["auth", "check", "--provider", "github-copilot", "--json"])
        .env("PATH", augmented_path())
        .output()
        .await;
    match out {
        Ok(o) if o.status.success() => {
            let v: serde_json::Value =
                serde_json::from_slice(&o.stdout).unwrap_or(serde_json::Value::Null);
            let ready = v["status"].as_str() == Some("ready");
            CopilotStatus {
                ready,
                auth_type: v["authType"].as_str().map(String::from),
            }
        }
        _ => CopilotStatus { ready: false, auth_type: None },
    }
}

/// Open Terminal.app and run a command (macOS). Used for install / login actions
/// that need an interactive TTY (e.g. pi's `/login github-copilot`).
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

/// Install pi globally, headless (no Terminal). Honors npm_config_prefix from the
/// environment (so the sandbox test installs into its throwaway prefix).
pub async fn install_pi() -> Result<(), String> {
    let out = tokio::process::Command::new("npm")
        .args([
            "install",
            "-g",
            "--ignore-scripts",
            "@earendil-works/pi-coding-agent",
        ])
        .env("PATH", augmented_path())
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
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
