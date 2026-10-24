//! Linux-specific behaviour.

use tauri::{AppHandle, WebviewWindow};

/// Linux desktop environments expose tray applications and floating windows
/// through the normal Tauri APIs, so no process-wide native policy is needed.
pub fn apply_startup_policy(_app: &AppHandle) {
    log::info!("[APP] Linux startup policy applied");
}

/// Shows the overlay after the cross-platform always-on-top and workspace
/// flags have been applied in `windows::configure_companion`.
///
/// Window managers ultimately decide how those hints are handled. Mainstream
/// X11 desktops honour both; Wayland compositors may restrict always-on-top or
/// global positioning by design, but the app remains usable through its tray.
pub fn make_floating_panel(window: &WebviewWindow) {
    if let Err(error) = window.show() {
        log::error!("[WINDOW] Could not show the companion: {error}");
    }
}
