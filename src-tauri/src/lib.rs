//! Hermes Workspace — Tauri 2 + Rust backend
//!
//! This crate is the desktop shell that wraps the Hermes Workspace web app.
//! The web UI (Vite/TanStack Start) is loaded inside the Tauri webview; the
//! Rust side is responsible for everything *outside* the webview:
//!
//! * single-instance locking
//! * settings persistence (JSON in OS app-config dir)
//! * Hermes Agent installation / gateway / dashboard lifecycle
//! * `gateway_request` HTTP proxy (lets the webview reach `http://127.0.0.1:8642`
//!   without CORS preflights or explicit CORS headers on the gateway side)
//! * window controls + system tray
//! * auto-update via `tauri-plugin-updater`
//!
//! The web UI invokes these via `window.__TAURI__.core.invoke('cmd_name', args)`.

use std::collections::HashMap;
use std::fs;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use tracing_subscriber::EnvFilter;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_GATEWAY_URL: &str = "http://127.0.0.1:8642";
const DEFAULT_DASHBOARD_URL: &str = "http://127.0.0.1:9119";
const DEFAULT_WORKSPACE_PORT: u16 = 3000;
const HERMES_INSTALL_CMD_WIN: &str = "pip install hermes-agent";
const HERMES_INSTALL_CMD_UNIX: &str =
    "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup";

static HTTP: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent(concat!("HermesWorkspace/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("reqwest client")
});

// ---------------------------------------------------------------------------
// Settings (persisted to <app-config-dir>/settings.json)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub gateway: GatewaySettings,
    pub appearance: AppearanceSettings,
    pub general: GeneralSettings,
    pub window: WindowSettings,
    pub advanced: AdvancedSettings,
    pub setup_complete: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewaySettings {
    pub mode: String, // "local" | "remote"
    pub url: String,
    pub dashboard_url: String,
    pub token_secret_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceSettings {
    pub theme: String,
    pub accent_color: String,
    pub font_size: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralSettings {
    pub launch_at_startup: bool,
    pub minimize_to_tray: bool,
    pub close_to_tray: bool,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowSettings {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: f64,
    pub height: f64,
    pub is_maximized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvancedSettings {
    pub dev_mode: bool,
    pub log_level: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            gateway: GatewaySettings {
                mode: "local".into(),
                url: DEFAULT_GATEWAY_URL.into(),
                dashboard_url: DEFAULT_DASHBOARD_URL.into(),
                token_secret_ref: String::new(),
            },
            appearance: AppearanceSettings {
                theme: "claude-nous".into(),
                accent_color: "amber".into(),
                font_size: "md".into(),
            },
            general: GeneralSettings {
                launch_at_startup: false,
                minimize_to_tray: true,
                close_to_tray: true,
                language: "zh-CN".into(),
            },
            window: WindowSettings {
                x: None,
                y: None,
                width: 1480.0,
                height: 940.0,
                is_maximized: false,
            },
            advanced: AdvancedSettings {
                dev_mode: false,
                log_level: "info".into(),
            },
            setup_complete: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

pub struct AppState {
    pub settings: Arc<Mutex<AppSettings>>,
    pub config_dir: PathBuf,
    pub spawned: Arc<Mutex<HashMap<String, Child>>>,
    pub install_process: Arc<Mutex<Option<Child>>>,
}

impl AppState {
    fn save_settings(&self) -> Result<(), String> {
        let settings = self.settings.lock().unwrap();
        let json = serde_json::to_string_pretty(&*settings).map_err(|e| e.to_string())?;
        let path = self.config_dir.join("settings.json");
        fs::write(&path, json).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn load_settings(config_dir: &PathBuf) -> AppSettings {
        let path = config_dir.join("settings.json");
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
                return settings;
            }
        }
        AppSettings::default()
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn temp_log_path(label: &str) -> PathBuf {
    let dir = std::env::temp_dir();
    dir.join(format!("hermes-workspace-{}.log", label))
}

fn is_hermes_installed() -> bool {
    let cmd = if cfg!(target_os = "windows") {
        ("where", "hermes")
    } else {
        ("which", "hermes")
    };
    Command::new(cmd.0)
        .arg(cmd.1)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

async fn http_get_json(url: &str) -> serde_json::Value {
    match HTTP.get(url).send().await {
        Ok(resp) => {
            let status = resp.status();
            let ok = status.is_success();
            let body = resp.json::<serde_json::Value>().await.unwrap_or(serde_json::json!({}));
            serde_json::json!({
                "ok": ok,
                "status": status.as_u16(),
                "data": body,
            })
        }
        Err(e) => serde_json::json!({
            "ok": false,
            "status": 0,
            "error": e.to_string(),
        }),
    }
}

fn port_in_use(port: u16) -> bool {
    use std::net::TcpListener;
    TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_err()
}

async fn service_port_status(
    id: &str,
    label: &str,
    port: u16,
    url: &str,
) -> serde_json::Value {
    let health = http_get_json(url).await;
    let reachable = health.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    serde_json::json!({
        "id": id,
        "label": label,
        "host": "127.0.0.1",
        "port": port,
        "url": url,
        "inUse": port_in_use(port),
        "reachable": reachable,
        "status": health.get("status").and_then(|v| v.as_u64()).unwrap_or(0),
        "error": health.get("error").and_then(|v| v.as_str()).unwrap_or_default(),
    })
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
async fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
async fn get_all_settings(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    Ok(serde_json::to_value(state.settings.lock().unwrap().clone()).unwrap())
}

#[tauri::command]
async fn set_settings(
    key: String,
    value: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut s = state.settings.lock().unwrap();
        match key.as_str() {
            "gateway" => {
                if let Ok(g) = serde_json::from_value(value) {
                    s.gateway = g;
                }
            }
            "appearance" => {
                if let Ok(a) = serde_json::from_value(value) {
                    s.appearance = a;
                }
            }
            "general" => {
                if let Ok(g) = serde_json::from_value(value) {
                    s.general = g;
                }
            }
            "window" => {
                if let Ok(w) = serde_json::from_value(value) {
                    s.window = w;
                }
            }
            "advanced" => {
                if let Ok(a) = serde_json::from_value(value) {
                    s.advanced = a;
                }
            }
            "setupComplete" => {
                if let Some(v) = value.as_bool() {
                    s.setup_complete = Some(v);
                }
            }
            _ => return Err(format!("unknown settings key: {}", key)),
        }
    }
    state.save_settings()
}

#[tauri::command]
async fn reset_settings(state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut s = state.settings.lock().unwrap();
        *s = AppSettings::default();
    }
    state.save_settings()
}

/// Mirrors Electron's `desktop:status` IPC. Probes Hermes install + gateway +
/// dashboard reachability and reports back to the UI for the bootstrap wizard.
#[tauri::command]
async fn desktop_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let s = state.settings.lock().unwrap().clone();
    let gw_url = format!("{}/health", s.gateway.url.trim_end_matches('/'));
    let db_url = format!("{}/api/status", s.gateway.dashboard_url.trim_end_matches('/'));

    let (gw, db) = tokio::join!(http_get_json(&gw_url), http_get_json(&db_url));

    let installer_running = {
        let mut guard = state.install_process.lock().unwrap();
        guard
            .as_mut()
            .map(|c| {
                // try_wait is non-blocking; we don't need the result here.
                c.try_wait().ok().flatten().is_none()
            })
            .unwrap_or(false)
    };

    let spawned: Vec<String> = state.spawned.lock().unwrap().keys().cloned().collect();

    Ok(serde_json::json!({
        "ok": true,
        "platform": std::env::consts::OS,
        "version": env!("CARGO_PKG_VERSION"),
        "hermesInstalled": is_hermes_installed(),
        "gatewayReachable": gw.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
        "gateway": gw,
        "dashboardReachable": db.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
        "dashboard": db,
        "installerRunning": installer_running,
        "spawned": spawned,
        "settingsComplete": s.setup_complete.unwrap_or(false),
    }))
}

/// Spawn the official Hermes installer in the background. Mirrors
/// `desktop:install-hermes` in the legacy Electron build.
#[tauri::command]
async fn install_hermes(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    {
        let mut guard = state.install_process.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            if child.try_wait().ok().flatten().is_none() {
                return Ok(serde_json::json!({
                    "ok": false,
                    "started": false,
                    "reason": "already-running",
                }));
            }
        }

        let log_path = temp_log_path("install");
        let log_file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| e.to_string())?;

        // Build the install command. We always pipe stdio to a log file and
        // use `CREATE_NO_WINDOW` on Windows so users never see a console pop.
        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("cmd");
            c.arg("/c").arg(HERMES_INSTALL_CMD_WIN);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                c.creation_flags(CREATE_NO_WINDOW);
            }
            c
        } else {
            let mut c = Command::new("bash");
            c.arg("-lc").arg(HERMES_INSTALL_CMD_UNIX);
            c
        };
        cmd.stdin(Stdio::null())
            .stdout(Stdio::from(log_file.try_clone().unwrap()))
            .stderr(Stdio::from(log_file));

        let child = cmd.spawn().map_err(|e| e.to_string())?;
        let pid = child.id();
        *guard = Some(child);

        // Spawn a one-shot watcher to clear the slot and emit a Tauri event
        // when install finishes — the UI can subscribe via listen('install:done').
        let slot = Arc::clone(&state.install_process);
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(500)).await;
                let mut guard = slot.lock().unwrap();
                if let Some(child) = guard.as_mut() {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            let _ = app2.emit(
                                "install:done",
                                serde_json::json!({ "ok": status.success(), "code": status.code() }),
                            );
                            *guard = None;
                            return;
                        }
                        Ok(None) => continue, // still running
                        Err(_) => {
                            *guard = None;
                            return;
                        }
                    }
                } else {
                    return;
                }
            }
        });

        Ok(serde_json::json!({
            "ok": true,
            "started": true,
            "pid": pid,
            "logPath": log_path.to_string_lossy(),
        }))
    }
}

