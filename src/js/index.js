console.log('index.js loaded');

import { initializeFirebase, setupDOM, setupAuthStateListener } from './core.js';
import { setupAuth } from './auth.js';
import { loadAppData, initApp } from './app.js';

// Add global error handler to catch script errors
window.addEventListener('error', (event) => {
  console.error('Global script error:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error ? event.error.stack : null
  });
  const errorMessage = document.createElement('p');
  errorMessage.style.color = 'red';
  errorMessage.style.textAlign = 'center';
  errorMessage.textContent = 'An error occurred. Please try refreshing the page.';
  document.body.appendChild(errorMessage);
});

let isInitialized = false;

async function init() {
  if (isInitialized) {
    console.log('init: Already initialized, skipping');
    return;
  }
  isInitialized = true;
  console.log('init: Starting app initialization');
  try {
    console.log('init: Calling initializeFirebase');
    await initializeFirebase();
    console.log('init: Calling setupDOM');
    setupDOM();
    console.log('init: Calling setupAuthStateListener');
    setupAuthStateListener(loadAppData);
    console.log('init: Calling setupAuth');
    setupAuth();
    console.log('init: Calling initApp');
    await initApp();
    console.log('init: Initialization complete');
  } catch (error) {
    console.error('init: Initialization failed:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    try {
      const { showError } = await import('./core.js');
      showError('page-title', 'Failed to initialize the app. Please try refreshing the page.');
    } catch (showErrorError) {
      console.error('init: Failed to show error:', showErrorError);
      document.body.innerHTML += '<p style="color: red; text-align: center;">Error: App failed to initialize. Please try refreshing.</p>';
    }
  }
}

window.initApp = init;
console.log('init: Calling init directly');
init().catch(error => {
  console.error('init: Direct init failed:', {
    code: error.code,
    message: error.message,
    stack: error.stack
  });
});
