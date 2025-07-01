import {
  auth,
  db,
  currentUser,
  userCurrency,
  familyCode,
  domElements,
  exchangeRateCache,
  formatCurrency,
  showError,
  clearErrors,
  setUserCurrency,
  setFamilyCode
} from './core.js';
import { signOut } from 'firebase/auth';
import { retryFirestoreOperation, fetchExchangeRate, getDateRange, resetBudgetsForNewMonth, fetchCachedTransactions, clearTransactionCache } from './utils.js';
import { collection, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp, increment } from 'firebase/firestore';

// State management
const state = {
  isEditing: { transaction: false, budget: false, category: false, profile: false, childTransaction: false },
  currentChildUserId: null,
  currentAccountType: null,
  loadedTabs: { budgets: false, transactions: false, childAccounts: false }
};

// Utility to get date range
const getDateRangeWrapper = (filter) => getDateRange(filter, domElements.filterStartDate, domElements.filterEndDate);

// Load app data
async function loadAppData() {
  console.log('loadAppData: Starting');
  if (!currentUser || !familyCode || !db) {
    console.error('loadAppData: Missing dependencies');
    showError('page-title', 'Failed to load app data.');
    return;
  }

  try {
    // Fetch exchange rates in parallel
    const [inrUsdRate, inrZarRate, usdZarRate] = await Promise.all([
      fetchExchangeRate('INR', 'USD', exchangeRateCache.get('INR_USD')),
      fetchExchangeRate('INR', 'ZAR', exchangeRateCache.get('INR_ZAR')),
      fetchExchangeRate('USD', 'ZAR', exchangeRateCache.get('USD_ZAR'))
    ]);

    // Update cache
    exchangeRateCache.set('INR_USD', { rate: inrUsdRate, timestamp: Date.now() });
    exchangeRateCache.set('INR_ZAR', { rate: inrZarRate, timestamp: Date.now() });
    exchangeRateCache.set('USD_ZAR', { rate: usdZarRate, timestamp: Date.now() });

    if (domElements.currencyToggle) {
      domElements.currencyToggle.value = userCurrency;
    }

    await Promise.all([
      loadProfileData(),
      loadCategories(),
      updateDashboard()
    ]);
  } catch (error) {
    console.error('loadAppData error:', error);
    showError('page-title', 'Failed to load app data.');
  }
}

// Tab management
function setupTabs() {
  const tabs = [
    { id: 'dashboard', name: 'Budget Dashboard', section: domElements.dashboardSection, show: () => updateDashboard() },
    { id: 'transactions', name: 'Transactions', section: domElements.transactionsSection, show: async () => {
      if (!state.loadedTabs.transactions) {
        await loadTransactions();
        state.loadedTabs.transactions = true;
      }
    }},
    { id: 'budgets', name: 'Budgets', section: domElements.budgetsSection, show: async () => {
      if (!state.loadedTabs.budgets) {
        await loadBudgets();
        state.loadedTabs.budgets = true;
      }
    }},
    { id: 'categories', name: 'Categories', section: domElements.categoriesSection, show: () => {} },
    { id: 'child-accounts', name: 'Child Accounts', section: domElements.childAccountsSection, show: async () => {
      if (!state.loadedTabs.childAccounts) {
        await loadChildAccounts();
        state.loadedTabs.childAccounts = true;
      }
    }},
    { id: 'profile', name: 'User Profile', section: domElements.profileSection, show: loadProfileData }
  ];

  let currentTabIndex = 0;

  const switchTab = (tabId) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Update UI
    tabs.forEach(t => {
      const isActive = t.id === tabId;
      const tabElement = domElements[`${t.id.replace('-', '')}Tab`];
      if (tabElement) {
        tabElement.classList.toggle('bg-blue-800', isActive);
      }
      if (t.section) {
        t.section.classList.toggle('hidden', !isActive);
      }
    });

    const pageTitle = domElements.pageTitle;
    if (pageTitle) {
      pageTitle.textContent = tab.name;
    }

    // Update mobile menu
    const currentTabName = document.getElementById('current-tab-name');
    if (currentTabName) {
      currentTabName.textContent = tab.name;
    }
    if (window.matchMedia('(max-width: 768px)').matches) {
      const menuItems = document.getElementById('menu-items');
      const menuToggle = document.getElementById('menu-toggle');
      if (menuItems && menuToggle) {
        menuItems.classList.add('hidden');
        menuToggle.setAttribute('aria-expanded', 'false');
      }
    }

    tab.show();
    currentTabIndex = tabs.findIndex(t => t.id === tabId);
  };

  // Setup event listeners
  tabs.forEach(tab => {
    const tabElement = domElements[`${tab.id.replace('-', '')}Tab`];
    if (tabElement) {
      tabElement.addEventListener('click', () => switchTab(tab.id));
    }
  });

  // Mobile menu toggle
  const menuToggle = document.getElementById('menu-toggle');
  const menuItems = document.getElementById('menu-items');
  if (menuToggle && menuItems) {
    menuToggle.addEventListener('click', () => {
      const isExpanded = !menuItems.classList.contains('hidden');
      menuItems.classList.toggle('hidden');
      menuToggle.setAttribute('aria-expanded', !isExpanded);
    });
  }

  // Swipe detection
  const swipeContainer = document.getElementById('swipeable-tabs');
  if (swipeContainer && window.matchMedia('(max-width: 768px)').matches) {
    let touchStartX = 0;
    const minSwipeDistance = 50;

    swipeContainer.addEventListener('touchstart', (e) => {
      if (e.target.closest('.no-swipe')) return;
      touchStartX = e.touches[0].clientX;
    });

    swipeContainer.addEventListener('touchend', (e) => {
      if (e.target.closest('.no-swipe')) return;
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(deltaX) < minSwipeDistance || Math.abs(e.changedTouches[0].clientY - e.touches[0].clientY) > 50) return;

      if (deltaX < 0 && currentTabIndex < tabs.length - 1) {
        switchTab(tabs[currentTabIndex + 1].id);
      } else if (deltaX > 0 && currentTabIndex > 0) {
        switchTab(tabs[currentTabIndex - 1].id);
      }
    });
  }

  switchTab('dashboard');
}

