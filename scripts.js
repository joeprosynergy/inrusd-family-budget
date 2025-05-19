// Firebase Configuration (Replace with your Firebase project config)
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

function initializeFirebase() {
  if (initAttempts >= maxAttempts) {
    console.error('Max Firebase initialization attempts reached');
    console.warn('Continuing with limited functionality (UI only)');
    return;
  }
  initAttempts++;
  console.log(`Initialization attempt ${initAttempts}/${maxAttempts}`);
  try {
    // Check if Firebase SDK is loaded
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
      throw new Error('Firebase SDK not loaded or incomplete');
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
    firebase.initializeApp(firebaseConfig);
    console.log('Firebase initialized successfully');
    auth = firebase.auth();
    db = firebase.firestore();
    console.log('Firebase services initialized:', { auth: !!auth, db: !!db });
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
      attempt: initAttempts
    });
    if (initAttempts < maxAttempts) {
      console.log(`Retrying initialization in 1 second...`);
      setTimeout(initializeFirebase, 1000);
    } else {
      console.warn('Continuing with limited functionality (UI only)');
    }
  }
}
initializeFirebase();

// DOM Elements
console.log('Querying DOM elements');
const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const loginButton = document.getElementById('login-button');
const signupButton = document.getElementById('signup-button');
const resetButton = document.getElementById('reset-button');
const logoutButton = document.getElementById('logout-button');
const loginModal = document.getElementById('login-modal');
const signupModal = document.getElementById('signup-modal');
const resetModal = document.getElementById('reset-modal');
const addTransaction = document.getElementById('add-transaction');
const transactionTable = document.getElementById('transaction-table');
const addBudget = document.getElementById('add-budget');
const budgetTable = document.getElementById('budget-table');
const budgetTiles = document.getElementById('budget-tiles');
const addCategory = document.getElementById('add-category');
const categoryTable = document.getElementById('category-table');
const categorySelect = document.getElementById('category');
const categoryBudgetSelect = document.getElementById('category-budget');
const addCategoryModal = document.getElementById('add-category-modal');
const addBudgetModal = document.getElementById('add-budget-modal');
const saveCategory = document.getElementById('save-category');
const cancelCategory = document.getElementById('cancel-category');
const saveBudget = document.getElementById('save-budget');
const cancelBudget = document.getElementById('cancel-budget');
const balance = document.getElementById('balance');
const totalBudget = document.getElementById('total-budget');
const totalRemaining = document.getElementById('total-remaining');

// User State
let currentUser = null;
let userCurrency = 'INR';
let familyCode = '';

