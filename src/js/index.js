// Entry point: Initializes the family budget app
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
    const { showError } = await import('./core.js');
    showError('page-title', 'Failed to initialize the app. Please try refreshing the page.');
  }
}

// Run initialization when DOM is ready
console.log('Adding DOMContentLoaded listener');
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded fired, calling init');
  init();
});
