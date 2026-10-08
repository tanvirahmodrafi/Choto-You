//! Windows-specific behaviour.

use tauri::{AppHandle, WebviewWindow};

pub fn apply_startup_policy(_app: &AppHandle) {
    // Transparency and the layered, click-through window style are configured
    // per-window; nothing process-wide is required yet.
    log::info!("[APP] Windows startup policy applied");
}

/// No equivalent is needed on Windows.
///
/// A topmost window already draws over fullscreen applications, and Windows has
/// no per-application Space that a window can be excluded from. Preventing
/// focus theft is handled by the extended window style instead, which is set
/// when click-through support lands for this platform.
pub fn make_floating_panel(window: &WebviewWindow) {
    // The window starts hidden so macOS can install its Space policy before
    // the first order-front. Windows has no equivalent ordering requirement.
    if let Err(error) = window.show() {
        log::error!("[WINDOW] Could not show the companion: {error}");
    }
}
