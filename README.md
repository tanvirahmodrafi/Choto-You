# Choto You

A small animated character that lives on your desktop. Cross-platform
(Windows + macOS), built with Tauri 2, React, TypeScript and Rust.

Everything runs locally. No backend, no cloud services, no network access is
required for any core feature.

**Just want to run it?** [Installing](#installing) · [Using it](#using-it) ·
[Building from source](#building-from-source) · [Releasing](#releasing) ·
[Troubleshooting](#troubleshooting)

## Status

**Phases 1–10 complete.** The companion lives on the desktop, animates, walks
around, and understands multi-monitor layouts.

| Phase | What works |
| --- | --- |
| 1 — Window foundation | Transparent, frameless, shadowless, always-on-top overlay |
| 2 — Animation | Delta-timed playback, looping, priority-based interruption, direction flipping |
| 3 — Movement | Delta-timed walking, gravity, work-area boundaries, idle wandering |
| 4 — Multi-monitor | Display enumeration in virtual-desktop coordinates, negative origins, mixed DPI, hot-plug recovery |
| 5 — Transitions | Walk to edge → look → jump → fall → land, across touching displays |
| 6 — Interaction | Hitbox-only click-through, click, double click, right click, hover, drag and drop with gravity |
| 7 — Reminders | Scheduler, priority event queue, speech bubbles, the water-reminder sequence |
| 8 — Settings | SQLite storage, settings window, live cross-window sync, position persistence |
| 9 — Desktop integration | System tray, autostart login item, show/hide, pause reminders, restart, quit |
| 10 — Polish | Sleep when idle, custom reminders, sound, display modes, frame-rate cap, startup recovery, packaging |

All ten phases are implemented. See **Known macOS limitations** for what is
still imperfect.

## Moving about

Three modes, under Settings → Behavior:

| Mode | What it does |
| --- | --- |
| Roam freely | Wanders the screen on its own. |
| Only when reminding me | Stays hidden, peeks around a side edge, steps into that corner to deliver a reminder, then runs away. |
| Stay put | Never moves by itself. You can still drag it anywhere. |

Reminder-only appearances pause at the edge before entering. The message and
sound wait until arrival, and the avatar disappears again after a faster exit.
The peek uses a clipped, leaning wave pose, so existing character packs work.

This setting replaced an earlier on/off `walkAround` toggle; a database written
by an older build is migrated, so anyone who had wandering switched off stays
switched off.

## Behaviour when you are away

After ten minutes without cursor movement the companion falls asleep, which
also stops it wandering — the largest saving available on an unattended
machine. Interaction or a reminder wakes it.

The only signal is whether the mouse has moved, which is already polled for
interaction. Keyboard activity is deliberately not watched: that would mean
asking for input-monitoring permission to decide whether to play a sleep
animation, which is not a reasonable trade.

## Display modes

| Mode | Behaviour |
| --- | --- |
| Follow me | Moves to whichever display the cursor has been on for a few seconds |
| Roam | Wanders between displays on its own |
| Primary | Stays on the primary display |
| Specific | Stays on a chosen display, falling back to the primary one if it is unplugged |

Following is deliberately slow. Chasing the pointer the instant it crosses a
boundary would make the companion teleport constantly, which is the opposite
of restful.

## The tray

| Item | What it does |
| --- | --- |
| Show companion | Shows or hides the overlay, and suspends its animation loop while hidden |
| Pause reminders | Stops reminders firing; resuming pushes every schedule forward by the length of the pause rather than letting a backlog arrive at once |
| Settings… | Opens the settings window |
| Restart companion | Restarts the process |
| Quit | Exits |

Window actions are carried out in Rust. Anything whose state the frontend owns
— whether reminders are paused — is sent to it as an event instead, so that
state lives in one place rather than two that can drift apart.

Closing the settings window hides it rather than quitting: the application
lives in the tray.

The menu bar icon is a dedicated silhouette, not the app icon. A macOS template
image uses only the alpha channel, and the app icon's alpha is its background
plate, which would appear as a solid rounded rectangle.

## Autostart

A login item, created through the official plugin, needing no elevated
privileges on either platform.

The OS is treated as the source of truth, not the stored setting: the user may
remove the login item in System Settings, or a reinstall may drop it. The two
are reconciled when the settings window opens, and a toggle stores whatever the
OS reports *after* the change rather than what was asked for.

### Known macOS limitations

**Spaces and fullscreen — solved.** macOS binds a window to the Space it was
ordered into. On a machine with several Mission Control desktops, or with any
app in fullscreen (which gets a Space of its own), the overlay used to be left
behind on a Space the user was not looking at. It was then genuinely off-screen,
WebKit marked the webview hidden and throttled *every* timer to roughly 1Hz, and
the character froze where it stood.

What fixes it is a set of settings that work together:

* `ActivationPolicy::Accessory`, and
* a window level above `NSPopUpMenuWindowLevel`, and
* `canJoinAllApplications`, the current AppKit behavior for overlays that must
  join other applications' fullscreen Spaces.

Measured, with another application fullscreen:

| Policy | Level | `isOnActiveSpace` |
| --- | --- | --- |
| Regular | 25 | false |
| Regular | 102 | false |
| Accessory | 102 | **true** |

The reason is activation. macOS will not move a plain NSWindow onto the active
Space without activating its application, and activating would throw the user
out of fullscreen — so under `Regular` the keeper's `orderFrontRegardless` has
no effect however often it runs. An accessory application is never activated in
that sense, so the restriction does not apply.

An earlier round of work concluded the opposite, that `Accessory` made things
worse. That measurement was taken at level 25, where the window is below a
fullscreen Space whatever its Space membership; the policy was being blamed for
the level's failure. Changing one at a time is what separated them.

Also implemented, and still carrying their weight:

* `canJoinAllSpaces | canJoinAllApplications | fullScreenAuxiliary |
  stationary` collection behaviour;
* a keeper that checks twice a second and puts back the window level, which
  Tauri re-applies after `setup` returns;
* `Ticker` warns when the loop stalls, so a frozen companion shows up in the log
  rather than silently.

**No Dock icon.** A consequence of the above, and the behaviour a desktop pet
wants anyway. The app is reached from the tray icon, or by right-clicking the
companion.

**First click.** Handled: the companion window sets `acceptFirstMouse`, which
wry exposes as a window attribute. An earlier attempt patched
`acceptsFirstMouse:` onto the view classes at runtime; that turned out to be
unnecessary and was removed.

Open settings from the tray icon, or by right-clicking the companion.

### Verification

Phases 1–3 were confirmed on screen: the character renders transparently over
the desktop, animates at the authored frame rate, and walks across the display.

Phases 4–5 are covered by tests rather than by hardware, because only one
display was attached during development. The tests use synthetic layouts —
including the vertically stacked arrangement with the upper display at negative
y — and assert the companion lands on the right display at the right
coordinates. **They have not yet been exercised against two real monitors.**

## Installing

### From a release

Builds for macOS and Windows are attached to each GitHub release:

<https://github.com/tanvirahmodrafi/Choto-You/releases>

| Platform | Download | Notes |
| --- | --- | --- |
| macOS | `Choto You_<version>_universal.dmg` | One disk image for both Intel and Apple Silicon |
| Windows 10/11 (x64) | `Choto You_<version>_x64-setup.exe` | NSIS installer; the recommended one |
| Windows 10/11 (x64) | `Choto You_<version>_x64_en-US.msi` | For deployment through group policy or a management tool |

There is no Linux bundle. The overlay depends on per-platform window code
(`src-tauri/src/platform/`) that has a macOS and a Windows implementation only.

**macOS.** Open the `.dmg` and drag **Choto You** into Applications. The builds
are not code-signed, so the first launch is blocked: right-click the app in
Applications, choose **Open**, then confirm at the prompt. Double-clicking it
the usual way only offers to move it to the Bin. After that first approval it
launches normally.

The companion has no Dock icon by design — see
[Known macOS limitations](#known-macos-limitations). Look for the silhouette in
the menu bar.

**Windows.** Run the `-setup.exe`. SmartScreen warns about an unknown
publisher, because the installer is unsigned: click **More info** →
**Run anyway**. The app then appears in the notification area, under the
overflow arrow if Windows has hidden it.

### Verifying a build you made yourself

1. `npm run tauri:dev`
2. The character appears on the primary display with no window frame, title
   bar, background rectangle or drop shadow.
3. It stays above other windows when you click into another application.
4. Clicking elsewhere on the desktop still works — the overlay intercepts the
   cursor only inside the character's hitbox.
5. The tray icon is present, and **Settings…** opens the settings window.

## Using it

**First launch.** The companion appears on the primary display and starts
wandering. There is no onboarding and nothing to sign in to; the defaults are
meant to be usable as they are.

**Interacting with it.** Click for a reaction, double-click for a bigger one,
drag it anywhere (it falls to the floor when you let go), and right-click to
open the settings window. Everywhere else, clicks pass straight through to
whatever is underneath.

**The tray icon** carries the controls you need without opening settings:
show or hide the companion, pause reminders, open settings, restart, quit. See
[The tray](#the-tray) for what each item does. Closing the settings window
hides it rather than quitting — the application lives in the tray.

**Settings** has seven tabs:

| Tab | What you set there |
| --- | --- |
| General | Start with computer, launch minimized, sound, show companion |
| Character | Which avatar, its size, animation speed, and importing your own |
| Display | Which monitor it lives on: follow the cursor, roam, primary, or a specific one |
| Reminders | Interval reminders — water, posture, breaks, and any you add yourself |
| Alarms | Clock alarms at a time of day, with an optional warning beforehand |
| Behavior | Roam freely, only when reminding you, or stay put |
| Advanced | Debug hitbox overlay, frame-rate cap, and reset everything to defaults |

Changes apply immediately. Both windows read the same database and are kept in
step by events, so you never have to restart to see a setting take effect.

**Reminders and alarms** are described in full under
[Reminders](#reminders) and [Alarms](#alarms). The short version: reminders
repeat on an interval and can be paused from the tray; alarms fire at a wall
clock time, ignore the pause, and are dropped rather than announced if they are
badly late.

**Bringing your own character.** Settings → Character → import. A pack is a
`character.json` and its images, with no executable code. You can import a
sprite sheet and have it sliced, or a folder of stills. [Avatars](#avatars)
covers the format, and [Making one from a photo](#making-one-from-a-photo) the
generated prompt for producing a sheet from a photograph.

**Leaving it running.** It is built to sit in the tray all day: it sleeps after
ten minutes without cursor movement, caps its frame rate, and suspends its
animation loop entirely while hidden.

## Building from source

### Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Node | 20 or newer | `node --version` |
| Rust | stable, via `rustup` | `rustup toolchain install stable` |
| macOS | Xcode command line tools | `xcode-select --install` |
| Windows | MSVC build tools and WebView2 | WebView2 ships with Windows 11 and current Windows 10 |

Tauri's own [prerequisites page](https://v2.tauri.app/start/prerequisites/)
lists the system packages per platform if a build fails to configure.

If `cargo` and `tauri` are not on your `PATH`, prefix commands with
`PATH="$HOME/.cargo/bin:$PATH"`.

### Development

```bash
git clone https://github.com/tanvirahmodrafi/Choto-You.git
cd Choto-You
npm install
npm run tauri:dev
```

`tauri:dev` starts the Vite dev server on port 1420 and launches the app
against it, so frontend edits hot-reload. Rust changes trigger a rebuild and a
restart, which takes noticeably longer — the first one longest of all, since the
whole dependency tree compiles.

Logs go to the terminal in a dev build, and to a rotating file in the OS log
directory in both:

| Platform | Log directory |
| --- | --- |
| macOS | `~/Library/Logs/com.chotoyou.app/` |
| Windows | `%LOCALAPPDATA%\com.chotoyou.app\logs\` |

### Checks before handing work back

```bash
npm test          # Vitest, once
npm run typecheck # tsc --noEmit, strict
cargo fmt --check --manifest-path src-tauri/Cargo.toml   # if Rust changed
```

CI runs these on every push and pull request, and additionally compiles the
Rust crate on both macOS and Windows with `clippy -D warnings`. The Windows leg
is the point of it: development happens on macOS, so a break in
`platform/windows.rs` would otherwise stay hidden until release day.

### Producing a bundle locally

```bash
npm run tauri:build
```

That runs `npm run build` first (typecheck plus the Vite bundle), then compiles
the crate in release mode and packages it. `bundle.targets` is `"all"`, so
every installer format the host platform can produce is built. Output lands
under `src-tauri/target/release/bundle/`:

| Platform | Artifact | Path |
| --- | --- | --- |
| macOS | App bundle | `macos/Choto You.app` |
| macOS | Disk image | `dmg/Choto You_<version>_<arch>.dmg` |
| Windows | NSIS installer | `nsis/Choto You_<version>_x64-setup.exe` |
| Windows | MSI | `msi/Choto You_<version>_x64_en-US.msi` |

To skip the installers and get only the runnable app — much faster, and what
you want while iterating on release behaviour:

```bash
npm run tauri -- build --bundles app     # macOS
```

A universal macOS binary needs both architectures installed, because Tauri
builds each and merges them with `lipo`:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri -- build --target universal-apple-darwin
```

Cross-compiling between macOS and Windows is not supported. Each platform's
installers are built on that platform, which is what the release workflow does.

## Releasing

Releases are built by `.github/workflows/release.yml` on GitHub Actions, one
job per platform, and attached to a **draft** GitHub release. Nothing is
published automatically.

1. Bump the version in **both** `package.json` and
   `src-tauri/tauri.conf.json`. They are separate files and must agree; the
   bundle takes its version from the Tauri config and the installer file names
   follow it.
2. Run the checks above, and commit.
3. Tag and push:

   ```bash
   git tag v1.1.0
   git push origin main
   git push origin v1.1.0
   ```

4. Watch the two jobs in the Actions tab. `fail-fast` is off, so one platform
   failing does not discard the other's artifacts.
5. Smoke-test the Windows installer before publishing. The overlay behaviour
   there is barely exercised, which is the reason the release is left as a
   draft.
6. Edit the release notes and publish.

A tag that already exists can be built again from the Actions tab:
**Release** → **Run workflow**, giving the tag name. The workflow checks that
tag out rather than the default branch.

### Code signing

The published builds are unsigned, which is why users have to click through
Gatekeeper and SmartScreen on first launch. To sign and notarize the macOS
build, add these repository secrets and uncomment the matching `env` entries in
`release.yml`:

`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.

Signing requires a paid Apple Developer account; Windows signing requires a
code-signing certificate. Neither is set up.

### The app does not auto-update

There is no updater plugin and no update endpoint, deliberately: the
no-network-access property in the first paragraph of this file is worth more
than the convenience. Upgrading means installing the new version over the old
one, which keeps your data — the app's data directory is derived from the
bundle identifier, and that has not changed.

## Where your data lives

| Platform | Directory |
| --- | --- |
| macOS | `~/Library/Application Support/com.chotoyou.app/` |
| Windows | `%APPDATA%\com.chotoyou.app\` |

It holds `companion.db` (settings, reminders, alarms, the saved position) with
its SQLite sidecars, and `avatars/` for imported character packs. Backing the
directory up copies everything; deleting it resets the app to a first launch.

### Uninstalling

1. Turn off **Start with computer** in Settings → General, or remove the login
   item in the OS afterwards, then quit from the tray.
2. macOS: drag **Choto You** from Applications to the Bin.
   Windows: uninstall it from Settings → Apps.
3. Delete the data directory above if you want the settings gone too. The
   uninstaller leaves it in place.

## Troubleshooting

**Nothing appears after launching.** Check whether the companion is hidden:
tray icon → **Show Choto You**. Display enumeration can legitimately return
nothing during wake or at login, so startup waits up to a minute for a display
and retries the whole sequence three times — see
[Startup recovery](#startup-recovery). If it is still blank, the log file says
which step gave up.

**macOS says the app is damaged or cannot be opened.** That is Gatekeeper on an
unsigned build, not a corrupt download. Right-click the app in Applications and
choose **Open**.

**The character froze in place.** It stalls if the overlay is left on a Space
you are not looking at, because WebKit throttles timers in a hidden webview.
The current window policy prevents it; `Ticker` warns to the log when the loop
stalls, so check there and file an issue with the surrounding lines.

**Clicks are not reaching the application underneath.** The overlay intercepts
only inside the hitbox declared in `character.json`. Settings → Advanced →
**Debug mode** draws it, which usually shows the pack declaring a hitbox far
larger than its drawing.

**A setting made the companion unusable.** Settings → Advanced →
**Reset…** puts everything back to its default. Values read from the database
are clamped on load, so a hand-edited or out-of-range value costs its own
default rather than preventing startup.

**The build fails before compiling.** `tauri-build` needs `frontendDist`
(`../dist`) to exist; run `npm run build` first if you are invoking `cargo`
directly.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run tauri:dev` | Runs the app with the Vite dev server |
| `npm run tauri:build` | Builds the installable bundle |
| `npm test` | Runs the unit tests |
| `npm run test:watch` | Runs the unit tests in watch mode |
| `npm run typecheck` | Strict TypeScript check, no emit |
| `npm run build` | Typecheck plus the frontend bundle, without packaging |
| `npm run assets:character` | Rebuilds the bundled avatar from `art/avatar-sheet.png` |
| `npm run assets:icon` | Rebuilds the application icon set from `art/app-icon.png` |
| `npm run assets:tray` | Rebuilds the menu bar silhouette from the bundled avatar |
| `npm run assets:sample-sheet` | Writes `samples/sample-avatar-sheet.png` for testing sheet import |

## Layout

```
src/
  app/         window entry points (one per Tauri window) and their CSS
  companion/   the overlay surface: CompanionOverlay, CharacterRenderer
  characters/  character-pack loading and validation
  animation/   animation engine                       (Phase 2)
  movement/    movement engine, physics, boundaries   (Phase 3)
  displays/    display manager, topology, active monitor (Phase 4)
  behavior/    state machine, behaviour engine, event queue (Phase 6)
  reminders/   reminder scheduler and engine          (Phase 7)
  settings/    settings window UI                     (Phase 8)
  tray/        system tray                            (Phase 9)
  database/    SQLite persistence                     (Phase 8)
  types/       shared type definitions
  utils/       logger and helpers

src-tauri/src/
  commands/    the frontend-facing command surface
  windows/     window creation and runtime configuration
  displays/    monitor enumeration                    (Phase 4)
  platform/    all macOS/Windows-specific code

art/                     the source artwork the bundled assets are built from
public/characters/rafi/  the bundled avatar pack, built from that artwork
tools/                   asset builders and generators
```

Directories for later phases exist but are empty or hold only a documented
placeholder module — the structure is fixed up front so modules land in a
predictable place rather than being retrofitted.

## The two windows

| Window | Label | Behaviour |
| --- | --- | --- |
| Companion overlay | `companion` | Transparent, frameless, no shadow, always on top, skipped in the taskbar, does not take focus |
| Settings | `settings` | An ordinary window, hidden on launch |

They are separate HTML entry points, so the overlay bundle never loads settings
code.

Transparency on macOS requires `macOSPrivateApi: true` in `tauri.conf.json`
alongside `transparent: true` on the window. `shadow: false` matters just as
much: without it macOS draws a rectangular drop shadow around the invisible
window and the companion stops looking like it is sitting on the desktop.

**Call order in `configure_companion` is load-bearing.** On macOS,
`set_visible_on_all_workspaces` rewrites the window's collection behaviour and
resets its level, silently undoing an earlier `set_always_on_top`. The overlay
then renders *behind* ordinary windows while still reporting `visible = true`,
which is a confusing failure to diagnose. Always-on-top is therefore asserted
last.

## Avatars

One avatar ships with the app — **Choto Rafi** — built by `npm run assets:character`
from `art/avatar-sheet.png`, the original artwork committed alongside it. The
app icon and the menu bar silhouette come from the same character, so what is
in the Dock, in the menu bar and on the desktop is recognisably one person.

The sheet is in exactly the layout `SHEET_PLAN` asks an image model for, which
is the same layout the in-app importer slices — the bundled avatar is built the
way any imported one is, rather than by a separate path that could drift.

Turning drawings composed cell by cell into frames that can be *animated* is
most of the work, and `tools/build-avatar-pack.mjs` does it: each drawing is
found by its own artwork rather than by an assumed grid, scaled by the width of
its head — the one measurement a pose cannot change — and placed on a shared
baseline and centre line. A sprite whose size or position wanders between cells
makes the character swell and slide on screen, which reads as a bug rather than
as a character.

The run cycle is the exception to the shared baseline: it is registered by the
head instead. Both feet leave the ground in the airborne frames, so putting
each frame's lowest pixel on the floor would push the character *down* exactly
where it should be rising.

Avatar packs are declarative: a `character.json` manifest plus image assets,
with no executable code. The manifest is versioned (`schemaVersion`) and fully
validated on load, so a corrupt or unsupported pack produces one clear error
instead of failing somewhere inside the renderer.

Which avatar is on screen is a setting, and changing it swaps the artwork in
place — the character keeps its position, its reminders and, where both packs
have the pose, its current animation frame.

```
public/characters/
  index.json          ← what the picker lists; a webview cannot list a directory
  rafi/
    character.json
    thumbnail.png
    idle/001.png … 008.png
    walk/001.png … 008.png
    wave/001.png … 008.png
    jump/001.png, fall/001.png, land/001.png, …
```

Slots the sheet has no drawing for are pointed at one that fits rather than
left out — `wake` reuses the sleeping pose — because the runtime asks for all
twelve and a missing one would be filled with a blank stare at the moment the
character wakes up.

A pose that the runtime waits on must be able to *end*. A looping single-frame
clip never completes, so it never releases the priority it was played at: one
click and the character would wear its delighted face for the rest of the
session, because ordinary walking ranks below a reaction. The builder marks
those slots one-shot and holds them for half a second.

### Making one from a photo

Settings → Character → *Make one from a photo* is the route to an avatar that
actually moves.

The app has no backend and makes no network calls, so it does not talk to an
image model itself — you are the transport:

1. **Copy the prompt.** It is generated from `SHEET_PLAN`, so the poses it asks
   for and the poses the slicer expects cannot drift apart. A name and an extra
   note ("wearing a white saree") are folded in.
2. Paste it into ChatGPT or Claude with a clear photo of the person.
3. Bring the returned PNG back and choose it.

What comes back is an 8×4 sprite sheet, 32 poses in one 4096×2048 image. Each
512×512 cell retains enough source detail for clean downscaling on high-density
displays. One sheet rather than 32 separate generations keeps the character
consistent between frames. Three rows are real animations:

| Row | Becomes | Frames |
| --- | --- | --- |
| 1 | `idle` | 8 — breathing, with a blink |
| 2 | `walk` | 8 — a full run cycle, so legs and arms swing |
| 3 | `wave` | 8 — the edge peek opening into a greeting |
| 4 | `jump`, `fall`, `land`, `happy`, `surprised`, `drink`, `dragged`, `sleep` | 1 each |

Three of row 4 are one event rather than three unrelated poses: `dragged` is
the character held up in the user's hand, `fall` is the moment it is let go,
and `land` is the shock-absorbing crouch. The prompt names them by cell number
and marks them in the list, so the same startled expression carries through all
three.

That row's cell **order is a wire format**, not a preference: it is how cells
are matched to animation slots, so moving one silently re-labels every sheet
anyone has already generated — a jump would import as the pose for being picked
up. Reword a cell freely; do not move one. (It is why the three pick-up moments
are not adjacent, and are cross-referenced by number instead.)

The prompt also has to say, in as many words, that the attached image is a
photograph of a real person whose face must be reproduced — its shape, jaw,
nose, eyes, eyebrows, mouth, skin tone — and that the *style* is what gets
simplified, never the identity. Without that, models return a plausible cartoon
of somebody else: a mascot, rather than your mother.

The remaining slots borrow along the fallback chains. A borrowed clip is
re-timed for where it lands: a looping walk copied into `land` is made to
finish, or the runtime's `onFinish` never fires and the character is stranded in
the pose.

Cells are never trimmed to their contents. Trimming is tempting — most have
transparent margins — but it destroys the alignment between frames, and a walk
cycle whose frames are each centred on their own bounding box jitters badly.
The prompt instead demands a constant baseline, which is what the pack's anchor
assumes.

#### How big the character has to be drawn

The prompt states this in numbers because a model told only to "leave a margin"
fills the frame instead: head to heel is **75%** of the cell's height (never
more than 80%), planted feet sit on a line **88%** of the way down it, the
widest pose is at most **80%** of the cell's width, and **10%** of every side
stays empty. `CELL_LAYOUT` in `src/characters/avatarSheet.ts` holds those
figures, and the prompt quotes them as both percentages and pixels.

They are fractions rather than pixels because the canvas size the prompt asks
for is the one thing models reliably ignore — returned sheets come back at
whatever resolution the model works at, and a rule stated in pixels stops
applying the moment it does.

The failure they prevent is not subtle. Measured on returned sheets, characters
were drawn at 105–120% of their cell height: every row overflowed into the one
below, the least-damaging cut ran through the shoes, and on one sheet the bottom
row's feet ran off the edge of the image with no margin at all. A cut-off foot
cannot be recovered afterwards, because those pixels were never drawn.

So the row boundaries are searched for **per column**, not once across the
sheet. Whether a figure overflows is a property of that one drawing: on the
sheet the bundled avatar is built from, four of eight columns had a clean gap at
the third boundary and four did not. One cut across the sheet took the soles off
all four; found per column, seven of the eight keep their feet and the last
loses 11 pixels. `npm run assets:character` prints what each cut went through,
so a sheet that needs redrawing says so.

Image models are unreliable about transparency, so the prompt asks for a flat
chroma green (`#00B140`) as a fallback and the importer keys it out. The
background colour is sampled from the sheet's four corners rather than assumed,
so white works too; if the corners disagree, nothing is touched, because a
photographic background is not something a colour key can fix and a half-removed
one looks far worse than one left alone. The preview shows each sliced pose on a
checkerboard, which makes a failed transparency obvious at a glance.

`npm run assets:sample-sheet` writes `samples/sample-avatar-sheet.png` — a sheet
in exactly this layout, on exactly that green — so the import can be tried
without a round trip to a model.

### Bringing your own stills

Settings → Character → *Add still pictures* imports one still image per mood.
Simpler, but a still cannot walk: it slides.
Only **Normal** is required; every other pose falls back along a chain that
ends at it, so a single drawing is already a working avatar, and supplying
*Happy* also covers waving, drinking and being surprised.

A still is stored as a one-frame animation rather than as a separate format, so
the player, the loader and the frame cache need no special case — and a pack can
gain real sequences one slot at a time as the artwork improves. The chains and
the slot list live in `src/characters/stills.ts`.

Imported packs cannot live in the bundle, which is read-only and signed, so they
are written to `avatars/<id>/` under the app data directory and served through
Tauri's asset protocol (scoped to that directory in `tauri.conf.json`). Images
are sent to Rust as base64 from a file input, so the app never opens a path the
webview named, and an import stages into a temporary directory and is renamed
into place — an interrupted import cannot leave a pack that loads with half its
images missing.

### Per-reminder avatars

A reminder can name its own avatar, which delivers it and then gives the desk
back. Reminders that name none use whichever avatar is currently on screen.

This is what makes a household of avatars useful: a reminder to pray delivered
by one person, water and eye breaks by another.

The changeover is on foot, not a cut. Swapping the artwork where the character
stood turned one person into another mid-stride, which read as a glitch rather
than as a visit. Instead (`AvatarHandover`): the character on screen runs off
whichever edge is nearer, the reminder's avatar leans in from that same edge
and walks to the centre, delivers, walks back out, and the first one returns to
the exact spot it was using.

Both swaps happen while the character is fully off screen, and each off-screen
stage waits there until the pack has finished loading — so a slow import is
absorbed in the one place where nothing can be seen, rather than showing the
wrong avatar walking in. Those waits time out after six seconds: a pack that
cannot load must not leave the companion parked beyond the edge of the screen,
which the user has no way to suspect, let alone fix.

The movement layer refuses to place the companion outside the work area, which
is what keeps it from ever becoming unreachable. Walking *off* the edge is
therefore drawn by sliding the character out of a window that clips it — the
same trick reminder-only mode uses for its peek — not by moving the window off
screen.

Picking the companion up outranks all of this: the exchange is abandoned where
it is, the chosen avatar comes straight back, and the character is put back
inside its window rather than left half-clipped.

## Logging

Logs are tagged by subsystem so they read as an event stream:

```
[APP]     Companion overlay starting
[WINDOW]  Companion overlay configured
[CHARACTER] Loaded character "Pip" v1.0.0
```

Development builds log from `debug` up; production builds keep `warn` and
`error` only.

## Speech bubbles and the window

The overlay window is normally exactly the character, so it intercepts as
little of the desktop as possible. A speech bubble does not fit in 96x96, so
while one is shown the window grows and the character moves to a corner of it.

The bubble is a white rectangle joined to the character by three dots stepping
down to its head, the way a thought balloon connects to whoever is thinking.
White in both colour schemes, because it sits on whatever the user's desktop
happens to be rather than on one of the app's own surfaces, and white with dark
text is the one combination that reads on both. The dots hang below the box in
CSS and are not part of its measured height, so the layout's `gap` has to clear
them or the lowest one is drawn over the character's hair.

`OverlayLayout` is the only module that knows the window is sometimes bigger
than the character. Movement, boundaries and interaction all continue to work
in *character* coordinates, which keeps that complication out of them. The
bubble flips to the character's other side near a display edge, and the window
is clamped into the work area, so a bubble is never drawn off-screen — the
hitbox follows the character wherever the clamp puts it.

## Reminders

Four are built in — drink water, an eye break every 20 minutes, stand up, and
stretch — and you can add your own with their own message, interval and avatar.

`ReminderScheduler` decides *when*; `ReminderPerformance` decides *what
happens*. The scheduler sleeps until the next reminder is due rather than
polling, capped at 30 seconds so a suspended machine or a clock change cannot
overshoot badly.

A due reminder is not shown immediately — it is pushed onto an `EventQueue`
with a priority and an expiry. That is what stops a reminder interrupting a
drag or a monitor crossing, stops twenty minutes of missed reminders arriving
at once (same key replaces, rather than stacks), and stops a stale one
appearing long after it mattered.

## Alarms

Reminders repeat on an interval. An alarm happens at a time: "standup at 9:45",
"take the tablet at ten". They are separate tabs in settings and separate
tables in the database, because almost nothing about them is shared — an alarm
has a wall-clock time, no interval, and an optional warning before it.

The warning is the part that earns the feature. Being told at 8:00 that the
meeting is at 8:00 is too late to do anything with, so an alarm can send the
companion out a few minutes beforehand: *Standup in 5 minutes.* Each alarm
carries its own warning time, its own message, and its own avatar, so the
person who tells you about the meeting can be a different character from the
one who nags you about water.

```
Alarms                                    Reminders
at 07:55  →  "Standup in 5 minutes."      every 45 min  →  "Drink some water!"
at 08:00  →  "Bring the slides."
```

An alarm is anchored to minutes since local midnight rather than to a
timestamp, so 08:00 is still 08:00 after the clocks change — the next
occurrence is built from calendar fields, not by adding 24 hours.

Everything after the moment of being due is shared: both kinds reduce to an
`Announcement`, and one queue holds both, which is what lets an alarm outrank a
queued reminder instead of the two racing for the companion.

**Alarms do not obey the reminder pause.** Pausing stops the companion
interrupting you on its own; an alarm is a moment you asked for, and by the
time one is queued its own schedule has already moved past that occurrence, so
suppressing it would lose it rather than defer it. Phone alarms behave the same
way inside Do Not Disturb.

**A late alarm is not announced.** If the machine slept through 08:00, nobody
needs telling at 09:15. More than five minutes late and it is skipped with a
line in the log: a daily alarm moves to tomorrow, and a one-off switches itself
off, so settings shows plainly that it was missed instead of it going off a day
late.

Alarms arrive with an entrance even while the companion is free-roaming: it
runs off the nearest edge, walks back in to that corner, says its piece and
returns to where it was standing. A reminder, which arrives while the character
is already wandering about, just speaks from where it is. Neither happens when
the roam mode is *Stay put* — that setting is a promise that it never moves on
its own, and an entrance is movement.

Editing either kind in settings now reaches the running companion. The settings
window writes to the database and broadcasts; the overlay re-reads. Before, an
edit only took effect at the next launch, which is survivable for a reminder's
interval and useless for an alarm set for ten minutes' time.

## Startup recovery

Display enumeration can legitimately come back empty for a while — during
wake, while a monitor is connected, and especially at login, where the app can
be running before any display is awake. Treating that as fatal was observed to
leave the overlay permanently blank with no way to recover.

Startup therefore waits up to a minute for a display, and the whole sequence is
retried three times. Nothing about it is fast-fail, because the failure mode is
an invisible companion the user has no reason to suspect is broken.

## Storage

One SQLite file in the app's data directory, created and migrated on startup.
Nothing leaves the machine.

SQL lives only in `src/database/`; the rest of the application works with typed
objects, so the storage format can change without touching it. Everything read
back is treated as untrusted — a database written by an older build, or edited
by hand, must not stop the companion starting. `mergeSettings` checks every
field individually and clamps numbers, so one bad value costs its own default
rather than the whole settings object. That matters more than it sounds: a
scale of 500 would cover the screen with a companion, and the settings window
needed to fix it would be underneath.

Settings are a key/value table holding JSON rather than a column per setting,
because the shape changes often and a wide table would mean a migration for
every new toggle.

**The position is written only once the character has been still for a few
seconds**, plus once on shutdown. Writing every step would mean thousands of
disk writes an hour for a value read exactly once, at startup.

## Two windows, one set of settings

The overlay and the settings window are separate webviews with separate
memory. Writes go to the database and then broadcast a Tauri event; each window
applies what it receives, so neither has to poll. Event payloads cross a
process boundary and are validated exactly like a value read from disk.

## Click-through and the hitbox

The overlay is a small transparent window sitting above everything else, so it
must not steal clicks meant for the application underneath.

The window is therefore click-through by default, and becomes solid *only*
while the cursor is inside the character's hitbox — the rectangle declared in
`character.json`, not the window bounds. The transparent padding around the
character never intercepts anything.

This requires knowing where the cursor is while the window is click-through,
which a webview cannot observe, so the global cursor position is polled. The
rate adapts to keep the cost down: 8Hz when the cursor is far away, 30Hz when
it is close enough to interact, and ~60Hz only while a drag is in progress.

## Coordinate space

Everything in the movement and display layers works in **physical pixels in
virtual-desktop coordinates**: one space spanning every monitor, with the origin
at the primary display's top-left.

A display above or to the left of the primary one therefore has negative
coordinates, and that is ordinary input, not an edge case. Nothing may assume
monitor 1 starts at x=0, or that monitor 2 starts where monitor 1 ends.

Character speeds are authored in logical points, so a character covers the same
apparent distance on any display and needs no rescaling when it moves between
them.

When a position is finally handed to the OS it is converted to physical pixels
using **the scale factor of the display it lands on**. Passing logical
coordinates to Tauri directly is wrong across displays of differing DPI: Tauri
converts with the scale factor of the display the window currently occupies, so
stepping from a 1x display onto a 2x one would be converted at 1x and place the
window in the gap between their physical rects, where nothing is visible.

---

Contributor conventions — style, naming, commit and PR expectations — are in
[`AGENTS.md`](AGENTS.md). What the code does and the invariants that are easy
to break by accident are in [`CLAUDE.md`](CLAUDE.md).
