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

let isEditing = { transaction: false, budget: false, category: false, profile: false, childTransaction: false };
let currentChildUserId = null;
let currentAccountType = null;
let loadedTabs = { budgets: false, transactions: false, childAccounts: false };

// Utility to debounce functions
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Load App Data
async function loadAppData() {
  console.log('loadAppData: Starting');
  if (!currentUser || !familyCode || !db) {
    console.error('Cannot load app data: missing user, familyCode, or Firestore');
    return;
  }
  try {
    const [inrUsdRate, inrZarRate, usdZarRate] = await Promise.all([
      fetchExchangeRate('INR', 'USD', exchangeRateCache.get('INR_USD')),
      fetchExchangeRate('INR', 'ZAR', exchangeRateCache.get('INR_ZAR')),
      fetchExchangeRate('USD', 'ZAR', exchangeRateCache.get('USD_ZAR'))
    ]);
    exchangeRateCache.set('INR_USD', { rate: inrUsdRate, timestamp: Date.now() });
    exchangeRateCache.set('INR_ZAR', { rate: inrZarRate, timestamp: Date.now() });
    exchangeRateCache.set('USD_ZAR', { rate: usdZarRate, timestamp: Date.now() });
    if (domElements.currencyToggle) domElements.currencyToggle.value = userCurrency;
    await Promise.all([loadProfileData(), loadCategories(), updateDashboard()]);
    console.log('loadAppData: Complete');
  } catch (error) {
    console.error('loadAppData error:', error);
    showError('page-title', 'Failed to load app data.');
  }
}

// Tab Management
const tabs = [
  { id: 'dashboard', name: 'Dashboard', show: showDashboard, section: 'dashboardSection' },
  { id: 'transactions', name: 'Transactions', show: showTransactions, section: 'transactionsSection', load: loadTransactions },
  { id: 'budgets', name: 'Budgets', show: showBudgets, section: 'budgetsSection', load: loadBudgets },
  { id: 'categories', name: 'Categories', show: showCategories, section: 'categoriesSection' },
  { id: 'child-accounts', name: 'Child Accounts', show: showChildAccounts, section: 'childAccountsSection', load: loadChildAccounts },
  { id: 'profile', name: 'Profile', show: showProfile, section: 'profileSection', load: loadProfileData }
];

function setupTabs() {
  console.log('Setting up tab navigation');
  let currentTabIndex = 0;

  function switchTab(tabId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) {
      console.error('Invalid tab ID:', tabId);
      return;
    }
    currentTabIndex = tabs.findIndex(t => t.id === tabId);
    tab.show();
    updateTabUI(tabId);
  }

  function updateTabUI(tabId) {
    tabs.forEach(t => {
      const tabButton = domElements[`${t.id.replace('-', '')}Tab`];
      if (tabButton) {
        tabButton.setAttribute('aria-selected', t.id === tabId);
        tabButton.classList.toggle('bg-blue-800', t.id === tabId);
      }
      domElements[t.section]?.classList.toggle('hidden', t.id !== tabId);
    });
    const tab = tabs.find(t => t.id === tabId);
    if (domElements.pageTitle) domElements.pageTitle.textContent = tab.name;
    const menuItems = document.getElementById('menu-items');
    const menuToggle = document.getElementById('menu-toggle');
    if (menuItems && menuToggle && window.matchMedia('(max-width: 768px)').matches) {
      menuItems.classList.add('hidden');
      menuToggle.setAttribute('aria-expanded', 'false');
    }
  }

  async function showDashboard() {
    await updateDashboard();
  }

  async function showTransactions() {
    if (!loadedTabs.transactions) {
      await loadTransactions();
      loadedTabs.transactions = true;
    }
  }

  async function showBudgets() {
    if (!loadedTabs.budgets) {
      await loadBudgets();
      loadedTabs.budgets = true;
    }
  }

  function showCategories() {}

  async function showChildAccounts() {
    if (!loadedTabs.childAccounts) {
      await loadChildAccounts();
      loadedTabs.childAccounts = true;
    }
  }

  function showProfile() {
    loadProfileData();
  }

  tabs.forEach(tab => {
    const tabButton = domElements[`${tab.id.replace('-', '')}Tab`];
    if (tabButton) tabButton.addEventListener('click', () => switchTab(tab.id));
  });

  const menuToggle = document.getElementById('menu-toggle');
  const menuItems = document.getElementById('menu-items');
  if (menuToggle && menuItems) {
    menuToggle.addEventListener('click', () => {
      const isExpanded = menuItems.classList.toggle('hidden');
      menuToggle.setAttribute('aria-expanded', !isExpanded);
    });
  }

  const swipeContainer = document.getElementById('swipeable-tabs');
  if (swipeContainer && window.matchMedia('(max-width: 768px)').matches) {
    let touchStartX = 0, touchStartY = 0;
    const minSwipeDistance = 50;

    swipeContainer.addEventListener('touchstart', (event) => {
      if (event.target.closest('.no-swipe')) return;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    });

    swipeContainer.addEventListener('touchend', (event) => {
      if (event.target.closest('.no-swipe')) return;
      const deltaX = event.changedTouches[0].clientX - touchStartX;
      const deltaY = Math.abs(event.changedTouches[0].clientY - touchStartY);
      if (deltaY > 50 || Math.abs(deltaX) < minSwipeDistance) return;
      event.preventDefault();
      if (deltaX < 0 && currentTabIndex < tabs.length - 1) {
        switchTab(tabs[currentTabIndex + 1].id);
      } else if (deltaX > 0 && currentTabIndex > 0) {
        switchTab(tabs[currentTabIndex - 1].id);
      }
    });
  }

  switchTab('dashboard');
}

