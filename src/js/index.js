// Entry point: Initializes the family budget app
import { initializeFirebase, setupDOM, setupAuthStateListener } from './core.js';
import { setupAuth } from './auth.js';
import { loadAppData, initApp } from './app.js';

async function init() {
  console.log('Initializing family budget app');
  try {
    // Initialize Firebase
    await initializeFirebase();

    // Setup DOM elements
    setupDOM();

    // Setup auth state listener with app data loading callback
    setupAuthStateListener(loadAppData);

    // Setup authentication event listeners
    setupAuth();

    // Initialize app logic (tabs, profile, transactions, etc.)
    initApp();
  } catch (error) {
    console.error('Initialization failed:', {
      message: error.message,
      stack: error.stack
    });
    // Display user-friendly error (assumes showError is available from core.js)
    const { showError } = await import('./core.js');
    showError('page-title', 'Failed to initialize the app. Please try refreshing the page.');
  }
}

// Run initialization when DOM is ready
document.addEventListener('DOMContentLoaded', init);
