//! Local HTTP API so an external dashboard or coding agent can drive the same
//! inbox, reports, and resolutions. Binds 127.0.0.1 only, guarded by a personal
//! token (except /api/health). Port + token are configurable and persisted.

use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager};
use tower_http::cors::CorsLayer;

use crate::{clickup, pi, reports};

pub const DEFAULT_API_PORT: u16 = 4849;

/// ClickUp/pi config the API acts with. Pushed from the UI.
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct RuntimeConfig {
    pub token: String,
    pub team_id: String,
    pub owner_field_id: String,
    pub owner_value: i64,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub repo: Option<String>,
    #[serde(default)]
    pub reports_dir: Option<String>,
}

pub struct ConfigState(pub Arc<Mutex<RuntimeConfig>>);

/// Persisted API server settings (port + personal token).
#[derive(Clone, Serialize, Deserialize)]
pub struct ApiSettings {
    pub port: u16,
    pub token: String,
}

impl Default for ApiSettings {
    fn default() -> Self {
        ApiSettings { port: DEFAULT_API_PORT, token: gen_token() }
    }
}

pub fn gen_token() -> String {
    let mut rng = rand::thread_rng();
    (0..32).map(|_| format!("{:x}", rng.gen_range(0..16))).collect()
}

#[derive(Clone)]
struct ApiState {
    cfg: Arc<Mutex<RuntimeConfig>>,
    app: AppHandle,
    token: String,
}

/// Managed state: settings + the running server task, so we can restart on change.
pub struct ServerState {
    pub settings: Arc<Mutex<ApiSettings>>,
    cfg: Arc<Mutex<RuntimeConfig>>,
    app: AppHandle,
    task: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl ServerState {
    pub fn new(app: AppHandle, cfg: Arc<Mutex<RuntimeConfig>>) -> Self {
        let settings = load_settings(&app);
        ServerState {
            settings: Arc::new(Mutex::new(settings)),
            cfg,
            app,
            task: Arc::new(Mutex::new(None)),
        }
    }

    pub fn start(&self) {
        let snapshot = self.settings.lock().unwrap().clone();
        let jh = spawn_server(self.app.clone(), self.cfg.clone(), snapshot);
        *self.task.lock().unwrap() = Some(jh);
    }

    fn restart(&self) {
        if let Some(t) = self.task.lock().unwrap().take() {
            t.abort();
        }
        self.start();
    }

    pub fn set_port(&self, port: u16) {
        {
            let mut s = self.settings.lock().unwrap();
            s.port = port;
            save_settings(&self.app, &s);
        }
        self.restart();
    }

    pub fn regenerate_token(&self) -> ApiSettings {
        let out = {
            let mut s = self.settings.lock().unwrap();
            s.token = gen_token();
            save_settings(&self.app, &s);
            s.clone()
        };
        self.restart();
        out
    }
}

fn settings_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    dir.join("api.json")
}

fn load_settings(app: &AppHandle) -> ApiSettings {
    let path = settings_path(app);
    if let Ok(s) = std::fs::read_to_string(&path) {
        if let Ok(v) = serde_json::from_str::<ApiSettings>(&s) {
            return v;
        }
    }
    let def = ApiSettings::default();
    save_settings(app, &def);
    def
}

fn save_settings(app: &AppHandle, s: &ApiSettings) {
    let path = settings_path(app);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(s) {
        let _ = std::fs::write(&path, json);
    }
}

fn resolve_reports_dir(cfg: &RuntimeConfig) -> PathBuf {
    if let Some(d) = &cfg.reports_dir {
        if !d.trim().is_empty() {
            return PathBuf::from(d);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join("Documents/Personal Aierbaer/Reports");
    }
    std::env::temp_dir().join("aierbaer-reports")
}

fn clickup_config(cfg: &RuntimeConfig) -> clickup::ClickUpConfig {
    clickup::ClickUpConfig {
        token: cfg.token.clone(),
        team_id: cfg.team_id.clone(),
        owner_field_id: cfg.owner_field_id.clone(),
        owner_value: cfg.owner_value,
    }
}

type ApiResult = Result<Json<Value>, (StatusCode, String)>;

fn err(e: impl ToString) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

async fn auth(State(st): State<ApiState>, req: Request, next: Next) -> Result<Response, StatusCode> {
    if req.uri().path() == "/api/health" || st.token.is_empty() {
        return Ok(next.run(req).await);
    }
    let header = req
        .headers()
        .get("x-aierbaer-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .or_else(|| {
            req.headers()
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(|s| s.to_string())
        });
    if header.as_deref() == Some(st.token.as_str()) {
        Ok(next.run(req).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "app": "Personal Aierbaer" }))
}

