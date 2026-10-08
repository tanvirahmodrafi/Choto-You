//! macOS-specific behaviour.

use tauri::{AppHandle, WebviewWindow};

/// Window level for the overlay.
///
/// Above `NSMainMenuWindowLevel` (24) the window is allowed over the menu bar;
/// above `NSPopUpMenuWindowLevel` (101) it is also kept above the window macOS
/// puts up for another application's fullscreen Space. Below that, a fullscreen
/// app simply covers the companion, which is the single most common report of
/// it "disappearing".
///
/// Defined once: it is both set here and re-asserted by the keeper, and two
/// copies that drifted apart would have the keeper fighting the setter every
/// time it ran.
const OVERLAY_WINDOW_LEVEL: isize = 102;

pub fn apply_startup_policy(app: &AppHandle) {
    // Transparency on macOS comes from the `macOSPrivateApi` flag in
    // tauri.conf.json combined with `transparent: true` on the window.
    //
    // `Accessory` drops the Dock icon — the behaviour a desktop pet actually
    // wants — and, more importantly, it is what lets the overlay appear over
    // another application's fullscreen Space.
    //
    // This was previously `Regular`, because an earlier attempt at `Accessory`
    // was measured to take the overlay off the active Space entirely. That
    // measurement was taken at window level 25. Re-measured at level 102 the
    // result reverses, and the two settings turn out to be a pair:
    //
    //   policy     level   isOnActiveSpace while another app is fullscreen
    //   Regular    25      false
    //   Regular    102     false  (the window simply cannot be placed there)
    //   Accessory  102     true   (character keeps animating, no throttling)
    //
    // The reason is activation. macOS will not move a plain NSWindow onto the
    // active Space without activating its application, and activating would
    // throw the user out of fullscreen — so under `Regular` the keeper's
    // `orderFrontRegardless` has no effect, however often it runs. An accessory
    // application is never activated in that sense, so the restriction does not
    // apply to it.
    if let Err(error) = app.set_activation_policy(tauri::ActivationPolicy::Accessory) {
        log::error!("[APP] Could not set the activation policy: {error}");
        return;
    }
    log::info!("[APP] macOS activation policy set to accessory (no Dock icon)");
}

/// Makes the overlay float above everything, on every Space.
///
/// An ordinary window is bound to the Space it was created on. With several
/// Mission Control desktops — or any app in fullscreen, which gets a Space of
/// its own — the companion ends up stranded: `isOnActiveSpace` reports false,
/// nothing is drawn, and because the window is genuinely off-screen WebKit
/// marks the webview hidden and throttles its timers to roughly 1Hz. The
/// character silently freezes mid-step.
///
/// Two things are needed together:
///
/// * `canJoinAllSpaces` + `canJoinAllApplications`, so the window is *allowed*
///   onto other Spaces and, specifically, another app's fullscreen Space; and
/// * a window level above the main menu bar. At the ordinary floating level a
///   window still sits below a fullscreen Space and is simply not shown.
///
/// Re-classing the window to a real NSPanel would be the textbook approach,
/// but Tauri's window is a custom NSWindow subclass carrying its own instance
/// variables, so swapping its class is undefined behaviour — objc2 rightly
/// panics on the attempt.
pub fn make_floating_panel(window: &WebviewWindow) {
    use objc2::rc::Retained;
    use objc2_app_kit::NSWindow;

    let handle = match window.ns_window() {
        Ok(handle) if !handle.is_null() => handle,
        Ok(_) => {
            log::error!("[WINDOW] Native window handle was null");
            return;
        }
        Err(error) => {
            log::error!("[WINDOW] Could not reach the native window: {error}");
            return;
        }
    };

    // SAFETY: `ns_window` hands back a live NSWindow owned by Tauri for as long
    // as the window exists, and setup runs on the main thread.
    let ns_window: Retained<NSWindow> = match unsafe { Retained::retain(handle as *mut NSWindow) } {
        Some(window) => window,
        None => {
            log::error!("[WINDOW] Could not retain the native window");
            return;
        }
    };

    apply_collection_behavior(&ns_window);

    // Keep the overlay up when the user switches to another application.
    ns_window.setHidesOnDeactivate(false);

    // Collection behaviour only takes effect when a window is ordered in, and
    // this one is already on a Space, so put it back. `orderFrontRegardless`
    // re-shows it without activating the application and stealing focus.
    ns_window.orderOut(None);
    ns_window.orderFrontRegardless();

    // The level is set *after* ordering in: re-showing the window puts it back
    // at the level its creator chose, silently undoing an earlier raise.
    ns_window.setLevel(OVERLAY_WINDOW_LEVEL);

    log::info!(
        "[WINDOW] Overlay floating above all Spaces: level={} onActiveSpace={}",
        ns_window.level(),
        ns_window.isOnActiveSpace()
    );
}

