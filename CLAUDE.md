# CLAUDE.md

Guidance for Claude Code when working in this repository.

`AGENTS.md` holds the contributor conventions (style, naming, commit/PR
expectations) and applies here unchanged. This file covers what the code does,
how it fits together, and the invariants that are easy to break by accident.
`README.md` is the long-form rationale — read the relevant section before
changing window policy, coordinates, reminders, or avatar import.

## What this is

**Choto You** — a Tauri 2 desktop companion (an animated character that lives
on the desktop) for macOS and Windows. React 19 + TypeScript frontend, Rust
backend, SQLite for persistence.

Everything is local. There is no backend, no telemetry, and no network access
in any core feature. Do not add one without being asked.

## Commands

```bash
npm install                 # Node 20+; a stable Rust toolchain is also required
npm run tauri:dev           # app with Vite hot reload
npm test                    # Vitest, once
npm run test:watch
npm run typecheck           # tsc --noEmit, strict
npm run build               # typecheck + frontend bundle
npm run tauri:build         # installable bundle
cargo fmt --check --manifest-path src-tauri/Cargo.toml
npm run assets:character    # rebuild the bundled avatar from art/avatar-sheet.png
npm run assets:icon         # rebuild the app icon set from art/app-icon.png
npm run assets:tray         # rebuild the tray silhouette from the bundled avatar
npm run assets:sample-sheet # samples/sample-avatar-sheet.png, for testing sheet import
```

Before handing work back: `npm test`, `npm run typecheck`, and `cargo fmt`
if Rust changed. If `cargo`/`tauri` is not on PATH, prefix with
`PATH="$HOME/.cargo/bin:$PATH"` (see `start.md`).

## Architecture

Two Tauri windows, two Vite entry points, two separate webviews:

| Window | Label | Entry | Role |
| --- | --- | --- | --- |
| Companion overlay | `companion` | `index.html` → `src/app/companion-entry.tsx` | Transparent, frameless, shadowless, always-on-top, click-through, no focus |
| Settings | `settings` | `settings.html` → `src/app/settings-entry.tsx` | Ordinary window, hidden on launch, hides (not quits) on close |

Keeping them separate is deliberate: the overlay bundle never loads settings
code. Add a window entry to `vite.config.ts` `build.rollupOptions.input` if you
ever add a third.

### Frontend (`src/`)

`CompanionRuntime` (`src/companion/CompanionRuntime.ts`) is the hub: it
constructs every subsystem and drives them from a single tick. `useCompanion`
creates it once and retries startup up to three times. Subsystems:

- `animation/` — `Ticker` (one delta-timed loop, FPS-capped), `AnimationPlayer`
  (priority-based interruption, looping, direction flip), loader + frame cache.
- `movement/` — `MovementEngine` (delta-timed walk, gravity),
  `BoundaryDetector`, `MonitorTransition` (walk to edge → look → jump → fall → land).
- `displays/` — `DisplayManager`, `MonitorTopology`, `ActiveMonitorDetector`,
  `DisplayWatcher` (hot-plug).
- `behavior/` — `WanderBehavior`, `IdleMonitor` (sleep after 10 min of cursor
  stillness), `EventQueue` (priority + expiry + replace-by-key).
- `interaction/` — `CursorTracker` (adaptive 8/30/60 Hz polling), `Hitbox`,
  `InteractionController` (click, double click, right click, hover, drag).
- `reminders/` — `ReminderScheduler` decides *when*, `ReminderPerformance`
  decides *what happens*, `ReminderCoordinator` joins them, `ReminderVisit`
  handles the reminders-only peek-and-deliver sequence, `AvatarHandover` the
  free-roam exchange when a reminder belongs to a different avatar.
- `alarms/` — clock alarms: `AlarmScheduler` plus the model. Scheduled by time
  of day, with an optional warning minutes beforehand; delivered through the
  reminder coordinator as an `Announcement`, which is the one shape both kinds
  reduce to.
- `characters/` — pack loading and validation, `AvatarRegistry`, sprite-sheet
  slicing (`avatarSheet.ts`, `sliceSheet.ts`), stills import (`stills.ts`),
  the generated model prompt (`avatarPrompt.ts`).
- `database/` — the only place SQL lives. `Database`, `SettingsRepository`,
  `ReminderRepository`, `PositionStore`.
- `settings/` — settings window UI, `SettingsStore`, `merge.ts`, `types.ts`.
- `utils/logger.ts` — tagged logging; `tray/trayEvents.ts` — tray event listener.

### Backend (`src-tauri/src/`)

`lib.rs` wires plugins (log, sql, autostart), registers commands, and runs the
setup sequence: legacy data carry-over → startup policy → tray → window
configuration → the overlay-level keeper thread → settings close handler.
`main.rs` is a thin wrapper.

- `commands/` — only what a webview cannot do itself: `app_info` and the avatar
  filesystem commands. Window moves and display enumeration use Tauri's own APIs.
- `windows/` — window lookup and `configure_companion`.
- `platform/` — all macOS/Windows divergence (`macos.rs` uses AppKit via `objc2`).
- `database.rs` — declares the migrations in `src-tauri/migrations/`.
- `tray/`, `displays/`, `logging.rs`, `migration.rs`.

