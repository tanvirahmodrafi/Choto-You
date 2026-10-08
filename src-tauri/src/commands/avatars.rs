//! Avatar pack storage.
//!
//! Bundled packs ship inside the app and are served by the frontend's own
//! origin. Packs the user creates cannot live there — the bundle is read-only
//! and code-signed — so they go in `avatars/<id>/` under the app data
//! directory and reach the webview through Tauri's asset protocol.
//!
//! Images arrive as base64 from a file input in the settings window rather than
//! as paths. That keeps the picker working with drag-and-drop, needs no dialog
//! plugin, and means this command never opens a path the user named — it only
//! ever writes inside the avatars directory.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Image types accepted for a still. Kept narrow on purpose: these are the
/// formats every WebKit/WebView2 build decodes without a plugin.
const ALLOWED_EXTENSIONS: [&str; 4] = ["png", "gif", "webp", "jpg"];

/// Ceiling on a single still, in bytes. A desktop pet is drawn at around 96
/// logical points; anything this large is a mistake worth reporting as one.
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Serialize)]
pub struct UserAvatar {
    /// Directory name, which is also the pack id.
    pub id: String,
    /// Absolute path to the pack directory, for building asset URLs.
    pub directory: String,
    /// The pack's manifest, verbatim, for the frontend to parse and validate.
    pub manifest: String,
    /// When the pack was last written, in epoch milliseconds.
    ///
    /// Re-importing an avatar replaces its images at the same paths, so the
    /// asset URLs do not change and the webview happily serves the copies it
    /// already has — the user fixes their sprite sheet, imports it again, and
    /// sees the old broken frames. The frontend appends this to each URL so a
    /// rewritten pack is fetched afresh.
    pub modified: u64,
}

#[derive(Deserialize)]
pub struct AvatarImage {
    /// Animation slot this image fills, e.g. `idle` or `happy`.
    pub slot: String,
    /// File extension without the dot, lowercased by the caller.
    pub extension: String,
    /// The image itself, base64-encoded.
    pub data: String,
}

/// Lists the packs the user has imported, with their manifests.
#[tauri::command]
pub fn list_user_avatars(app: AppHandle) -> Result<Vec<UserAvatar>, String> {
    let root = avatars_root(&app)?;
    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let mut found = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        let directory = entry.path();
        if !directory.is_dir() {
            continue;
        }
        // A directory without a readable manifest is a half-finished import,
        // not an avatar; skipping it keeps one bad pack out of the picker.
        let Ok(manifest) = fs::read_to_string(directory.join("character.json")) else {
            continue;
        };
        let Some(id) = directory.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        found.push(UserAvatar {
            id: id.to_string(),
            directory: directory.to_string_lossy().into_owned(),
            manifest,
            modified: modified_millis(&directory.join("character.json")),
        });
    }

    found.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(found)
}

/// Creates or replaces a user pack from a set of still images.
///
/// The manifest is written by the frontend, which owns the pack schema; this
/// command's job is the filesystem. It writes to a staging directory and
/// renames it into place, so an interrupted import cannot leave behind a pack
/// that loads with half its frames missing.
#[tauri::command]
pub fn save_user_avatar(
    app: AppHandle,
    id: String,
    manifest: String,
    images: Vec<AvatarImage>,
) -> Result<UserAvatar, String> {
    let id = sanitize_id(&id)?;
    let root = avatars_root(&app)?;
    let final_dir = root.join(&id);
    let staging = root.join(format!(".{id}.incoming"));

    // A staging directory left by a previous failure must not contaminate this
    // import.
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| format!("Could not create the pack directory: {e}"))?;

    let result = (|| -> Result<(), String> {
        for image in &images {
            let slot = sanitize_id(&image.slot)?;
            let extension = image.extension.to_ascii_lowercase();
            if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
                return Err(format!(
                    "\"{extension}\" is not a supported image type (use {})",
                    ALLOWED_EXTENSIONS.join(", ")
                ));
            }

            let bytes = decode_base64(&image.data)
                .map_err(|e| format!("Could not decode the image for \"{slot}\": {e}"))?;
            if bytes.is_empty() {
                return Err(format!("The image for \"{slot}\" is empty"));
            }
            if bytes.len() > MAX_IMAGE_BYTES {
                return Err(format!(
                    "The image for \"{slot}\" is larger than {} MB",
                    MAX_IMAGE_BYTES / (1024 * 1024)
                ));
            }

            fs::write(staging.join(format!("{slot}.{extension}")), &bytes)
                .map_err(|e| format!("Could not write the image for \"{slot}\": {e}"))?;
        }

        fs::write(staging.join("character.json"), manifest.as_bytes())
            .map_err(|e| format!("Could not write the manifest: {e}"))
    })();

    if let Err(error) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    // The old pack is only removed once the new one is fully staged.
    let _ = fs::remove_dir_all(&final_dir);
    fs::rename(&staging, &final_dir).map_err(|e| {
        let _ = fs::remove_dir_all(&staging);
        format!("Could not install the pack: {e}")
    })?;

    log::info!("[AVATAR] Saved user avatar \"{id}\"");
    let manifest_path = final_dir.join("character.json");
    Ok(UserAvatar {
        id,
        directory: final_dir.to_string_lossy().into_owned(),
        manifest,
        modified: modified_millis(&manifest_path),
    })
}