/// The collection behaviour the overlay needs, applied in one place.
///
/// Measured against another application's fullscreen Space, no combination of
/// these flags reliably decides the outcome on its own — what matters is that
/// they are in force at the moment the window is ordered in. They are therefore
/// re-asserted on every correction rather than set once at startup.
///
/// `MoveToActiveSpace` is cleared explicitly: it is mutually exclusive with
/// `CanJoinAllSpaces`, and was measured to leave the overlay off the active
/// Space even on an ordinary desktop with nothing in fullscreen.
#[cfg(target_os = "macos")]
fn apply_collection_behavior(ns_window: &objc2_app_kit::NSWindow) {
    use objc2_app_kit::NSWindowCollectionBehavior;

    // `FullScreenAuxiliary` is the older full-screen hint. It says that a
    // window may accompany a full-screen window, but on current macOS it does
    // not by itself opt a window into *another application's* full-screen
    // Space. `CanJoinAllApplications` is the AppKit behavior intended for
    // floating windows and system overlays, and is the missing distinction
    // between an overlay that follows our own windows and one that follows
    // VS Code/Cursor.
    //
    // Clear the mutually-exclusive Stage Manager/full-screen roles first in
    // case AppKit or Tauri assigned one while constructing the NSWindow.
    let behavior = (ns_window.collectionBehavior()
        & !NSWindowCollectionBehavior::MoveToActiveSpace
        & !NSWindowCollectionBehavior::Primary
        & !NSWindowCollectionBehavior::Auxiliary)
        | NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::CanJoinAllApplications
        // Kept as a compatibility hint for macOS releases predating
        // CanJoinAllApplications; the two flags belong to different AppKit
        // behavior groups and can safely coexist.
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::Stationary
        | NSWindowCollectionBehavior::IgnoresCycle;
    ns_window.setCollectionBehavior(behavior);
}

/// Keeps the overlay on the active Space, at the right level.
///
/// Two things drift and have to be put back:
///
/// * Tauri re-applies its own window level after `setup` returns, dropping the
///   overlay below fullscreen Spaces.
/// * macOS binds a window to the Space it was ordered into. Collection
///   behaviour only decides placement at that moment, so a window already
///   sitting on another Space stays there — `isOnActiveSpace` reports false,
///   nothing is drawn, and WebKit then throttles the now-hidden webview's
///   timers to about 1Hz, freezing the character.
///
/// Re-ordering the window forward moves it onto the current Space, so this is
/// checked periodically rather than guessing at the timing of either event.
///
/// @returns a description of what was corrected, or None if nothing needed it.
pub fn ensure_overlay_state(window: &WebviewWindow) -> Option<String> {
    use objc2::rc::Retained;
    use objc2_app_kit::NSWindow;

    let handle = match window.ns_window() {
        Ok(handle) if !handle.is_null() => handle,
        _ => return None,
    };
    let ns_window: Retained<NSWindow> = unsafe { Retained::retain(handle as *mut NSWindow) }?;

    let mut corrected = Vec::new();

    // Order matters, and the obvious order is wrong. Re-showing a window puts
    // it back at the level its creator chose, so setting the level first and
    // *then* re-ordering silently undoes the raise — leaving the overlay below
    // a fullscreen Space for the next half-second, every time it is corrected.
    // The Space is therefore fixed first and the level asserted afterwards.

    // Only worth correcting while the window is meant to be visible; a window
    // the user hid from the tray is off-Space for a good reason.
    let misplaced = ns_window.isVisible() && !ns_window.isOnActiveSpace();
    if misplaced {
        // Collection behaviour decides placement only at the moment a window is
        // ordered in, so it is re-asserted here rather than trusted to have
        // survived since startup.
        apply_collection_behavior(&ns_window);

        // Ordering out first forces macOS to re-place the window when it is
        // ordered back in. `orderFrontRegardless` alone leaves a window that
        // is already assigned to another Space exactly where it is, which is
        // the state this is trying to escape.
        ns_window.orderOut(None);
        ns_window.orderFrontRegardless();
        corrected.push("space");
    }

    if misplaced || ns_window.level() != OVERLAY_WINDOW_LEVEL {
        ns_window.setLevel(OVERLAY_WINDOW_LEVEL);
        if !misplaced {
            corrected.push("level");
        }
    }

    if corrected.is_empty() {
        None
    } else {
        Some(corrected.join(", "))
    }
}

/// Reports the native visibility state of the overlay window.
///
/// Tauri's own `is_visible` only tracks whether the window was asked to be
/// shown; it says nothing about whether macOS is actually displaying it. When
/// the overlay silently disappears, these are the values that explain why.
pub fn describe_visibility(window: &WebviewWindow) -> String {
    use objc2::rc::Retained;
    use objc2_app_kit::NSWindow;

    let handle = match window.ns_window() {
        Ok(handle) if !handle.is_null() => handle,
        _ => return "no native window".to_string(),
    };
    let ns_window: Retained<NSWindow> = match unsafe { Retained::retain(handle as *mut NSWindow) } {
        Some(w) => w,
        None => return "null NSWindow".to_string(),
    };

    format!(
        "isVisible={} isOnActiveSpace={} occlusionState={:?} level={} alpha={} behavior={:?}",
        ns_window.isVisible(),
        ns_window.isOnActiveSpace(),
        ns_window.occlusionState(),
        ns_window.level(),
        ns_window.alphaValue(),
        ns_window.collectionBehavior(),
    )
}
