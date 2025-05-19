document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded, querying elements');

  // DOM Elements
  let authSection, appSection, loginModal, signupModal, resetModal, loginButton, signupButton, resetButton, logoutButton,
      showSignupBtn, showResetBtn, showLoginFromSignupBtn, showLoginFromResetBtn, dashboardTab, transactionsTab,
      budgetsTab, categoriesTab, profileTab, dashboardSection, transactionsSection, budgetsSection, categoriesSection,
      profileSection, pageTitle, addTransaction, transactionTable, addBudget, budgetTable, budgetTiles, addCategory,
      categoryTable, categorySelect, categoryBudgetSelect, addCategoryModal, addBudgetModal, saveCategory, cancelCategory,
      saveBudget, cancelBudget, balance, totalBudget, totalRemaining, profileEmail, profileCurrency, profileFamilyCode,
      profileAccountType, editProfile, saveProfile, currencyToggle;

  try {
    authSection = document.getElementById('auth-section');
    appSection = document.getElementById('app-section');
    loginModal = document.getElementById('login-modal');
    signupModal = document.getElementById('signup-modal');
    resetModal = document.getElementById('reset-modal');
    loginButton = document.getElementById('login-button');
    signupButton = document.getElementById('signup-button');
    resetButton = document.getElementById('reset-button');
    logoutButton = document.getElementById('logout-button');
    showSignupBtn = document.getElementById('show-signup');
    showResetBtn = document.getElementById('show-reset');
    showLoginFromSignupBtn = document.getElementById('show-login-from-signup');
    showLoginFromResetBtn = document.getElementById('show-login-from-reset');
    dashboardTab = document.getElementById('dashboard-tab');
    transactionsTab = document.getElementById('transactions-tab');
    budgetsTab = document.getElementById('budgets-tab');
    categoriesTab = document.getElementById('categories-tab');
    profileTab = document.getElementById('profile-tab');
    dashboardSection = document.getElementById('dashboard-section');
    transactionsSection = document.getElementById('transactions-section');
    budgetsSection = document.getElementById('budgets-section');
    categoriesSection = document.getElementById('categories-section');
    profileSection = document.getElementById('profile-section');
    pageTitle = document.getElementById('page-title');
    addTransaction = document.getElementById('add-transaction');
    transactionTable = document.getElementById('transaction-table');
    addBudget = document.getElementById('add-budget');
    budgetTable = document.getElementById('budget-table');
    budgetTiles = document.getElementById('budget-tiles');
    addCategory = document.getElementById('add-category');
    categoryTable = document.getElementById('category-table');
    categorySelect = document.getElementById('category');
    categoryBudgetSelect = document.getElementById('category-budget');
    addCategoryModal = document.getElementById('add-category-modal');
    addBudgetModal = document.getElementById('add-budget-modal');
    saveCategory = document.getElementById('save-category');
    cancelCategory = document.getElementById('cancel-category');
    saveBudget = document.getElementById('save-budget');
    cancelBudget = document.getElementById('cancel-budget');
    balance = document.getElementById('balance');
    totalBudget = document.getElementById('total-budget');
    totalRemaining = document.getElementById('total-remaining');
    profileEmail = document.getElementById('profile-email');
    profileCurrency = document.getElementById('profile-currency');
    profileFamilyCode = document.getElementById('profile-family-code');
    profileAccountType = document.getElementById('profile-account-type');
    editProfile = document.getElementById('edit-profile');
    saveProfile = document.getElementById('save-profile');
    currencyToggle = document.getElementById('currency-toggle');

    // Validate critical DOM elements
    const criticalElements = {
      authSection, appSection, loginModal, signupModal, resetModal, loginButton, signupButton, resetButton, logoutButton,
      showSignupBtn, showResetBtn, showLoginFromSignupBtn, showLoginFromResetBtn, dashboardTab, transactionsTab,
      budgetsTab, categoriesTab, profileTab, dashboardSection, transactionsSection, budgetsSection, categoriesSection,
      profileSection, pageTitle, categoryBudgetSelect, addCategoryModal, profileEmail, profileCurrency, profileFamilyCode,
      profileAccountType, editProfile, saveProfile, currencyToggle
    };
    for (const [key, element] of Object.entries(criticalElements)) {
      console.log(`Checking DOM element ${key}: ${element ? 'found' : 'not found'}`);
      if (!element) {
        console.error(`Critical DOM element not found: ${key}`);
      }
    }
    console.log(`Signup button: ${signupButton ? 'found' : 'not found'}`);
    console.log(`Category budget dropdown: ${categoryBudgetSelect ? 'found' : 'not found'}`);

    // Hide sections initially to prevent flashing
    authSection.classList.add('hidden');
    appSection.classList.add('hidden');
    // Create loading spinner
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-spinner';
    loadingDiv.className = 'flex justify-center items-center h-screen';
    loadingDiv.innerHTML = `<div class="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-600"></div>`;
    document.body.appendChild(loadingDiv);
  } catch (error) {
    console.error('Error querying DOM elements:', {
      message: error.message,
      stack: error.stack
    });
    return;
  }

  // Firebase Configuration
  const firebaseConfig = {
    apiKey: "AIzaSyAntsDc3PAwve3kC0AHZ_bx7JhU5sSTrVk",
    authDomain: "inrusd-family-budget-6cff2.firebaseapp.com",
    projectId: "inrusd-family-budget-6cff2",
    storageBucket: "inrusd-family-budget-6cff2.firebasestorage.app",
    messagingSenderId: "113253470716",
    appId: "1:113253470716:web:f9030918df878a9adee279"
  };

  // Initialize Firebase with Retry
  console.log('Attempting to initialize Firebase');
  let auth = null;
  let db = null;
  let initAttempts = 0;
  const maxAttempts = 3;
  const retryDelay = 2000;

  function initializeFirebase() {
    if (initAttempts >= maxAttempts) {
      console.error('Max Firebase initialization attempts reached');
      alert('Failed to connect to Firebase. Please check your network and try again.');
      document.getElementById('loading-spinner')?.remove();
      authSection.classList.remove('hidden');
      return;
    }
    initAttempts++;
    console.log(`Initialization attempt ${initAttempts}/${maxAttempts}`);
    try {
      console.log('Network status:', { online: navigator.onLine });
      if (!navigator.onLine) {
        throw new Error('No internet connection detected');
      }
      console.log('Checking Firebase SDK availability');
      if (typeof firebase === 'undefined' || !firebase.initializeApp) {
        throw new Error('Firebase SDK not loaded.');
      }
      console.log('Validating firebaseConfig:', {
        apiKey: firebaseConfig.apiKey ? '<redacted>' : 'missing',
        authDomain: firebaseConfig.authDomain,
        projectId: firebaseConfig.projectId
      });
      const requiredFields = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
      for (const field of requiredFields) {
        if (!firebaseConfig[field] || firebaseConfig[field].trim() === '') {
          throw new Error(`Invalid Firebase configuration: ${field} is missing or empty`);
        }
      }
      console.log('Initializing Firebase app');
      const app = firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      console.log('Firebase initialized successfully:', { app: !!app, auth: !!auth, db: !!db });
      setupAuthStateListener();
    } catch (error) {
      console.error('Firebase initialization failed:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
        attempt: initAttempts,
        online: navigator.onLine
      });
      if (initAttempts < maxAttempts) {
        console.log(`Retrying initialization in ${retryDelay/1000} seconds...`);
        setTimeout(initializeFirebase, retryDelay);
      } else {
        alert('Failed to initialize Firebase. Please check your network or configuration.');
        document.getElementById('loading-spinner')?.remove();
        authSection.classList.remove('hidden');
      }
    }
  }
  initializeFirebase();

  // Setup Auth State Listener with Retry
  function setupAuthStateListener() {
    try {
      if (!auth) {
        console.error('Auth service not available');
        showError('login-email', 'Authentication service not available.');
        document.getElementById('loading-spinner')?.remove();
        authSection.classList.remove('hidden');
        return;
      }
      console.log('Setting up auth state listener');
      auth.onAuthStateChanged(user => {
        console.log('Auth state changed:', user ? user.uid : 'No user');
        if (user) {
          currentUser = user;
          if (db) {
            console.log('Fetching user data for UID:', user.uid);
            retryFirestoreOperation(() => 
              db.collection('users').doc(user.uid).get()
                .then(doc => {
                  if (doc.exists) {
                    userCurrency = doc.data().currency || 'INR';
                    familyCode = doc.data().familyCode;
                    console.log('User data loaded:', { userCurrency, familyCode });
                    loadAppData().then(() => {
                      authSection.classList.add('hidden');
                      appSection.classList.remove('hidden');
                      document.getElementById('loading-spinner')?.remove();
                    });
                  } else {
                    console.error('User document not found for UID:', user.uid);
                    showError('login-email', 'User data not found. Please sign up again.');
                    authSection.classList.remove('hidden');
                    document.getElementById('loading-spinner')?.remove();
                  }
                })
            ).catch(error => {
              console.error('Error fetching user data:', {
                code: error.code,
                message: error.message,
                uid: user.uid
              });
              showError('login-email', 'Failed to load user data.');
              authSection.classList.remove('hidden');
              document.getElementById('loading-spinner')?.remove();
            });
          } else {
            console.error('Firestore not available');
            showError('login-email', 'Database service not available.');
            authSection.classList.remove('hidden');
            document.getElementById('loading-spinner')?.remove();
          }
        } else {
          currentUser = null;
          authSection.classList.remove('hidden');
          appSection.classList.add('hidden');
          showLoginModal();
          document.getElementById('loading-spinner')?.remove();
        }
      });
    } catch (error) {
      console.error('Error in auth state handling:', {
        message: error.message,
        stack: error.stack
      });
      showError('login-email', 'Authentication error occurred.');
      authSection.classList.remove('hidden');
      document.getElementById('loading-spinner')?.remove();
    }
  }

  // Firestore Retry Utility
  async function retryFirestoreOperation(operation, maxRetries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Firestore operation attempt ${attempt}/${maxRetries}`);
        return await operation();
      } catch (error) {
        console.error('Firestore operation failed:', {
          attempt,
          code: error.code,
          message: error.message
        });
        if (attempt === maxRetries || error.code === 'permission-denied') {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // Exchange Rate Cache
  let exchangeRateCache = {
    rate: null,
    timestamp: null
  };
  const CACHE_TTL = 3600000; // 1 hour in milliseconds

  // Fetch Exchange Rate
  async function fetchExchangeRate() {
    try {
      const now = Date.now();
      if (exchangeRateCache.rate && exchangeRateCache.timestamp && (now - exchangeRateCache.timestamp) < CACHE_TTL) {
        console.log('Using cached exchange rate:', exchangeRateCache.rate);
        return exchangeRateCache.rate;
      }
      console.log('Fetching exchange rate from API');
      const response = await fetch('https://v6.exchangerate-api.com/v6/18891e972833c8dd062c1283/latest/INR');
      const data = await response.json();
      if (data.result !== 'success') {
        throw new Error('Failed to fetch exchange rate');
      }
      const rate = data.conversion_rates.USD;
      exchangeRateCache = { rate, timestamp: now };
      console.log('Exchange rate fetched:', rate);
      return rate;
    } catch (error) {
      console.error('Error fetching exchange rate:', {
        message: error.message,
        stack: error.stack
      });
      return 0.012; // Fallback rate (approx INR to USD as of May 2025)
    }
  }

  // User State
  let currentUser = null;
  let userCurrency = 'INR';
  let familyCode = '';
  let isEditing = { transaction: false, budget: false, category: false, profile: false };

  // Modal and Tab Switching
  try {
    function showLoginModal() {
      console.log('Showing login modal');
      loginModal.classList.remove('hidden');
      signupModal.classList.add('hidden');
      resetModal.classList.add('hidden');
    }

    function showSignupModal() {
      console.log('Showing signup modal');
      signupModal.classList.remove('hidden');
      loginModal.classList.add('hidden');
      resetModal.classList.add('hidden');
    }

    function showResetModal() {
      console.log('Showing reset modal');
      resetModal.classList.remove('hidden');
      loginModal.classList.add('hidden');
      signupModal.classList.add('hidden');
    }

    function showDashboard() {
      console.log('Showing dashboard');
      dashboardTab.classList.add('bg-blue-800');
      transactionsTab.classList.remove('bg-blue-800');
      budgetsTab.classList.remove('bg-blue-800');
      categoriesTab.classList.remove('bg-blue-800');
      profileTab.classList.remove('bg-blue-800');
      dashboardSection.classList.remove('hidden');
      transactionsSection.classList.add('hidden');
      budgetsSection.classList.add('hidden');
      categoriesSection.classList.add('hidden');
      profileSection.classList.add('hidden');
      pageTitle.textContent = 'Budget Dashboard';
    }

    function showTransactions() {
      console.log('Showing transactions');
      transactionsTab.classList.add('bg-blue-800');
      dashboardTab.classList.remove('bg-blue-800');
      budgetsTab.classList.remove('bg-blue-800');
      categoriesTab.classList.remove('bg-blue-800');
      profileTab.classList.remove('bg-blue-800');
      transactionsSection.classList.remove('hidden');
      dashboardSection.classList.add('hidden');
      budgetsSection.classList.add('hidden');
      categoriesSection.classList.add('hidden');
      profileSection.classList.add('hidden');
      pageTitle.textContent = 'Transactions';
    }

    function showBudgets() {
      console.log('Showing budgets');
      budgetsTab.classList.add('bg-blue-800');
      dashboardTab.classList.remove('bg-blue-800');
      transactionsTab.classList.remove('bg-blue-800');
      categoriesTab.classList.remove('bg-blue-800');
      profileTab.classList.remove('bg-blue-800');
      budgetsSection.classList.remove('hidden');
      dashboardSection.classList.add('hidden');
      transactionsSection.classList.add('hidden');
      categoriesSection.classList.add('hidden');
      profileSection.classList.add('hidden');
      pageTitle.textContent = 'Budgets';
    }

    function showCategories() {
      console.log('Showing categories');
      categoriesTab.classList.add('bg-blue-800');
      dashboardTab.classList.remove('bg-blue-800');
      transactionsTab.classList.remove('bg-blue-800');
      budgetsTab.classList.remove('bg-blue-800');
      profileTab.classList.remove('bg-blue-800');
      categoriesSection.classList.remove('hidden');
      dashboardSection.classList.add('hidden');
      transactionsSection.classList.add('hidden');
      budgetsSection.classList.add('hidden');
      profileSection.classList.add('hidden');
      pageTitle.textContent = 'Categories';
    }

    function showProfile() {
      console.log('Showing profile');
      profileTab.classList.add('bg-blue-800');
      dashboardTab.classList.remove('bg-blue-800');
      transactionsTab.classList.remove('bg-blue-800');
      budgetsTab.classList.remove('bg-blue-800');
      categoriesTab.classList.remove('bg-blue-800');
      profileSection.classList.remove('hidden');
      dashboardSection.classList.add('hidden');
      transactionsSection.classList.add('hidden');
      budgetsSection.classList.add('hidden');
      categoriesSection.classList.add('hidden');
      pageTitle.textContent = 'User Profile';
      loadProfileData();
    }

    if (showSignupBtn) {
      showSignupBtn.addEventListener('click', showSignupModal);
    } else {
      console.error('showSignupBtn not found');
    }
    if (showResetBtn) {
      showResetBtn.addEventListener('click', showResetModal);
    } else {
      console.error('showResetBtn not found');
    }
    if (showLoginFromSignupBtn) {
      showLoginFromSignupBtn.addEventListener('click', showLoginModal);
    } else {
      console.error('showLoginFromSignupBtn not found');
    }
    if (showLoginFromResetBtn) {
      showLoginFromResetBtn.addEventListener('click', showLoginModal);
    } else {
      console.error('showLoginFromResetBtn not found');
    }
    if (dashboardTab) {
      dashboardTab.addEventListener('click', showDashboard);
    }
    if (transactionsTab) {
      transactionsTab.addEventListener('click', showTransactions);
    }
    if (budgetsTab) {
      budgetsTab.addEventListener('click', showBudgets);
    }
    if (categoriesTab) {
      categoriesTab.addEventListener('click', showCategories);
    }
    if (profileTab) {
      profileTab.addEventListener('click', showProfile);
    } else {
      console.error('profileTab not found');
    }
    if (editProfile) {
      editProfile.addEventListener('click', () => {
        console.log('Edit Profile clicked');
        isEditing.profile = true;
        profileEmail.removeAttribute('readonly');
        profileCurrency.removeAttribute('disabled');
        profileFamilyCode.removeAttribute('readonly');
        profileAccountType.removeAttribute('disabled');
        profileEmail.classList.remove('bg-gray-100');
        profileCurrency.classList.remove('bg-gray-100');
        profileFamilyCode.classList.remove('bg-gray-100');
        profileAccountType.classList.remove('bg-gray-100');
        editProfile.classList.add('hidden');
        saveProfile.classList.remove('hidden');
      });
    } else {
      console.error('editProfile not found');
    }
    if (saveProfile) {
      saveProfile.addEventListener('click', async () => {
        console.log('Save Profile clicked');
        clearErrors();
        const email = profileEmail.value.trim();
        const currency = profileCurrency.value;
        const familyCodeInput = profileFamilyCode.value.trim();
        const accountType = profileAccountType.value;

        console.log('Validating profile inputs:', { email, currency, familyCode: familyCodeInput, accountType });

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          showError('profile-email', 'Valid email is required');
          return;
        }
        if (!familyCodeInput) {
          showError('profile-family-code', 'Family code is required');
          return;
        }
        if (!currency || !['INR', 'USD'].includes(currency)) {
          showError('profile-currency', 'Valid currency is required');
          return;
        }
        if (!accountType || !['admin', 'child'].includes(accountType)) {
          showError('profile-account-type', 'Valid account type is required');
          return;
        }

        try {
          saveProfile.disabled = true;
          saveProfile.textContent = 'Saving...';
          if (email !== currentUser.email) {
            console.log('Updating email in Firebase Auth:', email);
            await auth.currentUser.updateEmail(email);
          }
          await retryFirestoreOperation(() => 
            db.collection('users').doc(currentUser.uid).update({
              currency,
              familyCode: familyCodeInput,
              accountType
            })
          );
          console.log('Profile updated successfully:', { email, currency, familyCode: familyCodeInput, accountType });
          userCurrency = currency;
          familyCode = familyCodeInput;
          isEditing.profile = false;
          profileEmail.setAttribute('readonly', 'true');
          profileCurrency.setAttribute('disabled', 'true');
          profileFamilyCode.setAttribute('readonly', 'true');
          profileAccountType.setAttribute('disabled', 'true');
          profileEmail.classList.add('bg-gray-100');
          profileCurrency.classList.add('bg-gray-100');
          profileFamilyCode.classList.add('bg-gray-100');
          profileAccountType.classList.add('bg-gray-100');
          editProfile.classList.remove('hidden');
          saveProfile.classList.add('hidden');
          saveProfile.disabled = false;
          saveProfile.textContent = 'Save';
          currencyToggle.value = currency;
          await loadBudgets();
          await loadTransactions();
          await updateDashboard();
        } catch (error) {
          console.error('Error saving profile:', { code: error.code, message: error.message });
          let errorMessage = error.message || 'Failed to save profile.';
          if (error.code === 'auth/email-already-in-use') {
            errorMessage = 'This email is already in use.';
          } else if (error.code === 'auth/invalid-email') {
            errorMessage = 'Invalid email format.';
          } else if (error.code === 'auth/requires-recent-login') {
            errorMessage = 'Please log out and log in again to update email.';
          }
          showError('profile-email', errorMessage);
          saveProfile.disabled = false;
          saveProfile.textContent = 'Save';
        }
      });
    } else {
      console.error('saveProfile not found');
    }
    if (currencyToggle) {
      currencyToggle.addEventListener('change', async () => {
        const newCurrency = currencyToggle.value;
        console.log('Currency toggle changed to:', newCurrency);
        await updateCurrency(newCurrency);
      });
    } else {
      console.error('currencyToggle not found');
    }
  } catch (error) {
    console.error('Error setting up modal/tab switching:', {
      message: error.message,
      stack: error.stack
    });
  }
  // User State
  let currentUser = null;
  let userCurrency = 'INR';
  let familyCode = '';
  let isEditing = { transaction: false, budget: false, category: false, profile: false };

  // Utility Functions
  function formatCurrency(amount, currency) {
    try {
      console.log('Formatting currency:', { amount, currency });
      let displayAmount = amount;
      if (currency === 'INR' && userCurrency === 'USD') {
        displayAmount = amount * exchangeRateCache.rate;
      } else if (currency === 'USD' && userCurrency === 'INR') {
        displayAmount = amount / exchangeRateCache.rate;
      }
      if (userCurrency === 'USD') {
        return `$${Number(displayAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
      return `₹${Number(displayAmount).toLocaleString('en-IN')}`;
    } catch (error) {
      console.error('Error formatting currency:', {
        message: error.message,
        stack: error.stack,
        amount,
        currency
      });
      return amount.toString();
    }
  }

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
        console.error('Error element not found:', elementId);
      }
    } catch (error) {
      console.error('Error showing error message:', {
        message: error.message,
        stack: error.stack,
        elementId,
        message
      });
    }
  }

  function clearErrors() {
    try {
      console.log('Clearing errors');
      document.querySelectorAll('.text-red-600').forEach(el => el.remove());
    } catch (error) {
      console.error('Error clearing errors:', {
        message: error.message,
        stack: error.stack
      });
    }
  }

  // Update Currency
  async function updateCurrency(newCurrency) {
    try {
      console.log('Updating currency to:', newCurrency);
      if (!currentUser || !db) {
        console.error('Cannot update currency: missing user or Firestore');
        return;
      }
      userCurrency = newCurrency;
      await retryFirestoreOperation(() => 
        db.collection('users').doc(currentUser.uid).update({
          currency: newCurrency
        })
      );
      console.log('Currency updated in Firestore:', newCurrency);
      currencyToggle.value = newCurrency;
      profileCurrency.value = newCurrency;
      await loadBudgets();
      await loadTransactions();
      await updateDashboard();
    } catch (error) {
      console.error('Error updating currency:', {
        message: error.message,
        stack: error.stack
      });
      showError('currency-toggle', 'Failed to update currency.');
    }
  }

  // Load Profile Data
  async function loadProfileData() {
    try {
      console.log('Loading profile data');
      if (!currentUser || !db) {
        console.error('Cannot load profile data: missing user or Firestore');
        return;
      }
      profileEmail.value = currentUser.email || '--';
      profileCurrency.value = userCurrency || 'INR';
      profileFamilyCode.value = familyCode || '--';
      profileAccountType.value = '--';
      await retryFirestoreOperation(() => 
        db.collection('users').doc(currentUser.uid).get()
          .then(doc => {
            if (doc.exists) {
              const data = doc.data();
              profileCurrency.value = data.currency || 'INR';
              profileFamilyCode.value = data.familyCode || '--';
              profileAccountType.value = data.accountType || '--';
              console.log('Profile data loaded:', {
                email: currentUser.email,
                currency: data.currency,
                familyCode: data.familyCode,
                accountType: data.accountType
              });
            } else {
              console.error('User document not found for UID:', currentUser.uid);
              showError('profile-email', 'Profile data not found.');
            }
          })
      );
    } catch (error) {
      console.error('Error loading profile data:', {
        message: error.message,
        stack: error.stack
      });
      showError('profile-email', 'Failed to load profile data.');
    }
  }

  // Authentication
  try {
    if (signupButton) {
      signupButton.addEventListener('click', () => {
        console.log('Signup button clicked');
        clearErrors();
        console.log('Reading signup form inputs');
        const email = document.getElementById('signup-email')?.value.trim();
        const password = document.getElementById('signup-password')?.value;
        const confirmPassword = document.getElementById('signup-confirm-password')?.value;
        const currency = document.getElementById('signup-currency')?.value;
        const familyCodeInput = document.getElementById('signup-family-code')?.value.trim();
        const accountType = document.getElementById('signup-account-type')?.value;

        console.log('Validating inputs:', {
          email,
          password: password ? '[redacted]' : 'missing',
          confirmPassword: confirmPassword ? '[redacted]' : 'missing',
          currency,
          familyCodeInput,
          accountType
        });

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          showError('signup-email', 'Valid email is required');
          console.log('Validation failed: Invalid or missing email');
          return;
        }
        if (!password || password.length < 6) {
          showError('signup-password', 'Password must be at least 6 characters');
          console.log('Validation failed: Invalid or missing password');
          return;
        }
        if (password !== confirmPassword) {
          showError('signup-confirm-password', 'Passwords do not match');
          console.log('Validation failed: Passwords do not match');
          return;
        }
        if (!familyCodeInput) {
          showError('signup-family-code', 'Family code is required');
          console.log('Validation failed: Missing family code');
          return;
        }
        if (!currency || !['INR', 'USD'].includes(currency)) {
          showError('signup-currency', 'Valid currency is required');
          console.log('Validation failed: Invalid currency');
          return;
        }
        if (!accountType || !['admin', 'child'].includes(accountType)) {
          showError('signup-account-type', 'Valid account type is required');
          console.log('Validation failed: Invalid account type');
          return;
        }

        if (!auth) {
          console.error('Auth service not available');
          showError('signup-email', 'Authentication service not available.');
          return;
        }
        if (!db) {
          console.error('Firestore service not available');
          showError('signup-email', 'Database service not available.');
          return;
        }

        console.log('Attempting to create user with email:', email);
        signupButton.disabled = true;
        signupButton.textContent = 'Signing up...';
        auth.createUserWithEmailAndPassword(email, password)
          .then(credential => {
            console.log('Authentication response:', {
              credential: credential ? 'received' : 'null',
              user: credential && credential.user ? credential.user.uid : 'null'
            });
            if (!credential || !credential.user) {
              throw new Error('No user credential returned from authentication');
            }
            console.log('User created successfully:', credential.user.uid);
            console.log('Writing user data to Firestore:', {
              uid: credential.user.uid,
              currency,
              familyCode: familyCodeInput,
              accountType
            });
            return db.collection('users').doc(credential.user.uid).set({
              currency,
              familyCode: familyCodeInput,
              accountType,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          })
          .then(() => {
            console.log('User data written to Firestore successfully');
            signupButton.disabled = false;
            signupButton.textContent = 'Sign Up';
            document.getElementById('signup-email').value = '';
            document.getElementById('signup-password').value = '';
            document.getElementById('signup-confirm-password').value = '';
            document.getElementById('signup-family-code').value = '';
            document.getElementById('signup-currency').value = 'INR';
            document.getElementById('signup-account-type').value = 'admin';
          })
          .catch(error => {
            console.error('Signup error:', {
              code: error.code,
              message: error.message,
              email,
              familyCode: familyCodeInput,
              currency,
              accountType,
              network: navigator.onLine
            });
            signupButton.disabled = false;
            signupButton.textContent = 'Sign Up';
            let errorMessage = error.message || 'Failed to sign up.';
            if (error.code === 'auth/email-already-in-use') {
              errorMessage = 'This email is already registered. Please log in or use a different email.';
            } else if (error.code === 'auth/invalid-email') {
              errorMessage = 'Invalid email format.';
            } else if (error.code === 'auth/weak-password') {
              errorMessage = 'Password is too weak.';
            } else if (error.code === 'auth/network-request-failed') {
              errorMessage = 'Network error. Please check your connection.';
            }
            showError('signup-email', errorMessage);
          });
      });
    } else {
      console.error('signupButton not found');
    }

    if (loginButton) {
      loginButton.addEventListener('click', () => {
        console.log('Login button clicked');
        clearErrors();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        if (!email) showError('login-email', 'Email is required');
        if (!password) showError('login-password', 'Password is required');
        if (email && password && auth) {
          loginButton.disabled = true;
          loginButton.textContent = 'Logging in...';
          auth.signInWithEmailAndPassword(email, password)
            .then(() => {
              loginButton.disabled = false;
              loginButton.textContent = 'Login';
            })
            .catch(error => {
              loginButton.disabled = false;
              loginButton.textContent = 'Login';
              console.error('Login error:', error.code, error.message);
              showError('login-password', error.message || 'Failed to log in.');
            });
        } else {
          console.error('Auth service not available or invalid inputs');
          showError('login-email', auth ? 'Invalid input data' : 'Authentication service not available.');
        }
      });
    }

    if (resetButton) {
      resetButton.addEventListener('click', () => {
        console.log('Reset button clicked');
        clearErrors();
        const email = document.getElementById('reset-email').value;
        if (!email) showError('reset-email', 'Email is required');
        if (email && auth) {
          resetButton.disabled = true;
          resetButton.textContent = 'Sending...';
          auth.sendPasswordResetEmail(email)
            .then(() => {
              console.log('Password reset email sent');
              alert('Password reset email sent');
              showLoginModal();
              resetButton.disabled = false;
              resetButton.textContent = 'Send Reset Link';
            })
            .catch(error => {
              console.error('Reset error:', error.code, error.message);
              resetButton.disabled = false;
              resetButton.textContent = 'Send Reset Link';
              showError('reset-email', error.message || 'Failed to send reset email');
            });
        } else {
          console.error('Auth service not available');
          showError('reset-email', auth ? 'Invalid email' : 'Authentication service not available.');
        }
      });
    }

    if (logoutButton) {
      logoutButton.addEventListener('click', () => {
        console.log('Logout button clicked');
        if (auth) {
          auth.signOut();
        } else {
          console.error('Auth service not available');
          showError('logout-button', 'Authentication service not available');
        }
      });
    }
  } catch (error) {
    console.error('Error binding auth event listeners:', {
      message: error.message,
      stack: error.stack
    });
  }

  // Load App Data
  async function loadAppData() {
    try {
      console.log('Loading app data');
      if (!currentUser || !familyCode || !db) {
        console.error('Cannot load app data: missing user, familyCode, or Firestore');
        return;
      }
      exchangeRateCache.rate = await fetchExchangeRate();
      currencyToggle.value = userCurrency;
      await Promise.all([
        loadCategories(),
        loadBudgets(),
        loadTransactions(),
        loadProfileData(),
        updateDashboard()
      ]);
      console.log('App data loaded successfully');
    } catch (error) {
      console.error('Error loading app data:', {
        message: error.message,
        stack: error.stack
      });
    }
  }

  // Categories
  async function loadCategories() {
    try {
      console.log('Loading categories and budgets for dropdowns');
      if (!db) {
        console.error('Firestore not available');
        return;
      }
      categorySelect.innerHTML = '<option value="">Select Category</option><option value="add-new">Add New</option>';
      categoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
      const newCategoryBudgetSelect = document.getElementById('new-category-budget');
      if (newCategoryBudgetSelect) {
        newCategoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
      } else {
        console.error('new-category-budget dropdown not found');
      }

      await retryFirestoreOperation(() => 
        db.collection('budgets').where('familyCode', '==', familyCode).get()
          .then(budgetSnapshot => {
            console.log('Budgets fetched:', { count: budgetSnapshot.size });
            budgetSnapshot.forEach(budgetDoc => {
              const budget = budgetDoc.data();
              console.log('Adding budget to dropdowns:', { id: budgetDoc.id, name: budget.name });
              const budgetOption = document.createElement('option');
              budgetOption.value = budgetDoc.id;
              budgetOption.textContent = budget.name;
              categoryBudgetSelect.insertBefore(budgetOption, categoryBudgetSelect.querySelector('option[value="add-new"]'));
              if (newCategoryBudgetSelect) {
                const newBudgetOption = document.createElement('option');
                newBudgetOption.value = budgetDoc.id;
                newBudgetOption.textContent = budget.name;
                newCategoryBudgetSelect.insertBefore(newBudgetOption, newCategoryBudgetSelect.querySelector('option[value="add-new"]'));
              }
            });
          })
      );

      await retryFirestoreOperation(() => 
        db.collection('categories').where('familyCode', '==', familyCode).get()
          .then(snapshot => {
            console.log('Categories fetched:', { count: snapshot.size });
            snapshot.forEach(doc => {
              const category = doc.data();
              const option = document.createElement('option');
              option.value = doc.id;
              option.textContent = category.name;
              categorySelect.insertBefore(option, categorySelect.querySelector('option[value="add-new"]'));
            });

            categoryTable.innerHTML = '';
            snapshot.forEach(doc => {
              const category = doc.data();
              const tr = document.createElement('tr');
              tr.classList.add('table-row');
              const budgetName = category.budgetId ? 'Loading...' : 'None';
              tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${category.name}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${category.type}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${budgetName}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">
                  <button class="text-blue-600 hover:text-blue-800 mr-2 edit-category" data-id="${doc.id}">Edit</button>
                  <button class="text-red-600 hover:text-red-800 delete-category" data-id="${doc.id}">Delete</button>
                </td>
              `;
              categoryTable.appendChild(tr);
              if (category.budgetId) {
                db.collection('budgets').doc(category.budgetId).get().then(budgetDoc => {
                  if (budgetDoc.exists) {
                    tr.children[2].textContent = budgetDoc.data().name;
                  } else {
                    tr.children[2].textContent = 'None';
                  }
                }).catch(error => {
                  console.error('Error fetching budget for category table:', {
                    code: error.code,
                    message: error.message
                  });
                  tr.children[2].textContent = 'Error';
                });
              }
            });
          })
      );
    } catch (error) {
      console.error('Error loading categories:', {
        message: error.message,
        stack: error.stack
      });
    }
  }

  try {
    if (addCategory) {
      addCategory.addEventListener('click', () => {
        console.log('Add Category clicked', { isEditing: isEditing.category });
        if (isEditing.category) return;
        clearErrors();
        const name = document.getElementById('category-name').value.trim();
        const type = document.getElementById('category-type').value;
        const budgetId = document.getElementById('category-budget').value === 'none' ? null : document.getElementById('category-budget').value;
        if (!name) showError('category-name', 'Name is required');
        if (name && currentUser && db) {
          addCategory.disabled = true;
          addCategory.textContent = 'Adding...';
          retryFirestoreOperation(() => 
            db.collection('categories').add({
              name,
              type,
              budgetId,
              familyCode,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(() => {
              console.log('Category added successfully:', { name, type, budgetId });
              document.getElementById('category-name').value = '';
              document.getElementById('category-type').value = 'income';
              document.getElementById('category-budget').value = 'none';
              addCategory.innerHTML = 'Add Category';
              addCategory.disabled = false;
              loadCategories();
            })
          ).catch(error => {
            console.error('Error adding category:', error.code, error.message);
            showError('category-name', 'Failed to add category.');
            addCategory.disabled = false;
            addCategory.innerHTML = 'Add Category';
          });
        } else {
          console.error('Firestore or user not available');
          showError('category-name', db ? 'Invalid input data' : 'Database service not available');
        }
      });
    }

    if (categorySelect) {
      categorySelect.addEventListener('change', () => {
        console.log('Category select changed:', categorySelect.value);
        if (categorySelect.value === 'add-new') {
          addCategoryModal.classList.remove('hidden');
          categorySelect.value = '';
        }
      });
    }

    if (saveCategory) {
      saveCategory.addEventListener('click', () => {
        console.log('Save Category clicked');
        clearErrors();
        const name = document.getElementById('new-category-name').value.trim();
        const type = document.getElementById('new-category-type').value;
        const budgetId = document.getElementById('new-category-budget').value === 'none' ? null : document.getElementById('new-category-budget').value;
        if (!name) showError('new-category-name', 'Name is required');
        if (name && currentUser && db) {
          saveCategory.disabled = true;
          saveCategory.textContent = 'Saving...';
          retryFirestoreOperation(() => 
            db.collection('categories').add({
              name,
              type,
              budgetId,
              familyCode,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(() => {
              console.log('Category saved successfully:', { name, type, budgetId });
              addCategoryModal.classList.add('hidden');
              document.getElementById('new-category-name').value = '';
              document.getElementById('new-category-type').value = 'income';
              document.getElementById('new-category-budget').value = 'none';
              saveCategory.disabled = false;
              saveCategory.textContent = 'Save';
              loadCategories();
            })
          ).catch(error => {
            console.error('Error saving category:', error.code, error.message);
            showError('new-category-name', 'Failed to save category.');
            saveCategory.disabled = false;
            saveCategory.textContent = 'Save';
          });
        } else {
          console.error('Firestore or user not available');
          showError('new-category-name', db ? 'Invalid input data' : 'Database service not available');
        }
      });
    }

    if (cancelCategory) {
      cancelCategory.addEventListener('click', () => {
        console.log('Cancel Category clicked');
        addCategoryModal.classList.add('hidden');
        document.getElementById('new-category-name').value = '';
        document.getElementById('new-category-type').value = 'income';
        document.getElementById('new-category-budget').value = 'none';
      });
    }

    if (categoryTable) {
      categoryTable.addEventListener('click', e => {
        if (e.target.classList.contains('edit-category')) {
          console.log('Edit Category clicked:', e.target.dataset.id);
          const id = e.target.dataset.id;
          if (db) {
            retryFirestoreOperation(() => 
              db.collection('categories').doc(id).get().then(doc => {
                if (doc.exists) {
                  document.getElementById('category-name').value = doc.data().name;
                  document.getElementById('category-type').value = doc.data().type;
                  document.getElementById('category-budget').value = doc.data().budgetId || 'none';
                  addCategory.innerHTML = 'Update Category';
                  isEditing.category = true;
                  console.log('Entered edit mode for category:', id);
                  const updateHandler = () => {
                    const name = document.getElementById('category-name').value.trim();
                    const type = document.getElementById('category-type').value;
                    const budgetId = document.getElementById('category-budget').value === 'none' ? null : document.getElementById('category-budget').value;
                    if (!name) {
                      showError('category-name', 'Name is required');
                      return;
                    }
                    addCategory.disabled = true;
                    addCategory.textContent = 'Updating...';
                    retryFirestoreOperation(() => 
                      db.collection('categories').doc(id).update({
                        name,
                        type,
                        budgetId
                      }).then(() => {
                        console.log('Category updated successfully:', { id, name, type, budgetId });
                        document.getElementById('category-name').value = '';
                        document.getElementById('category-type').value = 'income';
                        document.getElementById('category-budget').value = 'none';
                        addCategory.innerHTML = 'Add Category';
                        addCategory.disabled = false;
                        isEditing.category = false;
                        console.log('Exited edit mode for category:', id);
                        loadCategories();
                      })
                    ).catch(error => {
                      console.error('Error updating category:', error.code, error.message);
                      showError('category-name', 'Failed to update category.');
                      addCategory.disabled = false;
                      addCategory.innerHTML = 'Add Category';
                      isEditing.category = false;
                    });
                  };
                  addCategory.addEventListener('click', updateHandler, { once: true });
                }
              })
            ).catch(error => {
              console.error('Error fetching category:', error.code, error.message);
              showError('category-name', 'Failed to fetch category.');
            });
          }
        }
        if (e.target.classList.contains('delete-category')) {
          console.log('Delete Category clicked:', e.target.dataset.id);
          const id = e.target.dataset.id;
          if (db) {
            retryFirestoreOperation(() => 
              db.collection('categories').doc(id).delete().then(() => {
                console.log('Category deleted successfully:', { id });
                loadCategories();
              })
            ).catch(error => {
              console.error('Error deleting category:', error.code, error.message);
              showError('category-name', 'Failed to delete category.');
            });
          }
        }
      });
    }
  } catch (error) {
    console.error('Error binding category event listeners:', {
      message: error.message,
      stack: error.stack
    });
  }

  // Budgets
  async function loadBudgets() {
    try {
      console.log('Loading budgets');
      if (!db) {
        console.error('Firestore not available');
        return;
      }
      budgetTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading...</td></tr>';
      budgetTiles.innerHTML = '<div class="text-center py-4">Loading...</div>';
      await retryFirestoreOperation(() => 
        db.collection('budgets').where('familyCode', '==', familyCode).get()
          .then(snapshot => {
            console.log('Budgets fetched for table and tiles:', { count: snapshot.size });
            budgetTable.innerHTML = '';
            budgetTiles.innerHTML = '';
            let totalBudgetAmount = 0;
            let totalRemainingAmount = 0;
            snapshot.forEach(doc => {
              const budget = doc.data();
              const spent = budget.spent || 0;
              totalBudgetAmount += budget.amount;
              totalRemainingAmount += budget.amount - spent;
              const tr = document.createElement('tr');
              tr.classList.add('table-row');
              tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${budget.name}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatCurrency(budget.amount, 'INR')}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatCurrency(spent, 'INR')}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatCurrency(budget.amount - spent, 'INR')}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">
                  <button class="text-blue-600 hover:text-blue-800 mr-2 edit-budget" data-id="${doc.id}">Edit</button>
                  <button class="text-red-600 hover:text-red-800 delete-budget" data-id="${doc.id}">Delete</button>
                </td>
              `;
              budgetTable.appendChild(tr);
              const tile = document.createElement('div');
              tile.classList.add('bg-white', 'rounded-lg', 'shadow-md', 'p-6', 'budget-tile');
              const percentage = budget.amount ? (spent / budget.amount) * 100 : 0;
              tile.innerHTML = `
                <h3 class="text-lg font-semibold text-gray-700">${budget.name}</h3>
                <p class="text-sm text-gray-500">Budget: <span id="${doc.id}-budget">${formatCurrency(budget.amount, 'INR')}</span></p>
                <p class="text-sm text-gray-500">Spent: <span id="${doc.id}-spent">${formatCurrency(spent, 'INR')}</span></p>
                <p class="text-sm font-semibold text-gray-700 mt-2">
                  Remaining: <span id="${doc.id}-remaining">${formatCurrency(budget.amount - spent, 'INR')}</span>
                </p>
                <div class="w-full bg-gray-200 rounded-full mt-4 progress-bar">
                  <div class="bg-green-600 progress-bar" style="width: ${percentage}%"></div>
                </div>
              `;
              console.log('Budget tile added:', {
                id: doc.id,
                name: budget.name,
                amount: formatCurrency(budget.amount, 'INR'),
                spent: formatCurrency(spent, 'INR')
              });
              budgetTiles.appendChild(tile);
            });
            totalBudget.textContent = formatCurrency(totalBudgetAmount, 'INR');
            totalRemaining.textContent = formatCurrency(totalRemainingAmount, 'INR');
            console.log('Total budget and remaining updated:', {
              totalBudget: formatCurrency(totalBudgetAmount, 'INR'),
              totalRemaining: formatCurrency(totalRemainingAmount, 'INR')
            });
          })
      );
    } catch (error) {
      console.error('Error loading budgets:', {
        message: error.message,
        stack: error.stack
      });
      showError('budget-name', 'Failed to load budgets.');
    }
  }

  try {
    if (addBudget) {
      addBudget.addEventListener('click', () => {
        console.log('Add Budget clicked', { isEditing: isEditing.budget });
        if (isEditing.budget) return;
        clearErrors();
        const name = document.getElementById('budget-name').value.trim();
        const amount = parseFloat(document.getElementById('budget-amount').value);
        if (!name) showError('budget-name', 'Name is required');
        if (!amount || amount <= 0) showError('budget-amount', 'Valid amount is required');
        if (name && amount > 0 && currentUser && db) {
          addBudget.disabled = true;
          addBudget.textContent = 'Adding...';
          retryFirestoreOperation(() => 
            db.collection('budgets').add({
              name,
              amount,
              spent: 0,
              familyCode,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(() => {
              console.log('Budget added successfully:', { name, amount });
              document.getElementById('budget-name').value = '';
              document.getElementById('budget-amount').value = '';
              addBudget.innerHTML = 'Add Budget';
              addBudget.disabled = false;
              loadBudgets();
              loadCategories();
            })
          ).catch(error => {
            console.error('Error adding budget:', error.code, error.message);
            showError('budget-name', 'Failed to add budget.');
            addBudget.disabled = false;
            addBudget.innerHTML = 'Add Budget';
          });
        } else {
          console.error('Firestore or user not available');
          showError('budget-name', db ? 'Invalid input data' : 'Database service not available');
        }
      });
    }

    if (categoryBudgetSelect) {
      categoryBudgetSelect.addEventListener('change', () => {
        console.log('Category Budget select changed:', categoryBudgetSelect.value);
        if (categoryBudgetSelect.value === 'add-new') {
          addBudgetModal.classList.remove('hidden');
          categoryBudgetSelect.value = 'none';
        }
      });
    }

    if (saveBudget) {
      saveBudget.addEventListener('click', () => {
        console.log('Save Budget clicked');
        clearErrors();
        const name = document.getElementById('new-budget-name').value.trim();
        const amount = parseFloat(document.getElementById('new-budget-amount').value);
        if (!name) showError('new-budget-name', 'Name is required');
        if (!amount || amount <= 0) showError('new-budget-amount', 'Valid amount is required');
        if (name && amount > 0 && currentUser && db) {
          saveBudget.disabled = true;
          saveBudget.textContent = 'Saving...';
          retryFirestoreOperation(() => 
            db.collection('budgets').add({
              name,
              amount,
              spent: 0,
              familyCode,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(() => {
              console.log('Budget saved successfully:', { name, amount });
              addBudgetModal.classList.add('hidden');
              document.getElementById('new-budget-name').value = '';
              document.getElementById('new-budget-amount').value = '';
              saveBudget.disabled = false;
              saveBudget.textContent = 'Save';
              loadBudgets();
              loadCategories();
            })
          ).catch(error => {
            console.error('Error saving budget:', error.code, error.message);
            showError('new-budget-name', 'Failed to save budget.');
            saveBudget.disabled = false;
            saveBudget.textContent = 'Save';
          });
        } else {
          console.error('Firestore or user not available');
          showError('new-budget-name', db ? 'Invalid input data' : 'Database service not available');
        }
      });
    }

    if (cancelBudget) {
      cancelBudget.addEventListener('click', () => {
        console.log('Cancel Budget clicked');
        addBudgetModal.classList.add('hidden');
        document.getElementById('new-budget-name').value = '';
        document.getElementById('new-budget-amount').value = '';
      });
    }

    if (budgetTable) {
      budgetTable.addEventListener('click', e => {
        if (e.target.classList.contains('edit-budget')) {
          console.log('Edit Budget clicked:', e.target.dataset.id);
          const id = e.target.dataset.id;
          if (db) {
            retryFirestoreOperation(() => 
              db.collection('budgets').doc(id).get().then(doc => {
                if (doc.exists) {
                  document.getElementById('budget-name').value = doc.data().name;
                  document.getElementById('budget-amount').value = doc.data().amount;
                  addBudget.innerHTML = 'Update Budget';
                  isEditing.budget = true;
                  console.log('Entered edit mode for budget:', id);
                  const updateHandler = () => {
                    const name = document.getElementById('budget-name').value.trim();
                    const amount = parseFloat(document.getElementById('budget-amount').value);
                    if (!name) {
                      showError('budget-name', 'Name is required');
                      return;
                    }
                    if (!amount || amount <= 0) {
                      showError('budget-amount', 'Valid amount is required');
                      return;
                    }
                    addBudget.disabled = true;
                    addBudget.textContent = 'Updating...';
                    retryFirestoreOperation(() => 
                      db.collection('budgets').doc(id).update({
                        name,
                        amount
                      }).then(() => {
                        console.log('Budget updated successfully:', { id, name, amount });
                        document.getElementById('budget-name').value = '';
                        document.getElementById('budget-amount').value = '';
                        addBudget.innerHTML = 'Add Budget';
                        addBudget.disabled = false;
                        isEditing.budget = false;
                        console.log('Exited edit mode for budget:', id);
                        loadBudgets();
                        loadCategories();
                      })
                    ).catch(error => {
                      console.error('Error updating budget:', error.code, error.message);
                      showError('budget-name', 'Failed to update budget.');
                      addBudget.disabled = false;
                      addBudget.innerHTML = 'Add Budget';
                      isEditing.budget = false;
                    });
                  };
                  addBudget.addEventListener('click', updateHandler, { once: true });
                }
              })
            ).catch(error => {
              console.error('Error fetching budget:', error.code, error.message);
              showError('budget-name', 'Failed to fetch budget.');
            });
          }
        }
        if (e.target.classList.contains('delete-budget')) {
          console.log('Delete Budget clicked:', e.target.dataset.id);
          const id = e.target.dataset.id;
          if (db) {
            retryFirestoreOperation(() => 
              db.collection('budgets').doc(id).delete().then(() => {
                console.log('Budget deleted successfully:', { id });
                loadBudgets();
                loadCategories();
              })
            ).catch(error => {
              console.error('Error deleting budget:', error.code, error.message);
              showError('budget-name', 'Failed to delete budget.');
            });
          }
        }
      });
    }
  } catch (error) {
    console.error('Error binding budget event listeners:', {
      message: error.message,
      stack: error.stack
    });
  }

  // Transactions
  async function loadTransactions() {
    try {
      console.log('Loading transactions');
      if (!db) {
        console.error('Firestore not available');
        return;
      }
      transactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading...</td></tr>';
      await retryFirestoreOperation(() => 
        db.collection('transactions').where('familyCode', '==', familyCode).get()
          .then(snapshot => {
            console.log('Transactions fetched:', { count: snapshot.size });
            transactionTable.innerHTML = '';
            snapshot.forEach(doc => {
              const transaction = doc.data();
              const tr = document.createElement('tr');
              tr.classList.add('table-row');
              db.collection('categories').doc(transaction.categoryId).get().then(categoryDoc => {
                const categoryName = categoryDoc.exists ? categoryDoc.data().name : 'Unknown';
                tr.innerHTML = `
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${transaction.type}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatCurrency(transaction.amount, 'INR')}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${categoryName}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${transaction.description}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm">
                    <button class="text-blue-600 hover:text-blue-800 mr-2 edit-transaction" data-id="${doc.id}">Edit</button>
                    <button class="text-red-600 hover:text-red-800 delete-transaction" data-id="${doc.id}">Delete</button>
                  </td>
                `;
                console.log('Transaction row added:', {
                  id: doc.id,
                  type: transaction.type,
                  amount: formatCurrency(transaction.amount, 'INR'),
                  category: categoryName
                });
                transactionTable.appendChild(tr);
              }).catch(error => {
                console.error('Error fetching category for transaction:', error.code, error.message);
              });
            });
          })
      );
    } catch (error) {
      console.error('Error loading transactions:', {
        message: error.message,
        stack: error.stack
      });
    }
  }

  try {
    if (addTransaction) {
      addTransaction.addEventListener('click', () => {
        console.log('Add Transaction clicked', { isEditing: isEditing.transaction });
        if (isEditing.transaction) return;
        clearErrors();
        const type = document.getElementById('type').value;
        const amount = parseFloat(document.getElementById('amount').value);
        const categoryId = document.getElementById('category').value;
        const description = document.getElementById('description').value.trim();
        if (!amount || amount <= 0) showError('amount', 'Valid amount is required');
        if (!categoryId) showError('category', 'Category is required');
        if (amount > 0 && categoryId && currentUser && db) {
          addTransaction.disabled = true;
          addTransaction.textContent = 'Adding...';
          retryFirestoreOperation(() => 
            db.collection('transactions').add({
              type,
              amount,
              categoryId,
              description,
              familyCode,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(async docRef => {
              console.log('Transaction added successfully:', { id: docRef.id, type, amount, categoryId });
              if (type === 'debit') {
                const categoryDoc = await db.collection('categories').doc(categoryId).get();
                if (categoryDoc.exists && categoryDoc.data().budgetId) {
                  const budgetId = categoryDoc.data().budgetId;
                  console.log('Updating budget spent for budgetId:', budgetId, 'with amount:', amount);
                  await retryFirestoreOperation(() => 
                    db.collection('budgets').doc(budgetId).update({
                      spent: firebase.firestore.FieldValue.increment(amount)
                    })
                  );
                  console.log('Budget spent updated successfully:', { budgetId, amount });
                  await loadBudgets();
                }
              }
              document.getElementById('type').value = 'debit';
              document.getElementById('amount').value = '';
              document.getElementById('category').value = '';
              document.getElementById('description').value = '';
              addTransaction.innerHTML = 'Add Transaction';
              addTransaction.disabled = false;
              await loadTransactions();
              await updateDashboard();
            })
          ).catch(error => {
            console.error('Error adding transaction:', error.code, error.message);
            showError('category', 'Failed to add transaction.');
            addTransaction.disabled = false;
            addTransaction.innerHTML = 'Add Transaction';
          });
        } else {
          console.error('Firestore or user not available');
          showError('category', db ? 'Invalid input data' : 'Database service not available');
        }
      });
    }

    if (transactionTable) {
      transactionTable.addEventListener('click', e => {
        if (e.target.classList.contains('edit-transaction')) {
          console.log('Edit Transaction clicked:', e.target.dataset.id);
          const id = e.target.dataset.id;
          if (db) {
            retryFirestoreOperation(() => 
              db.collection('transactions').doc(id).get().then(async doc => {
                if (doc.exists) {
                  const oldData = doc.data();
                  document.getElementById('type').value = oldData.type;
                  document.getElementById('amount').value = oldData.amount;
                  document.getElementById('category').value = oldData.categoryId;
                  document.getElementById('description').value = oldData.description;
                  addTransaction.innerHTML = 'Update Transaction';
                  isEditing.transaction = true;
                  console.log('Entered edit mode for transaction:', id);
                  const updateHandler = async () => {
                    const type = document.getElementById('type').value;
                    const amount = parseFloat(document.getElementById('amount').value);
                    const categoryId = document.getElementById('category').value;
                    const description = document.getElementById('description').value.trim();
                    if (!amount || amount <= 0) {
                      showError('amount', 'Valid amount is required');
                      return;
                    }
                    if (!categoryId) {
                      showError('category', 'Category is required');
                      return;
                    }
                    addTransaction.disabled = true;
                    addTransaction.textContent = 'Updating...';
                    try {
                      // Handle budget spent adjustments
                      if (oldData.type === 'debit' || type === 'debit') {
                        let oldBudgetId = null;
                        let newBudgetId = null;
                        if (oldData.type === 'debit') {
                          const oldCategoryDoc = await db.collection('categories').doc(oldData.categoryId).get();
                          if (oldCategoryDoc.exists && oldCategoryDoc.data().budgetId) {
                            oldBudgetId = oldCategoryDoc.data().budgetId;
                          }
                        }
                        if (type === 'debit') {
                          const newCategoryDoc = await db.collection('categories').doc(categoryId).get();
                          if (newCategoryDoc.exists && newCategoryDoc.data().budgetId) {
                            newBudgetId = newCategoryDoc.data().budgetId;
                          }
                        }
                        if (oldBudgetId && oldBudgetId === newBudgetId) {
                          // Same budget: adjust by amount difference
                          const amountDiff = amount - oldData.amount;
                          if (amountDiff !== 0) {
                            console.log('Adjusting budget spent for budgetId:', oldBudgetId, 'by amountDiff:', amountDiff);
                            await retryFirestoreOperation(() => 
                              db.collection('budgets').doc(oldBudgetId).update({
                                spent: firebase.firestore.FieldValue.increment(amountDiff)
                              })
                            );
                            console.log('Budget spent adjusted successfully:', { budgetId: oldBudgetId, amountDiff });
                          }
                        } else {
                          // Different budgets or type change
                          if (oldBudgetId && oldData.type === 'debit') {
                            console.log('Deducting old budget spent for budgetId:', oldBudgetId, 'by amount:', oldData.amount);
                            await retryFirestoreOperation(() => 
                              db.collection('budgets').doc(oldBudgetId).update({
                                spent: firebase.firestore.FieldValue.increment(-oldData.amount)
                              })
                            );
                            console.log('Old budget spent deducted successfully:', { budgetId: oldBudgetId, amount: oldData.amount });
                          }
                          if (newBudgetId && type === 'debit') {
                            console.log('Adding to new budget spent for budgetId:', newBudgetId, 'by amount:', amount);
                            await retryFirestoreOperation(() => 
                              db.collection('budgets').doc(newBudgetId).update({
                                spent: firebase.firestore.FieldValue.increment(amount)
                              })
                            );
                            console.log('New budget spent updated successfully:', { budgetId: newBudgetId, amount });
                          }
                        }
                      }
                      // Update transaction
                      await retryFirestoreOperation(() => 
                        db.collection('transactions').doc(id).update({
                          type,
                          amount,
                          categoryId,
                          description
                        })
                      );
                      console.log('Transaction updated successfully:', { id, type, amount, categoryId });
                      document.getElementById('type').value = 'debit';
                      document.getElementById('amount').value = '';
                      document.getElementById('category').value = '';
                      document.getElementById('description').value = '';
                      addTransaction.innerHTML = 'Add Transaction';
                      addTransaction.disabled = false;
                      isEditing.transaction = false;
                      console.log('Exited edit mode for transaction:', id);
                      await loadBudgets();
                      await loadTransactions();
                      await updateDashboard();
                    } catch (error) {
                      console.error('Error updating transaction:', error.code, error.message);
                      showError('category', 'Failed to update transaction.');
                      addTransaction.disabled = false;
                      addTransaction.innerHTML = 'Add Transaction';
                      isEditing.transaction = false;
                    }
                  };
                  addTransaction.addEventListener('click', updateHandler, { once: true });
                }
              })
            ).catch(error => {
              console.error('Error fetching transaction:', error.code, error.message);
              showError('category', 'Failed to fetch transaction.');
            });
          }
        }
        if (e.target.classList.contains('delete-transaction')) {
          console.log('Delete Transaction clicked:', e.target.dataset.id);
          const id = e.target.dataset.id;
          if (db) {
            retryFirestoreOperation(() => 
              db.collection('transactions').doc(id).get().then(async doc => {
                if (doc.exists) {
                  const transaction = doc.data();
                  if (transaction.type === 'debit' && transaction.categoryId) {
                    const categoryDoc = await db.collection('categories').doc(transaction.categoryId).get();
                    if (categoryDoc.exists && categoryDoc.data().budgetId) {
                      const budgetId = categoryDoc.data().budgetId;
                      console.log('Deducting budget spent for budgetId:', budgetId, 'by amount:', transaction.amount);
                      await retryFirestoreOperation(() => 
                        db.collection('budgets').doc(budgetId).update({
                          spent: firebase.firestore.FieldValue.increment(-transaction.amount)
                        })
                      );
                      console.log('Budget spent deducted successfully:', { budgetId, amount: transaction.amount });
                      await loadBudgets();
                    }
                  }
                  await db.collection('transactions').doc(id).delete();
                  console.log('Transaction deleted successfully:', { id });
                  await loadTransactions();
                  await updateDashboard();
                }
              })
            ).catch(error => {
              console.error('Error deleting transaction:', error.code, error.message);
              showError('category', 'Failed to delete transaction.');
            });
          }
        }
      });
    }
  } catch (error) {
    console.error('Error binding transaction event listeners:', {
      message: error.message,
      stack: error.stack
    });
  }

  // Dashboard Updates
  async function updateDashboard() {
    try {
      console.log('Updating dashboard');
      if (!db) {
        console.error('Firestore not available');
        return;
      }
      let totalBalance = 0;
      await retryFirestoreOperation(() => 
        db.collection('transactions').where('familyCode', '==', familyCode).get()
          .then(snapshot => {
            snapshot.forEach(doc => {
              const transaction = doc.data();
              if (transaction.type === 'credit') {
                totalBalance += transaction.amount;
              } else {
                totalBalance -= transaction.amount;
              }
            });
            balance.textContent = formatCurrency(totalBalance, 'INR');
            console.log('Dashboard balance updated:', { totalBalance: formatCurrency(totalBalance, 'INR') });
          })
      );
    } catch (error) {
      console.error('Error updating dashboard:', {
        message: error.message,
        stack: error.stack
      });
      showError('balance', 'Failed to update dashboard.');
    }
  }
});
