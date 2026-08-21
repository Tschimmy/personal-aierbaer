//! In-app update check against GitHub Releases. If a newer version is published,
//! download its .dmg, mount it, and copy the .app into /Applications.

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

const REPO: &str = "Tschimmy/personal-aierbaer";

#[derive(Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub url: String,
    pub notes: String,
    pub current: String,
}

fn parse_ver(s: &str) -> (u64, u64, u64) {
    let s = s.trim().trim_start_matches('v');
    let mut it = s.split('.').map(|x| x.parse::<u64>().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

fn is_newer(candidate: &str, current: &str) -> bool {
    parse_ver(candidate) > parse_ver(current)
}

/// Check the latest GitHub release. Returns update info when it's newer than the
/// running version and has a .dmg asset; None otherwise (incl. private-repo 404).
pub async fn check() -> Result<Option<UpdateInfo>, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::new();
    let res = client
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .header("User-Agent", "personal-aierbaer")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Ok(None);
    }
    let v: Value = res.json().await.map_err(|e| e.to_string())?;
    let tag = v["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
    if tag.is_empty() || !is_newer(&tag, &current) {
        return Ok(None);
    }
    let url = v["assets"].as_array().and_then(|a| {
        a.iter()
            .find(|x| x["name"].as_str().map(|n| n.ends_with(".dmg")).unwrap_or(false))
            .and_then(|x| x["browser_download_url"].as_str())
            .map(String::from)
    });
    match url {
        Some(url) => Ok(Some(UpdateInfo {
            version: tag,
            url,
            notes: v["body"].as_str().unwrap_or("").to_string(),
            current,
        })),
        None => Ok(None),
    }
}

/// Download the .dmg, mount it, and copy the .app into /Applications.
pub async fn install(url: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let bytes = client
        .get(&url)
        .header("User-Agent", "personal-aierbaer")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let dmg = std::env::temp_dir().join("aierbaer-update.dmg");
    tokio::fs::write(&dmg, &bytes).await.map_err(|e| e.to_string())?;

    let mount = std::env::temp_dir().join("aierbaer-update-mnt");
    let _ = tokio::fs::create_dir_all(&mount).await;

    let attach = std::process::Command::new("hdiutil")
        .args(["attach", "-nobrowse", "-mountpoint"])
        .arg(&mount)
        .arg(&dmg)
        .output()
        .map_err(|e| e.to_string())?;
    if !attach.status.success() {
        return Err(format!("hdiutil attach failed: {}", String::from_utf8_lossy(&attach.stderr)));
    }

    let result = copy_app(&mount).await;

    let _ = std::process::Command::new("hdiutil").arg("detach").arg(&mount).output();
    let _ = tokio::fs::remove_file(&dmg).await;
    result
}

async fn copy_app(mount: &std::path::Path) -> Result<(), String> {
    let mut app_src = None;
    if let Ok(mut rd) = tokio::fs::read_dir(mount).await {
        while let Ok(Some(e)) = rd.next_entry().await {
            if e.file_name().to_string_lossy().ends_with(".app") {
                app_src = Some(e.path());
                break;
            }
        }
    }
    let src = app_src.ok_or_else(|| "no .app found in the downloaded dmg".to_string())?;
    let name = src.file_name().ok_or("bad app path")?.to_string_lossy().to_string();
    let dest = format!("/Applications/{name}");
    let _ = std::process::Command::new("rm").args(["-rf", &dest]).status();
    let cp = std::process::Command::new("cp")
        .arg("-R")
        .arg(&src)
        .arg("/Applications/")
        .status()
        .map_err(|e| e.to_string())?;
    if !cp.success() {
        return Err("failed to copy the app into /Applications".into());
    }
    Ok(())
}

/// Relaunch the freshly-installed app and quit this one.
pub fn restart(app: &AppHandle) {
    let _ = std::process::Command::new("open")
        .arg("/Applications/Personal Aierbaer.app")
        .spawn();
    app.exit(0);
}
