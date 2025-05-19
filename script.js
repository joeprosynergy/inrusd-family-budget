// Firebase Configuration (Replace with your Firebase project config)
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// DOM Elements
const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const loginButton = document.getElementById('login-button');
const signupButton = document.getElementById('signup-button');
const resetButton = document.getElementById('reset-button');
const logoutButton = document.getElementById('logout-button');
const loginModal = document.getElementById('login-modal');
const signupModal = document.getElementById('signup-modal');
const resetModal = document.getElementById('reset-modal');
const showSignup = document.getElementById('show-signup');
const showReset = document.getElementById('show-reset');
const showLoginFromSignup = document.getElementById('show-login-from-signup');
const showLoginFromReset = document.getElementById('show-login-from-reset');

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

// Utility Functions
function formatCurrency(amount, currency) {
  if (currency === 'USD') {
    return `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function showError(elementId, message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'text-red-600 text-sm mt-1';
  errorDiv.textContent = message;
  document.getElementById(elementId).parentElement.appendChild(errorDiv);
  setTimeout(() => errorDiv.remove(), 3000);
}

function clearErrors() {
  document.querySelectorAll('.text-red-600').forEach(el => el.remove());
}

// Authentication
auth.onAuthStateChanged(user => {
  if (user) {
    currentUser = user;
    authSection.classList.add('hidden');
    appSection.classList.remove('hidden');
    // Fetch user metadata
    db.collection('users').doc(user.uid).get().then(doc => {
      if (doc.exists) {
        userCurrency = doc.data().currency || 'INR';
        loadAppData();
      }
    });
  } else {
    currentUser = null;
    authSection.classList.remove('hidden');
    appSection.classList.add('hidden');
    loginModal.classList.remove('hidden');
    signupModal.classList.add('hidden');
    resetModal.classList.add('hidden');
  }
});

loginButton.addEventListener('click', () => {
  clearErrors();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  if (!email) showError('login-email', 'Email is required');
  if (!password) showError('login-password', 'Password is required');
  if (email && password) {
    auth.signInWithEmailAndPassword(email, password).catch(error => {
      showError('login-password', error.message);
    });
  }
});

signupButton.addEventListener('click', () => {
  clearErrors();
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const confirmPassword = document.getElementById('signup-confirm-password').value;
  const currency = document.getElementById('signup-currency').value;
  const familyCode = document.getElementById('signup-family-code').value;
  const accountType = document.getElementById('signup-account-type').value;
  if (!email) showError('signup-email', 'Email is required');
  if (!password) showError('signup-password', 'Password is required');
  if (password !== confirmPassword) showError('signup-confirm-password', 'Passwords do not match');
  if (!familyCode) showError('signup-family-code', 'Family code is required');
  if (email && password && password === confirmPassword && familyCode) {
    auth.createUserWithEmailAndPassword(email, password).then(credential => {
      return db.collection('users').doc(credential.user.uid).set({
        currency,
        familyCode,
        accountType,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }).catch(error => {
      showError('signup-email', error.message);
    });
  }
});

resetButton.addEventListener('click', () => {
  clearErrors();
  const email = document.getElementById('reset-email').value;
  if (!email) showError('reset-email', 'Email is required');
  if (email) {
    auth.sendPasswordResetEmail(email).then(() => {
      alert('Password reset email sent');
      loginModal.classList.remove('hidden');
      resetModal.classList.add('hidden');
    }).catch(error => {
      showError('reset-email', error.message);
    });
  }
});

logoutButton.addEventListener('click', () => {
  auth.signOut();
});

// Load App Data
function loadAppData() {
  if (!currentUser) return;
  const familyCodeRef = db.collection('users').doc(currentUser.uid);
  familyCodeRef.get().then(doc => {
    if (doc.exists) {
      const familyCode = doc.data().familyCode;
      loadCategories(familyCode);
      loadBudgets(familyCode);
      loadTransactions(familyCode);
      updateDashboard(familyCode);
    }
  });
}

// Categories
function loadCategories(familyCode) {
  categorySelect.innerHTML = '<option value="add-new">Add New</option>';
  categoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
  db.collection('categories').where('familyCode', '==', familyCode).get().then(snapshot => {
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
        });
      }
    });
    // Load category table
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
        });
      }
    });
  });
}

addCategory.addEventListener('click', () => {
  clearErrors();
  const name = document.getElementById('category-name').value.trim();
  const type = document.getElementById('category-type').value;
  const budgetId = document.getElementById('category-budget').value === 'none' ? null : document.getElementById('category-budget').value;
  if (!name) showError('category-name', 'Name is required');
  if (name && currentUser) {
    db.collection('users').doc(currentUser.uid).get().then(doc => {
      if (doc.exists) {
        db.collection('categories').add({
          name,
          type,
          budgetId,
          familyCode: doc.data().familyCode,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
          document.getElementById('category-name').value = '';
          document.getElementById('category-type').value = 'income';
          document.getElementById('category-budget').value = 'none';
          loadCategories(doc.data().familyCode);
        });
      }
    });
  }
});

categorySelect.addEventListener('change', () => {
  if (categorySelect.value === 'add-new') {
    addCategoryModal.classList.remove('hidden');
    categorySelect.value = '';
  }
});

saveCategory.addEventListener('click', () => {
  clearErrors();
  const name = document.getElementById('new-category-name').value.trim();
  const type = document.getElementById('new-category-type').value;
  const budgetId = document.getElementById('new-category-budget').value === 'none' ? null : document.getElementById('new-category-budget').value;
  if (!name) showError('new-category-name', 'Name is required');
  if (name && currentUser) {
    db.collection('users').doc(currentUser.uid).get().then(doc => {
      if (doc.exists) {
        db.collection('categories').add({
          name,
          type,
          budgetId,
          familyCode: doc.data().familyCode,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
          addCategoryModal.classList.add('hidden');
          document.getElementById('new-category-name').value = '';
          document.getElementById('new-category-type').value = 'income';
          document.getElementById('new-category-budget').value = 'none';
          loadCategories(doc.data().familyCode);
        });
      }
    });
  }
});

cancelCategory.addEventListener('click', () => {
  addCategoryModal.classList.add('hidden');
  document.getElementById('new-category-name').value = '';
  document.getElementById('new-category-type').value = 'income';
  document.getElementById('new-category-budget').value = 'none';
});

categoryTable.addEventListener('click', e => {
  if (e.target.classList.contains('edit-category')) {
    const id = e.target.dataset.id;
    db.collection('categories').doc(id).get().then(doc => {
      if (doc.exists) {
        document.getElementById('category-name').value = doc.data().name;
        document.getElementById('category-type').value = doc.data().type;
        document.getElementById('category-budget').value = doc.data().budgetId || 'none';
        addCategory.innerHTML = 'Update Category';
        addCategory.onclick = () => {
          db.collection('categories').doc(id).update({
            name: document.getElementById('category-name').value.trim(),
            type: document.getElementById('category-type').value,
            budgetId: document.getElementById('category-budget').value === 'none' ? null : document.getElementById('category-budget').value
          }).then(() => {
            document.getElementById('category-name').value = '';
            document.getElementById('category-type').value = 'income';
            document.getElementById('category-budget').value = 'none';
            addCategory.innerHTML = 'Add Category';
            addCategory.onclick = null;
            db.collection('users').doc(currentUser.uid).get().then(doc => {
              loadCategories(doc.data().familyCode);
            });
          });
        };
      }
    });
  }
  if (e.target.classList.contains('delete-category')) {
    const id = e.target.dataset.id;
    db.collection('categories').doc(id).delete().then(() => {
      db.collection('users').doc(currentUser.uid).get().then(doc => {
        loadCategories(doc.data().familyCode);
      });
    });
  }
});

// Budgets
function loadBudgets(familyCode) {
  budgetTable.innerHTML = '';
  budgetTiles.innerHTML = '';
  db.collection('budgets').where('familyCode', '==', familyCode).get().then(snapshot => {
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
  });
}

addBudget.addEventListener('click', () => {
  clearErrors();
  const name = document.getElementById('budget-name').value.trim();
  const amount = parseFloat(document.getElementById('budget-amount').value);
  if (!name) showError('budget-name', 'Name is required');
  if (!amount || amount <= 0) showError('budget-amount', 'Valid amount is required');
  if (name && amount > 0 && currentUser) {
    db.collection('users').doc(currentUser.uid).get().then(doc => {
      if (doc.exists) {
        db.collection('budgets').add({
          name,
          amount,
          spent: 0,
          familyCode: doc.data().familyCode,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
          document.getElementById('budget-name').value = '';
          document.getElementById('budget-amount').value = '';
          loadBudgets(doc.data().familyCode);
          loadCategories(doc.data().familyCode); // Update category budget dropdown
        });
      }
    });
  }
});

categoryBudgetSelect.addEventListener('change', () => {
  if (categoryBudgetSelect.value === 'add-new') {
    addBudgetModal.classList.remove('hidden');
    categoryBudgetSelect.value = 'none';
  }
});

saveBudget.addEventListener('click', () => {
  clearErrors();
  const name = document.getElementById('new-budget-name').value.trim();
  const amount = parseFloat(document.getElementById('new-budget-amount').value);
  if (!name) showError('new-budget-name', 'Name is required');
  if (!amount || amount <= 0) showError('new-budget-amount', 'Valid amount is required');
  if (name && amount > 0 && currentUser) {
    db.collection('users').doc(currentUser.uid).get().then(doc => {
      if (doc.exists) {
        db.collection('budgets').add({
          name,
          amount,
          spent: 0,
          familyCode: doc.data().familyCode,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
          addBudgetModal.classList.add('hidden');
          document.getElementById('new-budget-name').value = '';
          document.getElementById('new-budget-amount').value = '';
          loadBudgets(doc.data().familyCode);
          loadCategories(doc.data().familyCode);
        });
      }
    });
  }
});

cancelBudget.addEventListener('click', () => {
  addBudgetModal.classList.add('hidden');
  document.getElementById('new-budget-name').value = '';
  document.getElementById('new-budget-amount').value = '';
});

budgetTable.addEventListener('click', e => {
  if (e.target.classList.contains('edit-budget')) {
    const id = e.target.dataset.id;
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
              db.collection('users').doc(currentUser.uid).get().then(doc => {
                loadBudgets(doc.data().familyCode);
                loadCategories(doc.data().familyCode);
              });
            });
          }
        };
      }
    });
  }
  if (e.target.classList.contains('delete-budget')) {
    const id = e.target.dataset.id;
    db.collection('budgets').doc(id).delete().then(() => {
      db.collection('users').doc(currentUser.uid).get().then(doc => {
        loadBudgets(doc.data().familyCode);
        loadCategories(doc.data().familyCode);
      });
    });
  }
});

// Transactions
function loadTransactions(familyCode) {
  transactionTable.innerHTML = '';
  db.collection('transactions').where('familyCode', '==', familyCode).get().then(snapshot => {
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
      });
    });
  });
}

addTransaction.addEventListener('click', () => {
  clearErrors();
  const type = document.getElementById('type').value;
  const amount = parseFloat(document.getElementById('amount').value);
  const categoryId = document.getElementById('category').value;
  const description = document.getElementById('description').value.trim();
  if (!amount || amount <= 0) showError('amount', 'Valid amount is required');
  if (!categoryId) showError('category', 'Category is required');
  if (amount > 0 && categoryId && currentUser) {
    db.collection('users').doc(currentUser.uid).get().then(doc => {
      if (doc.exists) {
        db.collection('transactions').add({
          type,
          amount,
          categoryId,
          description,
          familyCode: doc.data().familyCode,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
          document.getElementById('type').value = 'debit';
          document.getElementById('amount').value = '';
          document.getElementById('category').value = '';
          document.getElementById('description').value = '';
          loadTransactions(doc.data().familyCode);
          updateDashboard(doc.data().familyCode);
        });
      }
    });
  }
});

transactionTable.addEventListener('click', e => {
  if (e.target.classList.contains('edit-transaction')) {
    const id = e.target.dataset.id;
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
              db.collection('users').doc(currentUser.uid).get().then(doc => {
                loadTransactions(doc.data().familyCode);
                updateDashboard(doc.data().familyCode);
              });
            });
          }
        };
      }
    });
  }
  if (e.target.classList.contains('delete-transaction')) {
    const id = e.target.dataset.id;
    db.collection('transactions').doc(id).delete().then(() => {
      db.collection('users').doc(currentUser.uid).get().then(doc => {
        loadTransactions(doc.data().familyCode);
        updateDashboard(doc.data().familyCode);
      });
    });
  }
});

// Dashboard Updates
function updateDashboard(familyCode) {
  let totalBalance = 0;
  db.collection('transactions').where('familyCode', '==', familyCode).get().then(snapshot => {
    snapshot.forEach(doc => {
      const transaction = doc.data();
      if (transaction.type === 'credit') {
        totalBalance += transaction.amount;
      } else {
        totalBalance -= transaction.amount;
      }
    });
    balance.textContent = formatCurrency(totalBalance, userCurrency);
  });
  // Budget updates handled in loadBudgets
}