/// Make sure gateway + dashboard are running, spawning them if absent.
/// Mirrors `desktop:start-backend` from the Electron build.
#[tauri::command]
async fn start_backend(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let settings = state.settings.lock().unwrap().clone();

    if !is_hermes_installed() {
        return Ok(serde_json::json!({
            "ok": false,
            "installed": false,
            "reason": "hermes-cli not found; install first",
        }));
    }

    // Try to use already-running services first.
    let gw_health = http_get_json(&format!("{}/health", settings.gateway.url)).await;
    let db_health = http_get_json(&format!("{}/api/status", settings.gateway.dashboard_url)).await;
    let gw_already = gw_health.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    let db_already = db_health.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);

    if gw_already && db_already {
        return Ok(serde_json::json!({
            "ok": true,
            "installed": true,
            "gatewayStarted": false,
            "dashboardStarted": false,
            "gatewayReachable": true,
            "dashboardReachable": true,
        }));
    }

    let mut gateway_started = false;
    let mut dashboard_started = false;

    // Scope the lock so the std::sync::MutexGuard is released *before* any
    // await point. Tauri 2 requires command futures to be `Send`, and the
    // std::sync::MutexGuard is not `Send` even when explicitly dropped, so we
    // put the entire critical section in a nested block.
    {
        let mut spawned = state.spawned.lock().unwrap();

        if !gw_already {
            match spawn_logged("hermes", &["gateway", "run"], "gateway") {
                Ok(child) => {
                    spawned.insert("gateway".into(), child);
                    gateway_started = true;
                }
                Err(e) => tracing::warn!("failed to spawn gateway: {}", e),
            }
        }

        if !db_already {
            let args = vec![
                "dashboard",
                "--port",
                "9119",
                "--host",
                "127.0.0.1",
                "--no-open",
            ];
            match spawn_logged("hermes", &args, "dashboard") {
                Ok(child) => {
                    spawned.insert("dashboard".into(), child);
                    dashboard_started = true;
                }
                Err(e) => tracing::warn!("failed to spawn dashboard: {}", e),
            }
        }
    } // `spawned` (MutexGuard) goes out of scope here.

    tokio::time::sleep(Duration::from_millis(800)).await;
    let _ = app.emit("backend:started", serde_json::json!({ "ok": true }));

    let gw_health = http_get_json(&format!("{}/health", settings.gateway.url)).await;
    let db_health = http_get_json(&format!("{}/api/status", settings.gateway.dashboard_url)).await;

    Ok(serde_json::json!({
        "ok": true,
        "installed": true,
        "gatewayStarted": gateway_started,
        "dashboardStarted": dashboard_started,
        "gatewayReachable": gw_health.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
        "dashboardReachable": db_health.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
    }))
}

fn spawn_logged(program: &str, args: &[&str], label: &str) -> std::io::Result<Child> {
    let log_path = temp_log_path(label);
    let log_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;

    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file.try_clone()?))
        .stderr(Stdio::from(log_file));
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
}

#[tauri::command]
async fn open_logs(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = std::env::temp_dir();
    let path_str = dir.to_string_lossy().to_string();
    let _ = app.opener().open_path(path_str.clone(), None::<&str>);
    Ok(serde_json::json!({ "ok": true, "path": path_str }))
}

