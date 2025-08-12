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
import { collection, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp, increment, writeBatch } from 'firebase/firestore';

function toCamelCase(str) {
  return str.split('-').map((word, index) => index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)).join('');
}

// Enums for constants
const AccountType = {
  ADMIN: 'admin',
  CHILD: 'child'
};

const TransactionType = {
  DEBIT: 'debit',
  CREDIT: 'credit'
};

// Utility functions
function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function sanitizeInput(input) {
  const div = document.createElement('div');
  div.textContent = input;
  return div.innerHTML;
}

function resetForm(inputs) {
  Object.values(inputs).forEach(el => {
    el.value = el.type === 'select-one' ? el.options[0].value : '';
  });
}

function showToast(message, type = 'error') {
  if (!document.body) {
    console.log('[showToast] Error: Document body not available');
    return;
  }
  const toast = document.createElement('div');
  toast.className = `fixed bottom-4 right-4 p-4 rounded-lg shadow-lg ${type === 'error' ? 'bg-red-500' : type === 'warning' ? 'bg-yellow-500' : 'bg-green-500'} text-white`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function validateDomElements(elements, errorElementId, errorMessage) {
  if (Object.values(elements).some(el => !el)) {
    showError(errorElementId, errorMessage);
    return false;
  }
  return true;
}

async function handleFormSubmission({ inputs, validate, dbOperation, successCallback, errorElement, button, isUpdate = false }) {
  clearErrors();
  try {
    const validationErrors = validate(inputs);
    if (validationErrors.length > 0) {
      validationErrors.forEach(({ id, message }) => showError(id, message));
      return;
    }
    button.disabled = true;
    button.textContent = isUpdate ? 'Updating...' : 'Processing...';
    await retryFirestoreOperation(dbOperation);
    successCallback();
    showToast(`Operation ${isUpdate ? 'updated' : 'completed'} successfully`, 'success');
  } catch (error) {
    showError(errorElement, `Operation failed: ${error.message}`);
    showToast(`Operation failed: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = isUpdate ? 'Update' : 'Add';
  }
}

function log(module, action, details) {
  console.log(`[${module}] ${action}:`, details);
}

// State management
const state = {
  isEditing: { transaction: false, budget: false, category: false, profile: false, childTransaction: false },
  currentChildUserId: null,
  currentAccountType: null,
  loadedTabs: { budgets: false, transactions: false, childAccounts: false }
};

// Supported currencies for dynamic rate fetching
const supportedCurrencies = ['INR', 'USD', 'ZAR'];

// Utility to get date range
const getDateRangeWrapper = (filter) => getDateRange(filter, domElements.filterStartDate, domElements.filterEndDate);

// Lazy fetch exchange rates
async function fetchRequiredExchangeRates(targetCurrency) {
  const pairs = supportedCurrencies
    .filter(currency => currency !== targetCurrency)
    .flatMap(currency => [[currency, targetCurrency], [targetCurrency, currency]]);
  const ratePromises = pairs.map(async ([from, to]) => {
    const key = `${from}_${to}`;
    try {
      const rate = await fetchExchangeRate(from, to, exchangeRateCache.get(key));
      exchangeRateCache.set(key, { rate, timestamp: Date.now() });
      return rate;
    } catch (error) {
      log('ExchangeRates', 'Fetch failed', `Failed to fetch rate for ${key}: ${error}`);
      return exchangeRateCache.get(key)?.rate || 1;
    }
  });
  await Promise.all(ratePromises);
}

// Load app data
async function loadAppData() {
  log('loadAppData', 'Starting', '');
  if (!currentUser || !familyCode || !db) {
    log('loadAppData', 'Error', 'Missing dependencies');
    showError('page-title', 'Failed to load app data.');
    return;
  }
  try {
    if (!supportedCurrencies.includes(userCurrency)) {
      log('loadAppData', 'Warning', `Invalid userCurrency: ${userCurrency}, defaulting to INR`);
      setUserCurrency('INR');
    }
    await fetchRequiredExchangeRates(userCurrency);
    if (domElements.currencyToggle) {
      domElements.currencyToggle.value = userCurrency;
    }
    const [profileResult, categoriesResult, dashboardResult] = await Promise.allSettled([
      loadProfileData(),
      loadCategories(),
      updateDashboard()
    ]);
    if (profileResult.status === 'rejected') {
      log('loadAppData', 'Error', 'Failed to load profile');
      showError('profile-email', 'Failed to load profile data.');
    }
    if (categoriesResult.status === 'rejected') {
      log('loadAppData', 'Error', 'Failed to load categories');
      showError('category-name', 'Failed to load categories.');
    }
    if (dashboardResult.status === 'rejected') {
      log('loadAppData', 'Error', 'Failed to update dashboard');
      showError('balance', 'Failed to update dashboard.');
    }
  } catch (error) {
    log('loadAppData', 'Error', error);
    showError('page-title', 'Failed to load app data.');
  }
}

// Tab management
function setupTabs() {
  log('setupTabs', 'Initializing', 'tabs');
  const tabs = [
    { id: 'dashboard', name: 'Budget Dashboard', section: domElements.dashboardSection, show: () => {
      log('setupTabs', 'Showing', 'dashboard');
      updateDashboard();
    }},
    { id: 'transactions', name: 'Transactions', section: domElements.transactionsSection, show: async () => {
      log('setupTabs', 'Showing', 'transactions');
      if (!state.loadedTabs.transactions) {
        await loadTransactions();
        state.loadedTabs.transactions = true;
      }
    }},
    { id: 'budgets', name: 'Budgets', section: domElements.budgetsSection, show: async () => {
      log('setupTabs', 'Showing', 'budgets');
      if (!state.loadedTabs.budgets) {
        await loadBudgets();
        state.loadedTabs.budgets = true;
      }
    }},
    { id: 'categories', name: 'Categories', section: domElements.categoriesSection, show: () => {
      log('setupTabs', 'Showing', 'categories');
    }},
    { id: 'child-accounts', name: 'Child Accounts', section: domElements.childAccountsSection, show: async () => {
      log('setupTabs', 'Showing', 'child-accounts');
      if (!domElements.childAccountsSection || !domElements.childAccountsTab) {
        log('setupTabs', 'Error', 'Child accounts section or tab not found');
        showError('page-title', 'Child accounts feature is currently unavailable.');
        return;
      }
      try {
        if (!state.loadedTabs.childAccounts) {
          await loadChildAccounts();
          state.loadedTabs.childAccounts = true;
        } else {
          log('setupTabs', 'Refreshing', 'child accounts');
          await loadChildAccounts();
        }
      } catch (error) {
        log('setupTabs', 'Error', 'Failed to load child accounts');
        showError('child-user-id', 'Failed to load child accounts tab.');
      }
    }},
    { id: 'profile', name: 'User Profile', section: domElements.profileSection, show: () => {
      log('setupTabs', 'Showing', 'profile');
      loadProfileData();
    }}
  ].filter(tab => {
    const propName = toCamelCase(tab.id) + 'Tab';
    if (!domElements[propName] || !tab.section) {
      log('setupTabs', 'Warning', `Filtering out tab ${tab.id} due to missing element or section`);
      return false;
    }
    return true;
  });
  let currentTabIndex = 0;
  const switchTab = (tabId) => {
    log('switchTab', 'Switching', `to ${tabId}`);
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) {
      log('switchTab', 'Error', `Tab not found: ${tabId}`);
      showError('page-title', `Tab ${tabId} not found.`);
      return;
    }
    const propName = toCamelCase(tab.id) + 'Tab';
    const tabElement = domElements[propName];
    if (!tabElement || !tab.section) {
      log('switchTab', 'Warning', `Skipping tab ${tab.id} due to missing element or section`);
      showError('page-title', `${tab.name} feature is currently unavailable.`);
      return;
    }
    tabs.forEach(t => {
      const isActive = t.id === tabId;
      const tPropName = toCamelCase(t.id) + 'Tab';
      const tElement = domElements[tPropName];
      if (tElement) {
        tElement.classList.toggle('bg-blue-800', isActive);
        tElement.setAttribute('aria-selected', isActive);
      }
      if (t.section) {
        t.section.classList.toggle('hidden', !isActive);
      }
    });
    const pageTitle = domElements.pageTitle;
    if (pageTitle) {
      pageTitle.textContent = tab.name;
    } else {
      log('switchTab', 'Warning', 'Page title element not found');
    }
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
    try {
      tab.show();
    } catch (error) {
      log('switchTab', 'Error', `Error showing tab ${tabId}`);
      showError('page-title', `Failed to load ${tab.name} tab.`);
    }
    currentTabIndex = tabs.findIndex(t => t.id === tabId);
  };
  tabs.forEach(tab => {
    const propName = toCamelCase(tab.id) + 'Tab';
    const tabElement = domElements[propName];
    if (tabElement) {
      log('setupTabs', 'Attaching', `listener to ${tab.id}`);
      tabElement.addEventListener('click', () => {
        log('setupTabs', 'Clicked', `${tab.id}`);
        switchTab(tab.id);
      });
    }
  });
  const menuToggle = document.getElementById('menu-toggle');
  const menuItems = document.getElementById('menu-items');
  if (menuToggle && menuItems) {
    log('setupTabs', 'Setting up', 'mobile menu toggle');
    menuToggle.addEventListener('click', () => {
      log('setupTabs', 'Toggled', 'mobile menu');
      const isExpanded = !menuItems.classList.contains('hidden');
      menuItems.classList.toggle('hidden');
      menuToggle.setAttribute('aria-expanded', !isExpanded);
    });
  } else {
    log('setupTabs', 'Warning', 'Mobile menu elements not found');
  }
  const swipeContainer = document.getElementById('swipeable-tabs');
  if (swipeContainer && window.matchMedia('(max-width: 768px)').matches) {
    let touchStartX = 0;
    let touchStartY = 0;
    const minSwipeDistance = 50;
    swipeContainer.addEventListener('touchstart', (e) => {
      if (e.target.closest('.no-swipe')) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      log('setupTabs', 'Swipe', 'started');
    });
    swipeContainer.addEventListener('touchend', (e) => {
      if (e.target.closest('.no-swipe')) return;
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(deltaX) < minSwipeDistance || Math.abs(deltaY) > 50) return;
      log('setupTabs', 'Swipe', `detected: deltaX=${deltaX}`);
      if (deltaX < 0 && currentTabIndex < tabs.length - 1) {
        switchTab(tabs[currentTabIndex + 1].id);
      } else if (deltaX > 0 && currentTabIndex > 0) {
        switchTab(tabs[currentTabIndex - 1].id);
      }
    });
    swipeContainer.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' && currentTabIndex < tabs.length - 1) {
        switchTab(tabs[currentTabIndex + 1].id);
        tabs[currentTabIndex + 1].section.focus();
      } else if (e.key === 'ArrowLeft' && currentTabIndex > 0) {
        switchTab(tabs[currentTabIndex - 1].id);
        tabs[currentTabIndex - 1].section.focus();
      }
    });
  } else {
    log('setupTabs', 'Warning', 'Swipe container not found or not in mobile view');
  }
  log('setupTabs', 'Initializing', 'default tab: dashboard');
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
      const email = domElements.profileEmail?.value.trim();
      const currency = domElements.profileCurrency?.value;
      const accountType = domElements.profileAccountType?.value;
      const validationErrors = [];
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) validationErrors.push({ id: 'profile-email', message: 'Valid email is required' });
      if (!currency || !supportedCurrencies.includes(currency)) validationErrors.push({ id: 'profile-currency', message: 'Valid currency is required' });
      if (!accountType || ![AccountType.ADMIN, AccountType.CHILD].includes(accountType)) validationErrors.push({ id: 'profile-account-type', message: 'Valid account type is required' });
      if (validationErrors.length > 0) {
        validationErrors.forEach(({ id, message }) => showError(id, message));
        return;
      }
      try {
        domElements.saveProfile.disabled = true;
        domElements.saveProfile.textContent = 'Saving...';
        if (email !== currentUser.email) {
          try {
            await auth.currentUser.updateEmail(email);
          } catch (error) {
            if (error.code === 'auth/requires-recent-login') {
              showToast('Please log out and log in again to update email.', 'error');
            } else {
              throw error;
            }
          }
        }
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
    domElements.currencyToggle.addEventListener('change', debounce(async () => {
      const newCurrency = domElements.currencyToggle.value;
      if (!supportedCurrencies.includes(newCurrency)) {
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
    }, 300));
  }
  if (domElements.dashboardFilter) {
    domElements.dashboardFilter.addEventListener('change', debounce(() => {
      if (domElements.customDateRange) {
        domElements.customDateRange.classList.toggle('hidden', domElements.dashboardFilter.value !== 'custom');
      }
      updateDashboard();
    }, 300));
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
      domElements.profileAccountType.value = data.accountType || AccountType.CHILD;
      state.currentAccountType = data.accountType || AccountType.CHILD;
    } else {
      showError('profile-email', 'Profile data not found.');
      state.currentAccountType = AccountType.CHILD;
    }
  } catch (error) {
    showError('profile-email', 'Failed to load profile data.');
    state.currentAccountType = AccountType.CHILD;
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
  if (!validateDomElements(elements, 'category-name', 'Required components not available')) return;
  if (!db || !familyCode) {
    showError('category-name', 'Database service not available');
    elements.categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-600">Error loading categories</td></tr>';
    return;
  }
  try {
    elements.categorySelect.innerHTML = '<option value="">Select Category</option><option value="add-new">Add New</option>';
    elements.categoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
    elements.newCategoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
    elements.categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">Loading...</td></tr>';
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
    const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
    const categoriesSnapshot = await retryFirestoreOperation(() => getDocs(categoriesQuery));
    elements.categoryTable.innerHTML = '';
    if (categoriesSnapshot.empty) {
      elements.categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">No categories found</td></tr>';
      return;
    }
    categoriesSnapshot.forEach(doc => {
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = doc.data().name;
      elements.categorySelect.insertBefore(option, elements.categorySelect.lastChild);
    });
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
    elements.categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-600">Error loading categories</td></tr>';
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
  if (!validateDomElements(elements, 'category-name', 'Category form or table not found')) return;
  const handleCategoryAdd = async (nameInput, typeSelect, budgetSelect, isModal = false) => {
    const name = nameInput.value.trim();
    const type = typeSelect.value;
    const budgetId = budgetSelect.value === 'none' ? null : budgetSelect.value;
    const validationErrors = [];
    if (!name) validationErrors.push({ id: isModal ? 'new-category-name' : 'category-name', message: 'Name is required' });
    if (name.length > 100) validationErrors.push({ id: isModal ? 'new-category-name' : 'category-name', message: 'Name cannot exceed 100 characters' });
    if (!type) validationErrors.push({ id: isModal ? 'new-category-type' : 'category-type', message: 'Type is required' });
    await handleFormSubmission({
      inputs: { nameInput, typeSelect, budgetSelect },
      validate: () => validationErrors,
      dbOperation: () => addDoc(collection(db, 'categories'), {
        name: sanitizeInput(name),
        type,
        budgetId,
        familyCode,
        createdAt: serverTimestamp()
      }),
      successCallback: () => {
        nameInput.value = '';
        typeSelect.value = 'income';
        budgetSelect.value = 'none';
        if (isModal && domElements.addCategoryModal) {
          domElements.addCategoryModal.classList.add('hidden');
        }
        loadCategories();
      },
      errorElement: isModal ? 'new-category-name' : 'category-name',
      button: elements.addCategory
    });
  };
  elements.addCategory.addEventListener('click', async () => {
    if (state.isEditing.category) return;
    const inputs = {
      name: document.getElementById('category-name'),
      type: document.getElementById('category-type'),
      budget: document.getElementById('category-budget-select')
    };
    if (!validateDomElements(inputs, 'category-name', 'Form elements not found')) return;
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
    if (!validateDomElements(inputs, 'new-category-name', 'Modal form elements not found')) return;
    await handleCategoryAdd(inputs.name, inputs.type, inputs.budget, true);
  });
  elements.cancelCategory.addEventListener('click', () => {
    if (domElements.addCategoryModal) {
      domElements.addCategoryModal.classList.add('hidden');
    }
    resetForm({
      name: document.getElementById('new-category-name'),
      type: document.getElementById('new-category-type'),
      budget: document.getElementById('new-category-budget')
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
          if (!validateDomElements(inputs, 'category-name', 'Form elements not found')) return;
          inputs.name.value = data.name || '';
          inputs.type.value = data.type || 'income';
          inputs.budget.value = data.budgetId || 'none';
          elements.addCategory.innerHTML = 'Update Category';
          state.isEditing.category = true;
          const updateHandler = async () => {
            const name = inputs.name.value.trim();
            const type = inputs.type.value;
            const budgetId = inputs.budget.value === 'none' ? null : inputs.budget.value;
            const validationErrors = [];
            if (!name) validationErrors.push({ id: 'category-name', message: 'Name is required' });
            if (name.length > 100) validationErrors.push({ id: 'category-name', message: 'Name cannot exceed 100 characters' });
            if (!type) validationErrors.push({ id: 'category-type', message: 'Type is required' });
            await handleFormSubmission({
              inputs,
              validate: () => validationErrors,
              dbOperation: () => updateDoc(doc(db, 'categories', id), { name: sanitizeInput(name), type, budgetId }),
              successCallback: () => {
                resetForm(inputs);
                elements.addCategory.innerHTML = 'Add Category';
                state.isEditing.category = false;
                loadCategories();
              },
              errorElement: 'category-name',
              button: elements.addCategory,
              isUpdate: true
            });
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
      const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', id)));
      const name = docSnap.exists() ? docSnap.data().name : 'this category';
      domElements.deleteConfirmMessage.textContent = `Are you sure you want to delete ${name}?`;
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
  if (state.currentAccountType === AccountType.ADMIN) {
    try {
      await resetBudgetsForNewMonth(db, familyCode, state.currentAccountType);
    } catch (error) {
      log('loadBudgets', 'Error', 'Budget reset failed');
    }
  }
  const elements = {
    budgetTable: document.getElementById('budget-table'),
    budgetTiles: document.getElementById('budget-tiles')
  };
  if (!validateDomElements(elements, 'budget-name', 'Budget table or tiles not found')) return;
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
        categoryIds.includes(tx.categoryId) ? sum + (tx.type === TransactionType.DEBIT ? tx.amount : -tx.amount) : sum, 0) : 0;
      totalBudgetAmount += budget.amount;
      totalRemainingAmount += budget.amount - spent;
      const [formattedBudgetAmount, formattedSpent, formattedRemaining] = await Promise.all([
        formatCurrency(budget.amount, 'INR'),
        formatCurrency(spent, 'INR'),
        formatCurrency(budget.amount - spent, 'INR')
      ]);
      const tr = document.createElement('tr');
      tr.classList.add('table-row');
      tr.innerHTML = `
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${budget.name}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formattedBudgetAmount}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formattedSpent}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formattedRemaining}</td>
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
        <p class="text-sm text-gray-500">Budget: <span id="${doc.id}-budget">${formattedBudgetAmount}</span></p>
        <p class="text-sm text-gray-500">Spent: <span id="${doc.id}-spent">${formattedSpent}</span></p>
        <p class="text-sm font-semibold text-gray-700 mt-2">
          Remaining: <span id="${doc.id}-remaining">${formattedRemaining}</span>
        </p>
        <div class="w-full bg-gray-200 rounded-full mt-4 progress-bar">
          <div class="bg-green-600 progress-bar" style="width: ${percentage}%"></div>
        </div>
      `;
      if (spent > budget.amount * 0.9) {
        showToast(`Warning: Budget ${budget.name} is at ${Math.round(percentage)}%`, 'warning');
      }
      tilesFragment.appendChild(tile);
    }
    elements.budgetTable.appendChild(tableFragment);
    elements.budgetTiles.appendChild(tilesFragment);
    const [formattedTotalBudget, formattedTotalRemaining] = await Promise.all([
      formatCurrency(totalBudgetAmount, 'INR'),
      formatCurrency(totalRemainingAmount, 'INR')
    ]);
    const totalBudgetElement = document.getElementById('total-budget');
    const totalRemainingElement = document.getElementById('total-remaining');
    if (totalBudgetElement) {
      totalBudgetElement.textContent = formattedTotalBudget;
    }
    if (totalRemainingElement) {
      totalRemainingElement.textContent = formattedTotalRemaining;
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
  if (!validateDomElements(elements, 'budget-name', 'Budget form or table not found')) return;
  const handleBudgetAdd = async (nameInput, amountInput, isModal = false) => {
    const name = nameInput.value.trim();
    const amount = parseFloat(amountInput.value);
    const validationErrors = [];
    if (!name) validationErrors.push({ id: isModal ? 'new-budget-name' : 'budget-name', message: 'Budget name is required' });
    if (name.length > 100) validationErrors.push({ id: isModal ? 'new-budget-name' : 'budget-name', message: 'Name cannot exceed 100 characters' });
    if (isNaN(amount) || amount <= 0) validationErrors.push({ id: isModal ? 'new-budget-amount' : 'budget-amount', message: 'Valid positive amount is required' });
    if (state.currentAccountType !== AccountType.ADMIN) validationErrors.push({ id: isModal ? 'new-budget-name' : 'budget-name', message: 'Only admins can add budgets' });
    await handleFormSubmission({
      inputs: { nameInput, amountInput },
      validate: () => validationErrors,
      dbOperation: async () => {
        const userDoc = await retryFirestoreOperation(() => getDoc(doc(db, 'users', currentUser.uid)));
        if (!userDoc.exists() || !userDoc.data().familyCode) {
          throw new Error('Invalid user configuration');
        }
        const now = new Date();
        const budgetData = {
          name: sanitizeInput(name),
          amount,
          spent: 0,
          familyCode: userDoc.data().familyCode,
          createdAt: serverTimestamp(),
          lastResetMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        };
        await addDoc(collection(db, 'budgets'), budgetData);
        clearTransactionCache();
      },
      successCallback: () => {
        nameInput.value = '';
        amountInput.value = '';
        if (isModal && domElements.addBudgetModal) {
          domElements.addBudgetModal.classList.add('hidden');
        }
        Promise.all([loadBudgets(), loadCategories()]);
      },
      errorElement: isModal ? 'new-budget-name' : 'budget-name',
      button: elements.addBudget
    });
  };
  elements.addBudget.addEventListener('click', async () => {
    if (state.isEditing.budget) return;
    const inputs = {
      name: document.getElementById('budget-name'),
      amount: document.getElementById('budget-amount')
    };
    if (!validateDomElements(inputs, 'budget-name', 'Form inputs not found')) return;
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
    if (!validateDomElements(inputs, 'new-budget-name', 'Modal form inputs not found')) return;
    await handleBudgetAdd(inputs.name, inputs.amount, true);
  });
  elements.cancelBudget.addEventListener('click', () => {
    if (domElements.addBudgetModal) {
      domElements.addBudgetModal.classList.add('hidden');
    }
    resetForm({
      name: document.getElementById('new-budget-name'),
      amount: document.getElementById('new-budget-amount')
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
            const validationErrors = [];
            if (!name) validationErrors.push({ id: 'budget-name', message: 'Budget name is required' });
            if (name.length > 100) validationErrors.push({ id: 'budget-name', message: 'Name cannot exceed 100 characters' });
            if (isNaN(amount) || amount <= 0) validationErrors.push({ id: 'budget-amount', message: 'Valid positive amount is required' });
            await handleFormSubmission({
              inputs,
              validate: () => validationErrors,
              dbOperation: () => updateDoc(doc(db, 'budgets', id), { name: sanitizeInput(name), amount }),
              successCallback: () => {
                clearTransactionCache();
                resetForm(inputs);
                elements.addBudget.innerHTML = 'Add Budget';
                state.isEditing.budget = false;
                Promise.all([loadBudgets(), loadCategories()]);
              },
              errorElement: 'budget-name',
              button: elements.addBudget,
              isUpdate: true
            });
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
      const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'budgets', id)));
      const name = docSnap.exists() ? docSnap.data().name : 'this budget';
      domElements.deleteConfirmMessage.textContent = `Are you sure you want to delete ${name}?`;
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
/**
 * @typedef {Object} Transaction
 * @property {string} id
 * @property {'debit' | 'credit'} type
 * @property {number} amount
 * @property {string} categoryId
 * @property {string} description
 * @property {Date} createdAt
 * @property {string} familyCode
 */
async function loadTransactions() {
  const elements = {
    transactionTable: document.getElementById('transaction-table'),
    dateHeader: document.getElementById('transaction-date-header'),
    transactionsFilter: document.getElementById('transactions-filter')
  };
  if (!validateDomElements(elements, 'transactions-filter', 'Required components not available')) {
    elements.transactionTable.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
    return;
  }
  if (!db || !familyCode) {
    showError('transactions-filter', 'Database service not available');
    elements.transactionTable.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
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
      let transactionDate = transaction.createdAt.toDate ? transaction.createdAt.toDate() : (typeof transaction.createdAt === 'string' ? new Date(transaction.createdAt) : new Date());
      if (isNaN(transactionDate.getTime())) {
        log('loadTransactions', 'Warning', `Invalid transaction date for ${transaction.id}`);
        transactionDate = new Date();
      }
      const formattedAmount = await formatCurrency(transaction.amount || 0, 'INR');
      tr.innerHTML = `
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.type || 'Unknown'}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${formattedAmount}</td>
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
  if (!validateDomElements(elements, 'category', 'Transaction components not found')) return;
  elements.transactionsFilter.addEventListener('change', debounce(loadTransactions, 300));
  const handleTransactionAdd = async (inputs, isUpdate = false, id = null) => {
    const { type, amount, category, description, date } = inputs;
    const amountVal = parseFloat(amount.value);
    const transactionDate = new Date(date.value);
    const validationErrors = [];
    if (!amountVal || amountVal <= 0) validationErrors.push({ id: 'amount', message: 'Valid amount is required' });
    if (!category.value) validationErrors.push({ id: 'category', message: 'Category is required' });
    if (!date.value || isNaN(transactionDate.getTime())) validationErrors.push({ id: 'transaction-date', message: 'Valid date is required' });
    if (description.value.length > 200) validationErrors.push({ id: 'description', message: 'Description cannot exceed 200 characters' });
    await handleFormSubmission({
      inputs,
      validate: () => validationErrors,
      dbOperation: async () => {
        const batch = writeBatch(db);
        if (isUpdate) {
          let oldBudgetId = null, newBudgetId = null;
          const oldDoc = await getDoc(doc(db, 'transactions', id));
          if (oldDoc.exists() && oldDoc.data().type === TransactionType.DEBIT) {
            const oldCategory = await getDoc(doc(db, 'categories', oldDoc.data().categoryId));
            oldBudgetId = oldCategory.exists() ? oldCategory.data().budgetId : null;
          }
          if (type.value === TransactionType.DEBIT) {
            const newCategory = await getDoc(doc(db, 'categories', category.value));
            newBudgetId = newCategory.exists() ? newCategory.data().budgetId : null;
          }
          if (oldBudgetId && oldBudgetId === newBudgetId) {
            const amountDiff = amountVal - oldDoc.data().amount;
            if (amountDiff !== 0) {
              batch.update(doc(db, 'budgets', oldBudgetId), { spent: increment(amountDiff) });
            }
          } else {
            if (oldBudgetId && oldDoc.data().type === TransactionType.DEBIT) {
              batch.update(doc(db, 'budgets', oldBudgetId), { spent: increment(-oldDoc.data().amount) });
            }
            if (newBudgetId && type.value === TransactionType.DEBIT) {
              batch.update(doc(db, 'budgets', newBudgetId), { spent: increment(amountVal) });
            }
          }
          batch.update(doc(db, 'transactions', id), {
            type: type.value,
            amount: amountVal,
            categoryId: category.value,
            description: sanitizeInput(description.value.trim()),
            createdAt: transactionDate
          });
        } else {
          const txRef = doc(collection(db, 'transactions'));
          batch.set(txRef, {
            type: type.value,
            amount: amountVal,
            categoryId: category.value,
            description: sanitizeInput(description.value.trim()),
            familyCode,
            createdAt: transactionDate
          });
          if (type.value === TransactionType.DEBIT) {
            const categoryDoc = await getDoc(doc(db, 'categories', category.value));
            if (categoryDoc.exists() && categoryDoc.data().budgetId) {
              batch.update(doc(db, 'budgets', categoryDoc.data().budgetId), { spent: increment(amountVal) });
            }
          }
        }
        await batch.commit();
      },
      successCallback: () => {
        clearTransactionCache();
        resetForm(inputs);
        elements.addTransaction.innerHTML = 'Add Transaction';
        state.isEditing.transaction = false;
        Promise.all([loadBudgets(), loadTransactions(), updateDashboard()]);
      },
      errorElement: 'category',
      button: elements.addTransaction,
      isUpdate
    });
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
    if (!validateDomElements(inputs, 'category', 'Form elements not found')) return;
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
      const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'transactions', id)));
      const tx = docSnap.exists() ? docSnap.data() : { description: 'this transaction', amount: 0 };
      const formattedAmount = await formatCurrency(tx.amount, 'INR');
      domElements.deleteConfirmMessage.textContent = `Are you sure you want to delete the ${tx.description} transaction of ${formattedAmount}?`;
      domElements.deleteConfirmModal.classList.remove('hidden');
      const confirmHandler = async () => {
        try {
          const batch = writeBatch(db);
          const transaction = docSnap.data();
          if (transaction.type === TransactionType.DEBIT && transaction.categoryId) {
            const categoryDoc = await getDoc(doc(db, 'categories', transaction.categoryId));
            if (categoryDoc.exists() && categoryDoc.data().budgetId) {
              batch.update(doc(db, 'budgets', categoryDoc.data().budgetId), { spent: increment(-transaction.amount) });
            }
          }
          batch.delete(doc(db, 'transactions', id));
          await batch.commit();
          clearTransactionCache();
          await Promise.all([loadBudgets(), loadTransactions(), updateDashboard()]);
          domElements.deleteConfirmModal.classList.add('hidden');
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
  log('loadChildAccounts', 'Starting', '');
  if (!domElements.childAccountsSection) {
    log('loadChildAccounts', 'Error', 'Child accounts section not found');
    showError('child-user-id', 'Child accounts section not found in the DOM.');
    return;
  }
  if (state.currentAccountType === AccountType.CHILD) {
    domElements.childAccountsSection.classList.add('hidden');
    return;
  } else {
    domElements.childAccountsSection.classList.remove('hidden');
  }
  if (!currentUser || !db || !familyCode) {
    log('loadChildAccounts', 'Error', 'Missing dependencies');
    showError('child-user-id', 'Unable to load child accounts. Missing user or database configuration.');
    return;
  }
  const elements = {
    childSelector: document.getElementById('child-selector'),
    childUserIdSelect: document.getElementById('child-user-id')
  };
  if (!validateDomElements(elements, 'child-user-id', 'Child selector not found in the DOM.')) return;
  try {
    log('loadChildAccounts', 'Checking', `account type ${state.currentAccountType}`);
    if (state.currentAccountType === AccountType.ADMIN) {
      log('loadChildAccounts', 'Admin', 'mode, loading child accounts');
      elements.childSelector.classList.remove('hidden');
      elements.childUserIdSelect.innerHTML = '<option value="">Select a Child</option>';
      const usersQuery = query(collection(db, 'users'), where('familyCode', '==', familyCode), where('accountType', '==', AccountType.CHILD));
      const snapshot = await retryFirestoreOperation(() => getDocs(usersQuery));
      if (snapshot.empty) {
        log('loadChildAccounts', 'No', 'child accounts found');
        elements.childUserIdSelect.innerHTML = '<option value="">No children found</option>';
      } else {
        log('loadChildAccounts', 'Found', `${snapshot.docs.length} child accounts`);
        snapshot.forEach(doc => {
          const option = document.createElement('option');
          option.value = doc.id;
          option.textContent = doc.data().email || `Child Account ${doc.id.substring(0, 8)}`;
          elements.childUserIdSelect.appendChild(option);
        });
      }
      state.currentChildUserId = elements.childUserIdSelect.value || null;
    } else {
      log('loadChildAccounts', 'Child', 'mode, setting current user');
      elements.childSelector.classList.add('hidden');
      state.currentChildUserId = currentUser.uid;
    }
    log('loadChildAccounts', 'Loading', 'child transactions');
    await loadChildTransactions();
  } catch (error) {
    log('loadChildAccounts', 'Error', 'loading child accounts');
    showError('child-user-id', `Failed to load child accounts: ${error.message}`);
    elements.childUserIdSelect.innerHTML = '<option value="">Error loading children</option>';
  }
}

async function loadChildTransactions() {
  log('loadChildTransactions', 'Starting', { currentChildUserId: state.currentChildUserId });
  if (!db || !state.currentChildUserId) {
    log('loadChildTransactions', 'Error', 'Missing database or user ID');
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
  if (!validateDomElements(elements, 'child-transaction-description', 'Required components not found')) return;
  try {
    elements.table.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading...</td></tr>';
    const { start, end } = getDateRangeWrapper(domElements.dashboardFilter?.value || 'thisMonth');
    elements.dateHeader.textContent = domElements.dashboardFilter?.value !== 'thisMonth' ? start.toLocaleString('en-US', { month: 'short' }) : new Date().toLocaleString('en-US', { month: 'short' });
    let totalBalance = 0;
    const transactionsQuery = query(collection(db, 'childTransactions'), where('userId', '==', state.currentChildUserId));
    log('loadChildTransactions', 'Fetching', `transactions for user ${state.currentChildUserId}`);
    const snapshot = await retryFirestoreOperation(() => getDocs(transactionsQuery));
    elements.table.innerHTML = '';
    const transactions = snapshot.docs
      .map(doc => {
        const data = doc.data();
        let createdAt = data.createdAt?.toDate?.() || (typeof data.createdAt === 'string' ? new Date(data.createdAt) : new Date());
        if (isNaN(createdAt.getTime())) {
          log('loadChildTransactions', 'Warning', `Invalid transaction date for ${doc.id}`);
          createdAt = new Date();
        }
        return { id: doc.id, ...data, createdAt };
      })
      .filter(tx => tx.createdAt >= start && tx.createdAt <= end)
      .sort((a, b) => b.createdAt - a.createdAt);
    log('loadChildTransactions', 'Found', `${transactions.length} transactions`);
    if (transactions.length === 0) {
      elements.table.innerHTML = '<tr><td colspan="5" class="text-center py-4">No transactions found for this period</td></tr>';
    } else {
      const fragment = document.createDocumentFragment();
      for (const tx of transactions) {
        totalBalance += tx.type === TransactionType.CREDIT ? tx.amount : -tx.amount;
        const formattedAmount = await formatCurrency(tx.amount || 0, 'INR');
        const tr = document.createElement('tr');
        tr.classList.add('table-row');
        tr.innerHTML = `
          <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${tx.type || 'Unknown'}</td>
          <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${formattedAmount}</td>
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
    log('loadChildTransactions', 'Error', 'loading transactions');
    showError('child-transaction-description', `Failed to load child transactions: ${error.message}`);
    elements.table.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
    elements.balance.textContent = await formatCurrency(0, 'INR');
  }
}

async function loadChildTiles() {
  log('loadChildTiles', 'Starting', '');
  if (!db || !familyCode) {
    log('loadChildTiles', 'Error', 'Missing database or family code');
    showError('child-tiles', 'No family data');
    return;
  }
  const childTiles = document.getElementById('child-tiles');
  if (!childTiles) {
    log('loadChildTiles', 'Error', 'Child tiles element not found');
    return;
  }
  try {
    childTiles.innerHTML = '<div class="text-center py-4">Loading...</div>';
    const usersQuery = query(collection(db, 'users'), where('familyCode', '==', familyCode), where('accountType', '==', AccountType.CHILD));
    const snapshot = await retryFirestoreOperation(() => getDocs(usersQuery));
    childTiles.innerHTML = '';
    if (snapshot.empty) {
      log('loadChildTiles', 'No', 'child accounts found');
      childTiles.innerHTML = '<div class="text-center py-4">No child accounts found</div>';
      return;
    }
    log('loadChildTiles', 'Found', `${snapshot.docs.length} child accounts`);
    const childBalances = new Map();
    await Promise.all(snapshot.docs.map(async doc => {
      const userId = doc.id;
      const email = doc.data().email || `Child Account ${userId.substring(0, 8)}`;
      const transQuery = query(collection(db, 'childTransactions'), where('userId', '==', userId));
      const transSnapshot = await retryFirestoreOperation(() => getDocs(transQuery));
      const balance = transSnapshot.docs.reduce((sum, txDoc) => {
        const tx = txDoc.data();
        return sum + (tx.type === TransactionType.CREDIT ? tx.amount : -tx.amount);
      }, 0);
      childBalances.set(userId, { email, balance });
    }));
    const fragment = document.createDocumentFragment();
    for (const [userId, { email, balance }] of childBalances) {
      const formattedBalance = await formatCurrency(balance, 'INR');
      const tile = document.createElement('div');
      tile.classList.add('bg-white', 'rounded-lg', 'shadow-md', 'p-6', 'child-tile');
      tile.innerHTML = `
        <h3 class="text-lg font-semibold text-gray-700">${email}</h3>
        <p class="text-sm font-semibold text-gray-700 mt-2">
          Balance: <span id="child-${userId}-balance">${formattedBalance}</span>
        </p>
      `;
      fragment.appendChild(tile);
    }
    childTiles.appendChild(fragment);
  } catch (error) {
    log('loadChildTiles', 'Error', 'loading child balances');
    showError('child-tiles', `Failed to load child balances: ${error.message}`);
    childTiles.innerHTML = '<div class="text-center py-4 text-red-600">Failed to load child balances.</div>';
  }
}

async function setupChildAccounts() {
  log('setupChildAccounts', 'Starting', '');
  const elements = {
    addChildTransaction: document.getElementById('add-child-transaction'),
    childTransactionTable: document.getElementById('child-transaction-table'),
    childUserId: document.getElementById('child-user-id')
  };
  if (!validateDomElements(elements, 'child-transaction-description', 'Child transaction components not found')) return;
  let lastClickTime = 0;
  const DEBOUNCE_MS = 5000;
  const handleChildTransactionAdd = async (inputs, isUpdate = false, id = null) => {
    const now = Date.now();
    if (now - lastClickTime < DEBOUNCE_MS) return;
    lastClickTime = now;
    const { type, amount, description } = inputs;
    const amountVal = parseFloat(amount.value);
    const transactionUserId = state.currentAccountType === AccountType.ADMIN ? state.currentChildUserId : currentUser.uid;
    const validationErrors = [];
    if (!amountVal || amountVal <= 0) validationErrors.push({ id: 'child-transaction-amount', message: 'Valid amount is required' });
    if (state.currentAccountType === AccountType.ADMIN && !state.currentChildUserId) validationErrors.push({ id: 'child-user-id', message: 'Please select a child account' });
    if (description.value.length > 200) validationErrors.push({ id: 'child-transaction-description', message: 'Description cannot exceed 200 characters' });
    await handleFormSubmission({
      inputs,
      validate: () => validationErrors,
      dbOperation: async () => {
        if (isUpdate) {
          await updateDoc(doc(db, 'childTransactions', id), {
            type: type.value,
            amount: amountVal,
            description: sanitizeInput(description.value.trim())
          });
        } else {
          const txId = `tx-${transactionUserId}-${type.value}-${amountVal}-${description.value.trim()}-${now}`.replace(/[^a-zA-Z0-9-]/g, '-');
          await setDoc(doc(db, 'childTransactions', txId), {
            type: type.value,
            amount: amountVal,
            description: sanitizeInput(description.value.trim()),
            userId: transactionUserId,
            familyCode,
            txId,
            createdAt: serverTimestamp()
          });
        }
      },
      successCallback: () => {
        resetForm(inputs);
        elements.addChildTransaction.innerHTML = 'Add Transaction';
        state.isEditing.childTransaction = false;
        Promise.all([loadChildTransactions(), loadChildTiles()]);
      },
      errorElement: 'child-transaction-description',
      button: elements.addChildTransaction,
      isUpdate
    });
  };
  elements.addChildTransaction.addEventListener('click', async () => {
    if (state.isEditing.childTransaction) return;
    const inputs = {
      type: document.getElementById('child-transaction-type'),
      amount: document.getElementById('child-transaction-amount'),
      description: document.getElementById('child-transaction-description')
    };
    if (!validateDomElements(inputs, 'child-transaction-description', 'Form elements not found')) return;
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
          inputs.type.value = data.type || TransactionType.DEBIT;
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
      const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'childTransactions', id)));
      const tx = docSnap.exists() ? docSnap.data() : { description: 'this transaction', amount: 0 };
      const formattedAmount = await formatCurrency(tx.amount, 'INR');
      domElements.deleteConfirmMessage.textContent = `Are you sure you want to delete the ${tx.description} child transaction of ${formattedAmount}?`;
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
    log('childUserId', 'Change', 'event triggered');
    state.currentChildUserId = elements.childUserId.value || null;
    if (state.currentChildUserId) {
      loadChildTransactions();
    } else {
      const table = document.getElementById('child-transaction-table');
      if (table) table.innerHTML = '<tr><td colspan="5" class="text-center py-4">No child selected</td></tr>';
      const balance = document.getElementById('child-balance');
      if (balance) balance.textContent = '₹0';
    }
  });
}

async function calculateChildBalance(userId) {
  if (!db || !userId) {
    log('calculateChildBalance', 'Error', 'Missing database or user ID');
    return 0;
  }
  try {
    const transactionsQuery = query(collection(db, 'childTransactions'), where('userId', '==', userId));
    const snapshot = await retryFirestoreOperation(() => getDocs(transactionsQuery));
    return snapshot.docs.reduce((sum, doc) => {
      const tx = doc.data();
      return sum + (tx.type === TransactionType.CREDIT ? tx.amount : -tx.amount);
    }, 0);
  } catch (error) {
    log('calculateChildBalance', 'Error', 'calculating balance');
    return 0;
  }
}

async function updateDashboard() {
  log('updateDashboard', 'Starting', '');
  if (!db || !currentUser) {
    log('updateDashboard', 'Error', 'Missing database or user');
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
  if (!validateDomElements(elements, 'balance', 'Dashboard elements not found')) return;
  try {
    const { start, end } = getDateRangeWrapper(domElements.dashboardFilter?.value || 'thisMonth');
    if (state.currentAccountType === AccountType.CHILD) {
      log('updateDashboard', 'Child', 'account mode');
      const childBalance = await calculateChildBalance(currentUser.uid);
      const formattedChildBalance = await formatCurrency(childBalance, 'INR');
      elements.childTiles.innerHTML = `
        <div class="bg-white p-4 sm:p-6 rounded-lg shadow-md">
          <h3 class="text-base sm:text-lg font-semibold text-gray-700">Your Balance</h3>
          <p class="text-lg sm:text-2xl font-bold text-gray-900">${formattedChildBalance}</p>
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
      log('updateDashboard', 'Admin', 'account mode');
      let totalBalance = 0, totalBudgetAmount = 0, totalSpent = 0;
      const allTransactionsQuery = query(
        collection(db, 'transactions'),
        where('familyCode', '==', familyCode),
        where('createdAt', '>=', start),
        where('createdAt', '<=', end)
      );
      const allTransactionsSnapshot = await retryFirestoreOperation(() => getDocs(allTransactionsQuery));
      totalBalance = allTransactionsSnapshot.docs.reduce((sum, doc) => {
        const tx = doc.data();
        return sum + (tx.type === TransactionType.CREDIT ? tx.amount : -tx.amount);
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
      budgetSnapshot.docs.forEach(doc => {
        const budget = doc.data();
        totalBudgetAmount += budget.amount;
        const categoryIds = budgetToCategories.get(doc.id) || [];
        const spent = categoryIds.length > 0 ? allTransactionsSnapshot.docs.reduce((sum, txDoc) => {
          const tx = txDoc.data();
          return categoryIds.includes(tx.categoryId) ? sum + (tx.type === TransactionType.DEBIT ? tx.amount : -tx.amount) : sum;
        }, 0) : 0;
        totalSpent += spent;
      });
      const [formattedTotalBalance, formattedTotalBudget, formattedTotalRemaining, formattedAfterBudget] = await Promise.all([
        formatCurrency(totalBalance, 'INR'),
        formatCurrency(totalBudgetAmount, 'INR'),
        formatCurrency(totalBudgetAmount - totalSpent, 'INR'),
        format THEY
System: formatCurrency(totalBalance - (totalBudgetAmount - totalSpent), 'INR')
      ]);
      elements.balance.textContent = formattedTotalBalance;
      elements.balance.parentElement.classList.remove('hidden');
      elements.totalBudget.textContent = formattedTotalBudget;
      elements.totalRemaining.textContent = formattedTotalRemaining;
      elements.totalBudget.parentElement.classList.remove('hidden');
      elements.afterBudget.textContent = formattedAfterBudget;
      elements.afterBudget.parentElement.classList.remove('hidden');
      await loadBudgets();
      if (!elements.childTiles.innerHTML) {
        await loadChildTiles();
      }
    }
  } catch (error) {
    log('updateDashboard', 'Error', 'updating dashboard');
    showError('balance', `Failed to update dashboard: ${error.message}`);
  }
}

async function setupLogout() {
  log('setupLogout', 'Starting', '');
  const maxAttempts = 10;
  let attempts = 0;
  const poll = setInterval(() => {
    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) {
      log('setupLogout', 'Found', 'logout button, setting up listener');
      clearInterval(poll);
      logoutButton.addEventListener('click', async () => {
        if (!auth) {
          log('setupLogout', 'Error', 'Authentication service not available');
          showError('page-title', 'Authentication service not available');
          return;
        }
        try {
          logoutButton.disabled = true;
          logoutButton.textContent = 'Logging out...';
          let signOutSuccess = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              await signOut(auth);
              signOutSuccess = true;
              log('setupLogout', 'Success', 'Sign out successful');
              break;
            } catch (error) {
              log('setupLogout', 'Warning', `Sign out attempt ${attempt} failed: ${error}`);
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
            log('setupLogout', 'Error', 'All sign out attempts failed');
            showError('page-title', 'Failed to log out: Connectivity issue');
          }
        } catch (error) {
          log('setupLogout', 'Error', 'during logout');
          showError('page-title', `Failed to log out: ${error.message}`);
        } finally {
          logoutButton.disabled = false;
          logoutButton.textContent = 'Logout';
        }
      });
    } else if (attempts++ >= maxAttempts) {
      log('setupLogout', 'Warning', 'Logout button not found after max attempts');
      clearInterval(poll);
    }
  }, 500);
}

async function initApp() {
  log('initApp', 'Starting', '');
  try {
    if (currentUser && state.currentAccountType === AccountType.ADMIN && db && familyCode) {
      log('initApp', 'Resetting', 'budgets for admin');
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
    log('initApp', 'Error', 'Failed to initialize app');
    showError('page-title', 'Failed to initialize app.');
  }
}

export { loadAppData, initApp };
