//! Choto You — application entry point.
//!
//! Module layout mirrors the responsibilities the companion will grow into:
//!   commands/ — the frontend-facing API surface
//!   windows/  — creation and runtime configuration of the app's windows
//!   displays/ — monitor enumeration and topology (Phase 4)
//!   platform/ — anything that differs between Windows and macOS

pub mod commands;
pub mod database;
pub mod displays;
pub mod logging;
pub mod migration;
pub mod platform;
pub mod tray;
pub mod windows;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(logging::plugin())
        .plugin(database::plugin())
        // Autostart is a login item, which needs no elevated privileges on
        // either platform.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::avatars::list_user_avatars,
            commands::avatars::save_user_avatar,
            commands::avatars::delete_user_avatar
        ])
        .setup(|app| {
            let handle = app.handle();
            log::info!("[APP] Choto You {} starting", env!("CARGO_PKG_VERSION"));

            // Before anything opens the database: the bundle identifier changed
            // with the rename, which moved the app data directory.
            migration::carry_over_legacy_data(handle);

            platform::apply_startup_policy(handle);

            if let Err(error) = tray::install(handle) {
                // Without a tray there is no way to quit once the Dock icon is
                // gone, so this is worth shouting about.
                log::error!("[APP] Could not install the tray icon: {error}");
            }

            // The overlay is declared in tauri.conf.json, so a missing window
            // here means the configuration was edited inconsistently. Report it
            // rather than panicking: the settings window is still usable.
            match windows::companion(handle) {
                Some(window) => windows::configure_companion(&window)?,
                None => log::error!("[WINDOW] Companion window was not created"),
            }

            // Tauri re-applies its own window level after setup returns, which
            // drops the overlay back below fullscreen Spaces. Rather than guess
            // at the timing, the level is checked periodically and restored.
            if let Some(window) = windows::companion(handle) {
                let handle = handle.clone();
                // Twice a second rather than every two seconds: this is what
                // puts the overlay onto a fullscreen Space the user has just
                // switched to, and a two-second wait reads as "it did not come
                // with me". The check is two cheap AppKit property reads and
                // does nothing at all unless something has actually drifted.
                std::thread::spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let window = window.clone();
                    let _ = handle.run_on_main_thread(move || {
                        if let Some(corrected) = platform::ensure_overlay_state(&window) {
                            log::info!(
                                "[WINDOW] overlay drifted ({corrected}); corrected. {}",
                                platform::describe_visibility(&window)
                            );
                        }
                    });
                });
            }

            // Closing the settings window must not take the companion with
            // it. The app lives in the tray and is quit from there.
            if let Some(settings) = windows::settings(handle) {
                let settings_handle = settings.clone();
                settings.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = settings_handle.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Choto You");
}