#[tauri::command]
async fn shell_open_external(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn gateway_health(gateway_url: String) -> Result<serde_json::Value, String> {
    if gateway_url.is_empty() {
        return Ok(serde_json::json!({
            "ok": false,
            "status": "no-url",
            "error": "Gateway URL not configured",
        }));
    }
    let url = format!("{}/health", gateway_url.trim_end_matches('/'));
    Ok(http_get_json(&url).await)
}

/// 5-second cache for the synthesised `/api/gateway-status` payload. Probing
/// the gateway once per call would be wasteful (and slow), and Hermes Agent's
/// own capabilities don't change at runtime, so 5s is a good balance between
/// freshness and probe cost.
static GATEWAY_STATUS_CACHE: Lazy<Mutex<Option<(u64, serde_json::Value)>>> =
    Lazy::new(|| Mutex::new(None));
const GATEWAY_STATUS_CACHE_TTL_MS: u64 = 5_000;

#[tauri::command]
async fn gateway_status(gateway_url: String) -> Result<serde_json::Value, String> {
    if gateway_url.is_empty() {
        return Ok(serde_json::json!({
            "ok": false,
            "error": "Gateway URL not configured",
        }));
    }
    let base = gateway_url.trim_end_matches('/').to_string();

    // Return cached payload if still fresh.
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    if let Ok(guard) = GATEWAY_STATUS_CACHE.lock() {
        if let Some((ts, payload)) = guard.as_ref() {
            if now_ms.saturating_sub(*ts) < GATEWAY_STATUS_CACHE_TTL_MS {
                return Ok(serde_json::json!({ "ok": true, "data": payload }));
            }
        }
    }

    // Probe the gateway's known endpoints in parallel. We treat 200, 401, and
    // 405 as "exists": the gateway frequently guards `/v1/*` and `/api/*`
    // behind auth, so a 401 means the route is wired up; a 405 (on a GET to
    // `/v1/chat/completions`) means the path exists but the wrong method was
    // used. Only 404 / network errors count as "missing".
    async fn probe(client: &reqwest::Client, url: String, accept_405: bool) -> bool {
        match client.get(&url).send().await {
            Ok(r) => {
                let s = r.status().as_u16();
                s == 200 || s == 401 || (accept_405 && s == 405)
            }
            Err(_) => false,
        }
    }

    let health_url = format!("{}/health", base);
    let models_url = format!("{}/v1/models", base);
    let chat_url = format!("{}/v1/chat/completions", base);
    let sessions_url = format!("{}/api/sessions", base);
    let tasks_url = format!("{}/api/tasks", base);
    let config_url = format!("{}/api/config", base);

    let (health_ok, models_ok, chat_ok, sessions_ok, tasks_ok, config_endpoint_ok) = tokio::join!(
        probe(&HTTP, health_url, false),
        probe(&HTTP, models_url, false),
        probe(&HTTP, chat_url, true),
        probe(&HTTP, sessions_url, false),
        probe(&HTTP, tasks_url, false),
        probe(&HTTP, config_url, false),
    );

    // Pull the version/platform out of `/health` if we can; otherwise leave
    // them as null and let the UI fall back to "Hermes Agent".
    let mut version: Option<String> = None;
    let mut platform: Option<String> = None;
    if let Ok(r) = HTTP.get(&format!("{}/health", base)).send().await {
        if let Ok(v) = r.json::<serde_json::Value>().await {
            version = v
                .get("version")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
            platform = v
                .get("platform")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
        }
    }

    // The `config` capability normally comes from the gateway's `/api/config`
    // endpoint, which in turn is served by the Hermes dashboard on :9119.
    // The desktop deployment does not start the dashboard, and the
    // zero-fork gateway on :8642 returns 404 for that route, so we fall back
    // to checking the agent's own `config.yaml` on disk. That's exactly what
    // `claude_config_get` reads, so the answer is consistent: if we can read
    // the file, the "Hermes Agent Settings" panel is fully usable.
    let config_yaml_path = hermes_config_dir().join("config.yaml");
    let local_config_ok = config_yaml_path.is_file();
    let config_ok = config_endpoint_ok || local_config_ok;

    let payload = serde_json::json!({
        "capabilities": {
            "health": health_ok,
            "models": models_ok,
            "chatCompletions": chat_ok,
            "sessions": sessions_ok,
            "tasks": tasks_ok,
            "skills": sessions_ok,
            "config": config_ok,
            "memory": local_config_ok,
            "jobs": tasks_ok,
        },
        "claudeUrl": format!("{}/v1", base),
        "platform": platform,
        "version": version,
        "gatewayUrl": base,
        "synthesised": true,
    });

    if let Ok(mut guard) = GATEWAY_STATUS_CACHE.lock() {
        *guard = Some((now_ms, payload.clone()));
    }

    Ok(serde_json::json!({ "ok": true, "data": payload }))
}

#[tauri::command]
async fn gateway_request(
    path: String,
    init: Option<serde_json::Value>,
    gateway_url: String,
) -> Result<serde_json::Value, String> {
    if gateway_url.is_empty() {
        return Ok(serde_json::json!({
            "ok": false,
            "error": "Gateway URL not configured",
        }));
    }
    let url = format!("{}{}", gateway_url.trim_end_matches('/'), path);
    let method = init
        .as_ref()
        .and_then(|i| i.get("method"))
        .and_then(|m| m.as_str())
        .unwrap_or("GET");
    let mut req = HTTP.request(
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?,
        &url,
    );
    if let Some(init_val) = init {
        if let Some(headers) = init_val.get("headers").and_then(|h| h.as_object()) {
            for (k, v) in headers {
                if let Some(s) = v.as_str() {
                    req = req.header(k, s);
                }
            }
        }
        if let Some(body) = init_val.get("body") {
            req = req.json(body);
        }
    }
    match req.send().await {
        Ok(resp) => match resp.json::<serde_json::Value>().await {
            Ok(json) => Ok(serde_json::json!({ "ok": true, "data": json })),
            Err(_) => Ok(serde_json::json!({ "ok": true, "data": null })),
        },
        Err(e) => Ok(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

fn read_config_model() -> (String, String) {
    let home = hermes_config_dir();
    let config = read_hermes_yaml(&home.join("config.yaml"));
    let model_section = read_record(&config["model"]);
    let provider = read_string(&model_section["provider"]);
    let model = read_string(&model_section["default"]);
    (provider, model)
}

fn portable_history_to_messages(history: &serde_json::Value) -> Vec<serde_json::Value> {
    let mut messages = Vec::new();
    let Some(items) = history.as_array() else {
        return messages;
    };
    for item in items.iter().rev().take(20).rev() {
        let role = read_string(&item["role"]);
        if role != "user" && role != "assistant" && role != "system" {
            continue;
        }
        let content = match &item["content"] {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Array(parts) => parts
                .iter()
                .filter_map(|part| {
                    part.get("text")
                        .and_then(|v| v.as_str())
                        .or_else(|| part.get("content").and_then(|v| v.as_str()))
                })
                .collect::<Vec<_>>()
                .join("\n"),
            other => other.as_str().unwrap_or_default().to_string(),
        };
        if !content.trim().is_empty() {
            messages.push(serde_json::json!({ "role": role, "content": content }));
        }
    }
    messages
}

#[tauri::command]
async fn send_stream(body: serde_json::Value, gateway_url: String) -> Result<serde_json::Value, String> {
    let gateway = if gateway_url.is_empty() {
        DEFAULT_GATEWAY_URL.to_string()
    } else {
        gateway_url.trim_end_matches('/').to_string()
    };
    let home = hermes_config_dir();
    let env = read_hermes_env(&home.join(".env"));
    let (_, configured_model) = read_config_model();
    let model = body
        .get("model")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .unwrap_or(configured_model);
    if model.is_empty() {
        return Ok(serde_json::json!({ "ok": false, "error": "No model configured" }));
    }
    let message = body
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if message.trim().is_empty() {
        return Ok(serde_json::json!({ "ok": false, "error": "message required" }));
    }

    let mut messages = portable_history_to_messages(&body["history"]);
    messages.push(serde_json::json!({ "role": "user", "content": message }));

    let req_body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false,
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1800))
        .user_agent(concat!("HermesWorkspace/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client
        .post(format!("{}/v1/chat/completions", gateway))
        .header("content-type", "application/json");
    if let Some(token) = env.get("API_SERVER_KEY").filter(|v| !v.trim().is_empty()) {
        req = req.header("authorization", format!("Bearer {}", token.trim()));
    }
    if let Some(session_key) = body.get("sessionKey").and_then(|v| v.as_str()) {
        if !session_key.is_empty() && session_key != "new" && session_key != "main" {
            req = req.header("x-hermes-session-id", session_key);
            req = req.header("x-claude-session-id", session_key);
        }
    }

    let resp = match req.json(&req_body).send().await {
        Ok(r) => r,
        Err(e) => return Ok(serde_json::json!({ "ok": false, "error": e.to_string() })),
    };
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    if status < 200 || status >= 300 {
        return Ok(serde_json::json!({
            "ok": false,
            "status": status,
            "error": if text.is_empty() { format!("HTTP {}", status) } else { text },
        }));
    }
    let data: serde_json::Value = serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({}));
    let content = data
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .or_else(|| data.pointer("/choices/0/delta/content").and_then(|v| v.as_str()))
        .or_else(|| data.get("output_text").and_then(|v| v.as_str()))
        .unwrap_or_default()
        .to_string();
    Ok(serde_json::json!({
        "ok": true,
        "data": {
            "text": content,
            "raw": data,
            "sessionKey": body.get("sessionKey").cloned().unwrap_or_else(|| serde_json::Value::String("main".into())),
            "friendlyId": body.get("friendlyId").cloned().unwrap_or_else(|| serde_json::Value::String("main".into())),
            "runId": format!("desktop-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)),
        }
    }))
}

// ---------------------------------------------------------------------------
// Hermes Agent configuration passthrough
//
// The web UI calls `GET/PATCH /api/claude-config` to read the agent's active
// provider, model, and the list of configured providers. Hermes Agent's
// gateway (:8642) does not expose those endpoints in its zero-fork flavour
// (the dashboard :9119 would normally serve them, but the dashboard isn't
// started in our deployment). To keep the UI working without a hard dependency
// on the dashboard, we read the agent's own config files directly from
// `%LOCALAPPDATA%\hermes\` (or the platform equivalent) and synthesise the
// same shape the legacy `handleHermesConfigGet` handler produced.
//
// The format mirrors `src/server/hermes-config-store.ts` and
// `src/server/hermes-config-migration.ts` on purpose: those are the canonical
// definitions of how YAML/env fields map to the provider list. Keep both
// implementations in sync if the schema changes upstream.
// ---------------------------------------------------------------------------

fn hermes_config_dir() -> PathBuf {
    // Honour the same env vars the agent itself does, then fall back to the
    // platform default. On Windows the agent stores its config in
    // %LOCALAPPDATA%\hermes\ — `dirs::data_local_dir()` returns exactly that.
    if let Ok(p) = std::env::var("HERMES_HOME") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    if let Ok(p) = std::env::var("CLAUDE_HOME") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    dirs::data_local_dir()
        .map(|p| p.join("hermes"))
        .unwrap_or_else(|| PathBuf::from(".hermes"))
}

fn read_hermes_env(path: &PathBuf) -> HashMap<String, String> {
    let mut env: HashMap<String, String> = HashMap::new();
    let Ok(content) = fs::read_to_string(path) else {
        return env;
    };
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some(eq) = trimmed.find('=') else { continue };
        let key = trimmed[..eq].trim().to_string();
        let mut value = trimmed[eq + 1..].trim().to_string();
        if value.len() >= 2 {
            let first = value.chars().next().unwrap();
            let last = value.chars().last().unwrap();
            if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
                value = value[1..value.len() - 1].to_string();
            }
        }
        if !key.is_empty() {
            env.insert(key, value);
        }
    }
    env
}

fn write_hermes_env(path: &PathBuf, env: &HashMap<String, String>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut out = String::new();
    for (k, v) in env {
        if v.contains('\n') || v.contains('\r') {
            return Err(format!("env value for {} contains a newline", k));
        }
        let needs_quote = v.is_empty()
            || v.chars().any(|c| c.is_whitespace() || c == '#' || c == '=' || c == '"' || c == '\'');
        if needs_quote {
            // Single quotes handle values with no embedded single quote; for
            // pathological inputs we drop the inner quote rather than escape.
            if !v.contains('\'') {
                out.push_str(&format!("{k}='{v}'\n"));
            } else {
                out.push_str(&format!("{k}=\"{}\"\n", v.replace('"', "")));
            }
        } else {
            out.push_str(&format!("{k}={v}\n"));
        }
    }
    fs::write(path, out).map_err(|e| e.to_string())
}

fn read_hermes_yaml(path: &PathBuf) -> serde_json::Value {
    let Ok(content) = fs::read_to_string(path) else {
        return serde_json::json!({});
    };
    serde_yaml::from_str::<serde_yaml::Value>(&content)
        .map(|v| yaml_to_json(v))
        .unwrap_or_else(|_| serde_json::json!({}))
}

fn write_hermes_yaml(path: &PathBuf, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let yaml: serde_yaml::Value = json_to_yaml(value.clone());
    let serialized = serde_yaml::to_string(&yaml).map_err(|e| e.to_string())?;
    fs::write(path, serialized).map_err(|e| e.to_string())
}

fn yaml_to_json(v: serde_yaml::Value) -> serde_json::Value {
    match v {
        serde_yaml::Value::Null => serde_json::Value::Null,
        serde_yaml::Value::Bool(b) => serde_json::Value::Bool(b),
        serde_yaml::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                serde_json::Value::Number(i.into())
            } else if let Some(u) = n.as_u64() {
                serde_json::Value::Number(u.into())
            } else if let Some(f) = n.as_f64() {
                serde_json::Number::from_f64(f)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null)
            } else {
                serde_json::Value::Null
            }
        }
        serde_yaml::Value::String(s) => serde_json::Value::String(s),
        serde_yaml::Value::Sequence(seq) => {
            serde_json::Value::Array(seq.into_iter().map(yaml_to_json).collect())
        }
        serde_yaml::Value::Mapping(map) => {
            let mut out = serde_json::Map::new();
            for (k, val) in map {
                let key = match k {
                    serde_yaml::Value::String(s) => s,
                    serde_yaml::Value::Number(n) => n.to_string(),
                    serde_yaml::Value::Bool(b) => b.to_string(),
                    other => serde_yaml::to_string(&other).unwrap_or_default(),
                };
                out.insert(key, yaml_to_json(val));
            }
            serde_json::Value::Object(out)
        }
        serde_yaml::Value::Tagged(tagged) => yaml_to_json(tagged.value),
    }
}

