// core.js
// Core module: Firebase initialization, DOM setup, auth state, and utilities
import { fetchExchangeRate } from './utils.js';

/** @type {import('firebase/auth').Auth | null} */
let auth = null;
/** @type {import('firebase/firestore').Firestore | null} */
let db = null;
/** @type {import('firebase/auth').User | null} */
let currentUser = null;
/** @type {string} */
let userCurrency = 'INR';
/** @type {string} */
let familyCode = '';
/** @type {Map<string, { rate: number | null, timestamp: number | null }>} */
const exchangeRateCache = new Map([
  ['INR_USD', { rate: null, timestamp: null }],
  ['INR_ZAR', { rate: null, timestamp: null }],
  ['USD_ZAR', { rate: null, timestamp: null }]
]);
const CACHE_TTL = 3600000; // 1 hour in milliseconds
const CACHE_KEY = 'exchangeRateCache';

// Load cache from localStorage on init
try {
  const storedCache = localStorage.getItem(CACHE_KEY);
  if (storedCache) {
    const parsed = JSON.parse(storedCache);
    for (const [key, value] of Object.entries(parsed)) {
      if (exchangeRateCache.has(key)) {
        exchangeRateCache.set(key, value);
      }
    }
    console.log('Loaded exchange rate cache from localStorage');
  }
} catch (error) {
  console.warn('Failed to load exchange rate cache from localStorage:', error);
}

// DOM Elements
/** @type {Record<string, HTMLElement | null>} */
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

/**
 * Initializes Firebase with retry logic
 * @returns {Promise<{ auth: import('firebase/auth').Auth, db: import('firebase/firestore').Firestore }>}
 */