## Invariants

These are load-bearing. Breaking one produces a bug that is hard to attribute.

**Coordinates.** The movement and display layers work in *physical pixels in
virtual-desktop coordinates* — one space across all monitors, origin at the
primary display's top-left. Negative coordinates are ordinary input. Never
assume a display starts at x=0 or that display 2 begins where display 1 ends.
Character speeds are authored in logical points; convert to physical using the
scale factor of **the display the position lands on**, not the one the window
currently occupies.

**Window call order.** In `configure_companion`, `set_visible_on_all_workspaces`
resets the window's collection behaviour and level on macOS, silently undoing an
earlier `set_always_on_top`. Always-on-top must be asserted **last**.

**macOS overlay policy.** `ActivationPolicy::Accessory` + a level above
`NSPopUpMenuWindowLevel` + `canJoinAllApplications` are required *together* for
the overlay to join other apps' fullscreen Spaces. Changing one in isolation
produces misleading results (README documents the measurements). The keeper
thread restores the level twice a second because Tauri re-applies its own after
setup. Transparency needs both `macOSPrivateApi: true` and `shadow: false`.

**Click-through.** The overlay is click-through by default and becomes solid
only while the cursor is inside the hitbox declared in `character.json` — never
the window bounds.

**Overlay layout.** `OverlayLayout` is the *only* module that knows the window
can be larger than the character (speech bubbles). Movement, boundaries and
interaction stay in character coordinates.

**Untrusted reads.** Anything from SQLite or from a cross-window Tauri event is
validated field by field and clamped — `mergeSettings` is the pattern. One bad
value must cost its own default, not the whole object; a scale of 500 makes the
app unrecoverable through its own UI.

**Two schedules, one queue.** Interval reminders and clock alarms are
scheduled by completely different rules and meet as `Announcement`s in
`ReminderCoordinator`, which holds the only queue. Two queues would let them
race for the companion; one lets an alarm outrank a reminder. Alarms are exempt
from the reminder pause and are dropped rather than announced when more than
`ALARM_STALE_MS` late — both deliberate, both documented in the README.

**SQL stays in `src/database/`.** Everything else works with typed objects.
Settings are JSON in a key/value table on purpose, so new toggles need no
migration. Position is written only after a few seconds of stillness, plus once
on shutdown.

**Cross-window state.** Writes go to the database, then broadcast a Tauri event;
each window applies what it receives. No polling, no second source of truth.
State the frontend owns (e.g. whether reminders are paused) is sent to it as an
event rather than duplicated in Rust.

**Startup is never fast-fail.** Display enumeration legitimately returns empty
during wake and at login. Startup waits up to a minute for a display and the
whole sequence retries three times; the failure mode otherwise is an invisible
companion the user has no reason to suspect.

**Frame-rate independence.** Anything periodic (roam checks, probability rolls,
movement) is time-based, not per-frame, so behaviour matches on 60 Hz and 120 Hz.

**Sheet geometry is a contract.** `CELL_LAYOUT` in `characters/avatarSheet.ts`
fixes how big the character is drawn inside its cell (75% of the cell height,
feet on a baseline at 88%, 10% margins) and the generated prompt quotes those
numbers. They are fractions, not pixels: models ignore the requested canvas
size, so returned sheets arrive at arbitrary resolutions. A figure drawn taller
than its cell overflows into the row below and the slicer's cut goes through its
feet, which cannot be recovered — row boundaries are therefore found per column,
so one overflowing drawing does not cost the whole row its shoes.

**Avatar packs are declarative.** `character.json` + images, no executable code,
`schemaVersion` validated on load. Imported packs go to `avatars/<id>/` under the
app data directory and are served through the asset protocol (scoped in
`tauri.conf.json`); images reach Rust as base64, and an import stages into a temp
directory and is renamed into place. Sprite-sheet cells are never trimmed to
their contents — trimming destroys inter-frame alignment.

## Security-sensitive files

Explain any change to these in the PR: `src-tauri/tauri.conf.json` (CSP, asset
protocol scope, window flags), `src-tauri/capabilities/*.json` (the `companion`
capability deliberately withholds window control from the settings window),
window ordering, and macOS overlay settings in `platform/macos.rs`.

## Testing

Vitest, colocated as `*.test.ts`, no separate config. Name tests after
observable behaviour. Fake time, animation frames, displays, and anything else
machine-dependent — multi-monitor behaviour is covered by synthetic layouts
(including negative origins and mixed DPI) and has **not** been verified against
real hardware. Add regression coverage for movement, scheduling, or animation
changes.

## Logging

`createLogger('<SUBSYSTEM>')` from `src/utils/logger.ts`; tags are a fixed union
(`APP`, `DISPLAY`, `STATE`, `MOVE`, `ANIM`, `REMINDER`, `CHARACTER`, `DB`,
`WINDOW`). Frontend logs are forwarded to the Rust logger so both streams land
in one ordered log file — the overlay usually runs with no devtools open. Dev
builds log from `debug`; production keeps `warn` and `error`.