// Profile management
async function setupProfile() {
  const toggleEditMode = (enable) => {
    state.isEditing.profile = enable;
    ['profileEmail', 'profileCurrency', 'profileAccountType'].forEach(id => {
      const el = domElements[id];
      if (el) {
        if (enable) {
          el.removeAttribute(id.includes('Email') ? 'readonly' : 'disabled');
          el.classList.remove('bg-gray-100');
        } else {
          el.setAttribute(id.includes('Email') ? 'readonly' : 'disabled', 'true');
          el.classList.add('bg-gray-100');
        }
      }
    });
    const profileFamilyCode = domElements.profileFamilyCode;
    if (profileFamilyCode) {
      profileFamilyCode.setAttribute('readonly', 'true');
      profileFamilyCode.classList.add('bg-gray-100');
    }
    if (domElements.editProfile) {
      domElements.editProfile.classList.toggle('hidden', enable);
    }
    if (domElements.saveProfile) {
      domElements.saveProfile.classList.toggle('hidden', !enable);
    }
  };

  if (domElements.editProfile) {
    domElements.editProfile.addEventListener('click', () => toggleEditMode(true));
  }

  if (domElements.saveProfile) {
    domElements.saveProfile.addEventListener('click', async () => {
      clearErrors();
      const email = domElements.profileEmail?.value.trim();
      const currency = domElements.profileCurrency?.value;
      const accountType = domElements.profileAccountType?.value;

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError('profile-email', 'Valid email is required');
        return;
      }
      if (!currency || !['INR', 'USD', 'ZAR'].includes(currency)) {
        showError('profile-currency', 'Valid currency is required');
        return;
      }
      if (!accountType || !['admin', 'child'].includes(accountType)) {
        showError('profile-account-type', 'Valid account type is required');
        return;
      }

      try {
        domElements.saveProfile.disabled = true;
        domElements.saveProfile.textContent = 'Saving...';
        
        if (email !== currentUser.email) await auth.currentUser.updateEmail(email);
        await retryFirestoreOperation(() => 
          updateDoc(doc(db, 'users', currentUser.uid), { currency, accountType })
        );

        setUserCurrency(currency);
        toggleEditMode(false);
        if (domElements.currencyToggle) {
          domElements.currencyToggle.value = currency;
        }
        await Promise.all([loadBudgets(), loadTransactions(), loadChildAccounts(), updateDashboard()]);
      } catch (error) {
        const errorMessages = {
          'auth/email-already-in-use': 'This email is already in use.',
          'auth/invalid-email': 'Invalid email format.',
          'auth/requires-recent-login': 'Please log out and log in again to update email.'
        };
        showError('profile-email', errorMessages[error.code] || 'Failed to save profile.');
      } finally {
        domElements.saveProfile.disabled = false;
        domElements.saveProfile.textContent = 'Save Profile';
      }
    });
  }

  if (domElements.currencyToggle) {
    domElements.currencyToggle.addEventListener('change', async () => {
      const newCurrency = domElements.currencyToggle.value;
      if (!['INR', 'USD', 'ZAR'].includes(newCurrency)) {
        showError('currency-toggle', 'Invalid currency selected.');
        return;
      }

      try {
        await retryFirestoreOperation(() => 
          updateDoc(doc(db, 'users', currentUser.uid), { currency: newCurrency })
        );
        setUserCurrency(newCurrency);
        if (domElements.profileCurrency) {
          domElements.profileCurrency.value = newCurrency;
        }
        await Promise.all([loadBudgets(), loadTransactions(), loadChildAccounts(), updateDashboard()]);
      } catch (error) {
        showError('currency-toggle', 'Failed to update currency.');
      }
    });
  }

  if (domElements.dashboardFilter) {
    domElements.dashboardFilter.addEventListener('change', () => {
      if (domElements.customDateRange) {
        domElements.customDateRange.classList.toggle('hidden', domElements.dashboardFilter.value !== 'custom');
      }
      updateDashboard();
    });
  }
}

async function loadProfileData() {
  if (!currentUser || !db) {
    showError('profile-email', 'Failed to load profile data.');
    return;
  }

  try {
    domElements.profileEmail.value = currentUser.email || '--';
    domElements.profileCurrency.value = userCurrency || 'INR';
    domElements.profileFamilyCode.value = familyCode || '--';
    domElements.profileAccountType.value = '--';

    const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'users', currentUser.uid)));
    if (docSnap.exists()) {
      const data = docSnap.data();
      domElements.profileCurrency.value = data.currency || 'INR';
      domElements.profileFamilyCode.value = data.familyCode || '--';
      domElements.profileAccountType.value = data.accountType || '--';
      state.currentAccountType = data.accountType || '--';
    } else {
      showError('profile-email', 'Profile data not found.');
    }
  } catch (error) {
    showError('profile-email', 'Failed to load profile data.');
  }
}

// Categories
async function loadCategories() {
  const elements = {
    categorySelect: document.getElementById('category'),
    categoryBudgetSelect: document.getElementById('category-budget-select'),
    newCategoryBudgetSelect: document.getElementById('new-category-budget'),
    categoryTable: document.getElementById('category-table')
  };

  if (Object.values(elements).some(el => !el) || !db || !familyCode) {
    showError('category-name', 'Required components not available');
    if (elements.categoryTable) {
      elements.categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-600">Error loading categories</td></tr>';
    }
    return;
  }

  try {
    // Initialize DOM
    elements.categorySelect.innerHTML = '<option value="">Select Category</option><option value="add-new">Add New</option>';
    elements.categoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
    elements.newCategoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
    elements.categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">Loading...</td></tr>';

    // Fetch budgets
    const budgetsQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
    const budgetsSnapshot = await retryFirestoreOperation(() => getDocs(budgetsQuery));
    const budgetMap = new Map();
    budgetsSnapshot.forEach(doc => {
      budgetMap.set(doc.id, doc.data().name);
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = doc.data().name;
      elements.categoryBudgetSelect.insertBefore(option, elements.categoryBudgetSelect.lastChild);
      elements.newCategoryBudgetSelect.insertBefore(option.cloneNode(true), elements.newCategoryBudgetSelect.lastChild);
    });

    // Fetch categories
    const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
    const categoriesSnapshot = await retryFirestoreOperation(() => getDocs(categoriesQuery));

    elements.categoryTable.innerHTML = '';
    if (categoriesSnapshot.empty) {
      elements.categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">No categories found</td></tr>';
      return;
    }

    // Update category select
    categoriesSnapshot.forEach(doc => {
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = doc.data().name;
      elements.categorySelect.insertBefore(option, elements.categorySelect.lastChild);
    });

    // Update category table
    const fragment = document.createDocumentFragment();
    categoriesSnapshot.forEach(doc => {
      const category = doc.data();
      const tr = document.createElement('tr');
      tr.classList.add('table-row');
      tr.innerHTML = `
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${category.name || 'Unknown'}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${category.type || 'Unknown'}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${category.budgetId ? budgetMap.get(category.budgetId) || 'Unknown' : 'None'}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm">
          <button class="text-blue-600 hover:text-blue-800 mr-2 edit-category" data-id="${doc.id}">Edit</button>
          <button class="text-red-600 hover:text-red-800 delete-category" data-id="${doc.id}">Delete</button>
        </td>
      `;
      fragment.appendChild(tr);
    });
    elements.categoryTable.appendChild(fragment);
  } catch (error) {
    showError('category-name', `Failed to load categories: ${error.message}`);
    if (elements.categoryTable) {
      elements.categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-600">Error loading categories</td></tr>';
    }
  }
}