async function initializeFirebase() {
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  };

  let attempts = 0;
  const maxAttempts = 3;
  const baseDelay = 2000;

  while (attempts < maxAttempts) {
    attempts++;
    console.log(`Firebase initialization attempt ${attempts}/${maxAttempts}`);
    try {
      if (!navigator.onLine) throw new Error('No internet connection');
      const requiredFields = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
      let missingFields = [];
      for (const field of requiredFields) {
        if (!firebaseConfig[field]) {
          missingFields.push(field);
        }
      }
      if (missingFields.length > 0) {
        console.error('Missing Firebase config fields:', missingFields);
        alert('Application configuration error. Please contact support.');
        throw new Error(`Missing Firebase config: ${missingFields.join(', ')}`);
      }
      const { initializeApp } = await import('firebase/app');
      const { getAuth } = await import('firebase/auth');
      const { getFirestore } = await import('firebase/firestore');
      const app = initializeApp(firebaseConfig);
      auth = getAuth(app);
      db = getFirestore(app);
      console.log('Firebase initialized successfully');
      return { auth, db };
    } catch (error) {
      console.error('Firebase initialization failed:', error.message);
      if (attempts === maxAttempts) {
        alert('Failed to connect to Firebase. Please check your network.');
        throw error;
      }
      const delay = baseDelay * Math.pow(2, attempts - 1); // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Firebase initialization failed after maximum attempts');
}

/**
 * Sets up DOM elements with caching
 */
function setupDOM() {
  console.log('Querying DOM elements');
  try {
    for (const [key] of Object.entries(domElements)) {
      const id = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      domElements[key] = document.getElementById(id);
      console.log(`DOM element ${key}: ${domElements[key] ? 'found' : 'not found'}`);
      if (!domElements[key]) console.warn(`DOM element not found: ${id}`);
    }

    // Hide sections initially
    domElements.authSection?.classList.add('hidden');
    domElements.appSection?.classList.add('hidden');

    // Create loading spinner with ARIA
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-spinner';
    loadingDiv.className = 'flex justify-center items-center h-screen';
    loadingDiv.setAttribute('aria-live', 'polite');
    loadingDiv.setAttribute('aria-label', 'Loading application');
    loadingDiv.innerHTML = `<div class="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-600" role="status"></div>`;
    document.body.appendChild(loadingDiv);
  } catch (error) {
    console.error('Error querying DOM elements:', error);
    throw error;
  }
}

/**
 * Sets up auth state listener
 * @param {Function} loadAppDataCallback
 */
async function setupAuthStateListener(loadAppDataCallback) {
  console.log('setupAuthStateListener: Starting');
  if (!auth || !db) {
    console.error('setupAuthStateListener: Auth or Firestore service not available');
    showError('login-email', 'Authentication service not available.');
    domElements.authSection?.classList.remove('hidden');
    document.getElementById('loading-spinner')?.remove();
    return;
  }

  console.log('setupAuthStateListener: Setting up onAuthStateChanged');
  const { onAuthStateChanged } = await import('firebase/auth');
  const { doc, getDoc } = await import('firebase/firestore');
  onAuthStateChanged(auth, async user => {
    console.log('Auth state changed:', user ? `User: ${user.uid}` : 'No user');
    try {
      document.getElementById('loading-spinner')?.remove();
      if (user) {
        currentUser = user;
        console.log('Fetching user document for UID:', user.uid);
        const docRef = doc(db, 'users', user.uid);
        let docSnap;
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
          try {
            docSnap = await getDoc(docRef);
            break;
          } catch (error) {
            attempts++;
            if (attempts === maxAttempts) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        if (docSnap.exists()) {
          console.log('User document found:', docSnap.data());
          userCurrency = docSnap.data().currency || 'INR';
          familyCode = docSnap.data().familyCode;
          console.log('User data loaded:', { userCurrency, familyCode });
          await loadAppDataCallback();
          domElements.authSection?.classList.add('hidden');
          domElements.appSection?.classList.remove('hidden');
        } else {
          console.error('User document not found for UID:', user.uid);
          showError('login-email', 'User data not found. Please sign up again.');
          domElements.authSection?.classList.remove('hidden');
        }
      } else {
        console.log('No user, showing authSection');
        currentUser = null;
        domElements.authSection?.classList.remove('hidden');
        domElements.appSection?.classList.add('hidden');
        domElements.loginModal?.classList.remove('hidden');
        domElements.loginModal?.focus(); // Accessibility
      }
    } catch (error) {
      console.error('setupAuthStateListener error:', {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      showError('login-email', 'Failed to load user data.');
      domElements.authSection?.classList.remove('hidden');
    }
  });
  console.log('setupAuthStateListener: Complete');
}

/**
 * Formats currency amount
 * @param {number} amount
 * @param {string} currency
 * @returns {Promise<string>}
 */
async function formatCurrency(amount, currency) {
  try {
    let displayAmount = amount;
    const now = Date.now();
    const rateKeys = ['INR_USD', 'INR_ZAR', 'USD_ZAR'];
    const fallbackRates = {
      INR_USD: 0.012,
      INR_ZAR: 0.22,
      USD_ZAR: 18.0
    };

    // Update exchange rates if stale
    for (const key of rateKeys) {
      const [from, to] = key.split('_');
      const cacheEntry = exchangeRateCache.get(key);
      if (!cacheEntry.rate || now - cacheEntry.timestamp > CACHE_TTL) {
        try {
          cacheEntry.rate = await fetchExchangeRate(from, to, cacheEntry);
        } catch {
          cacheEntry.rate = fallbackRates[key];
          console.warn(`Using fallback rate for ${key} due to fetch failure`);
        }
        cacheEntry.timestamp = now;
        exchangeRateCache.set(key, cacheEntry);
        // Save to localStorage
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(exchangeRateCache)));
          console.log('Saved exchange rate cache to localStorage');
        } catch (error) {
          console.warn('Failed to save exchange rate cache to localStorage:', error);
        }
      }
    }

    // Convert amount
    const conversions = {
      INR_USD: amount * exchangeRateCache.get('INR_USD').rate,
      USD_INR: amount / exchangeRateCache.get('INR_USD').rate,
      INR_ZAR: amount * exchangeRateCache.get('INR_ZAR').rate,
      ZAR_INR: amount / exchangeRateCache.get('INR_ZAR').rate,
      USD_ZAR: amount * exchangeRateCache.get('USD_ZAR').rate,
      ZAR_USD: amount / exchangeRateCache.get('USD_ZAR').rate
    };
    displayAmount = conversions[`${currency}_${userCurrency}`] || amount;

    // Format based on user currency
    const formatters = {
      USD: value => `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      ZAR: value => `R${Number(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      INR: value => `₹${Number(value).toLocaleString('en-IN')}`
    };
    return formatters[userCurrency](displayAmount);
  } catch (error) {
    console.error('Error formatting currency:', error);
    return amount.toString();
  }
}

/**
 * Shows error message
 * @param {string} elementId
 * @param {string} message
 */
function showError(elementId, message) {
  try {
    console.log('Showing error:', { elementId, message });
    const errorDiv = document.createElement('div');
    errorDiv.className = 'text-red-600 text-sm mt-1';
    errorDiv.textContent = message;
    errorDiv.setAttribute('role', 'alert');
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

/**
 * Clears error messages
 */
function clearErrors() {
  try {
    console.log('Clearing errors');
    document.querySelectorAll('.text-red-600').forEach(el => el.remove());
  } catch (error) {
    console.error('Error clearing errors:', error);
  }
}

/**
 * Sets current user
 * @param {import('firebase/auth').User | null} user
 */
function setCurrentUser(user) {
  currentUser = user;
}

/**
 * Sets user currency
 * @param {string} currency
 */
function setUserCurrency(currency) {
  userCurrency = currency;
}

/**
 * Sets family code
 * @param {string} code
 */
function setFamilyCode(code) {
  familyCode = code;
}

// Global error handler to ignore cross-origin "Script error." while handling real errors
window.onerror = function(message, filename, lineno, colno, error) {
  if (message === 'Script error.' && !filename) {
    console.log('Ignored cross-origin script error');
    return true;  // Prevents propagation and showing the error to the user
  }
  console.log('Global error:', { message, filename, lineno, colno, error });
  showError('page-title', 'An unexpected error occurred. Please refresh the page.');
  return false;
};

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
  setCurrentUser,
  setUserCurrency,
  setFamilyCode
};
