mod api;
mod clickup;
mod copilot;
mod doctor;
mod pi;
mod reports;

use std::sync::{Arc, Mutex};

use clickup::{ClickUpConfig, ClickUpTask, ClickUpTaskDetail};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

/// Where solve reports live. Priority: explicit setting → ~/Documents/Personal
/// Aierbaer/Reports → app data dir. P3 will swap for a shared git repo.
fn resolve_reports_dir(app: &AppHandle, given: Option<String>) -> PathBuf {
    if let Some(d) = given {
        if !d.trim().is_empty() {
            return PathBuf::from(d);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join("Documents/Personal Aierbaer/Reports");
    }
    app.path()
        .app_data_dir()
        .map(|d| d.join("reports"))
        .unwrap_or_else(|_| std::env::temp_dir().join("aierbaer-reports"))
}

#[tauri::command]
async fn fetch_tasks(cfg: ClickUpConfig) -> Result<Vec<ClickUpTask>, String> {
    clickup::fetch_tasks(&cfg).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_task_detail(token: String, task_id: String) -> Result<ClickUpTaskDetail, String> {
    clickup::fetch_task_detail(&token, &task_id)
        .await
        .map_err(|e| e.to_string())
}

/// Run the pi solve for a task. Streams `pi-output` events; resolves to report path.
#[tauri::command]
async fn solve_task(
    app: AppHandle,
    token: String,
    task_id: String,
    model: Option<String>,
    repo: Option<String>,
    reports_dir: Option<String>,
) -> Result<String, String> {
    let detail = clickup::fetch_task_detail(&token, &task_id)
        .await
        .map_err(|e| e.to_string())?;
    let dir = resolve_reports_dir(&app, reports_dir);
    let model = model.unwrap_or_else(|| "github-copilot/claude-opus-4.8".into());
    let path = pi::run_solve(&app, &detail, &dir, &model, repo.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Report markdown for a task (newest file), or null if none yet.
#[tauri::command]
async fn read_report_for(
    app: AppHandle,
    task_id: String,
    reports_dir: Option<String>,
) -> Result<Option<String>, String> {
    let dir = resolve_reports_dir(&app, reports_dir);
    match reports::find_report(&dir, &task_id).await {
        Some(p) => Ok(Some(tokio::fs::read_to_string(&p).await.map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

/// Task ids that currently have a report on disk (for inbox badges).
#[tauri::command]
async fn list_report_ids(
    app: AppHandle,
    reports_dir: Option<String>,
) -> Result<Vec<String>, String> {
    let dir = resolve_reports_dir(&app, reports_dir);
    Ok(reports::list_ids(&dir).await)
}

/// Per-task report metadata (resolved flag + chosen option) for the inbox.
#[tauri::command]
async fn list_reports_meta(
    app: AppHandle,
    reports_dir: Option<String>,
) -> Result<Vec<reports::ReportMeta>, String> {
    let dir = resolve_reports_dir(&app, reports_dir);
    Ok(reports::list_meta(&dir).await)
}

/// Record the actual solution for a task as a `## Resolution` section, so future
/// solves can detect it as already-solved.
#[tauri::command]
async fn save_resolution(
    app: AppHandle,
    task_id: String,
    choice: String,
    text: String,
    reports_dir: Option<String>,
) -> Result<(), String> {
    let dir = resolve_reports_dir(&app, reports_dir);
    let path = reports::find_report(&dir, &task_id)
        .await
        .ok_or_else(|| "No report file to attach the resolution to".to_string())?;
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    reports::upsert_resolution(&path, &choice, &text, &date)
        .await
        .map_err(|e| e.to_string())
}

/// Remove the `## Resolution` section from a task's report.
#[tauri::command]
async fn delete_resolution(
    app: AppHandle,
    task_id: String,
    reports_dir: Option<String>,
) -> Result<(), String> {
    let dir = resolve_reports_dir(&app, reports_dir);
    let path = reports::find_report(&dir, &task_id)
        .await
        .ok_or_else(|| "No report file".to_string())?;
    reports::remove_resolution(&path).await.map_err(|e| e.to_string())
}

/// Read a report markdown file (for the report view).
#[tauri::command]
async fn read_report(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_pi() -> doctor::PiStatus {
    doctor::check_pi().await
}

#[tauri::command]
async fn check_skill() -> doctor::SkillStatus {
    doctor::check_skill().await
}

#[tauri::command]
async fn check_copilot() -> doctor::CopilotStatus {
    doctor::check_copilot().await
}

#[tauri::command]
fn set_runtime_config(state: tauri::State<'_, api::ConfigState>, config: api::RuntimeConfig) {
    *state.0.lock().unwrap() = config;
}

#[tauri::command]
fn get_api_settings(server: tauri::State<'_, api::ServerState>) -> api::ApiSettings {
    server.settings.lock().unwrap().clone()
}

#[tauri::command]
fn set_api_port(server: tauri::State<'_, api::ServerState>, port: u16) -> api::ApiSettings {
    server.set_port(port);
    server.settings.lock().unwrap().clone()
}

#[tauri::command]
fn regenerate_api_token(server: tauri::State<'_, api::ServerState>) -> api::ApiSettings {
    server.regenerate_token()
}

#[tauri::command]
fn open_terminal(command: String) -> Result<(), String> {
    doctor::open_terminal(&command)
}

#[tauri::command]
async fn install_pi() -> Result<(), String> {
    doctor::install_pi().await
}

#[tauri::command]
async fn install_skill() -> Result<(), String> {
    doctor::install_skill().await
}

#[tauri::command]
async fn copilot_login(app: AppHandle) -> Result<(), String> {
    copilot::login(&app).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn copilot_models() -> Result<Vec<String>, String> {
    copilot::available_models().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn test_pi(model: String) -> Result<String, String> {
    pi::run_test(&model).await
}

#[tauri::command]
async fn fetch_teams(token: String) -> Result<Vec<clickup::Team>, String> {
    clickup::fetch_teams(&token).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_owner_options(
    token: String,
    team_id: String,
    field_id: String,
) -> Result<Vec<clickup::OwnerOption>, String> {
    clickup::fetch_owner_options(&token, &team_id, &field_id)
        .await
        .map_err(|e| e.to_string())
}

/// Deep links:
///   aierbaer://solve/<taskId> — start a solve
///   aierbaer://open/<taskId>  — focus the app on that ticket
fn handle_deep_link(app: &AppHandle, urls: Vec<String>) {
    for url in urls {
        let focus = || {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
            #[cfg(target_os = "macos")]
            {
                use tauri::ActivationPolicy;
                let _ = app.set_activation_policy(ActivationPolicy::Regular);
            }
        };
        if let Some(rest) = url.strip_prefix("aierbaer://solve/") {
            focus();
            let _ = app.emit("deep-link-solve", rest.trim_end_matches('/').to_string());
        } else if let Some(rest) = url.strip_prefix("aierbaer://open/") {
            focus();
            let _ = app.emit("deep-link-open", rest.trim_end_matches('/').to_string());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Second launch: forward any deep-link args to the running instance.
            handle_deep_link(app, argv);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Shared runtime config + local HTTP API for external dashboards.
            let cfg = Arc::new(Mutex::new(api::RuntimeConfig::default()));
            app.manage(api::ConfigState(cfg.clone()));
            let server = api::ServerState::new(app.handle().clone(), cfg);
            server.start();
            app.manage(server);

            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                // Register the scheme at runtime so it works from a dev build too
                // (production gets it from the bundled Info.plist).
                let _ = app.deep_link().register_all();
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls().into_iter().map(|u| u.to_string()).collect();
                    handle_deep_link(&handle, urls);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_tasks,
            fetch_task_detail,
            solve_task,
            read_report,
            check_pi,
            check_skill,
            check_copilot,
            open_terminal,
            set_runtime_config,
            get_api_settings,
            set_api_port,
            regenerate_api_token,
            install_pi,
            install_skill,
            copilot_login,
            copilot_models,
            test_pi,
            fetch_teams,
            fetch_owner_options,
            read_report_for,
            list_report_ids,
            list_reports_meta,
            save_resolution,
            delete_resolution
        ])
        .run(tauri::generate_context!())
        .expect("error while running Personal Aierbaer");
}