async function setupCategories() {
  const elements = {
    addCategory: document.getElementById('add-category'),
    categorySelect: document.getElementById('category'),
    saveCategory: document.getElementById('save-category'),
    cancelCategory: document.getElementById('cancel-category'),
    categoryTable: document.getElementById('category-table')
  };

  if (Object.values(elements).some(el => !el)) {
    showError('category-name', 'Category form or table not found');
    return;
  }

  const handleCategoryAdd = async (nameInput, typeSelect, budgetSelect, isModal = false) => {
    clearErrors();
    const name = nameInput.value.trim();
    const type = typeSelect.value;
    const budgetId = budgetSelect.value === 'none' ? null : budgetSelect.value;

    if (!name) return showError(isModal ? 'new-category-name' : 'category-name', 'Name is required');
    if (!type) return showError(isModal ? 'new-category-type' : 'category-type', 'Type is required');
    if (!currentUser || !db) return showError(isModal ? 'new-category-name' : 'category-name', 'Database service not available');

    try {
      elements.addCategory.disabled = true;
      elements.addCategory.textContent = isModal ? 'Saving...' : 'Adding...';
      await retryFirestoreOperation(() => 
        addDoc(collection(db, 'categories'), {
          name,
          type,
          budgetId,
          familyCode,
          createdAt: serverTimestamp()
        })
      );
      nameInput.value = '';
      typeSelect.value = 'income';
      budgetSelect.value = 'none';
      if (isModal && domElements.addCategoryModal) {
        domElements.addCategoryModal.classList.add('hidden');
      }
      await loadCategories();
    } catch (error) {
      showError(isModal ? 'new-category-name' : 'category-name', `Failed to add category: ${error.message}`);
    } finally {
      elements.addCategory.disabled = false;
      elements.addCategory.textContent = isModal ? 'Save' : 'Add Category';
    }
  };

  elements.addCategory.addEventListener('click', async () => {
    if (state.isEditing.category) return;
    const inputs = {
      name: document.getElementById('category-name'),
      type: document.getElementById('category-type'),
      budget: document.getElementById('category-budget-select')
    };
    if (Object.values(inputs).some(el => !el)) {
      showError('category-name', 'Form elements not found');
      return;
    }
    await handleCategoryAdd(inputs.name, inputs.type, inputs.budget);
  });

  elements.categorySelect.addEventListener('change', () => {
    if (elements.categorySelect.value === 'add-new') {
      if (domElements.addCategoryModal) {
        domElements.addCategoryModal.classList.remove('hidden');
      }
      elements.categorySelect.value = '';
    }
  });

  elements.saveCategory.addEventListener('click', async () => {
    const inputs = {
      name: document.getElementById('new-category-name'),
      type: document.getElementById('new-category-type'),
      budget: document.getElementById('new-category-budget')
    };
    if (Object.values(inputs).some(el => !el)) {
      showError('new-category-name', 'Modal form elements not found');
      return;
    }
    await handleCategoryAdd(inputs.name, inputs.type, inputs.budget, true);
  });

  elements.cancelCategory.addEventListener('click', () => {
    if (domElements.addCategoryModal) {
      domElements.addCategoryModal.classList.add('hidden');
    }
    ['new-category-name', 'new-category-type', 'new-category-budget'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = id.includes('type') ? 'income' : id.includes('budget') ? 'none' : '';
    });
  });

  elements.categoryTable.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-category')) {
      const id = e.target.dataset.id;
      try {
        const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', id)));
        if (docSnap.exists()) {
          const data = docSnap.data();
          const inputs = {
            name: document.getElementById('category-name'),
            type: document.getElementById('category-type'),
            budget: document.getElementById('category-budget-select')
          };
          if (Object.values(inputs).some(el => !el)) {
            showError('category-name', 'Form elements not found');
            return;
          }
          inputs.name.value = data.name || '';
          inputs.type.value = data.type || 'income';
          inputs.budget.value = data.budgetId || 'none';
          elements.addCategory.innerHTML = 'Update Category';
          state.isEditing.category = true;

          const updateHandler = async () => {
            const name = inputs.name.value.trim();
            const type = inputs.type.value;
            const budgetId = inputs.budget.value === 'none' ? null : inputs.budget.value;
            if (!name) return showError('category-name', 'Name is required');
            if (!type) return showError('category-type', 'Type is required');

            try {
              elements.addCategory.disabled = true;
              elements.addCategory.textContent = 'Updating...';
              await retryFirestoreOperation(() => 
                updateDoc(doc(db, 'categories', id), { name, type, budgetId })
              );
              Object.values(inputs).forEach(el => el.value = el.id.includes('type') ? 'income' : el.id.includes('budget') ? 'none' : '');
              elements.addCategory.innerHTML = 'Add Category';
              state.isEditing.category = false;
              await loadCategories();
            } catch (error) {
              showError('category-name', `Failed to update category: ${error.message}`);
            } finally {
              elements.addCategory.disabled = false;
              elements.addCategory.textContent = 'Add Category';
              state.isEditing.category = false;
            }
          };
          elements.addCategory.removeEventListener('click', elements.addCategory._updateHandler);
          elements.addCategory._updateHandler = updateHandler;
          elements.addCategory.addEventListener('click', updateHandler, { once: true });
        } else {
          showError('category-name', 'Category not found');
        }
      } catch (error) {
        showError('category-name', `Failed to fetch category: ${error.message}`);
      }
    } else if (e.target.classList.contains('delete-category')) {
      const id = e.target.dataset.id;
      if (!domElements.deleteConfirmModal) return showError('category-name', 'Cannot delete: Missing components');

      domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this category?';
      domElements.deleteConfirmModal.classList.remove('hidden');
      const confirmHandler = async () => {
        try {
          await retryFirestoreOperation(() => deleteDoc(doc(db, 'categories', id)));
          await loadCategories();
          domElements.deleteConfirmModal.classList.add('hidden');
        } catch (error) {
          showError('category-name', `Failed to delete category: ${error.message}`);
        }
        domElements.confirmDelete.removeEventListener('click', confirmHandler);
      };
      const cancelHandler = () => {
        domElements.deleteConfirmModal.classList.add('hidden');
        domElements.cancelDelete.removeEventListener('click', cancelHandler);
      };
      domElements.confirmDelete.addEventListener('click', confirmHandler, { once: true });
      domElements.cancelDelete.addEventListener('click', cancelHandler, { once: true });
    }
  });
}

// Budgets
async function loadBudgets() {
  if (!db) {
    showError('budget-name', 'Database service not available');
    return;
  }

  if (state.currentAccountType === 'admin') {
    try {
      await resetBudgetsForNewMonth(db, familyCode, state.currentAccountType);
    } catch (error) {
      console.error('loadBudgets: Budget reset failed', error);
    }
  }

  const elements = {
    budgetTable: document.getElementById('budget-table'),
    budgetTiles: document.getElementById('budget-tiles')
  };

  if (!elements.budgetTable || !elements.budgetTiles) {
    showError('budget-name', 'Budget table or tiles not found');
    return;
  }

  try {
    elements.budgetTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading...</td></tr>';
    elements.budgetTiles.innerHTML = '<div class="text-center py-4">Loading...</div>';

    const filter = domElements.dashboardFilter?.value || 'thisMonth';
    let { start, end } = getDateRangeWrapper(filter);
    start = new Date(start.getTime() - 5.5 * 60 * 60 * 1000);

    const transactions = await fetchCachedTransactions(db, familyCode, start, end);
    const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
    const categoriesSnapshot = await retryFirestoreOperation(() => getDocs(categoriesQuery));
    const budgetToCategories = new Map();
    categoriesSnapshot.forEach(doc => {
      if (doc.data().budgetId) {
        budgetToCategories.set(doc.data().budgetId, [...(budgetToCategories.get(doc.data().budgetId) || []), doc.id]);
      }
    });

    let totalBudgetAmount = 0, totalRemainingAmount = 0;
    const budgetsQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
    const snapshot = await retryFirestoreOperation(() => getDocs(budgetsQuery));

    elements.budgetTable.innerHTML = '';
    elements.budgetTiles.innerHTML = '';
    if (snapshot.empty) {
      elements.budgetTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">No budgets found</td></tr>';
      elements.budgetTiles.innerHTML = '<div class="text-center py-4">No budgets found</div>';
      return;
    }

    const tableFragment = document.createDocumentFragment();
    const tilesFragment = document.createDocumentFragment();
    for (const doc of snapshot.docs) {
      const budget = doc.data();
      const categoryIds = budgetToCategories.get(doc.id) || [];
      const spent = categoryIds.length > 0 ? transactions.reduce((sum, tx) => 
        categoryIds.includes(tx.categoryId) ? sum + (tx.type === 'debit' ? tx.amount : -tx.amount) : sum, 0) : 0;

      totalBudgetAmount += budget.amount;
      totalRemainingAmount += budget.amount - spent;

      const tr = document.createElement('tr');
      tr.classList.add('table-row');
      tr.innerHTML = `
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${budget.name}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${await formatCurrency(budget.amount, 'INR')}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${await formatCurrency(spent, 'INR')}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${await formatCurrency(budget.amount - spent, 'INR')}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm">
          <button class="text-blue-600 hover:text-blue-800 mr-2 edit-budget" data-id="${doc.id}">Edit</button>
          <button class="text-red-600 hover:text-red-800 delete-budget" data-id="${doc.id}">Delete</button>
        </td>
      `;
      tableFragment.appendChild(tr);

      const tile = document.createElement('div');
      tile.classList.add('bg-white', 'rounded-lg', 'shadow-md', 'p-6', 'budget-tile');
      const percentage = budget.amount ? (spent / budget.amount) * 100 : 0;
      tile.innerHTML = `
        <h3 class="text-lg font-semibold text-gray-700">${budget.name}</h3>
        <p class="text-sm text-gray-500">Budget: <span id="${doc.id}-budget">${await formatCurrency(budget.amount, 'INR')}</span></p>
        <p class="text-sm text-gray-500">Spent: <span id="${doc.id}-spent">${await formatCurrency(spent, 'INR')}</span></p>
        <p class="text-sm font-semibold text-gray-700 mt-2">
          Remaining: <span id="${doc.id}-remaining">${await formatCurrency(budget.amount - spent, 'INR')}</span>
        </p>
        <div class="w-full bg-gray-200 rounded-full mt-4 progress-bar">
          <div class="bg-green-600 progress-bar" style="width: ${percentage}%"></div>
        </div>
      `;
      tilesFragment.appendChild(tile);
    }

    elements.budgetTable.appendChild(tableFragment);
    elements.budgetTiles.appendChild(tilesFragment);
    const totalBudgetElement = document.getElementById('total-budget');
    const totalRemainingElement = document.getElementById('total-remaining');
    if (totalBudgetElement) {
      totalBudgetElement.textContent = await formatCurrency(totalBudgetAmount, 'INR');
    }
    if (totalRemainingElement) {
      totalRemainingElement.textContent = await formatCurrency(totalRemainingAmount, 'INR');
    }
  } catch (error) {
    showError('budget-name', `Failed to load budgets: ${error.message}`);
    elements.budgetTable.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-600">Error loading budgets</td></tr>';
    elements.budgetTiles.innerHTML = '<div class="text-center py-4 text-red-600">Error loading budgets</div>';
  }
}