async fn inbox(State(st): State<ApiState>) -> ApiResult {
    let cfg = st.cfg.lock().unwrap().clone();
    if cfg.token.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "not configured yet".into()));
    }
    let tasks = clickup::fetch_tasks(&clickup_config(&cfg)).await.map_err(err)?;
    let meta = reports::list_meta(&resolve_reports_dir(&cfg)).await;
    let items: Vec<Value> = tasks
        .into_iter()
        .map(|t| {
            let m = meta.iter().find(|m| m.id == t.id);
            json!({
                "id": t.id, "name": t.name, "status": t.status,
                "statusColor": t.status_color, "url": t.url, "list": t.list,
                "tags": t.tags, "dateUpdated": t.date_updated,
                "hasReport": m.is_some(),
                "resolved": m.map(|m| m.resolved).unwrap_or(false),
                "choice": m.and_then(|m| m.choice.clone()),
            })
        })
        .collect();
    Ok(Json(json!({ "items": items })))
}

async fn report(State(st): State<ApiState>, Path(id): Path<String>) -> ApiResult {
    let dir = resolve_reports_dir(&st.cfg.lock().unwrap().clone());
    match reports::find_report(&dir, &id).await {
        Some(p) => {
            let md = tokio::fs::read_to_string(&p).await.map_err(err)?;
            Ok(Json(json!({ "taskId": id, "markdown": md })))
        }
        None => Ok(Json(json!({ "taskId": id, "markdown": Value::Null }))),
    }
}

async fn get_resolution(State(st): State<ApiState>, Path(id): Path<String>) -> ApiResult {
    let dir = resolve_reports_dir(&st.cfg.lock().unwrap().clone());
    let Some(p) = reports::find_report(&dir, &id).await else {
        return Ok(Json(json!({ "taskId": id, "resolved": false })));
    };
    let md = tokio::fs::read_to_string(&p).await.map_err(err)?;
    let (resolved, choice, notes) = parse_resolution(&md);
    Ok(Json(json!({ "taskId": id, "resolved": resolved, "choice": choice, "notes": notes })))
}

fn parse_resolution(md: &str) -> (bool, Option<String>, Option<String>) {
    let Some(i) = md.find("\n## Resolution") else {
        return (false, None, None);
    };
    let sec = &md[i..];
    let choice = sec
        .lines()
        .find_map(|l| l.trim().strip_prefix("**Chosen:**").map(|s| s.trim().to_string()));
    let notes = sec
        .split_once("**Resolved:**")
        .and_then(|(_, rest)| rest.split_once('\n'))
        .map(|(_, body)| body.trim().to_string())
        .filter(|s| !s.is_empty());
    (true, choice, notes)
}

#[derive(Deserialize)]
struct ResolutionBody {
    choice: String,
    #[serde(default)]
    text: String,
}

async fn set_resolution(
    State(st): State<ApiState>,
    Path(id): Path<String>,
    Json(body): Json<ResolutionBody>,
) -> ApiResult {
    let dir = resolve_reports_dir(&st.cfg.lock().unwrap().clone());
    let path = reports::find_report(&dir, &id)
        .await
        .ok_or((StatusCode::NOT_FOUND, "no report".into()))?;
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    reports::upsert_resolution(&path, &body.choice, &body.text, &date)
        .await
        .map_err(err)?;
    Ok(Json(json!({ "ok": true })))
}

async fn delete_resolution(State(st): State<ApiState>, Path(id): Path<String>) -> ApiResult {
    let dir = resolve_reports_dir(&st.cfg.lock().unwrap().clone());
    let path = reports::find_report(&dir, &id)
        .await
        .ok_or((StatusCode::NOT_FOUND, "no report".into()))?;
    reports::remove_resolution(&path).await.map_err(err)?;
    Ok(Json(json!({ "ok": true })))
}

async fn solve(State(st): State<ApiState>, Path(id): Path<String>) -> StatusCode {
    let cfg = st.cfg.lock().unwrap().clone();
    if cfg.token.is_empty() {
        return StatusCode::BAD_REQUEST;
    }
    let app = st.app.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(detail) = clickup::fetch_task_detail(&cfg.token, &id).await {
            let dir = resolve_reports_dir(&cfg);
            let model = if cfg.model.is_empty() {
                "github-copilot/claude-opus-4.8".to_string()
            } else {
                cfg.model.clone()
            };
            let _ = pi::run_solve(&app, &detail, &dir, &model, cfg.repo.as_deref()).await;
        }
    });
    StatusCode::ACCEPTED
}

fn spawn_server(app: AppHandle, cfg: Arc<Mutex<RuntimeConfig>>, settings: ApiSettings) -> JoinHandle<()> {
    let state = ApiState { cfg, app, token: settings.token.clone() };
    let port = settings.port;
    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route("/api/health", get(health))
            .route("/api/inbox", get(inbox))
            .route("/api/report/:id", get(report))
            .route(
                "/api/resolution/:id",
                get(get_resolution).post(set_resolution).delete(delete_resolution),
            )
            .route("/api/solve/:id", post(solve))
            .layer(middleware::from_fn_with_state(state.clone(), auth))
            .layer(CorsLayer::permissive())
            .with_state(state);

        match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => {
                println!("[aierbaer] API listening on http://127.0.0.1:{port}");
                if let Err(e) = axum::serve(listener, router).await {
                    eprintln!("[aierbaer] API server error: {e}");
                }
            }
            Err(e) => eprintln!("[aierbaer] could not bind API port {port}: {e}"),
        }
    })
}
