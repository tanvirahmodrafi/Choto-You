import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const host = process.env.TAURI_DEV_HOST;

/**
 * Two HTML entry points, one per Tauri window:
 *   index.html    -> the transparent companion overlay
 *   settings.html -> the normal settings window
 * Keeping them separate means the overlay bundle never pays for settings UI.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Tauri expects a fixed port and must fail rather than silently pick another.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // Only override HMR when serving to an external dev host; the key must be
    // absent otherwise, not `undefined` (exactOptionalPropertyTypes).
    ...(host ? { hmr: { protocol: 'ws', host, port: 1421 } } : {}),
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        companion: fileURLToPath(new URL('./index.html', import.meta.url)),
        settings: fileURLToPath(new URL('./settings.html', import.meta.url)),
      },
    },
  },
});
