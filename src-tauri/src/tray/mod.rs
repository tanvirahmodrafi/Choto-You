//! System tray icon and menu.
//!
//! The tray is how the companion is reached once it has no Dock icon: showing
//! and hiding it, pausing reminders, opening settings and quitting all happen
//! from here.
//!
//! Actions that are purely about windows are carried out in Rust. Anything the
//! frontend owns — whether reminders are paused — is sent to it as an event
//! instead, so there is one source of truth for that state rather than two
//! that can drift apart.

use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::windows;

/// Emitted to the frontend when a tray action needs application state changed.
pub const TRAY_EVENT: &str = "companion://tray";

const ID_SHOW: &str = "show-companion";
const ID_PAUSE: &str = "pause-reminders";
const ID_SETTINGS: &str = "open-settings";
const ID_RESTART: &str = "restart-companion";
const ID_QUIT: &str = "quit";

/// Builds the tray icon and installs its menu.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = CheckMenuItem::with_id(app, ID_SHOW, "Show Choto You", true, true, None::<&str>)?;
    let pause =
        CheckMenuItem::with_id(app, ID_PAUSE, "Pause reminders", true, false, None::<&str>)?;
    let settings = MenuItem::with_id(app, ID_SETTINGS, "Settings…", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, ID_RESTART, "Restart Choto You", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show,
            &pause,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &restart,
            &quit,
        ],
    )?;

    // A dedicated silhouette rather than the app icon: a template image uses
    // only the alpha channel, and the app icon's alpha is its background
    // plate, which would show up as a solid rounded rectangle.
    let icon = tauri::image::Image::from_bytes(include_bytes!("../../icons/tray.png"))?;

    TrayIconBuilder::with_id("companion-tray")
        .icon(icon)
        // Renders as a monochrome status item that follows the menu bar's
        // appearance, rather than a full-colour app icon.
        .icon_as_template(true)
        .tooltip("Choto You")
        .menu(&menu)
        // The menu should appear on a normal left click, which is what people
        // expect of a macOS status item.
        .show_menu_on_left_click(true)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|_tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                log::debug!("[APP] Tray icon double-clicked");
            }
        })
        .build(app)?;

    log::info!("[APP] Tray icon installed");
    Ok(())
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().as_ref() {
        ID_SHOW => toggle_companion(app),
        ID_PAUSE => emit_action(app, "toggle-reminders"),
        ID_SETTINGS => open_settings(app),
        ID_RESTART => {
            log::info!("[APP] Restarting at the user's request");
            app.restart();
        }
        ID_QUIT => {
            log::info!("[APP] Quitting at the user's request");
            app.exit(0);
        }
        other => log::warn!("[APP] Unhandled tray menu item: {other}"),
    }
}

/// Shows or hides the overlay, and tells the frontend so it can stop work.
fn toggle_companion<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(windows::COMPANION_LABEL) else {
        log::error!("[WINDOW] Companion window is missing");
        return;
    };

    let visible = window.is_visible().unwrap_or(false);
    let result = if visible {
        window.hide()
    } else {
        window.show()
    };
    if let Err(error) = result {
        log::error!("[WINDOW] Could not toggle the companion: {error}");
        return;
    }

    log::info!(
        "[WINDOW] Companion {}",
        if visible { "hidden" } else { "shown" }
    );
    // The overlay suspends its animation loop when hidden; a hidden webview
    // would otherwise keep a timer alive for a character nobody can see.
    emit_action(app, if visible { "hidden" } else { "shown" });
}

fn open_settings<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(windows::SETTINGS_LABEL) else {
        log::error!("[WINDOW] Settings window is missing");
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn emit_action<R: Runtime>(app: &AppHandle<R>, action: &str) {
    if let Err(error) = app.emit(TRAY_EVENT, action) {
        log::error!("[APP] Could not deliver tray action \"{action}\": {error}");
    }
}