fn json_to_yaml(v: serde_json::Value) -> serde_yaml::Value {
    match v {
        serde_json::Value::Null => serde_yaml::Value::Null,
        serde_json::Value::Bool(b) => serde_yaml::Value::Bool(b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                serde_yaml::Value::Number(i.into())
            } else if let Some(u) = n.as_u64() {
                serde_yaml::Value::Number(u.into())
            } else if let Some(f) = n.as_f64() {
                serde_yaml::Value::Number(f.into())
            } else {
                serde_yaml::Value::Null
            }
        }
        serde_json::Value::String(s) => serde_yaml::Value::String(s),
        serde_json::Value::Array(arr) => {
            serde_yaml::Value::Sequence(arr.into_iter().map(json_to_yaml).collect())
        }
        serde_json::Value::Object(obj) => {
            let mut map = serde_yaml::Mapping::new();
            for (k, val) in obj {
                map.insert(serde_yaml::Value::String(k), json_to_yaml(val));
            }
            serde_yaml::Value::Mapping(map)
        }
    }
}

fn read_string(value: &serde_json::Value) -> String {
    value
        .as_str()
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

fn mask_secret(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    if value.len() < 8 {
        return "***".to_string();
    }
    let prefix: String = value.chars().take(4).collect();
    let suffix: String = value
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{}...{}", prefix, suffix)
}

fn read_record(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(_) => value.clone(),
        _ => serde_json::json!({}),
    }
}