// Profile Management
async function setupProfile() {
  console.log('Setting up profile event listeners');

  const toggleEditProfile = (enable) => {
    isEditing.profile = enable;
    domElements.profileEmail?.toggleAttribute('readonly', !enable);
    domElements.profileCurrency?.toggleAttribute('disabled', !enable);
    domElements.profileAccountType?.toggleAttribute('disabled', !enable);
    domElements.profileEmail?.classList.toggle('bg-gray-100', !enable);
    domElements.profileCurrency?.classList.toggle('bg-gray-100', !enable);
    domElements.profileAccountType?.classList.toggle('bg-gray-100', !enable);
    domElements.profileFamilyCode?.setAttribute('readonly', 'true');
    domElements.profileFamilyCode?.classList.add('bg-gray-100');
    domElements.editProfile?.classList.toggle('hidden', enable);
    domElements.saveProfile?.classList.toggle('hidden', !enable);
  };

  domElements.editProfile?.addEventListener('click', () => toggleEditProfile(true));

  domElements.saveProfile?.addEventListener('click', async () => {
    clearErrors();
    const email = domElements.profileEmail?.value.trim();
    const currency = domElements.profileCurrency?.value;
    const accountType = domElements.profileAccountType?.value;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('profile-email', 'Valid email is required');
      return;
    }
    if (!['INR', 'USD', 'ZAR'].includes(currency)) {
      showError('profile-currency', 'Valid currency is required');
      return;
    }
    if (!['admin', 'child'].includes(accountType)) {
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
      currentAccountType = accountType;
      toggleEditProfile(false);
      domElements.currencyToggle.value = currency;
      await Promise.all([loadBudgets(), loadTransactions(), loadChildAccounts(), updateDashboard()]);
    } catch (error) {
      showError('profile-email', error.code === 'auth/email-already-in-use' ? 'This email is already in use.' :
        error.code === 'auth/invalid-email' ? 'Invalid email format.' :
        error.code === 'auth/requires-recent-login' ? 'Please log out and log in again to update email.' :
        'Failed to save profile.');
    } finally {
      domElements.saveProfile.disabled = false;
      domElements.saveProfile.textContent = 'Save Profile';
    }
  });

  domElements.currencyToggle?.addEventListener('change', debounce(async () => {
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
      domElements.profileCurrency.value = newCurrency;
      await Promise.all([loadBudgets(), loadTransactions(), loadChildAccounts(), updateDashboard()]);
    } catch (error) {
      showError('currency-toggle', 'Failed to update currency.');
    }
  }, 300));

  domElements.dashboardFilter?.addEventListener('change', () => {
    domElements.customDateRange?.classList.toggle('hidden', domElements.dashboardFilter.value !== 'custom');
    updateDashboard();
  });
}

async function loadProfileData() {
  if (!currentUser || !db) {
    console.error('Cannot load profile data: missing user or Firestore');
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
      currentAccountType = data.accountType || '--';
    } else {
      showError('profile-email', 'Profile data not found.');
    }
  } catch (error) {
    showError('profile-email', 'Failed to load profile data.');
  }
}

