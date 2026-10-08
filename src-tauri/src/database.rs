//! Local SQLite storage.
//!
//! Everything the companion remembers lives in one file in the application's
//! data directory. Nothing is sent anywhere; the database exists so settings,
//! reminders and the character's last position survive a restart.
//!
//! Migrations are declared here and applied by the plugin on startup, so a
//! database created by an older build is upgraded rather than discarded.

use tauri::plugin::TauriPlugin;
use tauri::Wry;
use tauri_plugin_sql::{Migration, MigrationKind, PluginConfig};

/// The database file, resolved inside the app's data directory by the plugin.
pub const DB_URL: &str = "sqlite:companion.db";

pub fn plugin() -> TauriPlugin<Wry, Option<PluginConfig>> {
    let migrations = vec![
        Migration {
            version: 1,
            description: "settings, reminders, characters and activity history",
            sql: include_str!("../migrations/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "per-reminder avatar",
            sql: include_str!("../migrations/002_reminder_avatars.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri_plugin_sql::Builder::default()
        .add_migrations(DB_URL, migrations)
        .build()
}
