# Repository Guidelines

## Project Structure & Module Organization

Choto You is a Tauri 2 desktop application. The React/TypeScript frontend lives in `src/`, grouped by responsibility (`animation/`, `movement/`, `displays/`, `reminders/`, and `settings/`). Window entry points and CSS are in `src/app/`. Native Rust code is under `src-tauri/src/`, with OS-specific behavior in `platform/`, commands in `commands/`, and SQL migrations in `src-tauri/migrations/`. Character packs belong in `public/characters/`; asset generators live in `tools/`.

## Build, Test, and Development Commands

- `npm install` installs pinned JavaScript dependencies (Node 20+; stable Rust is also required).
- `npm run tauri:dev` launches the desktop app with Vite hot reload.
- `npm test` runs the Vitest suite once; `npm run test:watch` reruns affected tests.
- `npm run typecheck` performs strict TypeScript checking without emitting files.
- `npm run build` type-checks and creates the frontend production bundle.
- `npm run tauri:build` creates the installable desktop bundle.
- `cargo fmt --check --manifest-path src-tauri/Cargo.toml` checks Rust formatting.

## Coding Style & Naming Conventions

Follow the existing TypeScript style: two-space indentation, single quotes, semicolons, trailing commas, and `@/` imports for `src/`. Strict compiler checks are enabled; do not bypass them with broad casts. Use `PascalCase` for components, classes, and their files (`CompanionOverlay.tsx`), and `camelCase` for functions and variables. Let `rustfmt` format Rust.

## Testing Guidelines

Vitest tests are colocated with implementation files as `*.test.ts`. Name tests after observable behavior and use fakes for time, animation frames, displays, and other machine-dependent inputs. Add regression coverage for movement, scheduling, or animation changes. Run `npm test`, `npm run typecheck`, and relevant Rust checks before submitting.

## Commit & Pull Request Guidelines

This checkout contains no Git history, so no repository-specific convention can be inferred. Use short, imperative subjects, for example `Fix reminder pause scheduling`. Keep generated assets and generator changes together. Pull requests should explain behavior, list verification, link an issue when applicable, and include screenshots or a recording for visual changes. Call out platform-specific testing and untested multi-monitor behavior.

## Security & Configuration

Core features are local-only. Do not introduce network access or secrets without documenting the need. Treat `src-tauri/tauri.conf.json`, capability files, window ordering, and macOS overlay settings as security- and behavior-sensitive; explain any permission or window-policy change in the pull request.
