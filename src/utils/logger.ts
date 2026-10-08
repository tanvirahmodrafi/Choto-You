/**
 * Structured logging with stable subsystem tags, so logs read as an event
 * stream rather than free-form text:
 *
 *   [DISPLAY] Monitor detected: DISPLAY-1
 *   [STATE]   IDLE -> WALKING
 *
 * Messages go to the webview console *and* to the Rust logger, so the
 * companion's frontend and backend events land in one ordered stream and in
 * one log file. That matters because the overlay normally runs from a tray
 * icon with no devtools open.
 *
 * Production builds keep only warnings and errors.
 */
import { debug as pluginDebug, error as pluginError, info as pluginInfo, warn as pluginWarn } from '@tauri-apps/plugin-log';

export type LogSubsystem =
  | 'APP'
  | 'DISPLAY'
  | 'STATE'
  | 'MOVE'
  | 'ANIM'
  | 'REMINDER'
  | 'CHARACTER'
  | 'DB'
  | 'WINDOW';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Vite replaces import.meta.env.DEV at build time, so production drops the
// debug/info branches entirely.
let minimumLevel: LogLevel = import.meta.env.DEV ? 'debug' : 'warn';

export function setLogLevel(level: LogLevel): void {
  minimumLevel = level;
}

const FORWARD: Record<LogLevel, (message: string) => Promise<void>> = {
  debug: pluginDebug,
  info: pluginInfo,
  warn: pluginWarn,
  error: pluginError,
};

function emit(level: LogLevel, subsystem: LogSubsystem, message: string, detail?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) return;
  const prefix = `[${subsystem}]`;
  const args: unknown[] = detail === undefined ? [prefix, message] : [prefix, message, detail];
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else console.log(...args);

  // Fire-and-forget: a logging failure must never surface as an error, and
  // must never be reported through this same path or it would recurse.
  const line = detail === undefined ? `${prefix} ${message}` : `${prefix} ${message} ${safeStringify(detail)}`;
  void FORWARD[level](line).catch(() => {});
}

function safeStringify(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`;
  try {
    return JSON.stringify(detail) ?? String(detail);
  } catch {
    return String(detail);
  }
}

export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

export function createLogger(subsystem: LogSubsystem): Logger {
  return {
    debug: (message, detail) => emit('debug', subsystem, message, detail),
    info: (message, detail) => emit('info', subsystem, message, detail),
    warn: (message, detail) => emit('warn', subsystem, message, detail),
    error: (message, detail) => emit('error', subsystem, message, detail),
  };
}

/**
 * Routes otherwise-silent webview failures into the log. Without this a script
 * error in the overlay leaves an invisible, empty window and no explanation.
 */
export function installGlobalErrorHandlers(subsystem: LogSubsystem = 'APP'): void {
  const log = createLogger(subsystem);
  window.addEventListener('error', (event) => {
    log.error(`Uncaught error: ${event.message}`, `${event.filename}:${event.lineno}:${event.colno}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    log.error('Unhandled promise rejection', event.reason);
  });
}
