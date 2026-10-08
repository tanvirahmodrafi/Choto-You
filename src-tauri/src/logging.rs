//! Logging setup.
//!
//! Both halves of the application log through the same pipeline: Rust uses the
//! `log` crate, and the frontend's `createLogger` output reaches here through
//! the webview console. Messages carry a `[SUBSYSTEM]` tag so the combined
//! stream reads as a sequence of events.
//!
//! The companion is meant to run all day from a tray icon with no console
//! attached, so logs also go to a rotating file in the OS log directory.

use tauri::plugin::TauriPlugin;
use tauri::Wry;
use tauri_plugin_log::{Target, TargetKind};

pub fn plugin() -> TauriPlugin<Wry> {
    // Debug builds are noisy on purpose; release builds keep warnings and
    // errors only, so an all-day session does not grow a large log file.
    let level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Warn
    };

    // `clear_targets` first: the plugin ships with Stdout enabled by default,
    // so adding it again below would print every line twice.
    let mut builder = tauri_plugin_log::Builder::new()
        .level(level)
        .clear_targets()
        .target(Target::new(TargetKind::LogDir { file_name: None }));

    // Stdout is only useful while a terminal is attached.
    if cfg!(debug_assertions) {
        builder = builder.target(Target::new(TargetKind::Stdout));
    }

    builder.build()
}
