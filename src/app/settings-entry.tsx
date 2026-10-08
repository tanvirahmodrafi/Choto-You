import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsApp } from '@/settings/SettingsApp';
import { createLogger } from '@/utils/logger';
import './settings.css';

const log = createLogger('APP');

const container = document.getElementById('settings-root');
if (!container) {
  log.error('Settings root element is missing from settings.html');
} else {
  createRoot(container).render(
    <StrictMode>
      <SettingsApp />
    </StrictMode>,
  );
}
