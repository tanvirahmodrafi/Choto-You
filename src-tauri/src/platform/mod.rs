//! Platform-specific behaviour.
//!
//! All `#[cfg(target_os = ...)]` code for the application lives under this
//! module so the rest of the crate stays portable.

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

use tauri::{AppHandle, WebviewWindow};

/// Applies process-level policy that must be set before windows are shown.
///
/// Phase 9 uses this to drop the application out of the Dock / taskbar once a
/// tray icon gives the user another way to reach it. Until then the app stays
/// an ordinary foreground application so it can always be quit normally.
pub fn apply_startup_policy(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    macos::apply_startup_policy(app);

    #[cfg(target_os = "windows")]
    windows::apply_startup_policy(app);

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        log::warn!("[APP] Unsupported platform; running with default policy");
    }
}

/// Makes the overlay a floating surface that appears on every Space and over
/// other applications' fullscreen windows, without ever stealing focus.
///
/// What this takes differs sharply between platforms, so the detail lives in
/// the per-platform modules.
pub fn make_floating_panel(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::make_floating_panel(window);

    #[cfg(target_os = "windows")]
    windows::make_floating_panel(window);

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    if let Err(error) = window.show() {
        log::error!("[WINDOW] Could not show the companion: {error}");
    }
}

/// Puts the overlay back on the active Space, at the right level, if it drifted.
pub fn ensure_overlay_state(window: &WebviewWindow) -> Option<String> {
    #[cfg(target_os = "macos")]
    return macos::ensure_overlay_state(window);

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        None
    }
}

/// A human-readable dump of the overlay's native visibility state.
pub fn describe_visibility(window: &WebviewWindow) -> String {
    #[cfg(target_os = "macos")]
    return macos::describe_visibility(window);

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        "not implemented on this platform".to_string()
    }
}