async function setupBudgets() {
  const elements = {
    addBudget: document.getElementById('add-budget'),
    saveBudget: document.getElementById('save-budget'),
    cancelBudget: document.getElementById('cancel-budget'),
    budgetTable: document.getElementById('budget-table')
  };

  if (Object.values(elements).some(el => !el)) {
    showError('budget-name', 'Budget form or table not found');
    return;
  }

  const handleBudgetAdd = async (nameInput, amountInput, isModal = false) => {
    clearErrors();
    const name = nameInput.value.trim();
    const amount = parseFloat(amountInput.value);

    if (!name) return showError(isModal ? 'new-budget-name' : 'budget-name', 'Budget name is required');
    if (isNaN(amount) || amount <= 0) return showError(isModal ? 'new-budget-amount' : 'budget-amount', 'Valid positive amount is required');
    if (state.currentAccountType !== 'admin') return showError(isModal ? 'new-budget-name' : 'budget-name', 'Only admins can add budgets');
    if (!currentUser || !db) return showError(isModal ? 'new-budget-name' : 'budget-name', 'Database service not available');

    try {
      const userDoc = await retryFirestoreOperation(() => getDoc(doc(db, 'users', currentUser.uid)));
      if (!userDoc.exists() || !userDoc.data().familyCode) {
        showError(isModal ? 'new-budget-name' : 'budget-name', 'Invalid user configuration');
        return;
      }

      elements.addBudget.disabled = true;
      elements.addBudget.textContent = isModal ? 'Saving...' : 'Adding...';
      const now = new Date();
      const budgetData = {
        name,
        amount,
        spent: 0,
        familyCode: userDoc.data().familyCode,
        createdAt: serverTimestamp(),
        lastResetMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      };

      await retryFirestoreOperation(() => addDoc(collection(db, 'budgets'), budgetData));
      clearTransactionCache();
      nameInput.value = '';
      amountInput.value = '';
      if (isModal && domElements.addBudgetModal) {
        domElements.addBudgetModal.classList.add('hidden');
      }
      await Promise.all([loadBudgets(), loadCategories()]);
    } catch (error) {
      showError(isModal ? 'new-budget-name' : 'budget-name', `Failed to add budget: ${error.message}`);
    } finally {
      elements.addBudget.disabled = false;
      elements.addBudget.textContent = isModal ? 'Save' : 'Add Budget';
    }
  };

  elements.addBudget.addEventListener('click', async () => {
    if (state.isEditing.budget) return;
    const inputs = {
      name: document.getElementById('budget-name'),
      amount: document.getElementById('budget-amount')
    };
    if (Object.values(inputs).some(el => !el)) {
      showError('budget-name', 'Form inputs not found');
      return;
    }
    await handleBudgetAdd(inputs.name, inputs.amount);
  });

  if (domElements.categoryBudgetSelect) {
    domElements.categoryBudgetSelect.addEventListener('change', () => {
      if (domElements.categoryBudgetSelect.value === 'add-new') {
        if (domElements.addBudgetModal) {
          domElements.addBudgetModal.classList.remove('hidden');
        }
        domElements.categoryBudgetSelect.value = 'none';
      }
    });
  }

  elements.saveBudget.addEventListener('click', async () => {
    const inputs = {
      name: document.getElementById('new-budget-name'),
      amount: document.getElementById('new-budget-amount')
    };
    if (Object.values(inputs).some(el => !el)) {
      showError('new-budget-name', 'Modal form inputs not found');
      return;
    }
    await handleBudgetAdd(inputs.name, inputs.amount, true);
  });

  elements.cancelBudget.addEventListener('click', () => {
    if (domElements.addBudgetModal) {
      domElements.addBudgetModal.classList.add('hidden');
    }
    ['new-budget-name', 'new-budget-amount'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  });

  elements.budgetTable.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-budget')) {
      const id = e.target.dataset.id;
      try {
        const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'budgets', id)));
        if (docSnap.exists()) {
          const data = docSnap.data();
          const inputs = {
            name: document.getElementById('budget-name'),
            amount: document.getElementById('budget-amount')
          };
          inputs.name.value = data.name;
          inputs.amount.value = data.amount;
          elements.addBudget.innerHTML = 'Update Budget';
          state.isEditing.budget = true;

          const updateHandler = async () => {
            const name = inputs.name.value.trim();
            const amount = parseFloat(inputs.amount.value);
            if (!name) return showError('budget-name', 'Budget name is required');
            if (isNaN(amount) || amount <= 0) return showError('budget-amount', 'Valid positive amount is required');

            try {
              elements.addBudget.disabled = true;
              elements.addBudget.textContent = 'Updating...';
              await retryFirestoreOperation(() => updateDoc(doc(db, 'budgets', id), { name, amount }));
              clearTransactionCache();
              inputs.name.value = '';
              inputs.amount.value = '';
              elements.addBudget.innerHTML = 'Add Budget';
              state.isEditing.budget = false;
              await Promise.all([loadBudgets(), loadCategories()]);
            } catch (error) {
              showError('budget-name', `Failed to update budget: ${error.message}`);
            } finally {
              elements.addBudget.disabled = false;
              elements.addBudget.textContent = 'Add Budget';
              state.isEditing.budget = false;
            }
          };
          elements.addBudget.removeEventListener('click', elements.addBudget._updateHandler);
          elements.addBudget._updateHandler = updateHandler;
          elements.addBudget.addEventListener('click', updateHandler, { once: true });
        }
      } catch (error) {
        showError('budget-name', `Failed to fetch budget: ${error.message}`);
      }
    } else if (e.target.classList.contains('delete-budget')) {
      const id = e.target.dataset.id;
      if (!domElements.deleteConfirmModal) return showError('budget-name', 'Cannot delete: Missing components');

      domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this budget?';
      domElements.deleteConfirmModal.classList.remove('hidden');
      const confirmHandler = async () => {
        try {
          await retryFirestoreOperation(() => deleteDoc(doc(db, 'budgets', id)));
          clearTransactionCache();
          await Promise.all([loadBudgets(), loadCategories()]);
          domElements.deleteConfirmModal.classList.add('hidden');
        } catch (error) {
          showError('budget-name', `Failed to delete budget: ${error.message}`);
        }
        domElements.confirmDelete.removeEventListener('click', confirmHandler);
      };
      const cancelHandler = () => {
        domElements.deleteConfirmModal.classList.add('hidden');
        domElements.cancelDelete.removeEventListener('click', cancelHandler);
      };
      domElements.confirmDelete.addEventListener('click', confirmHandler, { once: true });
      domElements.cancelDelete.addEventListener('click', cancelHandler, { once: true });
    }
  });
}