// Utility Functions
function formatCurrency(amount, currency) {
  console.log('Formatting currency:', { amount, currency });
  if (currency === 'USD') {
    return `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function showError(elementId, message) {
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
}

function clearErrors() {
  console.log('Clearing errors');
  document.querySelectorAll('.text-red-600').forEach(el => el.remove());
}

// Authentication
if (auth) {
  auth.onAuthStateChanged(user => {
    console.log('Auth state changed:', user ? user.uid : 'No user');
    if (user) {
      currentUser = user;
      authSection.classList.add('hidden');
      appSection.classList.remove('hidden');
      if (db) {
        db.collection('users').doc(user.uid).get().then(doc => {
          if (doc.exists) {
            userCurrency = doc.data().currency || 'INR';
            familyCode = doc.data().familyCode;
            console.log('User data loaded:', { userCurrency, familyCode });
            loadAppData();
          } else {
            console.error('User document not found');
          }
        }).catch(error => {
          console.error('Error fetching user data:', error.code, error.message);
        });
      } else {
        console.error('Firestore not available for user data');
      }
    } else {
      currentUser = null;
      authSection.classList.remove('hidden');
      appSection.classList.add('hidden');
      loginModal.classList.remove('hidden');
      signupModal.classList.add('hidden');
      resetModal.classList.add('hidden');
    }
  });
} else {
  console.warn('Auth service not available, UI will load without authentication');
}

// Button Event Listeners
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

signupButton.addEventListener('click', () => {
  console.log('Signup button clicked');
  clearErrors();
  console.log('Reading signup form inputs');
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const confirmPassword = document.getElementById('signup-confirm-password').value;
  const currency = document.getElementById('signup-currency').value;
  const familyCodeInput = document.getElementById('signup-family-code').value;
  const accountType = document.getElementById('signup-account-type').value;

  console.log('Validating inputs:', { email, password, confirmPassword, currency, familyCodeInput, accountType });
  if (!email) showError('signup-email', 'Email is required');
  if (!password) showError('signup-password', 'Password is required');
  if (password !== confirmPassword) showError('signup-confirm-password', 'Passwords do not match');
  if (!familyCodeInput) showError('signup-family-code', 'Family code is required');

  if (email && password && password === confirmPassword && familyCodeInput && auth && db) {
    console.log('Attempting to create user');
    signupButton.disabled = true;
    signupButton.textContent = 'Signing up...';
    auth.createUserWithEmailAndPassword(email, password)
      .then(credential => {
        if (!credential || !credential.user) {
          throw new Error('No user credential returned');
        }
        console.log('User created:', credential.user.uid);
        console.log('Writing user data to Firestore');
        return db.collection('users').doc(credential.user.uid).set({
          currency,
          familyCode: familyCodeInput,
          accountType,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      })
      .then(() => {
        console.log('User data written to Firestore');
        signupButton.disabled = false;
        signupButton.textContent = 'Sign Up';
      })
      .catch(error => {
        console.error('Signup error:', error.code, error.message);
        signupButton.disabled = false;
        signupButton.textContent = 'Sign Up';
        showError('signup-email', error.message || 'Failed to sign up. Please check your network or configuration.');
      });
  } else {
    console.error('Auth or Firestore service not available or invalid inputs');
    showError('signup-email', auth && db ? 'Invalid input data' : 'Authentication or database service not available. Please check your network or configuration.');
  }
});

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
        loginModal.classList.remove('hidden');
        resetModal.classList.add('hidden');
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

logoutButton.addEventListener('click', () => {
  console.log('Logout button clicked');
  if (auth) {
    auth.signOut();
  } else {
    console.error('Auth service not available');
    showError('logout-button', 'Authentication service not available');
  }
});

// Load App Data
function loadAppData() {
  console.log('Loading app data');
  if (!currentUser || !familyCode || !db) {
    console.error('Cannot load app data: missing user, familyCode, or Firestore');
    return;
  }
  loadCategories();
  loadBudgets();
  loadTransactions();
  updateDashboard();
}

// Categories
function loadCategories() {
  console.log('Loading categories');
  if (!db) {
    console.error('Firestore not available');
    return;
  }
  categorySelect.innerHTML = '<option value="">Select Category</option><option value="add-new">Add New</option>';
  categoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
  db.collection('categories').where('familyCode', '==', familyCode).get()
    .then(snapshot => {
      snapshot.forEach(doc => {
        const category = doc.data();
        const option = document.createElement('option');
        option.value = doc.id;
        option.textContent = category.name;
        categorySelect.insertBefore(option, categorySelect.querySelector('option[value="add-new"]'));
        if (category.budgetId) {
          db.collection('budgets').doc(category.budgetId).get().then(budgetDoc => {
            if (budgetDoc.exists) {
              const budgetOption = document.createElement('option');
              budgetOption.value = budgetDoc.id;
              budgetOption.textContent = budgetDoc.data().name;
              categoryBudgetSelect.insertBefore(budgetOption, categoryBudgetSelect.querySelector('option[value="add-new"]'));
            }
          }).catch(error => {
            console.error('Error fetching budget for category:', error.code, error.message);
          });
        }
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
            }
          }).catch(error => {
            console.error('Error fetching budget for category table:', error.code, error.message);
          });
        }
      });
    })
    .catch(error => {
      console.error('Error loading categories:', error.code, error.message);
    });
}

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
      document.getElementById('category-name').value = '';
      document.getElementById('category-type').value = 'income';
      document.getElementById('category-budget').value = 'none';
      loadCategories();
    }).catch(error => {
      console.error('Error adding category:', error.code, error.message);
    });
  } else {
    console.error('Firestore or user not available');
    showError('category-name', db ? 'Invalid input data' : 'Database service not available');
  }
});

categorySelect.addEventListener('change', () => {
  console.log('Category select changed:', categorySelect.value);
  if (categorySelect.value === 'add-new') {
    addCategoryModal.classList.remove('hidden');
    categorySelect.value = '';
  }
});

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
      addCategoryModal.classList.add('hidden');
      document.getElementById('new-category-name').value = '';
      document.getElementById('new-category-type').value = 'income';
      document.getElementById('new-category-budget').value = 'none';
      loadCategories();
    }).catch(error => {
      console.error('Error saving category:', error.code, error.message);
    });
  } else {
    console.error('Firestore or user not available');
    showError('new-category-name', db ? 'Invalid input data' : 'Database service not available');
  }
});

cancelCategory.addEventListener('click', () => {
  console.log('Cancel Category clicked');
  addCategoryModal.classList.add('hidden');
  document.getElementById('new-category-name').value = '';
  document.getElementById('new-category-type').value = 'income';
  document.getElementById('new-category-budget').value = 'none';
});

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
                document.getElementById('category-name').value = '';
                document.getElementById('category-type').value = 'income';
                document.getElementById('category-budget').value = 'none';
                addCategory.innerHTML = 'Add Category';
                addCategory.onclick = null;
                loadCategories();
              }).catch(error => {
                console.error('Error updating category:', error.code, error.message);
              });
            }
          };
        }
      }).catch(error => {
        console.error('Error fetching category:', error.code, error.message);
      });
    }
  }
  if (e.target.classList.contains('delete-category')) {
    console.log('Delete Category clicked:', e.target.dataset.id);
    const id = e.target.dataset.id;
    if (db) {
      db.collection('categories').doc(id).delete().then(() => {
        loadCategories();
      }).catch(error => {
        console.error('Error deleting category:', error.code, error.message);
      });
    }
  }
});

// Budgets
function loadBudgets() {
  console.log('Loading budgets');
  if (!db) {
    console.error('Firestore not available');
    return;
  }
  budgetTable.innerHTML = '';
  budgetTiles.innerHTML = '';
  db.collection('budgets').where('familyCode', '==', familyCode).get()
    .then(snapshot => {
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
    });
}

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
      document.getElementById('budget-name').value = '';
      document.getElementById('budget-amount').value = '';
      loadBudgets();
      loadCategories();
    }).catch(error => {
      console.error('Error adding budget:', error.code, error.message);
    });
  } else {
    console.error('Firestore or user not available');
    showError('budget-name', db ? 'Invalid input data' : 'Database service not available');
  }
});

categoryBudgetSelect.addEventListener('change', () => {
  console.log('Category Budget select changed:', categoryBudgetSelect.value);
  if (categoryBudgetSelect.value === 'add-new') {
    addBudgetModal.classList.remove('hidden');
    categoryBudgetSelect.value = 'none';
  }
});

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
      addBudgetModal.classList.add('hidden');
      document.getElementById('new-budget-name').value = '';
      document.getElementById('new-budget-amount').value = '';
      loadBudgets();
      loadCategories();
    }).catch(error => {
      console.error('Error saving budget:', error.code, error.message);
    });
  } else {
    console.error('Firestore or user not available');
    showError('new-budget-name', db ? 'Invalid input data' : 'Database service not available');
  }
});

cancelBudget.addEventListener('click', () => {
  console.log('Cancel Budget clicked');
  addBudgetModal.classList.add('hidden');
  document.getElementById('new-budget-name').value = '';
  document.getElementById('new-budget-amount').value = '';
});

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
                document.getElementById('budget-name').value = '';
                document.getElementById('budget-amount').value = '';
                addBudget.innerHTML = 'Add Budget';
                addBudget.onclick = null;
                loadBudgets();
                loadCategories();
              }).catch(error => {
                console.error('Error updating budget:', error.code, error.message);
              });
            }
          };
        }
      }).catch(error => {
        console.error('Error fetching budget:', error.code, error.message);
      });
    }
  }
  if (e.target.classList.contains('delete-budget')) {
    console.log('Delete Budget clicked:', e.target.dataset.id);
    const id = e.target.dataset.id;
    if (db) {
      db.collection('budgets').doc(id).delete().then(() => {
        loadBudgets();
        loadCategories();
      }).catch(error => {
        console.error('Error deleting budget:', error.code, error.message);
      });
    }
  }
});

// Transactions
function loadTransactions() {
  console.log('Loading transactions');
  if (!db) {
    console.error('Firestore not available');
    return;
  }
  transactionTable.innerHTML = '';
  db.collection('transactions').where('familyCode', '==', familyCode).get()
    .then(snapshot => {
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
        transactionTable.appendChild(tr);
      }).catch(error => {
        console.error('Error fetching category for transaction:', error.code, error.message);
      });
    });
  })
  .catch(error => {
    console.error('Error loading transactions:', error.code, error.message);
  });
}

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
      document.getElementById('type').value = 'debit';
      document.getElementById('amount').value = '';
      document.getElementById('category').value = '';
      document.getElementById('description').value = '';
      loadTransactions();
      updateDashboard();
    }).catch(error => {
      console.error('Error adding transaction:', error.code, error.message);
    });
  } else {
    console.error('Firestore or user not available');
    showError('category', db ? 'Invalid input data' : 'Database service not available');
  }
});

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
              });
            }
          };
        }
      }).catch(error => {
        console.error('Error fetching transaction:', error.code, error.message);
      });
    }
  }
  if (e.target.classList.contains('delete-transaction')) {
    console.log('Delete Transaction clicked:', e.target.dataset.id);
    const id = e.target.dataset.id;
    if (db) {
      db.collection('transactions').doc(id).delete().then(() => {
        loadTransactions();
        updateDashboard();
      }).catch(error => {
        console.error('Error deleting transaction:', error.code, error.message);
      });
    }
  }
});

// Dashboard Updates
function updateDashboard() {
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
    });
}