#[derive(Debug, Serialize)]
struct ProviderDef {
    id: &'static str,
    name: &'static str,
    kind: &'static str,
    env_keys: &'static [&'static str],
}

const PROVIDER_CATALOG: &[ProviderDef] = &[
    ProviderDef { id: "nous", name: "Nous Portal", kind: "oauth", env_keys: &[] },
    ProviderDef { id: "openai-codex", name: "OpenAI Codex", kind: "oauth", env_keys: &[] },
    ProviderDef { id: "anthropic", name: "Anthropic", kind: "api_key", env_keys: &["ANTHROPIC_API_KEY"] },
    ProviderDef { id: "openrouter", name: "OpenRouter", kind: "api_key", env_keys: &["OPENROUTER_API_KEY"] },
    ProviderDef { id: "zai", name: "Z.AI / GLM", kind: "api_key", env_keys: &["GLM_API_KEY"] },
    ProviderDef { id: "kimi-coding", name: "Kimi", kind: "api_key", env_keys: &["KIMI_API_KEY"] },
    ProviderDef { id: "minimax", name: "MiniMax", kind: "api_key", env_keys: &["MINIMAX_API_KEY"] },
    ProviderDef { id: "minimax-cn", name: "MiniMax (China)", kind: "api_key", env_keys: &["MINIMAX_CN_API_KEY"] },
    ProviderDef { id: "xiaomi", name: "Xiaomi MiMo", kind: "api_key", env_keys: &["XIAOMI_API_KEY"] },
    ProviderDef { id: "ollama", name: "Ollama", kind: "local", env_keys: &[] },
    ProviderDef { id: "atomic-chat", name: "Atomic Chat", kind: "local", env_keys: &[] },
    ProviderDef { id: "custom", name: "Custom", kind: "custom", env_keys: &["CUSTOM_API_KEY"] },
];