#[tauri::command]
pub fn delete_user_avatar(app: AppHandle, id: String) -> Result<(), String> {
    let id = sanitize_id(&id)?;
    let directory = avatars_root(&app)?.join(&id);
    if !directory.is_dir() {
        return Ok(());
    }
    fs::remove_dir_all(&directory).map_err(|e| format!("Could not delete the pack: {e}"))?;
    log::info!("[AVATAR] Deleted user avatar \"{id}\"");
    Ok(())
}

/// A file's modification time in epoch milliseconds, or 0 if it cannot be read.
///
/// Only used to make a URL unique, so an unreadable timestamp costing a cache
/// bust is not worth failing an import over.
fn modified_millis(path: &std::path::Path) -> u64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn avatars_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data directory: {e}"))?
        .join("avatars");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Restricts an id to characters that are safe as a single path segment.
///
/// Ids reach here from the frontend and are joined onto a path, so `..`, a
/// separator or an absolute path would let an import write outside the avatars
/// directory. Rejecting rather than stripping keeps the stored id and the
/// directory name identical.
fn sanitize_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err("An avatar id must be 1-64 characters".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!(
            "\"{trimmed}\" may only contain letters, numbers, hyphens and underscores"
        ));
    }
    Ok(trimmed.to_string())
}

/// Decodes standard base64, tolerating the whitespace and padding a data URL
/// prefix leaves behind.
///
/// Hand-written rather than pulled in as a dependency: it is the only base64 in
/// the app, and the decoder for a known-shape payload is shorter than the
/// argument for adding a crate.
fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    // A caller that passed the whole data URL gets the prefix stripped rather
            // than a confusing decode error.
    let payload = match input.find("base64,") {
        Some(index) => &input[index + "base64,".len()..],
        None => input,
    };

    let mut out = Vec::with_capacity(payload.len() / 4 * 3);
    let mut accumulator: u32 = 0;
    let mut bits = 0u32;

    for byte in payload.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b'\n' | b'\r' | b' ' | b'\t' => continue,
            other => return Err(format!("unexpected character {:?}", other as char)),
        };

        accumulator = (accumulator << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((accumulator >> bits) as u8);
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{decode_base64, sanitize_id};

    #[test]
    fn accepts_plain_ids() {
        assert_eq!(sanitize_id("my-avatar_2").unwrap(), "my-avatar_2");
    }

    #[test]
    fn trims_surrounding_space() {
        assert_eq!(sanitize_id("  pip  ").unwrap(), "pip");
    }

    #[test]
    fn rejects_path_traversal() {
        for bad in ["..", "../escape", "a/b", "a\\b", "/abs", ""] {
            assert!(sanitize_id(bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn decodes_base64_with_padding() {
        assert_eq!(decode_base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(decode_base64("aGVsbG8h").unwrap(), b"hello!");
        assert_eq!(decode_base64("aGk=").unwrap(), b"hi");
    }

    #[test]
    fn strips_a_data_url_prefix() {
        assert_eq!(
            decode_base64("data:image/png;base64,aGVsbG8=").unwrap(),
            b"hello"
        );
    }

    #[test]
    fn ignores_wrapped_lines() {
        assert_eq!(decode_base64("aGVs\nbG8=").unwrap(), b"hello");
    }

    #[test]
    fn rejects_invalid_characters() {
        assert!(decode_base64("aGVsbG8*").is_err());
    }
}