// Transactions
async function loadTransactions() {
  const elements = {
    transactionTable: document.getElementById('transaction-table'),
    dateHeader: document.getElementById('transaction-date-header'),
    transactionsFilter: document.getElementById('transactions-filter')
  };

  if (Object.values(elements).some(el => !el) || !db || !familyCode) {
    showError('transactions-filter', 'Required components not available');
    if (elements.transactionTable) {
      elements.transactionTable.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
    }
    return;
  }

  try {
    elements.transactionTable.innerHTML = '<tr><td colspan="6" class="text-center py-4">Loading...</td></tr>';
    elements.transactionsFilter.value = elements.transactionsFilter.value || 'thisMonth';
    const filter = elements.transactionsFilter.value;
    const { start, end } = getDateRangeWrapper(filter);
    const adjustedStart = new Date(start.getTime() - 5.5 * 60 * 60 * 1000);

    elements.dateHeader.textContent = {
      thisMonth: new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' }),
      lastMonth: new Date(start).toLocaleString('en-US', { month: 'short', year: 'numeric' }),
      thisYear: start.getFullYear().toString(),
      lastYear: start.getFullYear().toString(),
      custom: 'Date'
    }[filter];

    const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
    const categoriesSnapshot = await retryFirestoreOperation(() => getDocs(categoriesQuery));
    const categoryMap = new Map(categoriesSnapshot.docs.map(doc => [doc.id, doc.data().name]));

    const transactions = await fetchCachedTransactions(db, familyCode, adjustedStart, end);
    elements.transactionTable.innerHTML = '';
    if (transactions.length === 0) {
      elements.transactionTable.innerHTML = '<tr><td colspan="6" class="text-center py-4">No transactions found for this period</td></tr>';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const transaction of transactions.sort((a, b) => b.createdAt - a.createdAt)) {
      const tr = document.createElement('tr');
      tr.classList.add('table-row');
      const transactionDate = transaction.createdAt.toDate ? transaction.createdAt.toDate() : new Date(transaction.createdAt);
      tr.innerHTML = `
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.type || 'Unknown'}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${await formatCurrency(transaction.amount || 0, 'INR')}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.categoryId ? categoryMap.get(transaction.categoryId) || 'Unknown' : 'None'}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.description || ''}</td>
        <td class="w-12 px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transactionDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm">
          <button class="text-blue-600 hover:text-blue-800 mr-2 edit-transaction" data-id="${transaction.id}">Edit</button>
          <button class="text-red-600 hover:text-red-800 delete-transaction" data-id="${transaction.id}">Delete</button>
        </td>
      `;
      fragment.appendChild(tr);
    }
    elements.transactionTable.appendChild(fragment);
  } catch (error) {
    showError('transactions-filter', `Failed to load transactions: ${error.message}`);
    elements.transactionTable.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
  }
}

async function setupTransactions() {
  const elements = {
    addTransaction: document.getElementById('add-transaction'),
    transactionTable: document.getElementById('transaction-table'),
    transactionsFilter: document.getElementById('transactions-filter')
  };

  if (Object.values(elements).some(el => !el)) {
    showError('category', 'Transaction components not found');
    return;
  }

  elements.transactionsFilter.addEventListener('change', loadTransactions);

  const handleTransactionAdd = async (inputs, isUpdate = false, id = null) => {
    clearErrors();
    const { type, amount, category, description, date } = inputs;
    const amountVal = parseFloat(amount.value);
    const transactionDate = date.value ? new Date(date.value) : new Date();

    if (!amountVal || amountVal <= 0) return showError('amount', 'Valid amount is required');
    if (!category.value) return showError('category', 'Category is required');
    if (!date.value || isNaN(transactionDate)) return showError('transaction-date', 'Valid date is required');
    if (!currentUser || !db) return showError('category', 'Database service not available');

    try {
      elements.addTransaction.disabled = true;
      elements.addTransaction.textContent = isUpdate ? 'Updating...' : 'Adding...';

      if (isUpdate) {
        let oldBudgetId = null, newBudgetId = null;
        const oldDoc = await retryFirestoreOperation(() => getDoc(doc(db, 'transactions', id)));
        if (oldDoc.exists() && oldDoc.data().type === 'debit') {
          const oldCategory = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', oldDoc.data().categoryId)));
          oldBudgetId = oldCategory.exists() ? oldCategory.data().budgetId : null;
        }
        if (type.value === 'debit') {
          const newCategory = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', category.value)));
          newBudgetId = newCategory.exists() ? newCategory.data().budgetId : null;
        }

        if (oldBudgetId && oldBudgetId === newBudgetId) {
          const amountDiff = amountVal - oldDoc.data().amount;
          if (amountDiff !== 0) {
            await retryFirestoreOperation(() => 
              updateDoc(doc(db, 'budgets', oldBudgetId), { spent: increment(amountDiff) })
            );
          }
        } else {
          if (oldBudgetId && oldDoc.data().type === 'debit') {
            await retryFirestoreOperation(() => 
              updateDoc(doc(db, 'budgets', oldBudgetId), { spent: increment(-oldDoc.data().amount) })
            );
          }
          if (newBudgetId && type.value === 'debit') {
            await retryFirestoreOperation(() => 
              updateDoc(doc(db, 'budgets', newBudgetId), { spent: increment(amountVal) })
            );
          }
        }

        await retryFirestoreOperation(() => 
          updateDoc(doc(db, 'transactions', id), {
            type: type.value,
            amount: amountVal,
            categoryId: category.value,
            description: description.value.trim(),
            createdAt: transactionDate
          })
        );
      } else {
        const docRef = await retryFirestoreOperation(() => 
          addDoc(collection(db, 'transactions'), {
            type: type.value,
            amount: amountVal,
            categoryId: category.value,
            description: description.value.trim(),
            familyCode,
            createdAt: transactionDate
          })
        );

        if (type.value === 'debit') {
          const categoryDoc = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', category.value)));
          if (categoryDoc.exists() && categoryDoc.data().budgetId) {
            await retryFirestoreOperation(() => 
              updateDoc(doc(db, 'budgets', categoryDoc.data().budgetId), { spent: increment(amountVal) })
            );
          }
        }
      }

      clearTransactionCache();
      Object.values(inputs).forEach(el => el.value = el.id === 'type' ? 'debit' : '');
      elements.addTransaction.innerHTML = 'Add Transaction';
      state.isEditing.transaction = false;
      await Promise.all([loadBudgets(), loadTransactions(), updateDashboard()]);
    } catch (error) {
      showError('category', `Failed to ${isUpdate ? 'update' : 'add'} transaction: ${error.message}`);
    } finally {
      elements.addTransaction.disabled = false;
      elements.addTransaction.textContent = 'Add Transaction';
      state.isEditing.transaction = false;
    }
  };

  elements.addTransaction.addEventListener('click', async () => {
    if (state.isEditing.transaction) return;
    const inputs = {
      type: document.getElementById('type'),
      amount: document.getElementById('amount'),
      category: document.getElementById('category'),
      description: document.getElementById('description'),
      date: document.getElementById('transaction-date')
    };
    if (Object.values(inputs).some(el => !el)) {
      showError('category', 'Form elements not found');
      return;
    }
    await handleTransactionAdd(inputs);
  });

  elements.transactionTable.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-transaction')) {
      const id = e.target.dataset.id;
      try {
        const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'transactions', id)));
        if (docSnap.exists()) {
          const data = docSnap.data();
          const inputs = {
            type: document.getElementById('type'),
            amount: document.getElementById('amount'),
            category: document.getElementById('category'),
            description: document.getElementById('description'),
            date: document.getElementById('transaction-date')
          };
          inputs.type.value = data.type;
          inputs.amount.value = data.amount;
          inputs.category.value = data.categoryId;
          inputs.description.value = data.description || '';
          const transactionDate = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
          inputs.date.value = transactionDate.toISOString().split('T')[0];
          elements.addTransaction.innerHTML = 'Update Transaction';
          state.isEditing.transaction = true;

          const updateHandler = () => handleTransactionAdd(inputs, true, id);
          elements.addTransaction.removeEventListener('click', elements.addTransaction._updateHandler);
          elements.addTransaction._updateHandler = updateHandler;
          elements.addTransaction.addEventListener('click', updateHandler, { once: true });
        } else {
          showError('category', 'Transaction not found');
        }
      } catch (error) {
        showError('category', `Failed to fetch transaction: ${error.message}`);
      }
    } else if (e.target.classList.contains('delete-transaction')) {
      const id = e.target.dataset.id;
      if (!domElements.deleteConfirmModal) return showError('category', 'Cannot delete: Missing components');

      domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this transaction?';
      domElements.deleteConfirmModal.classList.remove('hidden');
      const confirmHandler = async () => {
        try {
          const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'transactions', id)));
          if (docSnap.exists()) {
            const transaction = docSnap.data();
            if (transaction.type === 'debit' && transaction.categoryId) {
              const categoryDoc = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', transaction.categoryId)));
              if (categoryDoc.exists() && categoryDoc.data().budgetId) {
                await retryFirestoreOperation(() => 
                  updateDoc(doc(db, 'budgets', categoryDoc.data().budgetId), { spent: increment(-transaction.amount) })
                );
              }
            }
            await retryFirestoreOperation(() => deleteDoc(doc(db, 'transactions', id)));
            clearTransactionCache();
            await Promise.all([loadBudgets(), loadTransactions(), updateDashboard()]);
            domElements.deleteConfirmModal.classList.add('hidden');
          } else {
            showError('category', 'Transaction not found');
          }
        } catch (error) {
          showError('category', `Failed to delete transaction: ${error.message}`);
        }
        domElements.confirmDelete.removeEventListener('click', confirmHandler);
      };
      const cancelHandler = () => {
        domElements.deleteConfirmModal.classList.add('hidden');
        domElements.cancelDelete.removeEventListener('click', cancelHandler);
      };
      domElements.confirmDelete.addEventListener('click', confirmHandler, { once: true });
      domElements.cancelDelete.addEventListener('click', cancelHandler, { once: true });
    }
  });
}

