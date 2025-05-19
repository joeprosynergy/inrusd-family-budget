document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded, querying elements');

  // DOM Elements
  let authSection, appSection, loginModal, signupModal, resetModal, loginButton, signupButton, resetButton, logoutButton,
      showSignupBtn, showResetBtn, showLoginFromSignupBtn, showLoginFromResetBtn, dashboardTab, transactionsTab,
      budgetsTab, categoriesTab, dashboardSection, transactionsSection, budgetsSection, categoriesSection, pageTitle,
      addTransaction, transactionTable, addBudget, budgetTable, budgetTiles, addCategory, categoryTable, categorySelect,
      categoryBudgetSelect, addCategoryModal, addBudgetModal, saveCategory, cancelCategory, saveBudget, cancelBudget,
      balance, totalBudget, totalRemaining;

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
    dashboardSection = document.getElementById('dashboard-section');
    transactionsSection = document.getElementById('transactions-section');
    budgetsSection = document.getElementById('budgets-section');
    categoriesSection = document.getElementById('categories-section');
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

    // Validate critical DOM elements
    const criticalElements = {
      authSection, appSection, loginModal, signupModal, resetModal, loginButton, signupButton, resetButton, logoutButton,
      showSignupBtn, showResetBtn, showLoginFromSignupBtn, showLoginFromResetBtn, dashboardTab, transactionsTab,
      budgetsTab, categoriesTab, dashboardSection, transactionsSection, budgetsSection, categoriesSection, pageTitle,
      categoryBudgetSelect, addCategoryModal
    };
    for (const [key, element] of Object.entries(criticalElements)) {
      console.log(`Checking DOM element ${key}: ${element ? 'found' : 'not found'}`);
      if (!element) {
        console.error(`Critical DOM element not found: ${key}`);
      }
    }
    // Specifically check signupButton and category dropdowns
    console.log(`Signup button: ${signupButton ? 'found' : 'not found'}`);
    console.log(`Category budget dropdown: ${categoryBudgetSelect ? 'found' : 'not found'}`);
  } catch (error) {
    console.error('Error querying DOM elements:', {
      message: error.message,
      stack: error.stack
    });
    return; // Stop execution to prevent further errors
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
  const retryDelay = 2000; // 2 seconds

  function initializeFirebase() {
    if (initAttempts >= maxAttempts) {
      console.error('Max Firebase initialization attempts reached');
      alert('Failed to connect to Firebase. Please check your network and try again.');
      return;
    }
    initAttempts++;
    console.log(`Initialization attempt ${initAttempts}/${maxAttempts}`);
    try {
      // Check network status
      console.log('Network status:', { online: navigator.onLine });
      if (!navigator.onLine) {
        throw new Error('No internet connection detected');
      }
      // Check if Firebase SDK is loaded
      console.log('Checking Firebase SDK availability');
      if (typeof firebase === 'undefined' || !firebase.initializeApp) {
        throw new Error('Firebase SDK not loaded. Ensure firebase-app-compat.js, firebase-auth-compat.js, and firebase-firestore-compat.js are included in index.html.');
      }
      // Validate firebaseConfig fields
      console.log('Validating firebaseConfig:', {
        apiKey: firebaseConfig.apiKey ? '<redacted>' : 'missing',
        authDomain: firebaseConfig.authDomain,
        projectId: firebaseConfig.projectId,
        storageBucket: firebaseConfig.storageBucket,
        messagingSenderId: firebaseConfig.messagingSenderId,
        appId: firebaseConfig.appId
      });
      const requiredFields = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
      for (const field of requiredFields) {
        if (!firebaseConfig[field] || firebaseConfig[field].trim() === '') {
          throw new Error(`Invalid Firebase configuration: ${field} is missing or empty`);
        }
      }
      // Initialize Firebase
      console.log('Initializing Firebase app');
      const app = firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      console.log('Firebase initialized successfully:', { app: !!app, auth: !!auth, db: !!db });
      // Initialize auth state listener only after successful initialization
      setupAuthStateListener();
    } catch (error) {
      console.error('Firebase initialization failed:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
        config: {
          apiKey: firebaseConfig.apiKey ? '<redacted>' : 'missing',
          authDomain: firebaseConfig.authDomain,
          projectId: firebaseConfig.projectId
        },
        attempt: initAttempts,
        online: navigator.onLine
      });
      if (initAttempts < maxAttempts) {
        console.log(`Retrying initialization in ${retryDelay/1000} seconds...`);
        setTimeout(initializeFirebase, retryDelay);
      } else {
        alert('Failed to initialize Firebase after multiple attempts. Please check your network or configuration.');
        showLoginModal();
      }
    }
  }
  initializeFirebase();

  // Setup Auth State Listener
  function setupAuthStateListener() {
    try {
      if (!auth) {
        console.error('Auth service not available, cannot set up auth state listener');
        showError('login-email', 'Authentication service not available.');
        return;
      }
      console.log('Setting up auth state listener');
      auth.onAuthStateChanged(user => {
        console.log('Auth state changed:', user ? user.uid : 'No user');
        if (user) {
          currentUser = user;
          authSection.classList.add('hidden');
          appSection.classList.remove('hidden');
          if (db) {
            console.log('Fetching user data from Firestore for UID:', user.uid);
            db.collection('users').doc(user.uid).get().then(doc => {
              if (doc.exists) {
                userCurrency = doc.data().currency || 'INR';
                familyCode = doc.data().familyCode;
                console.log('User data loaded:', { userCurrency, familyCode });
                loadAppData();
              } else {
                console.error('User document not found for UID:', user.uid);
                showError('login-email', 'User data not found. Please sign up again.');
              }
            }).catch(error => {
              console.error('Error fetching user data:', {
                code: error.code,
                message: error.message,
                uid: user.uid
              });
              showError('login-email', 'Failed to load user data.');
            });
          } else {
            console.error('Firestore not available for user data');
            showError('login-email', 'Database service not available.');
          }
        } else {
          currentUser = null;
          authSection.classList.remove('hidden');
          appSection.classList.add('hidden');
          showLoginModal();
        }
      });
    } catch (error) {
      console.error('Error in auth state handling:', {
        message: error.message,
        stack: error.stack
      });
      showError('login-email', 'Authentication error occurred.');
    }
  }

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
      dashboardSection.classList.remove('hidden');
      transactionsSection.classList.add('hidden');
      budgetsSection.classList.add('hidden');
      categoriesSection.classList.add('hidden');
      pageTitle.textContent = 'Budget Dashboard';
    }

    function showTransactions() {
      console.log('Showing transactions');
      transactionsTab.classList.add('bg-blue-800');
      dashboardTab.classList.remove('bg-blue-800');
      budgetsTab.classList.remove('bg-blue-800');
      categoriesTab.classList.remove('bg-blue-800');
      transactionsSection.classList.remove('hidden');
      dashboardSection.classList.add('hidden');
      budgetsSection.classList.add('hidden');
      categoriesSection.classList.add('hidden');
      pageTitle.textContent = 'Transactions';
    }

    function showBudgets() {
      console.log('Showing budgets');
      budgetsTab.classList.add('bg-blue-800');
      dashboardTab.classList.remove('bg-blue-800');
      transactionsTab.classList.remove('bg-blue-800');
      categoriesTab.classList.remove('bg-blue-800');
      budgetsSection.classList.remove('hidden');
      dashboardSection.classList.add('hidden');
      transactionsSection.classList.add('hidden');
      categoriesSection.classList.add('hidden');
      pageTitle.textContent = 'Budgets';
    }

    function showCategories() {
      console.log('Showing categories');
      categoriesTab.classList.add('bg-blue-800');
      dashboardTab.classList.remove('bg-blue-800');
      transactionsTab.classList.remove('bg-blue-800');
      budgetsTab.classList.remove('bg-blue-800');
      categoriesSection.classList.remove('hidden');
      dashboardSection.classList.add('hidden');
      transactionsSection.classList.add('hidden');
      budgetsSection.classList.add('hidden');
      pageTitle.textContent = 'Categories';
    }

    // Bind modal and tab event listeners
    if (showSignupBtn) {
      showSignupBtn.addEventListener('click', showSignupModal);
    } else {
      console.error('showSignupBtn not found, signup modal navigation may not work');
    }
    if (showResetBtn) {
      showResetBtn.addEventListener('click', showResetModal);
    } else {
      console.error('showResetBtn not found, reset modal navigation may not work');
    }
    if (showLoginFromSignupBtn) {
      showLoginFromSignupBtn.addEventListener('click', showLoginModal);
    } else {
      console.error('showLoginFromSignupBtn not found, login from signup navigation may not work');
    }
    if (showLoginFromResetBtn) {
      showLoginFromResetBtn.addEventListener('click', showLoginModal);
    } else {
      console.error('showLoginFromResetBtn not found, login from reset navigation may not work');
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

    // Initialize with login modal
    showLoginModal();
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

  // Utility Functions
  function formatCurrency(amount, currency) {
    try {
      console.log('Formatting currency:', { amount, currency });
      if (currency === 'USD') {
        return `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
      return `₹${Number(amount).toLocaleString('en-IN')}`;
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

        // Enhanced input validation
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
          showError('signup-email', 'Authentication service not available. Please check your network or configuration.');
          return;
        }
        if (!db) {
          console.error('Firestore service not available');
          showError('signup-email', 'Database service not available. Please check your network or configuration.');
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
            // Clear form
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
            let errorMessage = error.message || 'Failed to sign up. Please check your network or configuration.';
            if (error.code === 'auth/email-already-in-use') {
              errorMessage = 'This email is already registered. Please log in or use a different email.';
            } else if (error.code === 'auth/invalid-email') {
              errorMessage = 'Invalid email format.';
            } else if (error.code === 'auth/weak-password') {
              errorMessage = 'Password is too weak. Please use a stronger password.';
            } else if (error.code === 'auth/network-request-failed') {
              errorMessage = 'Network error. Please check your connection and try again.';
            }
            showError('signup-email', errorMessage);
          });
      });
    } else {
      console.error('signupButton not found, signup functionality will not work');
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
              showError('login-password', error.message || 'Failed to log in. Please check your network or configuration.');
            });
        } else {
          console.error('Auth service not available or invalid inputs');
          showError('login-email', auth ? 'Invalid input data' : 'Authentication service not available. Please check your network or configuration.');
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
          showError('reset-email', auth ? 'Invalid email' : 'Authentication service not available. Please check your network or configuration.');
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
  function loadAppData() {
    try {
      console.log('Loading app data');
      if (!currentUser || !familyCode || !db) {
        console.error('Cannot load app data: missing user, familyCode, or Firestore');
        return;
      }
      loadCategories();
      loadBudgets();
      loadTransactions();
      updateDashboard();
    } catch (error) {
      console.error('Error loading app data:', {
        message: error.message,
        stack: error.stack
      });
    }
  }

  // Categories
  function loadCategories() {
    try {
      console.log('Loading categories and budgets for dropdowns');
      if (!db) {
        console.error('Firestore not available');
        return;
      }
      // Initialize dropdowns
      categorySelect.innerHTML = '<option value="">Select Category</option><option value="add-new">Add New</option>';
      categoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
      const newCategoryBudgetSelect = document.getElementById('new-category-budget');
      if (newCategoryBudgetSelect) {
        newCategoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
      } else {
        console.error('new-category-budget dropdown not found');
      }

      // Load all budgets for familyCode
      console.log('Fetching all budgets for familyCode:', familyCode);
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
        .catch(error => {
          console.error('Error fetching budgets for dropdowns:', {
            code: error.code,
            message: error.message
          });
          showError('category-budget', 'Failed to load budgets.');
        });

      // Load categories
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

          // Populate category table
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
        .catch(error => {
          console.error('Error loading categories:', {
            code: error.code,
            message: error.message
          });
          showError('category-name', 'Failed to load categories.');
        });
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
        console.log('Add Category clicked');
        clearErrors();
        const name = document.getElementById('category-name').value.trim();
        const type = document.getElementById('category-type').value;
        const budgetId = document.getElementById('category-budget').value === 'none' ? null : document.getElementById('category-budget').value;
        if (!name) showError('category-name', 'Name is required');
        if (name && currentUser && db) {
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
            loadCategories();
          }).catch(error => {
            console.error('Error adding category:', error.code, error.message);
            showError('category-name', 'Failed to add category.');
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
            loadCategories();
          }).catch(error => {
            console.error('Error saving category:', error.code, error.message);
            showError('new-category-name', 'Failed to save category.');
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
            db.collection('categories').doc(id).get().then(doc => {
              if (doc.exists) {
                document.getElementById('category-name').value = doc.data().name;
                document.getElementById('category-type').value = doc.data().type;
                document.getElementById('category-budget').value = doc.data().budgetId || 'none';
                addCategory.innerHTML = 'Update Category';
                addCategory.onclick = () => {
                  const name = document.getElementById('category-name').value.trim();
                  const type = document.getElementById('category-type').value;
                  const budgetId = document.getElementById('category-budget').value === 'none' ? null : document.getElementById('category-budget').value;
                  if (!name) showError('category-name', 'Name is required');
                  if (name) {
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
                      addCategory.onclick = null;
                      loadCategories();
                    }).catch(error => {
                      console.error('Error updating category:', error.code, error.message);
                      showError('category-name', 'Failed to update category.');
                    });
                  }
                };
              }
            }).catch(error => {
              console.error('Error fetching category:', error.code, error.message);
              showError('category-name', 'Failed to fetch category.');
            });
          }
        }
        if (e.target.classList.contains('delete-category')) {
          console.log('Delete Category clicked:', e.target.dataset.id);
          const id = e.target.dataset.id;
          if (db) {
            db.collection('categories').doc(id).delete().then(() => {
              console.log('Category deleted successfully:', { id });
              loadCategories();
            }).catch(error => {
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
  function loadBudgets() {
    try {
      console.log('Loading budgets');
      if (!db) {
        console.error('Firestore not available');
        return;
      }
      budgetTable.innerHTML = '';
      budgetTiles.innerHTML = '';
      db.collection('budgets').where('familyCode', '==', familyCode).get()
        .then(snapshot => {
          console.log('Budgets fetched for table and tiles:', { count: snapshot.size });
          let totalBudgetAmount = 0;
          let totalRemainingAmount = 0;
          snapshot.forEach(doc => {
            const budget = doc.data();
            totalBudgetAmount += budget.amount;
            totalRemainingAmount += budget.amount - (budget.spent || 0);
            // Budget Table
            const tr = document.createElement('tr');
            tr.classList.add('table-row');
            tr.innerHTML = `
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${budget.name}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatCurrency(budget.amount, userCurrency)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatCurrency(budget.spent || 0, userCurrency)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatCurrency(budget.amount - (budget.spent || 0), userCurrency)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm">
                <button class="text-blue-600 hover:text-blue-800 mr-2 edit-budget" data-id="${doc.id}">Edit</button>
                <button class="text-red-600 hover:text-red-800 delete-budget" data-id="${doc.id}">Delete</button>
              </td>
            `;
            budgetTable.appendChild(tr);
            // Budget Tiles
            const tile = document.createElement('div');
            tile.classList.add('bg-white', 'rounded-lg', 'shadow-md', 'p-6', 'budget-tile');
            const spent = budget.spent || 0;
            const percentage = budget.amount ? (spent / budget.amount) * 100 : 0;
            tile.innerHTML = `
              <h3 class="text-lg font-semibold text-gray-700">${budget.name}</h3>
              <p class="text-sm text-gray-500">Budget: <span id="${doc.id}-budget">${formatCurrency(budget.amount, userCurrency)}</span></p>
              <p class="text-sm text-gray-500">Spent: <span id="${doc.id}-spent">${formatCurrency(spent, userCurrency)}</span></p>
              <p class="text-sm font-semibold text-gray-700 mt-2">
                Remaining: <span id="${doc.id}-remaining">${formatCurrency(budget.amount - spent, userCurrency)}</span>
              </p>
              <div class="w-full bg-gray-200 rounded-full mt-4 progress-bar">
                <div class="bg-green-600 progress-bar" style="width: ${percentage}%"></div>
              </div>
            `;
            budgetTiles.appendChild(tile);
          });
          totalBudget.textContent = formatCurrency(totalBudgetAmount, userCurrency);
          totalRemaining.textContent = formatCurrency(totalRemainingAmount, userCurrency);
        })
        .catch(error => {
          console.error('Error loading budgets:', error.code, error.message);
          showError('budget-name', 'Failed to load budgets.');
        });
    } catch (error) {
      console.error('Error loading budgets:', {
        message: error.message,
        stack: error.stack
      });
    }
  }

  try {
    if (addBudget) {
      addBudget.addEventListener('click', () => {
        console.log('Add Budget clicked');
        clearErrors();
        const name = document.getElementById('budget-name').value.trim();
        const amount = parseFloat(document.getElementById('budget-amount').value);
        if (!name) showError('budget-name', 'Name is required');
        if (!amount || amount <= 0) showError('budget-amount', 'Valid amount is required');
        if (name && amount > 0 && currentUser && db) {
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
            loadBudgets();
            loadCategories();
          }).catch(error => {
            console.error('Error adding budget:', error.code, error.message);
            showError('budget-name', 'Failed to add budget.');
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
            loadBudgets();
            loadCategories();
          }).catch(error => {
            console.error('Error saving budget:', error.code, error.message);
            showError('new-budget-name', 'Failed to save budget.');
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
            db.collection('budgets').doc(id).get().then(doc => {
              if (doc.exists) {
                document.getElementById('budget-name').value = doc.data().name;
                document.getElementById('budget-amount').value = doc.data().amount;
                addBudget.innerHTML = 'Update Budget';
                addBudget.onclick = () => {
                  const name = document.getElementById('budget-name').value.trim();
                  const amount = parseFloat(document.getElementById('budget-amount').value);
                  if (!name) showError('budget-name', 'Name is required');
                  if (!amount || amount <= 0) showError('budget-amount', 'Valid amount is required');
                  if (name && amount > 0) {
                    db.collection('budgets').doc(id).update({
                      name,
                      amount
                    }).then(() => {
                      console.log('Budget updated successfully:', { id, name, amount });
                      document.getElementById('budget-name').value = '';
                      document.getElementById('budget-amount').value = '';
                      addBudget.innerHTML = 'Add Budget';
                      addBudget.onclick = null;
                      loadBudgets();
                      loadCategories();
                    }).catch(error => {
                      console.error('Error updating budget:', error.code, error.message);
                      showError('budget-name', 'Failed to update budget.');
                    });
                  }
                };
              }
            }).catch(error => {
              console.error('Error fetching budget:', error.code, error.message);
              showError('budget-name', 'Failed to fetch budget.');
            });
          }
        }
        if (e.target.classList.contains('delete-budget')) {
          console.log('Delete Budget clicked:', e.target.dataset.id);
          const id = e.target.dataset.id;
          if (db) {
            db.collection('budgets').doc(id).delete().then(() => {
              console.log('Budget deleted successfully:', { id });
              loadBudgets();
              loadCategories();
            }).catch(error => {
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
  function loadTransactions() {
    try {
      console.log('Loading transactions');
      if (!db) {
        console.error('Firestore not available');
        return;
      }
      transactionTable.innerHTML = '';
      db.collection('transactions').where('familyCode', '==', familyCode).get()
        .then(snapshot => {
          console.log('Transactions fetched:', { count: snapshot.size });
          snapshot.forEach(doc => {
            const transaction = doc.data();
            const tr = document.createElement('tr');
            tr.classList.add('table-row');
            db.collection('categories').doc(transaction.categoryId).get().then(categoryDoc => {
              const categoryName = categoryDoc.exists ? categoryDoc.data().name : 'Unknown';
              tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${transaction.type}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatCurrency(transaction.amount, userCurrency)}</td>
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
                amount: formatCurrency(transaction.amount, userCurrency),
                category: categoryName
              });
              transactionTable.appendChild(tr);
            }).catch(error => {
              console.error('Error fetching category for transaction:', error.code, error.message);
            });
          });
        })
        .catch(error => {
          console.error('Error loading transactions:', error.code, error.message);
          showError('category', 'Failed to load transactions.');
        });
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
        console.log('Add Transaction clicked');
        clearErrors();
        const type = document.getElementById('type').value;
        const amount = parseFloat(document.getElementById('amount').value);
        const categoryId = document.getElementById('category').value;
        const description = document.getElementById('description').value.trim();
        if (!amount || amount <= 0) showError('amount', 'Valid amount is required');
        if (!categoryId) showError('category', 'Category is required');
        if (amount > 0 && categoryId && currentUser && db) {
          db.collection('transactions').add({
            type,
            amount,
            categoryId,
            description,
            familyCode,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          }).then(() => {
            console.log('Transaction added successfully:', { type, amount, categoryId });
            document.getElementById('type').value = 'debit';
            document.getElementById('amount').value = '';
            document.getElementById('category').value = '';
            document.getElementById('description').value = '';
            loadTransactions();
            updateDashboard();
          }).catch(error => {
            console.error('Error adding transaction:', error.code, error.message);
            showError('category', 'Failed to add transaction.');
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
            db.collection('transactions').doc(id).get().then(doc => {
              if (doc.exists) {
                document.getElementById('type').value = doc.data().type;
                document.getElementById('amount').value = doc.data().amount;
                document.getElementById('category').value = doc.data().categoryId;
                document.getElementById('description').value = doc.data().description;
                addTransaction.innerHTML = 'Update Transaction';
                addTransaction.onclick = () => {
                  const type = document.getElementById('type').value;
                  const amount = parseFloat(document.getElementById('amount').value);
                  const categoryId = document.getElementById('category').value;
                  const description = document.getElementById('description').value.trim();
                  if (!amount || amount <= 0) showError('amount', 'Valid amount is required');
                  if (!categoryId) showError('category', 'Category is required');
                  if (amount > 0 && categoryId) {
                    db.collection('transactions').doc(id).update({
                      type,
                      amount,
                      categoryId,
                      description
                    }).then(() => {
                      console.log('Transaction updated successfully:', { id, type, amount, categoryId });
                      document.getElementById('type').value = 'debit';
                      document.getElementById('amount').value = '';
                      document.getElementById('category').value = '';
                      document.getElementById('description').value = '';
                      addTransaction.innerHTML = 'Add Transaction';
                      addTransaction.onclick = null;
                      loadTransactions();
                      updateDashboard();
                    }).catch(error => {
                      console.error('Error updating transaction:', error.code, error.message);
                      showError('category', 'Failed to update transaction.');
                    });
                  }
                };
              }
            }).catch(error => {
              console.error('Error fetching transaction:', error.code, error.message);
              showError('category', 'Failed to fetch transaction.');
            });
          }
        }
        if (e.target.classList.contains('delete-transaction')) {
          console.log('Delete Transaction clicked:', e.target.dataset.id);
          const id = e.target.dataset.id;
          if (db) {
            db.collection('transactions').doc(id).delete().then(() => {
              console.log('Transaction deleted successfully:', { id });
              loadTransactions();
              updateDashboard();
            }).catch(error => {
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
  function updateDashboard() {
    try {
      console.log('Updating dashboard');
      if (!db) {
        console.error('Firestore not available');
        return;
      }
      let totalBalance = 0;
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
          balance.textContent = formatCurrency(totalBalance, userCurrency);
        })
        .catch(error => {
          console.error('Error updating dashboard:', error.code, error.message);
          showError('balance', 'Failed to update dashboard.');
        });
    } catch (error) {
      console.error('Error updating dashboard:', {
        message: error.message,
        stack: error.stack
      });
    }
  }
});
