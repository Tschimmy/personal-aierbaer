//! In-app GitHub Copilot device-code OAuth. Replicates pi's own flow so we can
//! run it headless (no Terminal) and drive a native in-app modal, then write the
//! credential into ~/.pi/agent/auth.json exactly like pi does.

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const CLIENT_ID: &str = "Iv1.b507a08c87ecfe98";
const UA: &str = "GitHubCopilotChat/0.35.0";

fn copilot_headers() -> reqwest::header::HeaderMap {
    use reqwest::header::{HeaderMap, HeaderValue};
    let mut h = HeaderMap::new();
    h.insert("User-Agent", HeaderValue::from_static(UA));
    h.insert("Editor-Version", HeaderValue::from_static("vscode/1.107.0"));
    h.insert(
        "Editor-Plugin-Version",
        HeaderValue::from_static("copilot-chat/0.35.0"),
    );
    h.insert("Copilot-Integration-Id", HeaderValue::from_static("vscode-chat"));
    h
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

/// api base URL derived from the copilot token's proxy-ep, else the individual default.
fn base_url_from_token(token: &str) -> String {
    for part in token.split(';') {
        if let Some(ep) = part.trim().strip_prefix("proxy-ep=") {
            return format!("https://{}", ep.replace("proxy.", "api."));
        }
    }
    "https://api.individual.githubcopilot.com".to_string()
}

/// Run the full device flow. Emits `copilot-device` with the user code + URL so
/// the UI can show a modal; polls until authorized; exchanges for a Copilot
/// token; writes auth.json. Resolves when Copilot is ready.
pub async fn login(app: &AppHandle) -> Result<()> {
    let client = reqwest::Client::new();

    // 1. Start device flow.
    let dev: Value = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .header("User-Agent", UA)
        .form(&[("client_id", CLIENT_ID), ("scope", "read:user")])
        .send()
        .await?
        .json()
        .await?;

    let device_code = dev["device_code"].as_str().ok_or_else(|| anyhow!("no device_code"))?;
    let user_code = dev["user_code"].as_str().ok_or_else(|| anyhow!("no user_code"))?;
    let verification_uri = dev["verification_uri"]
        .as_str()
        .ok_or_else(|| anyhow!("no verification_uri"))?;
    let mut interval = dev["interval"].as_u64().unwrap_or(5).max(1);
    let expires_in = dev["expires_in"].as_u64().unwrap_or(900);
    let deadline = now_secs() + expires_in;

    // 2. Tell the UI (it shows the code and opens the browser).
    let _ = app.emit(
        "copilot-device",
        json!({ "userCode": user_code, "verificationUri": verification_uri }),
    );

    // 3. Poll for the GitHub access token.
    let gh_token = loop {
        if now_secs() > deadline {
            return Err(anyhow!("Device code expired — try again"));
        }
        tokio::time::sleep(Duration::from_secs(interval)).await;

        let raw: Value = client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .header("User-Agent", UA)
            .form(&[
                ("client_id", CLIENT_ID),
                ("device_code", device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await?
            .json()
            .await?;

        if let Some(tok) = raw["access_token"].as_str() {
            break tok.to_string();
        }
        match raw["error"].as_str() {
            Some("authorization_pending") => {}
            Some("slow_down") => interval += 5,
            Some(e) => return Err(anyhow!("Device flow failed: {e}")),
            None => return Err(anyhow!("Invalid device token response")),
        }
    };

    // 4. Exchange for a Copilot API token.
    let tok: Value = client
        .get("https://api.github.com/copilot_internal/v2/token")
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {gh_token}"))
        .headers(copilot_headers())
        .send()
        .await?
        .json()
        .await?;

    let access = tok["token"].as_str().ok_or_else(|| anyhow!("no copilot token"))?.to_string();
    let expires_at = tok["expires_at"].as_i64().ok_or_else(|| anyhow!("no expires_at"))?;
    // pi stores ms, minus a 5-minute safety margin.
    let expires_ms = expires_at * 1000 - 5 * 60 * 1000;

    // 5. Best-effort model list (pi refreshes this on next use anyway).
    let available = fetch_model_ids(&client, &access).await.unwrap_or_default();

    // 6. Merge into ~/.pi/agent/auth.json.
    write_credential(&access, &gh_token, expires_ms, &available).await?;
    Ok(())
}

async fn fetch_model_ids(client: &reqwest::Client, token: &str) -> Result<Vec<String>> {
    let base = base_url_from_token(token);
    let raw: Value = client
        .get(format!("{base}/models"))
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {token}"))
        .headers(copilot_headers())
        .header("X-GitHub-Api-Version", "2026-06-01")
        .send()
        .await?
        .json()
        .await?;
    let mut ids = Vec::new();
    if let Some(data) = raw["data"].as_array() {
        for item in data {
            if item["capabilities"]["supports"]["tool_calls"].as_bool() == Some(false) {
                continue;
            }
            if item["model_picker_enabled"].as_bool() == Some(true)
                && item["policy"]["state"].as_str() != Some("disabled")
            {
                if let Some(id) = item["id"].as_str() {
                    ids.push(id.to_string());
                }
            }
        }
    }
    Ok(ids)
}

async fn write_credential(access: &str, refresh: &str, expires_ms: i64, models: &[String]) -> Result<()> {
    let home = std::env::var("HOME")?;
    let dir = format!("{home}/.pi/agent");
    tokio::fs::create_dir_all(&dir).await?;
    let path = format!("{dir}/auth.json");

    let mut root: Value = match tokio::fs::read_to_string(&path).await {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|_| json!({})),
        Err(_) => json!({}),
    };
    if !root.is_object() {
        root = json!({});
    }
    root["github-copilot"] = json!({
        "type": "oauth",
        "refresh": refresh,
        "access": access,
        "expires": expires_ms,
        "availableModelIds": models,
    });
    tokio::fs::write(&path, serde_json::to_string_pretty(&root)?).await?;
    Ok(())
}

/// The Copilot model ids allowed for this account (from auth.json, populated at
/// login). Returned bare, e.g. "claude-opus-4.8".
pub async fn available_models() -> Result<Vec<String>> {
    let home = std::env::var("HOME")?;
    let path = format!("{home}/.pi/agent/auth.json");
    let s = tokio::fs::read_to_string(&path).await?;
    let v: Value = serde_json::from_str(&s)?;
    Ok(v["github-copilot"]["availableModelIds"]
        .as_array()
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default())
}