// Child Accounts
async function loadChildAccounts() {
  if (!currentUser || !db || !familyCode) {
    showError('child-user-id', 'Unable to load child accounts.');
    return;
  }

  const elements = {
    childSelector: document.getElementById('child-selector'),
    childUserIdSelect: document.getElementById('child-user-id')
  };

  if (!elements.childSelector || !elements.childUserIdSelect) {
    showError('child-user-id', 'Child selector not found');
    return;
  }

  try {
    if (state.currentAccountType === 'admin') {
      elements.childSelector.classList.remove('hidden');
      elements.childUserIdSelect.innerHTML = '<option value="">Select a Child</option>';
      const usersQuery = query(collection(db, 'users'), where('familyCode', '==', familyCode), where('accountType', '==', 'child'));
      const snapshot = await retryFirestoreOperation(() => getDocs(usersQuery));
      
      if (snapshot.empty) {
        elements.childUserIdSelect.innerHTML = '<option value="">No children found</option>';
      } else {
        snapshot.forEach(doc => {
          const option = document.createElement('option');
          option.value = doc.id;
          option.textContent = doc.data().email || `Child Account ${doc.id.substring(0, 8)}`;
          elements.childUserIdSelect.appendChild(option);
        });
      }
      state.currentChildUserId = elements.childUserIdSelect.value || null;
    } else {
      elements.childSelector.classList.add('hidden');
      state.currentChildUserId = currentUser.uid;
    }
    await loadChildTransactions();
  } catch (error) {
    showError('child-user-id', `Failed to load child accounts: ${error.message}`);
    elements.childUserIdSelect.innerHTML = '<option value="">Error loading children</option>';
  }
}

async function loadChildTransactions() {
  if (!db || !state.currentChildUserId) {
    showError('child-transaction-description', 'No user selected');
    const table = document.getElementById('child-transaction-table');
    if (table) {
      table.innerHTML = '<tr><td colspan="5" class="text-center py-4">No user selected</td></tr>';
    }
    const balance = document.getElementById('child-balance');
    if (balance) {
      balance.textContent = await formatCurrency(0, 'INR');
    }
    return;
  }

  const elements = {
    table: document.getElementById('child-transaction-table'),
    balance: document.getElementById('child-balance'),
    dateHeader: document.getElementById('child-transaction-date-header')
  };

  if (Object.values(elements).some(el => !el)) {
    showError('child-transaction-description', 'Required components not found');
    return;
  }

  try {
    elements.table.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading...</td></tr>';
    const { start, end } = getDateRangeWrapper(domElements.dashboardFilter?.value || 'thisMonth');
    elements.dateHeader.textContent = domElements.dashboardFilter?.value !== 'thisMonth' ? start.toLocaleString('en-US', { month: 'short' }) : new Date().toLocaleString('en-US', { month: 'short' });

    let totalBalance = 0;
    const transactionsQuery = query(collection(db, 'childTransactions'), where('userId', '==', state.currentChildUserId));
    const snapshot = await retryFirestoreOperation(() => getDocs(transactionsQuery));
    elements.table.innerHTML = '';

    const transactions = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data(), createdAt: doc.data().createdAt?.toDate() || new Date() }))
      .filter(tx => tx.createdAt >= start && tx.createdAt <= end)
      .sort((a, b) => b.createdAt - a.createdAt);

    if (transactions.length === 0) {
      elements.table.innerHTML = '<tr><td colspan="5" class="text-center py-4">No transactions found for this period</td></tr>';
    } else {
      const fragment = document.createDocumentFragment();
      for (const tx of transactions) {
        totalBalance += tx.type === 'credit' ? tx.amount : -tx.amount;
        const tr = document.createElement('tr');
        tr.classList.add('table-row');
        tr.innerHTML = `
          <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${tx.type || 'Unknown'}</td>
          <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${await formatCurrency(tx.amount || 0, 'INR')}</td>
          <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${tx.description || ''}</td>
          <td class="w-12 px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${tx.createdAt.toLocaleString('en-US', { day: 'numeric' })}</td>
          <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm">
            <button class="text-blue-600 hover:text-blue-800 mr-2 edit-child-transaction" data-id="${tx.id}" data-user-id="${tx.userId}">Edit</button>
            <button class="text-red-600 hover:text-red-800 delete-child-transaction" data-id="${tx.id}" data-user-id="${tx.userId}">Delete</button>
          </td>
        `;
        fragment.appendChild(tr);
      }
      elements.table.appendChild(fragment);
    }
    elements.balance.textContent = await formatCurrency(totalBalance, 'INR');
  } catch (error) {
    showError('child-transaction-description', `Failed to load child transactions: ${error.message}`);
    elements.table.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
    elements.balance.textContent = await formatCurrency(0, 'INR');
  }
}

