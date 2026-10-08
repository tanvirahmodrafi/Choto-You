//! Commands exposed to the frontend.
//!
//! Display enumeration and window movement go through Tauri's own APIs; what
//! needs a command is anything touching the filesystem, which the webview
//! cannot reach on its own.

pub mod avatars;

use serde::Serialize;

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub platform: String,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}