/// Build the JSON the UI expects from a `GET /api/claude-config` call. Mirrors
/// `normalizeHermesConfigState` in `src/server/hermes-config-migration.ts`.
fn build_claude_config_state(
    paths: &serde_json::Value,
    config: &serde_json::Value,
    env: &HashMap<String, String>,
) -> serde_json::Value {
    // Hermes supports both flat (`model: foo` + `provider: bar`) and nested
    // (`model: { provider, default, base_url }`) config shapes. Prefer nested.
    let model_section = read_record(&config["model"]);
    let flat_model = read_string(&config["model"]);
    let flat_provider = read_string(&config["provider"]);
    let model_is_nested = model_section.is_object() && !model_section.as_object().unwrap().is_empty();

    let active_model = if model_is_nested {
        read_string(&model_section["default"])
    } else {
        flat_model.clone()
    };
    let active_provider = if model_is_nested {
        let nested = read_string(&model_section["provider"]);
        if nested.is_empty() { flat_provider.clone() } else { nested }
    } else {
        flat_provider.clone()
    };

    let providers_map = read_record(&config["providers"]);
    let custom_section = config["custom_providers"].clone();
    let custom_arr: Vec<serde_json::Value> = match custom_section {
        serde_json::Value::Array(a) => a
            .into_iter()
            .filter(|v| v.is_object())
            .collect(),
        serde_json::Value::Object(_) => vec![custom_section],
        _ => vec![],
    };

    let mut providers_out: Vec<serde_json::Value> = Vec::new();
    for def in PROVIDER_CATALOG {
        let mut entry = serde_json::json!({
            "id": def.id,
            "name": def.name,
            "kind": def.kind,
            "configured": false,
            "authenticated": false,
            "available": false,
            "isDefault": active_provider == def.id,
            "authSource": "none",
            "envKeys": def.env_keys,
            "maskedCredentials": {},
            "models": [],
            "warnings": [],
        });
        let obj = entry.as_object_mut().unwrap();

        match def.kind {
            "api_key" | "custom" => {
                let mut masked = serde_json::Map::new();
                let mut configured = false;
                for env_key in def.env_keys {
                    let key_str = env_key.to_string();
                    if let Some(value) = env.get(&key_str) {
                        if !value.is_empty() {
                            configured = true;
                            masked.insert(
                                key_str,
                                serde_json::Value::String(mask_secret(value)),
                            );
                        }
                    }
                }
                if configured {
                    obj.insert("configured".into(), serde_json::Value::Bool(true));
                    obj.insert("authenticated".into(), serde_json::Value::Bool(true));
                    obj.insert("available".into(), serde_json::Value::Bool(true));
                    obj.insert("authSource".into(), serde_json::Value::String("env".into()));
                }
                obj.insert("maskedCredentials".into(), serde_json::Value::Object(masked));
            }
            "oauth" => {
                // OAuth tokens live in auth-profiles.json; not all Hermes Agent
                // builds ship that file. The desktop UI does not strictly need
                // the token to render the provider list, so we leave
                // configured=false here and let dashboard-backed deployments
                // upgrade via the gateway. This matches the previous
                // server-side behaviour for non-dashboard builds.
            }
            "local" => {
                // Local providers (ollama, atomic-chat) require runtime
                // probing. The desktop bridge cannot ping those without a
                // running daemon, so we mark them as not-detected. The UI
                // shows a "Not detected" pill for them in this mode.
                let _ = custom_arr; // suppress unused warning
            }
            _ => {}
        }
        providers_out.push(entry);
    }

    let mut custom_out: Vec<serde_json::Value> = Vec::new();
    for entry in custom_arr {
        let name = read_string(&entry["name"]);
        if name.is_empty() {
            continue;
        }
        let base_url = read_string(&entry["base_url"]);
        let api_key_env = read_string(&entry["key_env"]);
        let api_mode = read_string(&entry["api_mode"]);
        let configured = !base_url.is_empty();
        let available = configured && (api_key_env.is_empty() || env.contains_key(&api_key_env));
        custom_out.push(serde_json::json!({
            "id": name,
            "name": name,
            "baseUrl": base_url,
            "apiKeyEnv": if api_key_env.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(api_key_env) },
            "apiMode": if api_mode.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(api_mode) },
            "configured": configured,
            "available": available,
        }));
    }

    serde_json::json!({
        "ok": true,
        "paths": paths,
        "defaultModel": {
            "provider": active_provider,
            "model": active_model,
            "source": if model_is_nested { "nested" } else { "flat" },
        },
        "activeProvider": active_provider,
        "activeModel": active_model,
        "providers": providers_out,
        "customProviders": custom_out,
        "config": config,
        "claudeHome": paths["hermesHome"],
        // Surface the credential pool map so the UI can show the headroom
        // entry the user configured for tokendance.space.
        "providersMap": providers_map,
    })
}

#[tauri::command]
async fn claude_config_get() -> Result<serde_json::Value, String> {
    let home = hermes_config_dir();
    let paths = serde_json::json!({
        "hermesHome": home.to_string_lossy(),
        "configPath": home.join("config.yaml").to_string_lossy(),
        "envPath": home.join(".env").to_string_lossy(),
        "authProfilesPath": home.join("auth-profiles.json").to_string_lossy(),
    });
    let config_path = home.join("config.yaml");
    let env_path = home.join(".env");
    let config = read_hermes_yaml(&config_path);
    let env_map = read_hermes_env(&env_path);
    let state = build_claude_config_state(&paths, &config, &env_map);
    Ok(serde_json::json!({ "ok": true, "data": state }))
}

fn deep_merge_yaml(target: &mut serde_json::Value, source: &serde_json::Value) {
    if let (Some(t), Some(s)) = (target.as_object_mut(), source.as_object()) {
        for (k, v) in s {
            if v.is_null() {
                t.remove(k);
            } else if let Some(existing) = t.get_mut(k) {
                if existing.is_object() && v.is_object() {
                    deep_merge_yaml(existing, v);
                } else {
                    *existing = v.clone();
                }
            } else {
                t.insert(k.clone(), v.clone());
            }
        }
    }
}

#[tauri::command]
async fn claude_config_patch(body: serde_json::Value) -> Result<serde_json::Value, String> {
    let home = hermes_config_dir();
    let config_path = home.join("config.yaml");
    let env_path = home.join(".env");

    // Discriminated union: `action` (e.g. set-default-model) OR legacy
    // `{config: {...}, env: {...}}` patch object.
    let action = body.get("action").and_then(|v| v.as_str());

    match action {
        Some("set-default-model") => {
            let provider_id = body
                .get("providerId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "providerId required".to_string())?;
            let model_id = body
                .get("modelId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "modelId required".to_string())?;
            let mut config = read_hermes_yaml(&config_path);
            // Preserve any nested form, just update the keys.
            if let Some(model_obj) = config.get_mut("model") {
                if let Some(obj) = model_obj.as_object_mut() {
                    obj.insert("provider".into(), serde_json::Value::String(provider_id.into()));
                    obj.insert("default".into(), serde_json::Value::String(model_id.into()));
                } else {
                    let mut next = serde_json::Map::new();
                    next.insert("provider".into(), serde_json::Value::String(provider_id.into()));
                    next.insert("default".into(), serde_json::Value::String(model_id.into()));
                    config["model"] = serde_json::Value::Object(next);
                }
            } else {
                let mut next = serde_json::Map::new();
                next.insert("provider".into(), serde_json::Value::String(provider_id.into()));
                next.insert("default".into(), serde_json::Value::String(model_id.into()));
                config["model"] = serde_json::Value::Object(next);
            }
            write_hermes_yaml(&config_path, &config)?;
            Ok(serde_json::json!({ "ok": true, "message": "Default model updated." }))
        }
        Some("set-api-key") => {
            let env_key = body
                .get("envKey")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "envKey required".to_string())?;
            let value = body
                .get("value")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "value required".to_string())?;
            let mut env = read_hermes_env(&env_path);
            env.insert(env_key.to_string(), value.to_string());
            write_hermes_env(&env_path, &env)?;
            Ok(serde_json::json!({ "ok": true, "message": "API key saved." }))
        }
        Some("remove-api-key") => {
            let env_key = body
                .get("envKey")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "envKey required".to_string())?;
            let mut env = read_hermes_env(&env_path);
            env.remove(env_key);
            write_hermes_env(&env_path, &env)?;
            Ok(serde_json::json!({ "ok": true, "message": "API key removed." }))
        }
        Some("set-custom-provider") => {
            let provider = body
                .get("provider")
                .ok_or_else(|| "provider required".to_string())?;
            let name = read_string(&provider["name"]);
            if name.is_empty() {
                return Err("provider.name required".into());
            }
            let mut config = read_hermes_yaml(&config_path);
            let mut list: Vec<serde_json::Value> = match &config["custom_providers"] {
                serde_json::Value::Array(a) => a
                    .iter()
                    .filter(|v| v.is_object() && read_string(&v["name"]) != name)
                    .cloned()
                    .collect(),
                _ => vec![],
            };
            let mut entry = serde_json::Map::new();
            entry.insert("name".into(), serde_json::Value::String(name.clone()));
            entry.insert(
                "base_url".into(),
                serde_json::Value::String(read_string(&provider["baseUrl"])),
            );
            let key_env = read_string(&provider["apiKeyEnv"]);
            if !key_env.is_empty() {
                entry.insert("key_env".into(), serde_json::Value::String(key_env));
            }
            let api_mode = read_string(&provider["apiMode"]);
            if !api_mode.is_empty() {
                entry.insert("api_mode".into(), serde_json::Value::String(api_mode));
            }
            list.push(serde_json::Value::Object(entry));
            config["custom_providers"] = serde_json::Value::Array(list);
            write_hermes_yaml(&config_path, &config)?;
            Ok(serde_json::json!({ "ok": true, "message": "Custom provider saved." }))
        }
        Some("remove-custom-provider") => {
            let name = body
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "name required".to_string())?;
            let mut config = read_hermes_yaml(&config_path);
            if let serde_json::Value::Array(list) = &config["custom_providers"] {
                let next: Vec<serde_json::Value> = list
                    .iter()
                    .filter(|v| v.is_object() && read_string(&v["name"]) != name)
                    .cloned()
                    .collect();
                if next.is_empty() {
                    config.as_object_mut().map(|m| m.remove("custom_providers"));
                } else {
                    config["custom_providers"] = serde_json::Value::Array(next);
                }
            }
            write_hermes_yaml(&config_path, &config)?;
            Ok(serde_json::json!({ "ok": true, "message": "Custom provider removed." }))
        }
        Some(other) => Err(format!("Unknown action: {}", other)),
        None => {
            // Legacy: { config: {...}, env: {...} }
            let mut config = read_hermes_yaml(&config_path);
            let mut env = read_hermes_env(&env_path);
            if let Some(cfg_patch) = body.get("config").and_then(|v| v.as_object()) {
                deep_merge_yaml(&mut config, &serde_json::Value::Object(cfg_patch.clone()));
                write_hermes_yaml(&config_path, &config)?;
            }
            if let Some(env_patch) = body.get("env").and_then(|v| v.as_object()) {
                for (k, v) in env_patch {
                    if v.is_null() || (v.is_string() && v.as_str().unwrap_or("").is_empty()) {
                        env.remove(k);
                    } else if let Some(s) = v.as_str() {
                        env.insert(k.clone(), s.to_string());
                    }
                }
                write_hermes_env(&env_path, &env)?;
            }
            Ok(serde_json::json!({ "ok": true, "message": "Saved." }))
        }
    }
}