async function loadChildTiles() {
  if (!db || !familyCode) {
    showError('child-tiles', 'No family data');
    return;
  }

  const childTiles = document.getElementById('child-tiles');
  if (!childTiles) return;

  try {
    childTiles.innerHTML = '<div class="text-center py-4">Loading...</div>';
    const usersQuery = query(collection(db, 'users'), where('familyCode', '==', familyCode), where('accountType', '==', 'child'));
    const snapshot = await retryFirestoreOperation(() => getDocs(usersQuery));
    
    childTiles.innerHTML = '';
    if (snapshot.empty) {
      childTiles.innerHTML = '<div class="text-center py-4">No child accounts found</div>';
      return;
    }

    const childBalances = new Map();
    await Promise.all(snapshot.docs.map(async doc => {
      const userId = doc.id;
      const email = doc.data().email || `Child Account ${userId.substring(0, 8)}`;
      const transQuery = query(collection(db, 'childTransactions'), where('userId', '==', userId));
      const transSnapshot = await retryFirestoreOperation(() => getDocs(transQuery));
      const balance = transSnapshot.docs.reduce((sum, txDoc) => {
        const tx = txDoc.data();
        return sum + (tx.type === 'credit' ? tx.amount : -tx.amount);
      }, 0);
      childBalances.set(userId, { email, balance });
    }));

    const fragment = document.createDocumentFragment();
    for (const [userId, { email, balance }] of childBalances) {
      const tile = document.createElement('div');
      tile.classList.add('bg-white', 'rounded-lg', 'shadow-md', 'p-6', 'child-tile');
      tile.innerHTML = `
        <h3 class="text-lg font-semibold text-gray-700">${email}</h3>
        <p class="text-sm font-semibold text-gray-700 mt-2">
          Balance: <span id="child-${userId}-balance">${await formatCurrency(balance, 'INR')}</span>
        </p>
      `;
      fragment.appendChild(tile);
    }
    childTiles.appendChild(fragment);
  } catch (error) {
    showError('child-tiles', `Failed to load child balances: ${error.message}`);
    childTiles.innerHTML = '<div class="text-center py-4 text-red-600">Failed to load child balances.</div>';
  }
}

async function setupChildAccounts() {
  const elements = {
    addChildTransaction: document.getElementById('add-child-transaction'),
    childTransactionTable: document.getElementById('child-transaction-table'),
    childUserId: document.getElementById('child-user-id')
  };

  if (Object.values(elements).some(el => !el)) {
    showError('child-transaction-description', 'Child transaction components not found');
    return;
  }

  let lastClickTime = 0;
  const DEBOUNCE_MS = 5000;

  const handleChildTransactionAdd = async (inputs, isUpdate = false, id = null) => {
    const now = Date.now();
    if (now - lastClickTime < DEBOUNCE_MS) return;
    lastClickTime = now;

    clearErrors();
    const { type, amount, description } = inputs;
    const amountVal = parseFloat(amount.value);
    const transactionUserId = state.currentAccountType === 'admin' ? state.currentChildUserId : currentUser.uid;

    if (!amountVal || amountVal <= 0) return showError('child-transaction-amount', 'Valid amount is required');
    if (state.currentAccountType === 'admin' && !state.currentChildUserId) return showError('child-user-id', 'Please select a child account');
    if (!currentUser || !db) return showError('child-transaction-description', 'Database service not available');

    try {
      elements.addChildTransaction.disabled = true;
      elements.addChildTransaction.textContent = isUpdate ? 'Updating...' : 'Adding...';

      if (isUpdate) {
        await retryFirestoreOperation(() => 
          updateDoc(doc(db, 'childTransactions', id), {
            type: type.value,
            amount: amountVal,
            description: description.value.trim()
          })
        );
      } else {
        const txId = `tx-${transactionUserId}-${type.value}-${amountVal}-${description.value.trim()}-${now}`.replace(/[^a-zA-Z0-9-]/g, '-');
        await retryFirestoreOperation(() => 
          setDoc(doc(db, 'childTransactions', txId), {
            type: type.value,
            amount: amountVal,
            description: description.value.trim(),
            userId: transactionUserId,
            familyCode,
            txId,
            createdAt: serverTimestamp()
          })
        );
      }

      Object.values(inputs).forEach(el => el.value = el.id.includes('type') ? 'debit' : '');
      elements.addChildTransaction.innerHTML = 'Add Transaction';
      state.isEditing.childTransaction = false;
      await Promise.all([loadChildTransactions(), loadChildTiles()]);
    } catch (error) {
      showError('child-transaction-description', `Failed to ${isUpdate ? 'update' : 'add'} transaction: ${error.message}`);
    } finally {
      elements.addChildTransaction.disabled = false;
      elements.addChildTransaction.textContent = 'Add Transaction';
      state.isEditing.childTransaction = false;
    }
  };

  elements.addChildTransaction.addEventListener('click', async () => {
    if (state.isEditing.childTransaction) return;
    const inputs = {
      type: document.getElementById('child-transaction-type'),
      amount: document.getElementById('child-transaction-amount'),
      description: document.getElementById('child-transaction-description')
    };
    if (Object.values(inputs).some(el => !el)) {
      showError('child-transaction-description', 'Form elements not found');
      return;
    }
    await handleChildTransactionAdd(inputs);
  });

  elements.childTransactionTable.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-child-transaction')) {
      const id = e.target.dataset.id;
      try {
        const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'childTransactions', id)));
        if (docSnap.exists()) {
          const data = docSnap.data();
          const inputs = {
            type: document.getElementById('child-transaction-type'),
            amount: document.getElementById('child-transaction-amount'),
            description: document.getElementById('child-transaction-description')
          };
          inputs.type.value = data.type || 'debit';
          inputs.amount.value = data.amount || '';
          inputs.description.value = data.description || '';
          elements.addChildTransaction.innerHTML = 'Update Transaction';
          state.isEditing.childTransaction = true;

          const updateHandler = () => handleChildTransactionAdd(inputs, true, id);
          elements.addChildTransaction.removeEventListener('click', elements.addChildTransaction._updateHandler);
          elements.addChildTransaction._updateHandler = updateHandler;
          elements.addChildTransaction.addEventListener('click', updateHandler, { once: true });
        } else {
          showError('child-transaction-description', 'Transaction not found');
        }
      } catch (error) {
        showError('child-transaction-description', `Failed to fetch transaction: ${error.message}`);
      }
    } else if (e.target.classList.contains('delete-child-transaction')) {
      const id = e.target.dataset.id;
      if (!domElements.deleteConfirmModal) return showError('child-transaction-description', 'Cannot delete: Missing components');

      domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this child transaction?';
      domElements.deleteConfirmModal.classList.remove('hidden');
      const confirmHandler = async () => {
        try {
          await retryFirestoreOperation(() => deleteDoc(doc(db, 'childTransactions', id)));
          await Promise.all([loadChildTransactions(), loadChildTiles()]);
          domElements.deleteConfirmModal.classList.add('hidden');
        } catch (error) {
          showError('child-transaction-description', `Failed to delete transaction: ${error.message}`);
        }
        domElements.confirmDelete.removeEventListener('click', confirmHandler);
      };
      const cancelHandler = () => {
        domElements.deleteConfirmModal.classList.add('hidden');
        domElements.cancelDelete.removeEventListener('click', cancelHandler);
      };
      domElements.confirmDelete.addEventListener('click', confirmHandler, { once: true });
      domElements.cancelDelete.addEventListener('click', cancelHandler, { once: true });
    }
  });

  elements.childUserId.addEventListener('change', () => {
    state.currentChildUserId = elements.childUserId.value || null;
    if (state.currentChildUserId) {
      loadChildTransactions();
    } else {
      const table = document.getElementById('child-transaction-table');
      if (table) table.innerHTML = '<tr><td colspan="5" class="text-center py-4">No child selected</td></tr>';
      const balance = document.getElementById('child-balance');
      if (balance) balance.textContent = '₹0'; // Fallback to static value if formatCurrency fails
    }
  });
}

