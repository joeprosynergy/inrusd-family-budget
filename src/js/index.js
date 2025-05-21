console.log('index.js loaded');

import { initializeFirebase, setupDOM, setupAuthStateListener } from './core.js';
import { setupAuth } from './auth.js';
import { loadAppData, initApp } from './app.js';

let isInitialized = false;

async function init() {
  if (isInitialized) {
    console.log('init: Already initialized, skipping');
    return;
  }
  isInitialized = true;
  console.log('Starting app initialization');
  try {
    console.log('Calling initializeFirebase');
    await initializeFirebase();
    console.log('Calling setupDOM');
    setupDOM();
    console.log('Calling setupAuthStateListener');
    setupAuthStateListener(loadAppData);
    console.log('Calling setupAuth');
    setupAuth();
    console.log('Calling initApp');
    await initApp();
  } catch (error) {
    console.error('Initialization failed:', {
      message: error.message,
      stack: error.stack
    });
    try {
      const { showError } = await import('./core.js');
      showError('page-title', 'Failed to initialize the app. Please try refreshing the page.');
    } catch (showErrorError) {
      console.error('Failed to show error:', showErrorError);
      document.body.innerHTML += '<p style="color: red; text-align: center;">Error: App failed to initialize. Please try refreshing.</p>';
    }
  }
}

window.initApp = init;
console.log('Calling init directly');
init().catch(error => {
  console.error('Direct init failed:', error);
});