#[tauri::command]
async fn window_toggle(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().map_err(|e| e.to_string())?;
        if visible {
            window.hide().map_err(|e| e.to_string())?;
        } else {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn window_minimize(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn window_maximize(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let is_max = window.is_maximized().map_err(|e| e.to_string())?;
        if is_max {
            window.unmaximize().map_err(|e| e.to_string())?;
        } else {
            window.maximize().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn workspace_port_status() -> Result<serde_json::Value, String> {
    let (workspace, gateway, dashboard, headroom, openclaw) = tokio::join!(
        service_port_status(
            "workspace",
            "Workspace dev server",
            DEFAULT_WORKSPACE_PORT,
            "http://127.0.0.1:3000/api/healthcheck",
        ),
        service_port_status(
            "gateway",
            "Hermes Agent gateway",
            8642,
            "http://127.0.0.1:8642/health",
        ),
        service_port_status(
            "dashboard",
            "Hermes Dashboard",
            9119,
            "http://127.0.0.1:9119/api/status",
        ),
        service_port_status(
            "headroom",
            "Headroom custom provider",
            8787,
            "http://127.0.0.1:8787/livez",
        ),
        service_port_status(
            "openclaw",
            "OpenClaw gateway",
            18789,
            "http://127.0.0.1:18789/health",
        ),
    );
    Ok(serde_json::json!({
        "ok": true,
        "checkedAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        "ports": [workspace, gateway, dashboard, headroom, openclaw],
    }))
}

// ---------------------------------------------------------------------------
// Auto-updater (tauri-plugin-updater)
// ---------------------------------------------------------------------------
//
// Mirrors the legacy Electron `desktop:update-check` / `desktop:update-state`
// IPC pair, but goes through the official Tauri 2 updater plugin so we get:
//   * signature verification via the pubkey baked into tauri.conf.json
//   * native installer launch (NSIS on Windows, .pkg on macOS, AppImage on Linux)
//   * GitHub Releases manifest resolution via the plugin's `endpoints` list
//
// The frontend already speaks `window.hermesDesktop.updates.{check,getState,
// onStateChange}` (see src/lib/tauri-bridge.ts). We re-emit the plugin's
// progress into a single `update:state` event so the UI can subscribe once.

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateState {
    pub checking: bool,
    pub available: bool,
    pub downloaded: bool,
    pub error: Option<String>,
    pub version: String,
    pub latest_version: Option<String>,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
}

static UPDATE_STATE: Lazy<Arc<Mutex<UpdateState>>> = Lazy::new(|| {
    Arc::new(Mutex::new(UpdateState {
        version: env!("CARGO_PKG_VERSION").to_string(),
        ..Default::default()
    }))
});

fn publish_update_state(app: &AppHandle, state: UpdateState) {
    if let Ok(mut guard) = UPDATE_STATE.lock() {
        *guard = state.clone();
    }
    let _ = app.emit("update:state", state);
}

#[tauri::command]
async fn update_state() -> Result<UpdateState, String> {
    Ok(UPDATE_STATE.lock().unwrap().clone())
}

#[tauri::command]
async fn update_check(app: AppHandle) -> Result<serde_json::Value, String> {
    let handle = app.clone();
    // Run the actual check on a background task so the IPC reply returns
    // immediately and the UI can show the spinner via the `update:state`
    // event stream.
    tauri::async_runtime::spawn(async move {
        publish_update_state(
            &handle,
            UpdateState {
                checking: true,
                version: env!("CARGO_PKG_VERSION").to_string(),
                ..Default::default()
            },
        );

        let updater = match handle.updater() {
            Ok(u) => u,
            Err(e) => {
                publish_update_state(
                    &handle,
                    UpdateState {
                        checking: false,
                        available: false,
                        downloaded: false,
                        error: Some(format!("updater init: {}", e)),
                        version: env!("CARGO_PKG_VERSION").to_string(),
                        ..Default::default()
                    },
                );
                return;
            }
        };
        match updater.check().await {
            Ok(Some(update)) => {
                let notes = update.body.clone();
                let pub_date = update.date.map(|d| d.to_string());
                let latest = update.version.clone();

                publish_update_state(
                    &handle,
                    UpdateState {
                        checking: false,
                        available: true,
                        downloaded: false,
                        error: None,
                        version: env!("CARGO_PKG_VERSION").to_string(),
                        latest_version: Some(latest),
                        notes,
                        pub_date,
                    },
                );
            }
            Ok(None) => {
                publish_update_state(
                    &handle,
                    UpdateState {
                        checking: false,
                        available: false,
                        downloaded: false,
                        error: None,
                        version: env!("CARGO_PKG_VERSION").to_string(),
                        ..Default::default()
                    },
                );
            }
            Err(e) => {
                publish_update_state(
                    &handle,
                    UpdateState {
                        checking: false,
                        available: false,
                        downloaded: false,
                        error: Some(e.to_string()),
                        version: env!("CARGO_PKG_VERSION").to_string(),
                        ..Default::default()
                    },
                );
            }
        }
    });

    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
async fn update_install(app: AppHandle) -> Result<serde_json::Value, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let updater = match handle.updater() {
            Ok(u) => u,
            Err(e) => {
                publish_update_state(
                    &handle,
                    UpdateState {
                        checking: false,
                        available: false,
                        downloaded: false,
                        error: Some(format!("updater init: {}", e)),
                        version: env!("CARGO_PKG_VERSION").to_string(),
                        ..Default::default()
                    },
                );
                return;
            }
        };
        let update = match updater.check().await {
            Ok(Some(u)) => u,
            Ok(None) => {
                publish_update_state(
                    &handle,
                    UpdateState {
                        checking: false,
                        available: false,
                        downloaded: false,
                        error: Some("no update available".into()),
        version: env!("CARGO_PKG_VERSION").to_string(),
                        ..Default::default()
                    },
                );
                return;
            }
            Err(e) => {
                publish_update_state(
                    &handle,
                    UpdateState {
                        checking: false,
                        available: false,
                        downloaded: false,
                        error: Some(e.to_string()),
                        version: env!("CARGO_PKG_VERSION").to_string(),
                        ..Default::default()
                    },
                );
                return;
            }
        };

        // download_and_install takes two callbacks — chunk progress + final
        // completion. We surface both to the UI as `update:state` snapshots.
        // Each closure needs its own clones of `handle` / `update.version`
        // because Rust moves captured values into `move` closures.
        let app_for_progress = handle.clone();
        let handle_for_done = handle.clone();
        let update_version_for_progress = update.version.clone();
        let update_version_for_done = update.version.clone();
        let result = update
            .download_and_install(
                move |chunk_len, total| {
                    tracing::info!(
                        "update download progress: {} / {:?}",
                        chunk_len,
                        total
                    );
                    let _ = app_for_progress.emit(
                        "update:state",
                        UpdateState {
                            checking: false,
                            available: true,
                            downloaded: false,
                            version: env!("CARGO_PKG_VERSION").to_string(),
                            latest_version: Some(update_version_for_progress.clone()),
                            ..Default::default()
                        },
                    );
                },
                move || {
                    tracing::info!("update download finished, prompting install");
                    let _ = handle_for_done.emit(
                        "update:state",
                        UpdateState {
                            checking: false,
                            available: true,
                            downloaded: true,
                            version: env!("CARGO_PKG_VERSION").to_string(),
                            latest_version: Some(update_version_for_done.clone()),
                            ..Default::default()
                        },
                    );
                },
            )
            .await;

        if let Err(e) = result {
            publish_update_state(
                &handle,
                UpdateState {
                    checking: false,
                    available: false,
                    downloaded: false,
                    error: Some(e.to_string()),
                    version: env!("CARGO_PKG_VERSION").to_string(),
                    ..Default::default()
                },
            );
        }
    });

    Ok(serde_json::json!({ "ok": true }))
}

fn spawn_update_poller(app: AppHandle) {
    // Best-effort background poller: every 6 hours, re-check the upstream
    // manifest. The frontend can also fire `update_check` on demand.
    tauri::async_runtime::spawn(async move {
        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => {
                tracing::warn!("updater: init failed: {}", e);
                return;
            }
        };
        let interval = Duration::from_secs(6 * 60 * 60);
        loop {
            tokio::time::sleep(interval).await;
            match updater.check().await {
                Ok(Some(update)) => {
                    publish_update_state(
                        &app,
                        UpdateState {
                            checking: false,
                            available: true,
                            downloaded: false,
                            error: None,
                            version: env!("CARGO_PKG_VERSION").to_string(),
                            latest_version: Some(update.version.clone()),
                            notes: update.body.clone(),
                            pub_date: update.date.map(|d| d.to_string()),
                        },
                    );
                }
                Ok(None) => {
                    // No update — leave state as-is so we don't churn the UI.
                    tracing::debug!("updater: no new release");
                }
                Err(e) => {
                    tracing::warn!("updater: poll failed: {}", e);
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// App entry
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance_check())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Make sure the main window is on top and focused.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }

            let config_dir = app
                .path()
                .app_config_dir()
                .map_err(|e| format!("config dir: {}", e))?;
            fs::create_dir_all(&config_dir).map_err(|e| format!("mkdir config: {}", e))?;

            let settings = AppState::load_settings(&config_dir);

            app.manage(AppState {
                settings: Arc::new(Mutex::new(settings)),
                config_dir,
                spawned: Arc::new(Mutex::new(HashMap::new())),
                install_process: Arc::new(Mutex::new(None)),
            });

            // Background poller for desktop app updates. The poller is
            // best-effort: failures are logged via `tracing` and never bubble
            // up to the user unless the frontend explicitly calls
            // `update_check`.
            let poller_app = app.handle().clone();
            spawn_update_poller(poller_app);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            get_platform,
            get_all_settings,
            set_settings,
            reset_settings,
            desktop_status,
            install_hermes,
            start_backend,
            open_logs,
            shell_open_external,
            gateway_health,
            gateway_status,
            gateway_request,
            send_stream,
            claude_config_get,
            claude_config_patch,
            window_toggle,
            window_minimize,
            window_maximize,
            workspace_port_status,
            update_state,
            update_check,
            update_install,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::WindowEvent { label, event, .. } = event {
                if label == "main" {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        let state = app_handle.state::<AppState>();
                        let settings = state.settings.lock().unwrap();
                        if settings.general.close_to_tray {
                            api.prevent_close();
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                    }
                }
            }
        });
}

/// Tauri 2 official single-instance plugin. The plugin emits a
/// `single-instance` event on the main instance and exits the new process.
fn tauri_plugin_single_instance_check() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_single_instance::init(|app, args, _cwd| {
        // Bring the existing window forward when a second instance is launched.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        let _ = app.emit("single-instance", args);
    })
}