async function calculateChildBalance(userId) {
  if (!db || !userId) return 0;

  try {
    const transactionsQuery = query(collection(db, 'childTransactions'), where('userId', '==', userId));
    const snapshot = await retryFirestoreOperation(() => getDocs(transactionsQuery));
    return snapshot.docs.reduce((sum, doc) => {
      const tx = doc.data();
      return sum + (tx.type === 'credit' ? tx.amount : -tx.amount);
    }, 0);
  } catch (error) {
    return 0;
  }
}

async function updateDashboard() {
  if (!db || !currentUser) {
    showError('balance', 'Required components not available');
    return;
  }

  const elements = {
    balance: document.getElementById('balance'),
    afterBudget: document.getElementById('after-budget'),
    totalBudget: document.getElementById('total-budget'),
    totalRemaining: document.getElementById('total-remaining'),
    childTiles: document.getElementById('child-tiles')
  };

  if (Object.values(elements).some(el => !el)) {
    showError('balance', 'Dashboard elements not found');
    return;
  }

  try {
    const { start, end } = getDateRangeWrapper(domElements.dashboardFilter?.value || 'thisMonth');

    if (state.currentAccountType === 'child') {
      const childBalance = await calculateChildBalance(currentUser.uid);
      elements.childTiles.innerHTML = `
        <div class="bg-white p-4 sm:p-6 rounded-lg shadow-md">
          <h3 class="text-base sm:text-lg font-semibold text-gray-700">Your Balance</h3>
          <p class="text-lg sm:text-2xl font-bold text-gray-900">${await formatCurrency(childBalance, 'INR')}</p>
        </div>
      `;
      elements.childTiles.style.display = 'block';
      ['balance', 'afterBudget', 'totalBudget'].forEach(id => {
        if (elements[id].parentElement) {
          elements[id].parentElement.classList.add('hidden');
          elements[id].textContent = 'N/A';
        }
      });
      elements.totalRemaining.textContent = 'N/A';
    } else {
      let totalBalance = 0, totalBudgetAmount = 0, totalSpent = 0;
      const transactionsQuery = query(collection(db, 'transactions'), where('familyCode', '==', familyCode));
      const snapshot = await retryFirestoreOperation(() => getDocs(transactionsQuery));
      totalBalance = snapshot.docs.reduce((sum, doc) => {
        const tx = doc.data();
        return sum + (tx.type === 'credit' ? tx.amount : -tx.amount);
      }, 0);

      const budgetToCategories = new Map();
      const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
      const categoriesSnapshot = await retryFirestoreOperation(() => getDocs(categoriesQuery));
      categoriesSnapshot.forEach(doc => {
        if (doc.data().budgetId) {
          budgetToCategories.set(doc.data().budgetId, [...(budgetToCategories.get(doc.data().budgetId) || []), doc.id]);
        }
      });

      const budgetsQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
      const budgetSnapshot = await retryFirestoreOperation(() => getDocs(budgetsQuery));
      for (const doc of budgetSnapshot.docs) {
        const budget = doc.data();
        totalBudgetAmount += budget.amount;
        const categoryIds = budgetToCategories.get(doc.id) || [];
        if (categoryIds.length > 0) {
          const chunks = [];
          for (let i = 0; i < categoryIds.length; i += 30) chunks.push(categoryIds.slice(i, i + 30));
          let debitTotal = 0, creditTotal = 0;
          for (const chunk of chunks) {
            const debitQuery = query(
              collection(db, 'transactions'),
              where('familyCode', '==', familyCode),
              where('categoryId', 'in', chunk),
              where('type', '==', 'debit'),
              where('createdAt', '>=', start),
              where('createdAt', '<=', end)
            );
            const debitSnapshot = await retryFirestoreOperation(() => getDocs(debitQuery));
            debitTotal += debitSnapshot.docs.reduce((sum, txDoc) => sum + (txDoc.data().amount || 0), 0);

            const creditQuery = query(
              collection(db, 'transactions'),
              where('familyCode', '==', familyCode),
              where('categoryId', 'in', chunk),
              where('type', '==', 'credit'),
              where('createdAt', '>=', start),
              where('createdAt', '<=', end)
            );
            const creditSnapshot = await retryFirestoreOperation(() => getDocs(creditQuery));
            creditTotal += creditSnapshot.docs.reduce((sum, txDoc) => sum + (txDoc.data().amount || 0), 0);
          }
          totalSpent += debitTotal - creditTotal;
        }
      }

      elements.balance.textContent = await formatCurrency(totalBalance, 'INR');
      elements.balance.parentElement.classList.remove('hidden');
      elements.totalBudget.textContent = await formatCurrency(totalBudgetAmount, 'INR');
      elements.totalRemaining.textContent = await formatCurrency(totalBudgetAmount - totalSpent, 'INR');
      elements.totalBudget.parentElement.classList.remove('hidden');
      elements.afterBudget.textContent = await formatCurrency(totalBalance - (totalBudgetAmount - totalSpent), 'INR');
      elements.afterBudget.parentElement.classList.remove('hidden');
      await loadBudgets();
      elements.childTiles.innerHTML = '';
      await loadChildTiles();
    }
  } catch (error) {
    showError('balance', `Failed to update dashboard: ${error.message}`);
  }
}

async function setupLogout() {
  const maxAttempts = 10;
  let attempts = 0;
  const poll = setInterval(() => {
    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) {
      clearInterval(poll);
      logoutButton.addEventListener('click', async () => {
        if (!auth) return showError('page-title', 'Authentication service not available');
        
        try {
          logoutButton.disabled = true;
          logoutButton.textContent = 'Logging out...';
          let signOutSuccess = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              await signOut(auth);
              signOutSuccess = true;
              break;
            } catch (error) {
              if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }

          if (signOutSuccess) {
            state.currentChildUserId = null;
            state.currentAccountType = null;
            const loginSection = document.getElementById('login-section');
            const appSection = document.getElementById('app-section');
            const pageTitle = document.getElementById('page-title');
            if (loginSection) loginSection.classList.remove('hidden');
            if (appSection) appSection.classList.add('hidden');
            if (pageTitle) pageTitle.textContent = 'Login';
            logoutButton.classList.add('hidden');
          } else {
            showError('page-title', 'Failed to log out: Connectivity issue');
          }
        } catch (error) {
          showError('page-title', `Failed to log out: ${error.message}`);
        } finally {
          logoutButton.disabled = false;
          logoutButton.textContent = 'Logout';
        }
      });
    } else if (attempts++ >= maxAttempts) {
      clearInterval(poll);
    }
  }, 500);
}

async function initApp() {
  try {
    if (currentUser && state.currentAccountType === 'admin' && db && familyCode) {
      await resetBudgetsForNewMonth(db, familyCode);
    }
    setupTabs();
    setupProfile();
    setupCategories();
    setupBudgets();
    setupTransactions();
    setupChildAccounts();
    setupLogout();
  } catch (error) {
    showError('page-title', 'Failed to initialize app.');
  }
}

export { loadAppData, initApp
