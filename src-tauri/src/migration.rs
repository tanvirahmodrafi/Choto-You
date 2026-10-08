//! One-time carry-over of data from the pre-rename application.
//!
//! The app's data directory is derived by Tauri from the bundle identifier, so
//! every rename moves it. Without this, the first launch afterwards would look
//! like a factory reset: settings, reminders and the saved position are all in
//! the directory the previous identifier pointed at.
//!
//! The copy runs before the SQL plugin opens the database, which is why this
//! lives in `setup` ordering rather than inside the plugin.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Identifiers this app has shipped under, newest first.
///
/// Searched in order, so a user coming from the most recent one gets their
/// latest data rather than something older left behind by an earlier rename.
const LEGACY_IDENTIFIERS: [&str; 3] = [
    "com.chotoou.app",
    "com.chotoyuu.app",
    "com.desktopcompanion.app",
];

/// The database file name, plus the sidecars SQLite writes beside it.
///
/// A `-wal` left behind without its database would be meaningless, and a
/// database copied without its `-wal` could lose the last transactions, so the
/// three move together or not at all.
const DB_FILES: [&str; 3] = ["companion.db", "companion.db-wal", "companion.db-shm"];

/// Marker written once the carry-over has been considered, so a user who
/// deliberately resets their settings is not handed the old ones back on the
/// next launch.
const MARKER: &str = ".migrated";

pub fn carry_over_legacy_data(app: &AppHandle) {
    let Ok(new_dir) = app.path().app_data_dir() else {
        log::warn!("[MIGRATE] No app data directory; skipping legacy carry-over");
        return;
    };

    if new_dir.join(MARKER).exists() {
        return;
    }

    // Nothing to do on a clean install, which is the common case.
    let Some(legacy_dir) = newest_legacy_dir(&new_dir) else {
        mark_done(&new_dir);
        return;
    };

    // An existing database in the new location means this build has already run
    // and been used. Copying over it would discard whatever happened since.
    if new_dir.join(DB_FILES[0]).exists() {
        log::info!("[MIGRATE] A database already exists; leaving the legacy one alone");
        mark_done(&new_dir);
        return;
    }

    if let Err(error) = fs::create_dir_all(&new_dir) {
        log::error!("[MIGRATE] Could not create {}: {error}", new_dir.display());
        return;
    }

    let mut copied = 0usize;
    for name in DB_FILES {
        let from = legacy_dir.join(name);
        if !from.exists() {
            continue;
        }
        match fs::copy(&from, new_dir.join(name)) {
            Ok(_) => copied += 1,
            Err(error) => {
                // A partial copy is worse than none: the database could be
                // opened without the WAL that completes it. Undo and start fresh.
                log::error!("[MIGRATE] Could not copy {name}: {error}");
                for cleanup in DB_FILES {
                    let _ = fs::remove_file(new_dir.join(cleanup));
                }
                return;
            }
        }
    }

    // Avatars the user imported under the old identifier should follow too.
    copy_tree(&legacy_dir.join("avatars"), &new_dir.join("avatars"));

    log::info!(
        "[MIGRATE] Carried {copied} file(s) over from {}",
        legacy_dir.display()
    );
    mark_done(&new_dir);
}

/// The most recent previous data directory that actually holds a database.
///
/// Every identifier resolves to a child of the same platform directory
/// (`~/Library/Application Support` on macOS, `%APPDATA%` on Windows), so each
/// candidate is the new directory's parent plus that identifier.
fn newest_legacy_dir(new_dir: &Path) -> Option<PathBuf> {
    let parent = new_dir.parent()?;
    LEGACY_IDENTIFIERS
        .iter()
        .map(|identifier| parent.join(identifier))
        .find(|candidate| candidate.join(DB_FILES[0]).exists())
}

fn mark_done(new_dir: &Path) {
    if let Err(error) = fs::create_dir_all(new_dir) {
        log::warn!("[MIGRATE] Could not create the data directory: {error}");
        return;
    }
    if let Err(error) = fs::write(new_dir.join(MARKER), b"") {
        log::warn!("[MIGRATE] Could not write the migration marker: {error}");
    }
}

/// Best-effort recursive copy. A failure here costs the user a re-import of
/// their avatars, not their settings, so it logs and carries on.
fn copy_tree(from: &Path, to: &Path) {
    if !from.is_dir() {
        return;
    }
    if let Err(error) = fs::create_dir_all(to) {
        log::warn!("[MIGRATE] Could not create {}: {error}", to.display());
        return;
    }
    let Ok(entries) = fs::read_dir(from) else {
        return;
    };
    for entry in entries.flatten() {
        let source = entry.path();
        let target = to.join(entry.file_name());
        if source.is_dir() {
            copy_tree(&source, &target);
        } else if let Err(error) = fs::copy(&source, &target) {
            log::warn!("[MIGRATE] Could not copy {}: {error}", source.display());
        }
    }
}
