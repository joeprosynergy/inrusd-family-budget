// Entry point: Initializes the family budget app
console.log('index.js loaded');

import { initializeFirebase, setupDOM, setupAuthStateListener } from './core.js';
import { setupAuth } from './auth.js';
import { loadAppData, initApp } from './app.js';

async function init() {
  console.log('Starting app initialization');
  try {
    // Initialize Firebase
    console.log('Calling initializeFirebase');
    await initializeFirebase();

    // Setup DOM elements
    console.log('Calling setupDOM');
    setupDOM();

    // Setup auth state listener with app data loading callback
    console.log('Calling setupAuthStateListener');
    setupAuthStateListener(loadAppData);

    // Setup authentication event listeners
    console.log('Calling setupAuth');
    setupAuth();

    // Initialize app logic (tabs, profile, transactions, etc.)
    console.log('Calling initApp');
    initApp();
  } catch (error) {
    console.error('Initialization failed:', {
      message: error.message,
      stack: error.stack
    });
    // Display user-friendly error
    try {
      const { showError } = await import('./core.js');
      showError('page-title', 'Failed to initialize the app. Please try refreshing the page.');
    } catch (showErrorError) {
      console.error('Failed to show error:', showErrorError);
      document.body.innerHTML += '<p style="color: red; text-align: center;">Error: App failed to initialize. Please try refreshing.</p>';
    }
  }
}

// Expose initApp for index.html fallback
window.initApp = init;

// Run initialization immediately for debugging
console.log('Calling init directly');
init().catch(error => {
  console.error('Direct init failed:', error);
});
