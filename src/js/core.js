// Core module: Firebase initialization, DOM setup, auth state, and utilities
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { fetchExchangeRate } from './utils.js';

let auth = null;
let db = null;
let currentUser = null;
let userCurrency = 'INR';
let familyCode = '';
let exchangeRateCache = { rate: null, timestamp: null };
const CACHE_TTL = 3600000; // 1 hour in milliseconds

// DOM Elements (exported for use in other modules)
const domElements = {
  authSection: null,
  appSection: null,
  loginModal: null,
  signupModal: null,
  resetModal: null,
  logoutButton: null,
  showSignupBtn: null,
  showResetBtn: null,
  showLoginFromSignupBtn: null,
  showLoginFromResetBtn: null,
  dashboardTab: null,
  transactionsTab: null,
  budgetsTab: null,
  categoriesTab: null,
  childAccountsTab: null,
  profileTab: null,
  dashboardSection: null,
  transactionsSection: null,
  budgetsSection: null,
  categoriesSection: null,
  childAccountsSection: null,
  profileSection: null,
  pageTitle: null,
  categoryBudgetSelect: null,
  addCategoryModal: null,
  profileEmail: null,
  profileCurrency: null,
  profileFamilyCode: null,
  profileAccountType: null,
  editProfile: null,
  saveProfile: null,
  currencyToggle: null,
  deleteConfirmModal: null,
  deleteConfirmMessage: null,
  confirmDelete: null,
  cancelDelete: null,
  dashboardFilter: null,
  customDateRange: null,
  filterStartDate: null,
  filterEndDate: null,
  childSelector: null,
  childUserId: null,
  childBalance: null,
  childTransactionType: null,
  childTransactionAmount: null,
  childTransactionDescription: null,
  addChildTransaction: null,
  childTransactionTable: null,
  childTiles: null
};

// Initialize Firebase
async function initializeFirebase() {
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  };

  let initAttempts = 0;
  const maxAttempts = 3;
  const retryDelay = 2000;

  while (initAttempts < maxAttempts) {
    initAttempts++;
    console.log(`Firebase initialization attempt ${initAttempts}/${maxAttempts}`);
    try {
      if (!navigator.onLine) throw new Error('No internet connection');
      const requiredFields = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
      for (const field of requiredFields) {
        if (!firebaseConfig[field]) throw new Error(`Missing Firebase config: ${field}`);
      }
      const app = initializeApp(firebaseConfig);
      auth = getAuth(app);
      db = getFirestore(app);
      console.log('Firebase initialized successfully');
      return { auth, db };
    } catch (error) {
      console.error('Firebase initialization failed:', error.message);
      if (initAttempts === maxAttempts) {
        alert('Failed to connect to Firebase. Please check your network.');
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

// Setup DOM Elements
function setupDOM() {
  console.log('Querying DOM elements');
  try {
    for (const [key, _] of Object.entries(domElements)) {
      domElements[key] = document.getElementById(key.replace(/([A-Z])/g, '-$1').toLowerCase());
      console.log(`DOM element ${key}: ${domElements[key] ? 'found' : 'not found'}`);
      if (!domElements[key]) console.warn(`DOM element not found: ${key}`);
    }

    // Hide sections initially
    domElements.authSection?.classList.add('hidden');
    domElements.appSection?.classList.add('hidden');

    // Create loading spinner
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-spinner';
    loadingDiv.className = 'flex justify-center items-center h-screen';
    loadingDiv.innerHTML = `<div class="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-600"></div>`;
    document.body.appendChild(loadingDiv);
  } catch (error) {
    console.error('Error querying DOM elements:', error);
    throw error;
  }
}

// Setup Auth State Listener
function setupAuthStateListener(loadAppDataCallback) {
  if (!auth) {
    console.error('Auth service not available');
    showError('login-email', 'Authentication service not available.');
    domElements.authSection?.classList.remove('hidden');
    document.getElementById('loading-spinner')?.remove();
    return;
  }

  console.log('Setting up auth state listener');
  onAuthStateChanged(auth, async user => {
    console.log('Auth state changed:', user ? user.uid : 'No user');
    document.getElementById('loading-spinner')?.remove();
    if (user) {
      currentUser = user;
      try {
        const doc = await db.collection('users').doc(user.uid).get();
        if (doc.exists) {
          userCurrency = doc.data().currency || 'INR';
          familyCode = doc.data().familyCode;
          console.log('User data loaded:', { userCurrency, familyCode });
          await loadAppDataCallback();
          domElements.authSection?.classList.add('hidden');
          domElements.appSection?.classList.remove('hidden');
        } else {
          console.error('User document not found:', user.uid);
          showError('login-email', 'User data not found. Please sign up again.');
          domElements.authSection?.classList.remove('hidden');
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
        showError('login-email', 'Failed to load user data.');
        domElements.authSection?.classList.remove('hidden');
      }
    } else {
      currentUser = null;
      domElements.authSection?.classList.remove('hidden');
      domElements.appSection?.classList.add('hidden');
      domElements.loginModal?.classList.remove('hidden');
    }
  });
}

// Utility: Format Currency
function formatCurrency(amount, currency) {
  try {
    let displayAmount = amount;
    if (currency === 'INR' && userCurrency === 'USD') {
      displayAmount = amount * (exchangeRateCache.rate || 0.012);
    } else if (currency === 'USD' && userCurrency === 'INR') {
      displayAmount = amount / (exchangeRateCache.rate || 0.012);
    }
    return userCurrency === 'USD'
      ? `$${Number(displayAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `₹${Number(displayAmount).toLocaleString('en-IN')}`;
  } catch (error) {
    console.error('Error formatting currency:', error);
    return amount.toString();
  }
}

// Utility: Show Error
function showError(elementId, message) {
  try {
    console.log('Showing error:', { elementId, message });
    const errorDiv = document.createElement('div');
    errorDiv.className = 'text-red-600 text-sm mt-1';
    errorDiv.textContent = message;
    const element = document.getElementById(elementId);
    if (element) {
      element.parentElement.appendChild(errorDiv);
      setTimeout(() => errorDiv.remove(), 3000);
    } else {
      console.warn('Error element not found:', elementId);
    }
  } catch (error) {
    console.error('Error showing error message:', error);
  }
}

// Utility: Clear Errors
function clearErrors() {
  try {
    console.log('Clearing errors');
    document.querySelectorAll('.text-red-600').forEach(el => el.remove());
  } catch (error) {
    console.error('Error clearing errors:', error);
  }
}

export {
  auth,
  db,
  currentUser,
  userCurrency,
  familyCode,
  domElements,
  exchangeRateCache,
  initializeFirebase,
  setupDOM,
  setupAuthStateListener,
  formatCurrency,
  showError,
  clearErrors,
  setCurrentUser: (user) => { currentUser = user; },
  setUserCurrency: (currency) => { userCurrency = currency; },
  setFamilyCode: (code) => { familyCode = code; }
};