async function loadCategories() {
  try {
    const elements = {
      categorySelect: document.getElementById('category'),
      categoryBudgetSelect: document.getElementById('category-budget-select'),
      newCategoryBudgetSelect: document.getElementById('new-category-budget'),
      categoryTable: document.getElementById('category-table')
    };
    if (Object.values(elements).some(el => !el)) {
      showError('category-name', 'Category form or table not found');
      return;
    }

    elements.categorySelect.innerHTML = '<option value="">Select Category</option><option value="add-new">Add New</option>';
    elements.categoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
    if (elements.newCategoryBudgetSelect) {
      elements.newCategoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
    }
    elements.categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">Loading...</td></tr>';

    const budgetsQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
    const budgetsSnapshot = await retryFirestoreOperation(() => getDocs(budgetsQuery)) || { docs: [] };
    const budgetMap = new Map();
    budgetsSnapshot.forEach(doc => {
      budgetMap.set(doc.id, doc.data().name);
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = doc.data().name;
      elements.categoryBudgetSelect.insertBefore(option, elements.categoryBudgetSelect.querySelector('option[value="add-new"]'));
      if (elements.newCategoryBudgetSelect) {
        const newOption = option.cloneNode(true);
        elements.newCategoryBudgetSelect.insertBefore(newOption, elements.newCategoryBudgetSelect.querySelector('option[value="add-new"]'));
      }
    });

    const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
    const categoriesSnapshot = await retryFirestoreOperation(() => getDocs(categoriesQuery));
    elements.categoryTable.innerHTML = '';
    if (categoriesSnapshot.empty) {
      elements.categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">No categories found</td></tr>';
      return;
    }

    const fragment = document.createDocumentFragment();
    categoriesSnapshot.forEach(doc => {
      const category = doc.data();
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = category.name;
      elements.categorySelect.insertBefore(option, elements.categorySelect.querySelector('option[value="add-new"]'));

      const tr = document.createElement('tr');
      tr.classList.add('table-row');
      const budgetName = category.budgetId ? budgetMap.get(category.budgetId) || 'Unknown' : 'None';
      tr.innerHTML = `
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${category.name || 'Unknown'}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${category.type || 'Unknown'}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${budgetName}</td>
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
    document.getElementById('category-table').innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-600">Error loading categories</td></tr>';
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

  const addCategoryHandler = async () => {
    if (isEditing.category) return;
    clearErrors();
    const inputs = {
      name: document.getElementById('category-name')?.value.trim(),
      type: document.getElementById('category-type')?.value,
      budgetId: document.getElementById('category-budget-select')?.value === 'none' ? null : document.getElementById('category-budget-select')?.value
    };
    if (!inputs.name) {
      showError('category-name', 'Name is required');
      return;
    }
    if (!inputs.type) {
      showError('category-type', 'Type is required');
      return;
    }
    try {
      elements.addCategory.disabled = true;
      elements.addCategory.textContent = 'Adding...';
      await retryFirestoreOperation(() =>
        addDoc(collection(db, 'categories'), {
          name: inputs.name,
          type: inputs.type,
          budgetId: inputs.budgetId,
          familyCode,
          createdAt: serverTimestamp()
        })
      );
      document.getElementById('category-name').value = '';
      document.getElementById('category-type').value = 'income';
      document.getElementById('category-budget-select').value = 'none';
      await loadCategories();
    } catch (error) {
      showError('category-name', `Failed to add category: ${error.message}`);
    } finally {
      elements.addCategory.disabled = false;
      elements.addCategory.textContent = 'Add Category';
    }
  };

  elements.addCategory.addEventListener('click', addCategoryHandler);

  elements.categorySelect.addEventListener('change', () => {
    if (elements.categorySelect.value === 'add-new') {
      if (domElements.addCategoryModal) {
        domElements.addCategoryModal.classList.remove('hidden');
        elements.categorySelect.value = '';
      } else {
        showError('category', 'Add category modal not found');
      }
    }
  });

  elements.saveCategory.addEventListener('click', async () => {
    clearErrors();
    const inputs = {
      name: document.getElementById('new-category-name')?.value.trim(),
      type: document.getElementById('new-category-type')?.value,
      budgetId: document.getElementById('new-category-budget')?.value === 'none' ? null : document.getElementById('new-category-budget')?.value
    };
    if (!inputs.name) {
      showError('new-category-name', 'Name is required');
      return;
    }
    if (!inputs.type) {
      showError('new-category-type', 'Type is required');
      return;
    }
    try {
      elements.saveCategory.disabled = true;
      elements.saveCategory.textContent = 'Saving...';
      await retryFirestoreOperation(() =>
        addDoc(collection(db, 'categories'), {
          name: inputs.name,
          type: inputs.type,
          budgetId: inputs.budgetId,
          familyCode,
          createdAt: serverTimestamp()
        })
      );
      domElements.addCategoryModal?.classList.add('hidden');
      document.getElementById('new-category-name').value = '';
      document.getElementById('new-category-type').value = 'income';
      document.getElementById('new-category-budget').value = 'none';
      await loadCategories();
    } catch (error) {
      showError('new-category-name', `Failed to save category: ${error.message}`);
    } finally {
      elements.saveCategory.disabled = false;
      elements.saveCategory.textContent = 'Save';
    }
  });

  elements.cancelCategory.addEventListener('click', () => {
    domElements.addCategoryModal?.classList.add('hidden');
    document.getElementById('new-category-name').value = '';
    document.getElementById('new-category-type').value = 'income';
    document.getElementById('new-category-budget').value = 'none';
  });

  elements.categoryTable.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-category')) {
      const id = e.target.dataset.id;
      const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', id)));
      if (!docSnap.exists()) {
        showError('category-name', 'Category not found');
        return;
      }
      const data = docSnap.data();
      document.getElementById('category-name').value = data.name || '';
      document.getElementById('category-type').value = data.type || 'income';
      document.getElementById('category-budget-select').value = data.budgetId || 'none';
      elements.addCategory.innerHTML = 'Update Category';
      isEditing.category = true;

      const updateHandler = async () => {
        const inputs = {
          name: document.getElementById('category-name')?.value.trim(),
          type: document.getElementById('category-type')?.value,
          budgetId: document.getElementById('category-budget-select')?.value === 'none' ? null : document.getElementById('category-budget-select')?.value
        };
        if (!inputs.name) {
          showError('category-name', 'Name is required');
          return;
        }
        if (!inputs.type) {
          showError('category-type', 'Type is required');
          return;
        }
        try {
          elements.addCategory.disabled = true;
          elements.addCategory.textContent = 'Updating...';
          await retryFirestoreOperation(() =>
            updateDoc(doc(db, 'categories', id), { name: inputs.name, type: inputs.type, budgetId: inputs.budgetId })
          );
          document.getElementById('category-name').value = '';
          document.getElementById('category-type').value = 'income';
          document.getElementById('category-budget-select').value = 'none';
          elements.addCategory.innerHTML = 'Add Category';
          isEditing.category = false;
          await loadCategories();
        } catch (error) {
          showError('category-name', `Failed to update category: ${error.message}`);
        } finally {
          elements.addCategory.disabled = false;
          elements.addCategory.textContent = 'Add Category';
          isEditing.category = false;
        }
      };
      elements.addCategory.removeEventListener('click', elements.addCategory._updateHandler);
      elements.addCategory._updateHandler = updateHandler;
      elements.addCategory.addEventListener('click', updateHandler, { once: true });
    } else if (e.target.classList.contains('delete-category')) {
      const id = e.target.dataset.id;
      if (!domElements.deleteConfirmModal) {
        showError('category-name', 'Cannot delete: Missing components');
        return;
      }
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
      };
      const cancelHandler = () => domElements.deleteConfirmModal.classList.add('hidden');
      domElements.confirmDelete.addEventListener('click', confirmHandler, { once: true });
      domElements.cancelDelete.addEventListener('click', cancelHandler, { once: true });
    }
  });
}

async function loadBudgets() {
  if (!db) {
    showError('budget-name', 'Database service not available');
    return;
  }
  if (currentAccountType === 'admin') {
    await resetBudgetsForNewMonth(db, familyCode, currentAccountType);
  }
  const elements = {
    budgetTable: document.getElementById('budget-table'),
    budgetTiles: document.getElementById('budget-tiles')
  };
  if (!elements.budgetTable || !elements.budgetTiles) {
    showError('budget-name', 'Budget table or tiles not found');
    return;
  }
  elements.budgetTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading...</td></tr>';
  elements.budgetTiles.innerHTML = '<div class="text-center py-4">Loading...</div>';

  const filter = domElements.dashboardFilter?.value || 'thisMonth';
  let { start, end } = getDateRange(filter, domElements.filterStartDate, domElements.filterEndDate);
  start = new Date(start.getTime() - 5.5 * 60 * 60 * 1000);

  const transactions = await fetchCachedTransactions(db, familyCode, start, end);
  const categoriesSnapshot = await retryFirestoreOperation(() => getDocs(query(collection(db, 'categories'), where('familyCode', '==', familyCode))));
  const budgetToCategories = new Map();
  categoriesSnapshot.forEach(doc => {
    if (doc.data().budgetId) {
      budgetToCategories.set(doc.data().budgetId, [...(budgetToCategories.get(doc.data().budgetId) || []), doc.id]);
    }
  });

  let totalBudgetAmount = 0, totalRemainingAmount = 0;
  const budgetsSnapshot = await retryFirestoreOperation(() => getDocs(query(collection(db, 'budgets'), where('familyCode', '==', familyCode))));
  elements.budgetTable.innerHTML = '';
  elements.budgetTiles.innerHTML = '';
  if (budgetsSnapshot.empty) {
    elements.budgetTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">No budgets found</td></tr>';
    elements.budgetTiles.innerHTML = '<div class="text-center py-4">No budgets found</div>';
    return;
  }

  const tableFragment = document.createDocumentFragment();
  const tilesFragment = document.createDocumentFragment();
  for (const doc of budgetsSnapshot.docs) {
    const budget = doc.data();
    const categoryIds = budgetToCategories.get(doc.id) || [];
    const spent = categoryIds.length > 0 ? transactions.reduce((sum, tx) => {
      return categoryIds.includes(tx.categoryId) ? sum + (tx.type === 'debit' ? tx.amount : -tx.amount) : sum;
    }, 0) : 0;

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

  if (document.getElementById('total-budget')) document.getElementById('total-budget').textContent = await formatCurrency(totalBudgetAmount, 'INR');
  if (document.getElementById('total-remaining')) document.getElementById('total-remaining').textContent = await formatCurrency(totalRemainingAmount, 'INR');
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

  const addOrUpdateBudget = async (id = null) => {
    if (isEditing.budget && !id) return;
    clearErrors();
    const inputs = {
      name: document.getElementById(id ? 'budget-name' : 'new-budget-name')?.value.trim(),
      amount: parseFloat(document.getElementById(id ? 'budget-amount' : 'new-budget-amount')?.value.trim())
    };
    if (!inputs.name) {
      showError(id ? 'budget-name' : 'new-budget-name', 'Budget name is required');
      return;
    }
    if (isNaN(inputs.amount) || inputs.amount <= 0) {
      showError(id ? 'budget-amount' : 'new-budget-amount', 'Valid positive amount is required');
      return;
    }
    if (currentAccountType !== 'admin') {
      showError(id ? 'budget-name' : 'new-budget-name', 'Only admins can add budgets');
      return;
    }
    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
    if (!userDoc.exists() || !userDoc.data().familyCode) {
      showError(id ? 'budget-name' : 'new-budget-name', 'Invalid user configuration');
      return;
    }
    try {
      elements.addBudget.disabled = true;
      elements.addBudget.textContent = id ? 'Updating...' : 'Adding...';
      const now = new Date();
      const budgetData = {
        name: inputs.name,
        amount: inputs.amount,
        spent: 0,
        familyCode: userDoc.data().familyCode,
        createdAt: serverTimestamp(),
        lastResetMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      };
      if (id) {
        await retryFirestoreOperation(() => updateDoc(doc(db, 'budgets', id), { name: inputs.name, amount: inputs.amount }));
      } else {
        await retryFirestoreOperation(() => addDoc(collection(db, 'budgets'), budgetData));
      }
      clearTransactionCache();
      document.getElementById(id ? 'budget-name' : 'new-budget-name').value = '';
      document.getElementById(id ? 'budget-amount' : 'new-budget-amount').value = '';
      elements.addBudget.innerHTML = 'Add Budget';
      isEditing.budget = false;
      if (!id) domElements.addBudgetModal?.classList.add('hidden');
      await loadBudgets();
      await loadCategories();
    } catch (error) {
      showError(id ? 'budget-name' : 'new-budget-name', `Failed to ${id ? 'update' : 'add'} budget: ${error.message}`);
    } finally {
      elements.addBudget.disabled = false;
      elements.addBudget.textContent = 'Add Budget';
    }
  };

  elements.addBudget.addEventListener('click', () => addOrUpdateBudget());
  elements.saveBudget.addEventListener('click', () => addOrUpdateBudget());
  elements.cancelBudget.addEventListener('click', () => {
    domElements.addBudgetModal?.classList.add('hidden');
    document.getElementById('new-budget-name').value = '';
    document.getElementById('new-budget-amount').value = '';
  });

  domElements.categoryBudgetSelect?.addEventListener('change', () => {
    if (domElements.categoryBudgetSelect.value === 'add-new') {
      domElements.addBudgetModal?.classList.remove('hidden');
      domElements.categoryBudgetSelect.value = 'none';
    }
  });

  elements.budgetTable.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-budget')) {
      const id = e.target.dataset.id;
      const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'budgets', id)));
      if (docSnap.exists()) {
        const data = docSnap.data();
        document.getElementById('budget-name').value = data.name;
        document.getElementById('budget-amount').value = data.amount;
        elements.addBudget.innerHTML = 'Update Budget';
        isEditing.budget = true;
        const updateHandler = () => addOrUpdateBudget(id);
        elements.addBudget.removeEventListener('click', elements.addBudget._updateHandler);
        elements.addBudget._updateHandler = updateHandler;
        elements.addBudget.addEventListener('click', updateHandler, { once: true });
      }
    } else if (e.target.classList.contains('delete-budget')) {
      const id = e.target.dataset.id;
      if (!domElements.deleteConfirmModal) return;
      domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this budget?';
      domElements.deleteConfirmModal.classList.remove('hidden');
      const confirmHandler = async () => {
        await retryFirestoreOperation(() => deleteDoc(doc(db, 'budgets', id)));
        clearTransactionCache();
        await loadBudgets();
        await loadCategories();
        domElements.deleteConfirmModal.classList.add('hidden');
      };
      const cancelHandler = () => domElements.deleteConfirmModal.classList.add('hidden');
      domElements.confirmDelete.addEventListener('click', confirmHandler, { once: true });
      domElements.cancelDelete.addEventListener('click', cancelHandler, { once: true });
    }
  });
}

async function loadTransactions() {
  const elements = {
    transactionTable: document.getElementById('transaction-table'),
    dateHeader: document.getElementById('transaction-date-header'),
    transactionsFilter: document.getElementById('transactions-filter')
  };
  if (Object.values(elements).some(el => !el)) {
    showError('transactions-filter', 'Transaction table, date header, or filter not found');
    return;
  }
  elements.transactionTable.innerHTML = '<tr><td colspan="6" class="text-center py-4">Loading...</td></tr>';

  const filter = elements.transactionsFilter.value || 'thisMonth';
  const { start, end } = getDateRange(filter, domElements.filterStartDate, domElements.filterEndDate);
  const adjustedStart = new Date(start.getTime() - 5.5 * 60 * 60 * 1000);

  elements.dateHeader.textContent = filter === 'thisMonth' ? new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' }) :
    filter === 'lastMonth' ? new Date(start).toLocaleString('en-US', { month: 'short', year: 'numeric' }) :
    filter.includes('Year') ? start.getFullYear().toString() : 'Date';

  const categoriesSnapshot = await retryFirestoreOperation(() => getDocs(query(collection(db, 'categories'), where('familyCode', '==', familyCode)))) || { docs: [] };
  const categoryMap = new Map(categoriesSnapshot.docs.map(doc => [doc.id, doc.data().name]));

  const transactions = await fetchCachedTransactions(db, familyCode, adjustedStart, end);
  elements.transactionTable.innerHTML = '';
  if (!transactions.length) {
    elements.transactionTable.innerHTML = '<tr><td colspan="6" class="text-center py-4">No transactions found for this period</td></tr>';
    return;
  }

  const fragment = document.createDocumentFragment();
  transactions.sort((a, b) => b.createdAt - a.createdAt).forEach(transaction => {
    const tr = document.createElement('tr');
    tr.classList.add('table-row');
    const categoryName = transaction.categoryId ? categoryMap.get(transaction.categoryId) || 'Unknown' : 'None';
    const day = transaction.createdAt.toLocaleString('en-US', { day: 'numeric' });
    tr.innerHTML = `
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.type || 'Unknown'}</td>
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${formatCurrency(transaction.amount || 0, 'INR')}</td>
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${categoryName}</td>
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.description || ''}</td>
      <td class="w-12 px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${day}</td>
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm">
        <button class="text-blue-600 hover:text-blue-800 mr-2 edit-transaction" data-id="${transaction.id}">Edit</button>
        <button class="text-red-600 hover:text-red-800 delete-transaction" data-id="${transaction.id}">Delete</button>
      </td>
    `;
    fragment.appendChild(tr);
  });
  elements.transactionTable.appendChild(fragment);
}

async function setupTransactions() {
  const elements = {
    addTransaction: document.getElementById('add-transaction'),
    transactionTable: document.getElementById('transaction-table'),
    transactionsFilter: document.getElementById('transactions-filter')
  };
  if (Object.values(elements).some(el => !el)) {
    showError('category', 'Transaction form, table, or filter not found');
    return;
  }

  elements.transactionsFilter.addEventListener('change', debounce(loadTransactions, 300));

  const addOrUpdateTransaction = async (id = null) => {
    if (isEditing.transaction && !id) return;
    clearErrors();
    const inputs = {
      type: document.getElementById('type')?.value,
      amount: parseFloat(document.getElementById('amount')?.value),
      categoryId: document.getElementById('category')?.value,
      description: document.getElementById('description')?.value.trim(),
      date: document.getElementById('transaction-date')?.value ? new Date(document.getElementById('transaction-date').value) : new Date()
    };
    if (!inputs.amount || inputs.amount <= 0) {
      showError('amount', 'Valid amount is required');
      return;
    }
    if (!inputs.categoryId) {
      showError('category', 'Category is required');
      return;
    }
    if (isNaN(inputs.date)) {
      showError('transaction-date', 'Valid date is required');
      return;
    }
    try {
      elements.addTransaction.disabled = true;
      elements.addTransaction.textContent = id ? 'Updating...' : 'Adding...';
      let oldBudgetId = null, newBudgetId = null;
      if (id) {
        const oldData = (await retryFirestoreOperation(() => getDoc(doc(db, 'transactions', id)))).data();
        if (oldData.type === 'debit') {
          const oldCategoryDoc = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', oldData.categoryId)));
          if (oldCategoryDoc.exists() && oldCategoryDoc.data().budgetId) oldBudgetId = oldCategoryDoc.data().budgetId;
        }
        if (inputs.type === 'debit') {
          const newCategoryDoc = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', inputs.categoryId)));
          if (newCategoryDoc.exists() && newCategoryDoc.data().budgetId) newBudgetId = newCategoryDoc.data().budgetId;
        }
        if (oldBudgetId && oldBudgetId === newBudgetId) {
          const amountDiff = inputs.amount - oldData.amount;
          if (amountDiff !== 0) {
            await retryFirestoreOperation(() =>
              updateDoc(doc(db, 'budgets', oldBudgetId), { spent: increment(amountDiff) })
            );
          }
        } else {
          if (oldBudgetId && oldData.type === 'debit') {
            await retryFirestoreOperation(() =>
              updateDoc(doc(db, 'budgets', oldBudgetId), { spent: increment(-oldData.amount) })
            );
          }
          if (newBudgetId && inputs.type === 'debit') {
            await retryFirestoreOperation(() =>
              updateDoc(doc(db, 'budgets', newBudgetId), { spent: increment(inputs.amount) })
            );
          }
        }
        await retryFirestoreOperation(() =>
          updateDoc(doc(db, 'transactions', id), {
            type: inputs.type,
            amount: inputs.amount,
            categoryId: inputs.categoryId,
            description: inputs.description,
            createdAt: inputs.date
          })
        );
      } else {
        await retryFirestoreOperation(() =>
          addDoc(collection(db, 'transactions'), {
            type: inputs.type,
            amount: inputs.amount,
            categoryId: inputs.categoryId,
            description: inputs.description,
            familyCode,
            createdAt: inputs.date
          })
        );
        if (inputs.type === 'debit') {
          const categoryDoc = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', inputs.categoryId)));
          if (categoryDoc.exists() && categoryDoc.data().budgetId) {
            await retryFirestoreOperation(() =>
              updateDoc(doc(db, 'budgets', categoryDoc.data().budgetId), { spent: increment(inputs.amount) })
            );
          }
        }
      }
      clearTransactionCache();
      document.getElementById('type').value = 'debit';
      document.getElementById('amount').value = '';
      document.getElementById('category').value = '';
      document.getElementById('description').value = '';
      document.getElementById('transaction-date').value = '';
      elements.addTransaction.innerHTML = 'Add Transaction';
      isEditing.transaction = false;
      await loadBudgets();
      await loadTransactions();
      await updateDashboard();
    } catch (error) {
      showError('category', `Failed to ${id ? 'update' : 'add'} transaction: ${error.message}`);
    } finally {
      elements.addTransaction.disabled = false;
      elements.addTransaction.textContent = 'Add Transaction';
    }
  };

  elements.addTransaction.addEventListener('click', () => addOrUpdateTransaction());

  elements.transactionTable.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-transaction')) {
      const id = e.target.dataset.id;
      const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'transactions', id)));
      if (!docSnap.exists()) {
        showError('category', 'Transaction not found');
        return;
      }
      const data = docSnap.data();
      document.getElementById('type').value = data.type;
      document.getElementById('amount').value = data.amount;
      document.getElementById('category').value = data.categoryId;
      document.getElementById('description').value = data.description || '';
      document.getElementById('transaction-date').value = (data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt)).toISOString().split('T')[0];
      elements.addTransaction.innerHTML = 'Update Transaction';
      isEditing.transaction = true;
      const updateHandler = () => addOrUpdateTransaction(id);
      elements.addTransaction.removeEventListener('click', elements.addTransaction._updateHandler);
      elements.addTransaction._updateHandler = updateHandler;
      elements.addTransaction.addEventListener('click', updateHandler, { once: true });
    } else if (e.target.classList.contains('delete-transaction')) {
      const id = e.target.dataset.id;
      if (!domElements.deleteConfirmModal) {
        showError('category', 'Cannot delete: Missing components');
        return;
      }
      domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this transaction?';
      domElements.deleteConfirmModal.classList.remove('hidden');
      const confirmHandler = async () => {
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
          await loadBudgets();
          await loadTransactions();
          await updateDashboard();
          domElements.deleteConfirmModal.classList.add('hidden');
        }
      };
      const cancelHandler = () => domElements.deleteConfirmModal.classList.add('hidden');
      domElements.confirmDelete.addEventListener('click', confirmHandler, { once: true });
      domElements.cancelDelete.addEventListener('click', cancelHandler, { once: true });
    }
  });
}

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

  domElements.childAccountsSection?.classList.remove('hidden');
  if (currentAccountType === 'admin') {
    elements.childSelector.classList.remove('hidden');
    elements.childUserIdSelect.innerHTML = '<option value="">Select a Child</option>';
    const usersQuery = query(collection(db, 'users'), where('familyCode', '==', familyCode), where('accountType', '==', 'child'));
    const snapshot = await retryFirestoreOperation(() => getDocs(usersQuery));
    if (snapshot.empty) {
      elements.childUserIdSelect.innerHTML = '<option value="">No children found</option>';
    } else {
      snapshot.forEach(doc => {
        const data = doc.data();
        const displayName = data.email && data.email.trim() !== '' ? data.email : `Child Account ${doc.id.substring(0, 8)}`;
        const option = document.createElement('option');
        option.value = doc.id;
        option.textContent = displayName;
        elements.childUserIdSelect.appendChild(option);
      });
    }
    currentChildUserId = elements.childUserIdSelect.value || null;
  } else {
    elements.childSelector.classList.add('hidden');
    currentChildUserId = currentUser.uid;
  }
  await loadChildTransactions();
}

async function loadChildTransactions() {
  if (!db || !currentChildUserId) {
    showError('child-transaction-description', 'No user selected');
    document.getElementById('child-transaction-table').innerHTML = '<tr><td colspan="5" class="text-center py-4">No user selected</td></tr>';
    document.getElementById('child-balance').textContent = '₹0';
    return;
  }
  const elements = {
    childTransactionTable: document.getElementById('child-transaction-table'),
    childBalance: document.getElementById('child-balance'),
    dateHeader: document.getElementById('child-transaction-date-header')
  };
  if (Object.values(elements).some(el => !el)) {
    showError('child-transaction-description', 'Transaction table, balance, or date header not found');
    return;
  }

  elements.childTransactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading...</td></tr>';
  const { start, end } = getDateRange(domElements.dashboardFilter?.value || 'thisMonth', domElements.filterStartDate, domElements.filterEndDate);
  const filterMonth = domElements.dashboardFilter?.value && domElements.dashboardFilter.value !== 'thisMonth' ?
    start.toLocaleString('en-US', { month: 'short' }) : new Date().toLocaleString('en-US', { month: 'short' });
  elements.dateHeader.textContent = filterMonth;

  let totalBalance = 0;
  const transactionsQuery = query(collection(db, 'childTransactions'), where('userId', '==', currentChildUserId));
  const snapshot = await retryFirestoreOperation(() => getDocs(transactionsQuery));
  elements.childTransactionTable.innerHTML = '';
  const transactions = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data(), createdAt: doc.data().createdAt?.toDate() || new Date() }))
    .filter(tx => tx.createdAt >= start && tx.createdAt <= end)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (!transactions.length) {
    elements.childTransactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">No transactions found for this period</td></tr>';
  } else {
    const fragment = document.createDocumentFragment();
    transactions.forEach(transaction => {
      totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
      const tr = document.createElement('tr');
      tr.classList.add('table-row');
      const day = transaction.createdAt.toLocaleString('en-US', { day: 'numeric' });
      tr.innerHTML = `
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.type || 'Unknown'}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${formatCurrency(transaction.amount || 0, 'INR')}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.description || ''}</td>
        <td class="w-12 px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${day}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm">
          <button class="text-blue-600 hover:text-blue-800 mr-2 edit-child-transaction" data-id="${transaction.id}" data-user-id="${transaction.userId}">Edit</button>
          <button class="text-red-600 hover:text-red-800 delete-child-transaction" data-id="${transaction.id}" data-user-id="${transaction.userId}">Delete</button>
        </td>
      `;
      fragment.appendChild(tr);
    });
    elements.childTransactionTable.appendChild(fragment);
  }
  elements.childBalance.textContent = await formatCurrency(totalBalance, 'INR');
}

async function loadChildTiles() {
  const childTiles = document.getElementById('child-tiles');
  if (!childTiles || !db || !familyCode) {
    showError('child-tiles', 'No family data');
    return;
  }
  childTiles.innerHTML = '<div class="text-center py-4">Loading...</div>';
  const childBalances = new Map();
  const usersQuery = query(collection(db, 'users'), where('familyCode', '==', familyCode), where('accountType', '==', 'child'));
  const snapshot = await retryFirestoreOperation(() => getDocs(usersQuery));
  if (snapshot.empty) {
    childTiles.innerHTML = '<div class="text-center py-4">No child accounts found</div>';
    return;
  }
  await Promise.all(snapshot.docs.map(async doc => {
    const userId = doc.id;
    const email = doc.data().email && doc.data().email.trim() !== '' ? doc.data().email : `Child Account ${userId.substring(0, 8)}`;
    const transQuery = query(collection(db, 'childTransactions'), where('userId', '==', userId));
    const transSnapshot = await retryFirestoreOperation(() => getDocs(transQuery));
    const balance = transSnapshot.docs.reduce((sum, transDoc) => {
      const trans = transDoc.data();
      return sum + (trans.type === 'credit' ? trans.amount : -trans.amount);
    }, 0);
    childBalances.set(userId, { email, balance });
  }));

  childTiles.innerHTML = '';
  if (!childBalances.size) {
    childTiles.innerHTML = '<div class="text-center py-4">No child accounts found</div>';
  } else {
    const fragment = document.createDocumentFragment();
    for (const [userId, { email, balance }] of childBalances) {
      const tile = document.createElement('div');
      tile.classList.add('bg-white', 'rounded-lg', 'shadow-md', 'p-6', 'child-tile');
      tile.innerHTML = `
        <h3 class="text-lg font-semibold text-gray-700">${email}</h3>
        <p class="text-sm font-semibold text-gray-700 mt-2">
          Balance: <span id="child-${userId}-balance">${formatCurrency(balance, 'INR')}</span>
        </p>
      `;
      fragment.appendChild(tile);
    }
    childTiles.appendChild(fragment);
  }
}

async function setupChildAccounts() {
  const elements = {
    addChildTransaction: document.getElementById('add-child-transaction'),
    childTransactionTable: document.getElementById('child-transaction-table'),
    childUserId: document.getElementById('child-user-id')
  };
  if (Object.values(elements).some(el => !el)) {
    showError('child-transaction-description', 'Child transaction form or table not found');
    return;
  }

  const addOrUpdateChildTransaction = async (id = null) => {
    if (isEditing.childTransaction && !id) return;
    clearErrors();
    const inputs = {
      type: document.getElementById('child-transaction-type')?.value,
      amount: parseFloat(document.getElementById('child-transaction-amount')?.value),
      description: document.getElementById('child-transaction-description')?.value.trim(),
      userId: currentAccountType === 'admin' ? currentChildUserId : currentUser.uid
    };
    if (!inputs.amount || inputs.amount <= 0) {
      showError('child-transaction-amount', 'Valid amount is required');
      return;
    }
    if (currentAccountType === 'admin' && !inputs.userId) {
      showError('child-user-id', 'Please select a child account');
      return;
    }
    try {
      elements.addChildTransaction.disabled = true;
      elements.addChildTransaction.textContent = id ? 'Updating...' : 'Adding...';
      if (id) {
        await retryFirestoreOperation(() =>
          updateDoc(doc(db, 'childTransactions', id), {
            type: inputs.type,
            amount: inputs.amount,
            description: inputs.description
          })
        );
      } else {
        const txId = `tx-${inputs.userId}-${inputs.type}-${inputs.amount}-${inputs.description}-${Date.now()}`.replace(/[^a-zA-Z0-9-]/g, '-');
        await retryFirestoreOperation(() =>
          setDoc(doc(db, 'childTransactions', txId), {
            type: inputs.type,
            amount: inputs.amount,
            description: inputs.description,
            userId: inputs.userId,
            familyCode,
            txId,
            createdAt: serverTimestamp()
          })
        );
      }
      document.getElementById('child-transaction-type').value = 'debit';
      document.getElementById('child-transaction-amount').value = '';
      document.getElementById('child-transaction-description').value = '';
      elements.addChildTransaction.innerHTML = 'Add Transaction';
      isEditing.childTransaction = false;
      await loadChildTransactions();
      await loadChildTiles();
    } catch (error) {
      showError('child-transaction-description', `Failed to ${id ? 'update' : 'add'} transaction: ${error.message}`);
    } finally {
      elements.addChildTransaction.disabled = false;
      elements.addChildTransaction.textContent = 'Add Transaction';
    }
  };

  elements.addChildTransaction.addEventListener('click', debounce(() => addOrUpdateChildTransaction(), 5000));

  elements.childTransactionTable.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-child-transaction')) {
      const id = e.target.dataset.id;
      const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'childTransactions', id)));
      if (!docSnap.exists()) {
        showError('child-transaction-description', 'Transaction not found');
        return;
      }
      const data = docSnap.data();
      document.getElementById('child-transaction-type').value = data.type || 'debit';
      document.getElementById('child-transaction-amount').value = data.amount || '';
      document.getElementById('child-transaction-description').value = data.description || '';
      elements.addChildTransaction.innerHTML = 'Update Transaction';
      isEditing.childTransaction = true;
      const updateHandler = () => addOrUpdateChildTransaction(id);
      elements.addChildTransaction.removeEventListener('click', elements.addChildTransaction._updateHandler);
      elements.addChildTransaction._updateHandler = updateHandler;
      elements.addChildTransaction.addEventListener('click', updateHandler, { once: true });
    } else if (e.target.classList.contains('delete-child-transaction')) {
      const id = e.target.dataset.id;
      if (!domElements.deleteConfirmModal) {
        showError('child-transaction-description', 'Cannot delete: Missing components');
        return;
      }
      domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this child transaction?';
      domElements.deleteConfirmModal.classList.remove('hidden');
      const confirmHandler = async () => {
        await retryFirestoreOperation(() => deleteDoc(doc(db, 'childTransactions', id)));
        await loadChildTransactions();
        await loadChildTiles();
        domElements.deleteConfirmModal.classList.add('hidden');
      };
      const cancelHandler = () => domElements.deleteConfirmModal.classList.add('hidden');
      domElements.confirmDelete.addEventListener('click', confirmHandler, { once: true });
      domElements.cancelDelete.addEventListener('click', cancelHandler, { once: true });
    }
  });

  elements.childUserId.addEventListener('change', () => {
    currentChildUserId = elements.childUserId.value || null;
    if (currentChildUserId) {
      loadChildTransactions();
    } else {
      document.getElementById('child-transaction-table').innerHTML = '<tr><td colspan="5" class="text-center py-4">No child selected</td></tr>';
      document.getElementById('child-balance').textContent = '₹0';
    }
  });
}

async function calculateChildBalance(userId) {
  if (!db || !userId) return 0;
  let totalBalance = 0;
  const transactionsQuery = query(collection(db, 'childTransactions'), where('userId', '==', userId));
  const snapshot = await retryFirestoreOperation(() => getDocs(transactionsQuery));
  snapshot.forEach(doc => {
    const transaction = doc.data();
    totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
  });
  return totalBalance;
}

async function updateDashboard() {
  if (!db || !currentUser?.uid) {
    showError('balance', 'Database or user not available');
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

  const { start, end } = getDateRange(domElements.dashboardFilter?.value || 'thisMonth', domElements.filterStartDate, domElements.filterEndDate);
  if (currentAccountType === 'child') {
    const childBalance = await calculateChildBalance(currentUser.uid);
    elements.childTiles.innerHTML = `
      <div class="bg-white p-4 sm:p-6 rounded-lg shadow-md">
        <h3 class="text-base sm:text-lg font-semibold text-gray-700">Your Balance</h3>
        <p class="text-lg sm:text-2xl font-bold text-gray-900">${formatCurrency(childBalance, 'INR')}</p>
      </div>
    `;
    elements.childTiles.style.display = 'block';
    elements.balance.parentElement.classList.add('hidden');
    elements.afterBudget.parentElement.classList.add('hidden');
    elements.totalBudget.parentElement.classList.add('hidden');
    elements.balance.textContent = 'N/A';
    elements.afterBudget.textContent = 'N/A';
    elements.totalBudget.textContent = 'N/A';
    elements.totalRemaining.textContent = 'N/A';
  } else {
    let totalBalance = 0, totalBudgetAmount = 0, totalSpent = 0;
    const transactionsSnapshot = await retryFirestoreOperation(() => getDocs(query(collection(db, 'transactions'), where('familyCode', '==', familyCode))));
    transactionsSnapshot.forEach(doc => {
      const transaction = doc.data();
      totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
    });

    const budgetToCategories = new Map();
    const categoriesSnapshot = await retryFirestoreOperation(() => getDocs(query(collection(db, 'categories'), where('familyCode', '==', familyCode))));
    categoriesSnapshot.forEach(doc => {
      if (doc.data().budgetId) {
        budgetToCategories.set(doc.data().budgetId, [...(budgetToCategories.get(doc.data().budgetId) || []), doc.id]);
      }
    });

    const budgetsSnapshot = await retryFirestoreOperation(() => getDocs(query(collection(db, 'budgets'), where('familyCode', '==', familyCode))));
    for (const doc of budgetsSnapshot.docs) {
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
}

async function setupLogout() {
  const logoutButton = document.getElementById('logout-button');
  if (!logoutButton) {
    console.error('setupLogout: Logout button not found');
    return;
  }
  logoutButton.addEventListener('click', async () => {
    if (!auth) {
      showError('page-title', 'Authentication service not available');
      return;
    }
    logoutButton.disabled = true;
    logoutButton.textContent = 'Logging out...';
    try {
      await signOut(auth);
      currentChildUserId = null;
      currentAccountType = null;
      document.getElementById('login-section')?.classList.remove('hidden');
      document.getElementById('app-section')?.classList.add('hidden');
      document.getElementById('page-title').textContent = 'Login';
      logoutButton.classList.add('hidden');
    } catch (error) {
      showError('page-title', `Failed to log out: ${error.message}`);
    } finally {
      logoutButton.disabled = false;
      logoutButton.textContent = 'Logout';
    }
  });
}

async function initApp() {
  if (currentUser && currentAccountType === 'admin' && db && familyCode) {
    await resetBudgetsForNewMonth(db, familyCode);
  }
  setupTabs();
  setupProfile();
  setupCategories();
  setupBudgets();
  setupTransactions();
  setupChildAccounts();
  setupLogout();
}

export { loadAppData, initApp };
