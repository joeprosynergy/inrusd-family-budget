// index.js
console.log('index.js loaded');

import { initializeFirebase, setupDOM, setupAuthStateListener, showError } from './core.js';
import { setupAuth } from './auth.js';
import { loadAppData, initApp } from './app.js';

/**
 * Initializes the application
 * @returns {Promise<void>}
 */
async function init() {
  let isInitialized = false;
  if (isInitialized) {
    console.log('init: Already initialized, skipping');
    return;
  }
  isInitialized = true;
  console.log('init: Starting app initialization');

  let attempts = 0;
  const maxAttempts = 3;
  const baseDelay = 1000;

  while (attempts < maxAttempts) {
    attempts++;
    console.log(`Initialization attempt ${attempts}/${maxAttempts}`);
    try {
      await initializeFirebase();
      console.log('init: Firebase initialized');
      setupDOM();
      console.log('init: DOM setup complete');
      setupAuthStateListener(loadAppData);
      console.log('init: Auth state listener setup');
      await setupAuth(loadAppData);
      console.log('init: Auth setup complete');
      await initApp();
      console.log('init: App initialized');
      break;
    } catch (error) {
      console.error('init: Initialization failed:', {
        attempt: attempts,
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      if (attempts === maxAttempts) {
        showError('page-title', 'Failed to initialize the app. Please try refreshing the page.');
        break;
      }
      const delay = baseDelay * Math.pow(2, attempts - 1) * (1 + Math.random() * 0.5); // Add jitter
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

window.addEventListener('error', (event) => {
  console.error('Global script error:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error?.stack
  });
  showError('page-title', 'An unexpected error occurred. Please refresh the page.');
});

console.log('init: Calling init directly');
init().catch(error => {
  console.error('init: Direct init failed:', {
    code: error.code,
    message: error.message,
    stack: error.stack
  });
  showError('page-title', 'Failed to initialize the app. Please try refreshing the page.');
});
