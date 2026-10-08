import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CompanionOverlay } from '@/companion/CompanionOverlay';
import { createLogger, installGlobalErrorHandlers } from '@/utils/logger';
import './companion.css';

const log = createLogger('APP');

installGlobalErrorHandlers();

const container = document.getElementById('companion-root');
if (!container) {
  log.error('Companion root element is missing from index.html');
} else {
  log.info('Companion overlay starting');
  createRoot(container).render(
    <StrictMode>
      <CompanionOverlay />
    </StrictMode>,
  );
}
