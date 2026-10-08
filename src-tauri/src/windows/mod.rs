//! Window setup for the two surfaces the application owns.
//!
//! Window *flags* (transparency, decorations, always-on-top) live in
//! `tauri.conf.json`; this module applies the behaviour that the static
//! configuration cannot express and that differs per platform.

use tauri::{AppHandle, Manager, WebviewWindow};

pub const COMPANION_LABEL: &str = "companion";
pub const SETTINGS_LABEL: &str = "settings";

/// Returns the overlay window, or `None` if it was closed.
pub fn companion(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(COMPANION_LABEL)
}

/// Returns the settings window, or `None` if it was closed.
pub fn settings(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(SETTINGS_LABEL)
}

/// Applies the overlay behaviour that has to be set at runtime.
pub fn configure_companion(window: &WebviewWindow) -> tauri::Result<()> {
    // The overlay must never participate in normal window cycling.
    window.set_skip_taskbar(true)?;

    // Keep the companion present when the user switches desktops/spaces,
    // otherwise it vanishes the moment they move to another Space on macOS.
    window.set_visible_on_all_workspaces(true)?;

    // Always-on-top first: on macOS it sets the window level, and the platform
    // hook below raises that level further. Doing it the other way round would
    // undo the raise.
    window.set_always_on_top(true)?;

    // Raises the window above fullscreen Spaces and lets it join every Space.
    // It also performs the first show only after the native policy is ready;
    // ordering the window earlier binds it to the ordinary desktop Space.
    // Must come last, for both reasons above.
    crate::platform::make_floating_panel(window);

    log::info!(
        "[WINDOW] Companion overlay configured: visible={:?} pos={:?} size={:?} scale={:?}",
        window.is_visible(),
        window.outer_position(),
        window.outer_size(),
        window.scale_factor()
    );
    Ok(())
}
