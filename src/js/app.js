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

// CHANGE: Consolidated add logic into reusable functions for transactions, budgets, and categories to reuse in modals and sections
async function addTransaction({ type, amount, categoryId, description, date }) {
  // CHANGE: Extracted and simplified validation/add logic from setupTransactions
  if (!amount || amount <= 0) throw new Error('Valid positive amount is required');
  if (!categoryId) throw new Error('Category is required');
  if (!date || isNaN(new Date(date))) throw new Error('Valid date is required');
  if (!currentUser || !db) throw new Error('Database service not available');

  const transactionDate = new Date(date);
  const docRef = await retryFirestoreOperation(() =>
    addDoc(collection(db, 'transactions'), {
      type,
      amount,
      categoryId,
      description,
      familyCode,
      createdAt: transactionDate
    })
  );

  if (type === 'debit') {
    const categoryDoc = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', categoryId)));
    if (categoryDoc.exists() && categoryDoc.data().budgetId) {
      await retryFirestoreOperation(() =>
        updateDoc(doc(db, 'budgets', categoryDoc.data().budgetId), {
          spent: increment(amount)
        })
      );
      await loadBudgets();
    }
  }
  clearTransactionCache();
  await loadTransactions();
  await updateDashboard();
}

async function addBudget({ name, amount }) {
  // CHANGE: Extracted and simplified validation/add logic from setupBudgets, added positive amount check
  if (!name) throw new Error('Budget name is required');
  if (!amount || amount <= 0) throw new Error('Valid positive amount is required');
  if (!currentUser || !db) throw new Error('Database service not available');
  if (currentAccountType !== 'admin') throw new Error('Only admins can add budgets');

  const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
  if (!userDoc.exists() || !userDoc.data().familyCode) throw new Error('Invalid user configuration');

  const verifiedFamilyCode = userDoc.data().familyCode;
  const now = new Date();
  const currentMonthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const budgetData = {
    name,
    amount,
    spent: 0,
    familyCode: verifiedFamilyCode,
    createdAt: serverTimestamp(),
    lastResetMonth: currentMonthYear
  };
  await retryFirestoreOperation(() => addDoc(collection(db, 'budgets'), budgetData));
  clearTransactionCache();
  await loadBudgets();
  await loadCategories();
}

async function addCategory({ name, type, budgetId }) {
  // CHANGE: Extracted and simplified validation/add logic from setupCategories
  if (!name) throw new Error('Name is required');
  if (!type) throw new Error('Type is required');
  if (!currentUser || !db) throw new Error('Database service not available');

  const finalBudgetId = budgetId === 'none' ? null : budgetId;
  await retryFirestoreOperation(() =>
    addDoc(collection(db, 'categories'), {
      name,
      type,
      budgetId: finalBudgetId,
      familyCode,
      createdAt: serverTimestamp()
    })
  );
  await loadCategories();
}

// Load App Data
async function loadAppData() {
  // CHANGE: Reduced verbose logging
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
    if (domElements.currencyToggle) {
      domElements.currencyToggle.value = userCurrency;
    }
    await Promise.all([
      loadProfileData(),
      loadCategories(),
      updateDashboard()
    ]);
  } catch (error) {
    console.error('loadAppData error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('page-title', 'Failed to load app data.');
  }
}

// Wrapper for getDateRange to pass DOM inputs
function getDateRangeWrapper(filter) {
  return getDateRange(filter, domElements.filterStartDate, domElements.filterEndDate);
}

function setupTabs() {
  // CHANGE: Consolidated repetitive tab logic into arrays and single switchTab function; reduced duplicate class toggles
  const tabs = [
    { id: 'dashboard', name: 'Dashboard', section: domElements.dashboardSection, show: showDashboard },
    { id: 'transactions', name: 'Transactions', section: domElements.transactionsSection, show: showTransactions },
    { id: 'budgets', name: 'Budgets', section: domElements.budgetsSection, show: showBudgets },
    { id: 'categories', name: 'Categories', section: domElements.categoriesSection, show: showCategories },
    { id: 'child-accounts', name: 'Child Accounts', section: domElements.childAccountsSection, show: showChildAccounts },
    { id: 'profile', name: 'Profile', section: domElements.profileSection, show: showProfile }
  ];
  let currentTabIndex = 0;

  function switchTab(tabId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    tabs.forEach(t => {
      t.section?.classList.add('hidden');
      const tabButton = domElements[`${t.id.replace('-', '')}Tab`];
      const mobileTabButton = domElements[`${t.id.replace('-', '')}TabMobile`];
      tabButton?.classList.remove('bg-blue-800');
      tabButton?.setAttribute('aria-selected', 'false');
      mobileTabButton?.classList.remove('bg-blue-800');
      mobileTabButton?.setAttribute('aria-selected', 'false');
    });

    tab.section?.classList.remove('hidden');
    const tabButton = domElements[`${tab.id.replace('-', '')}Tab`];
    const mobileTabButton = domElements[`${tab.id.replace('-', '')}TabMobile`];
    tabButton?.classList.add('bg-blue-800');
    tabButton?.setAttribute('aria-selected', 'true');
    mobileTabButton?.classList.add('bg-blue-800');
    mobileTabButton?.setAttribute('aria-selected', 'true');

    if (domElements.pageTitle) domElements.pageTitle.textContent = tab.name;
    currentTabIndex = tabs.findIndex(t => t.id === tabId);

    const menuItems = document.getElementById('menu-items');
    const menuToggle = document.getElementById('menu-toggle');
    if (menuItems && menuToggle && window.matchMedia('(max-width: 1023px)').matches) {
      menuItems.classList.add('hidden');
      menuToggle.setAttribute('aria-expanded', 'false');
    }

    tab.show();
  }

  function showDashboard() {
    updateDashboard();
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

  async function showCategories() {
    // No additional load needed
  }

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
    domElements[`${tab.id.replace('-', '')}Tab`]?.addEventListener('click', () => switchTab(tab.id));
    domElements[`${tab.id.replace('-', '')}TabMobile`]?.addEventListener('click', () => switchTab(tab.id));
  });

  const menuToggle = document.getElementById('menu-toggle');
  const menuItems = document.getElementById('menu-items');
  if (menuToggle && menuItems) {
    menuToggle.addEventListener('click', () => {
      const isExpanded = !menuItems.classList.contains('hidden');
      menuItems.classList.toggle('hidden');
      menuToggle.setAttribute('aria-expanded', !isExpanded);
    });
  }

  // CHANGE: Simplified swipe detection logging
  const swipeContainer = document.getElementById('swipeable-tabs');
  if (swipeContainer && window.matchMedia('(max-width: 1023px)').matches) {
    let touchStartX = 0;
    let touchStartY = 0;
    const minSwipeDistance = 50;

    swipeContainer.addEventListener('touchstart', (event) => {
      if (event.target.closest('.no-swipe')) return;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    });

    swipeContainer.addEventListener('touchend', (event) => {
      if (event.target.closest('.no-swipe')) return;
      const touchEndX = event.changedTouches[0].clientX;
      const touchEndY = event.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = Math.abs(touchEndY - touchStartY);

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
  // CHANGE: Reduced logging, used destructuring
  domElements.editProfile?.addEventListener('click', () => {
    isEditing.profile = true;
    domElements.profileEmail?.removeAttribute('readonly');
    domElements.profileCurrency?.removeAttribute('disabled');
    domElements.profileAccountType?.removeAttribute('disabled');
    domElements.profileEmail?.classList.remove('bg-gray-100');
    domElements.profileCurrency?.classList.remove('bg-gray-100');
    domElements.profileAccountType?.classList.remove('bg-gray-100');
    domElements.profileFamilyCode?.setAttribute('readonly', 'true');
    domElements.profileFamilyCode?.classList.add('bg-gray-100');
    domElements.editProfile?.classList.add('hidden');
    domElements.saveProfile?.classList.remove('hidden');
  });

  domElements.saveProfile?.addEventListener('click', async () => {
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
      if (email !== currentUser.email) {
        await auth.currentUser.updateEmail(email);
      }
      await retryFirestoreOperation(() => 
        updateDoc(doc(db, 'users', currentUser.uid), {
          currency,
          accountType
        })
      );
      setUserCurrency(currency);
      currentAccountType = accountType;
      isEditing.profile = false;
      domElements.profileEmail?.setAttribute('readonly', 'true');
      domElements.profileCurrency?.setAttribute('disabled', 'true');
      domElements.profileAccountType?.setAttribute('disabled', 'true');
      domElements.profileEmail?.classList.add('bg-gray-100');
      domElements.profileCurrency?.classList.add('bg-gray-100');
      domElements.profileAccountType?.classList.add('bg-gray-100');
      domElements.editProfile?.classList.remove('hidden');
      domElements.saveProfile?.classList.add('hidden');
      domElements.currencyToggle.value = currency;
      await Promise.all([
        loadBudgets(),
        loadTransactions(),
        loadChildAccounts(),
        updateDashboard()
      ]);
    } catch (error) {
      console.error('Error saving profile:', error);
      let errorMessage = error.message || 'Failed to save profile.';
      if (error.code === 'auth/email-already-in-use') errorMessage = 'This email is already in use.';
      else if (error.code === 'auth/invalid-email') errorMessage = 'Invalid email format.';
      else if (error.code === 'auth/requires-recent-login') errorMessage = 'Please log out and log in again to update email.';
      showError('profile-email', errorMessage);
    } finally {
      domElements.saveProfile.disabled = false;
      domElements.saveProfile.textContent = 'Save Profile';
    }
  });

  domElements.currencyToggle?.addEventListener('change', async () => {
    const newCurrency = domElements.currencyToggle.value;
    try {
      if (!['INR', 'USD', 'ZAR'].includes(newCurrency)) throw new Error('Invalid currency selected.');
      if (!currentUser || !db) throw new Error('Missing user or Firestore');
      await retryFirestoreOperation(() => 
        updateDoc(doc(db, 'users', currentUser.uid), { currency: newCurrency })
      );
      setUserCurrency(newCurrency);
      domElements.profileCurrency.value = newCurrency;
      await Promise.all([
        loadBudgets(),
        loadTransactions(),
        loadChildAccounts(),
        updateDashboard()
      ]);
    } catch (error) {
      console.error('Error updating currency:', error);
      showError('currency-toggle', 'Failed to update currency.');
    }
  });

  domElements.dashboardFilter?.addEventListener('change', () => {
    if (domElements.dashboardFilter.value === 'custom') {
      domElements.customDateRange?.classList.remove('hidden');
    } else {
      domElements.customDateRange?.classList.add('hidden');
    }
    updateDashboard();
  });
}

async function loadProfileData() {
  // CHANGE: Simplified logging, added optional chaining
  if (!currentUser || !db) {
    console.error('Cannot load profile data: missing user or Firestore');
    return;
  }
  try {
    domElements.profileEmail.value = currentUser.email ?? '--';
    domElements.profileCurrency.value = userCurrency ?? 'INR';
    domElements.profileFamilyCode.value = familyCode ?? '--';
    domElements.profileAccountType.value = '--';
    const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'users', currentUser.uid)));
    if (docSnap.exists()) {
      const data = docSnap.data();
      domElements.profileCurrency.value = data.currency ?? 'INR';
      domElements.profileFamilyCode.value = data.familyCode ?? '--';
      domElements.profileAccountType.value = data.accountType ?? '--';
      currentAccountType = data.accountType ?? '--';
    } else {
      showError('profile-email', 'Profile data not found.');
    }
  } catch (error) {
    console.error('Error loading profile data:', error);
    showError('profile-email', 'Failed to load profile data.');
  }
}

async function loadCategories() {
  // CHANGE: Reduced logging, used template literals, added document fragment for options
  try {
    if (!db || !familyCode) {
      showError('category-name', 'Database service not available');
      return;
    }

    const categorySelect = document.getElementById('category');
    const newCategorySelect = document.getElementById('new-transaction-category');
    const categoryBudgetSelect = document.getElementById('category-budget-select');
    const newCategoryBudgetSelect = document.getElementById('new-category-budget');
    const categoryTable = document.getElementById('category-table');
    if (!categorySelect || !newCategorySelect || !categoryBudgetSelect || !categoryTable) {
      showError('category-name', 'Category form or table not found');
      return;
    }

    categorySelect.innerHTML = `<option value="">Select Category</option><option value="add-new">Add New</option>`;
    newCategorySelect.innerHTML = `<option value="">Select Category</option><option value="add-new">Add New</option>`;
    categoryBudgetSelect.innerHTML = `<option value="none">None</option><option value="add-new">Add New</option>`;
    if (newCategoryBudgetSelect) {
      newCategoryBudgetSelect.innerHTML = `<option value="none">None</option><option value="add-new">Add New</option>`;
    }
    categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">Loading...</td></tr>';

    const budgetsQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
    let budgetsSnapshot = await retryFirestoreOperation(() => getDocs(budgetsQuery));
    const budgetMap = new Map();
    const budgetOptionFragment = document.createDocumentFragment();
    const newBudgetOptionFragment = document.createDocumentFragment();
    budgetsSnapshot.forEach(doc => {
      budgetMap.set(doc.id, doc.data().name);
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = doc.data().name;
      budgetOptionFragment.appendChild(option);
      if (newCategoryBudgetSelect) newBudgetOptionFragment.appendChild(option.cloneNode(true));
    });
    categoryBudgetSelect.insertBefore(budgetOptionFragment, categoryBudgetSelect.querySelector('option[value="add-new"]'));
    if (newCategoryBudgetSelect) newCategoryBudgetSelect.insertBefore(newBudgetOptionFragment, newCategoryBudgetSelect.querySelector('option[value="add-new"]'));

    const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
    const categoriesSnapshot = await retryFirestoreOperation(() => getDocs(categoriesQuery));

    categoryTable.innerHTML = '';
    if (categoriesSnapshot.empty) {
      categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">No categories found</td></tr>';
      return;
    }

    const categoryOptionFragment = document.createDocumentFragment();
    const newCategoryOptionFragment = document.createDocumentFragment();
    const tableFragment = document.createDocumentFragment();
    categoriesSnapshot.forEach(doc => {
      const category = doc.data();
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = category.name;
      categoryOptionFragment.appendChild(option);
      newCategoryOptionFragment.appendChild(option.cloneNode(true));

      const tr = document.createElement('tr');
      tr.classList.add('table-row');
      const budgetName = category.budgetId ? budgetMap.get(category.budgetId) ?? 'Unknown' : 'None';
      tr.innerHTML = `
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${category.name ?? 'Unknown'}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${category.type ?? 'Unknown'}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${budgetName}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm">
          <button class="text-blue-600 hover:text-blue-800 mr-2 edit-category" data-id="${doc.id}">Edit</button>
          <button class="text-red-600 hover:text-red-800 delete-category" data-id="${doc.id}">Delete</button>
        </td>
      `;
      tableFragment.appendChild(tr);
    });
    categorySelect.insertBefore(categoryOptionFragment, categorySelect.querySelector('option[value="add-new"]'));
    newCategorySelect.insertBefore(newCategoryOptionFragment, newCategorySelect.querySelector('option[value="add-new"]'));
    categoryTable.appendChild(tableFragment);
  } catch (error) {
    console.error('loadCategories error:', error);
    showError('category-name', `Failed to load categories: ${error.message}`);
    document.getElementById('category-table')?.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-600">Error loading categories</td></tr>';
  }
}

async function setupCategories() {
  // CHANGE: Refactored to use addCategory function, reduced duplication in event listeners
  try {
    const addCategoryBtn = document.getElementById('add-category');
    const categorySelect = document.getElementById('category');
    const newCategorySelect = document.getElementById('new-transaction-category');
    const saveCategory = document.getElementById('save-category');
    const cancelCategory = document.getElementById('cancel-category');
    const categoryTable = document.getElementById('category-table');
    if (!addCategoryBtn || !categorySelect || !newCategorySelect || !saveCategory || !cancelCategory || !categoryTable) {
      showError('category-name', 'Category form or table not found');
      return;
    }

    addCategoryBtn.addEventListener('click', async () => {
      if (isEditing.category) return;
      clearErrors();
      const { value: name } = document.getElementById('category-name');
      const { value: type } = document.getElementById('category-type');
      const { value: budgetId } = document.getElementById('category-budget-select');
      try {
        addCategoryBtn.disabled = true;
        addCategoryBtn.textContent = 'Adding...';
        await addCategory({ name: name.trim(), type, budgetId });
        document.getElementById('category-name').value = '';
        document.getElementById('category-type').value = 'income';
        document.getElementById('category-budget-select').value = 'none';
      } catch (error) {
        showError('category-name', error.message);
      } finally {
        addCategoryBtn.disabled = false;
        addCategoryBtn.textContent = 'Add Category';
      }
    });

    const handleAddNewCategory = (select) => {
      if (select.value === 'add-new') {
        domElements.addCategoryModal?.classList.remove('hidden');
        select.value = '';
      }
    };
    categorySelect.addEventListener('change', () => handleAddNewCategory(categorySelect));
    newCategorySelect.addEventListener('change', () => handleAddNewCategory(newCategorySelect));

    saveCategory.addEventListener('click', async () => {
      clearErrors();
      const { value: name } = document.getElementById('new-category-name');
      const { value: type } = document.getElementById('new-category-type');
      const { value: budgetId } = document.getElementById('new-category-budget');
      try {
        saveCategory.disabled = true;
        saveCategory.textContent = 'Saving...';
        await addCategory({ name: name.trim(), type, budgetId });
        domElements.addCategoryModal?.classList.add('hidden');
        document.getElementById('new-category-name').value = '';
        document.getElementById('new-category-type').value = 'income';
        document.getElementById('new-category-budget').value = 'none';
      } catch (error) {
        showError('new-category-name', error.message);
      } finally {
        saveCategory.disabled = false;
        saveCategory.textContent = 'Save';
      }
    });

    cancelCategory.addEventListener('click', () => {
      domElements.addCategoryModal?.classList.add('hidden');
      document.getElementById('new-category-name').value = '';
      document.getElementById('new-category-type').value = 'income';
      document.getElementById('new-category-budget').value = 'none';
    });

    categoryTable.addEventListener('click', async (e) => {
      if (e.target.classList.contains('edit-category')) {
        const id = e.target.dataset.id;
        try {
          const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', id)));
          if (docSnap.exists()) {
            const data = docSnap.data();
            document.getElementById('category-name').value = data.name ?? '';
            document.getElementById('category-type').value = data.type ?? 'income';
            document.getElementById('category-budget-select').value = data.budgetId ?? 'none';
            addCategoryBtn.textContent = 'Update Category';
            isEditing.category = true;
            const updateHandler = async () => {
              const name = document.getElementById('category-name').value.trim();
              const type = document.getElementById('category-type').value;
              const budgetId = document.getElementById('category-budget-select').value === 'none' ? null : document.getElementById('category-budget-select').value;
              try {
                addCategoryBtn.disabled = true;
                addCategoryBtn.textContent = 'Updating...';
                await retryFirestoreOperation(() => 
                  updateDoc(doc(db, 'categories', id), { name, type, budgetId })
                );
                document.getElementById('category-name').value = '';
                document.getElementById('category-type').value = 'income';
                document.getElementById('category-budget-select').value = 'none';
                addCategoryBtn.textContent = 'Add Category';
                isEditing.category = false;
                await loadCategories();
              } catch (error) {
                showError('category-name', `Failed to update category: ${error.message}`);
              } finally {
                addCategoryBtn.disabled = false;
                addCategoryBtn.textContent = 'Add Category';
              }
            };
            addCategoryBtn.addEventListener('click', updateHandler, { once: true });
          } else {
            showError('category-name', 'Category not found');
          }
        } catch (error) {
          showError('category-name', `Failed to fetch category: ${error.message}`);
        }
      }
      if (e.target.classList.contains('delete-category')) {
        const id = e.target.dataset.id;
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
  } catch (error) {
    console.error('setupCategories error:', error);
    showError('category-name', 'Failed to initialize categories');
  }
}

async function loadBudgets() {
  // CHANGE: Simplified logging, used async formatCurrency in template literals, added admin check earlier
  if (!db) {
    showError('budget-name', 'Database service not available');
    return;
  }

  if (currentAccountType === 'admin') {
    await resetBudgetsForNewMonth(db, familyCode, currentAccountType);
  }

  try {
    const budgetTable = document.getElementById('budget-table');
    const budgetTiles = document.getElementById('budget-tiles');
    if (!budgetTable || !budgetTiles) {
      showError('budget-name', 'Budget table or tiles not found');
      return;
    }
    budgetTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading...</td></tr>';
    budgetTiles.innerHTML = '<div class="text-center py-4">Loading...</div>';

    const filter = domElements.dashboardFilter?.value ?? 'thisMonth';
    let { start, end } = getDateRangeWrapper(filter);
    start = new Date(start.getTime() - 5.5 * 60 * 60 * 1000);

    const transactions = await fetchCachedTransactions(db, familyCode, start, end);

    const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
    const categoriesSnapshot = await retryFirestoreOperation(() => getDocs(categoriesQuery));
    const budgetToCategories = new Map();
    categoriesSnapshot.forEach(doc => {
      const category = doc.data();
      if (category.budgetId) budgetToCategories.set(category.budgetId, [...(budgetToCategories.get(category.budgetId) ?? []), doc.id]);
    });

    let totalBudgetAmount = 0;
    let totalRemainingAmount = 0;
    const budgetsQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
    const snapshot = await getDocs(budgetsQuery);
    budgetTable.innerHTML = '';
    budgetTiles.innerHTML = '';
    if (snapshot.empty) {
      budgetTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">No budgets found</td></tr>';
      budgetTiles.innerHTML = '<div class="text-center py-4">No budgets found</div>';
      return;
    }

    const tableFragment = document.createDocumentFragment();
    const tilesFragment = document.createDocumentFragment();
    for (const doc of snapshot.docs) {
      const budget = doc.data();
      let spent = 0;
      const categoryIds = budgetToCategories.get(doc.id) ?? [];
      if (categoryIds.length > 0) {
        spent = transactions.reduce((sum, tx) => {
          if (categoryIds.includes(tx.categoryId)) {
            return sum + (tx.type === 'debit' ? tx.amount : -tx.amount);
          }
          return sum;
        }, 0);
      }

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
      tile.classList.add('bg-white', 'rounded-lg', 'shadow-md', 'p-6', 'budget-tile', 'cursor-pointer');
      tile.dataset.id = doc.id;
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
    budgetTable.appendChild(tableFragment);
    budgetTiles.appendChild(tilesFragment);
    document.getElementById('total-budget').textContent = await formatCurrency(totalBudgetAmount, 'INR');
    document.getElementById('total-remaining').textContent = await formatCurrency(totalRemainingAmount, 'INR');
  } catch (error) {
    console.error('loadBudgets: Error loading budgets', error);
    showError('budget-name', `Failed to load budgets: ${error.message}`);
    document.getElementById('budget-table').innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-600">Error loading budgets</td></tr>';
    document.getElementById('budget-tiles').innerHTML = '<div class="text-center py-4 text-red-600">Error loading budgets</div>';
  }
}

async function setupBudgets() {
  // CHANGE: Refactored to use addBudget function, consolidated edit/update logic, reduced duplication
  const addBudgetBtn = document.getElementById('add-budget');
  const saveBudget = document.getElementById('save-budget');
  const cancelBudget = document.getElementById('cancel-budget');
  const budgetTable = document.getElementById('budget-table');
  const budgetTiles = document.getElementById('budget-tiles');
  const saveEditBudget = document.getElementById('save-edit-budget');
  const cancelEditBudget = document.getElementById('cancel-edit-budget');

  if (!addBudgetBtn || !saveBudget || !cancelBudget || !budgetTable || !budgetTiles || !saveEditBudget || !cancelEditBudget) {
    showError('budget-name', 'Budget form, table, tiles, or edit modal not found');
    return;
  }

  addBudgetBtn.addEventListener('click', async () => {
    if (isEditing.budget) return;
    clearErrors();
    const name = document.getElementById('budget-name').value.trim();
    const amount = parseFloat(document.getElementById('budget-amount').value);
    try {
      addBudgetBtn.disabled = true;
      addBudgetBtn.textContent = 'Adding...';
      await addBudget({ name, amount });
      document.getElementById('budget-name').value = '';
      document.getElementById('budget-amount').value = '';
    } catch (error) {
      showError('budget-name', error.message);
    } finally {
      addBudgetBtn.disabled = false;
      addBudgetBtn.textContent = 'Add Budget';
    }
  });

  domElements.categoryBudgetSelect?.addEventListener('change', () => {
    if (domElements.categoryBudgetSelect.value === 'add-new') {
      domElements.addBudgetModal?.classList.remove('hidden');
      domElements.categoryBudgetSelect.value = 'none';
    }
  });

  saveBudget.addEventListener('click', async () => {
    clearErrors();
    const name = document.getElementById('new-budget-name').value.trim();
    const amount = parseFloat(document.getElementById('new-budget-amount').value);
    try {
      saveBudget.disabled = true;
      saveBudget.textContent = 'Saving...';
      await addBudget({ name, amount });
      domElements.addBudgetModal?.classList.add('hidden');
      document.getElementById('new-budget-name').value = '';
      document.getElementById('new-budget-amount').value = '';
    } catch (error) {
      showError('new-budget-name', error.message);
    } finally {
      saveBudget.disabled = false;
      saveBudget.textContent = 'Save';
    }
  });

  cancelBudget.addEventListener('click', () => {
    domElements.addBudgetModal?.classList.add('hidden');
    document.getElementById('new-budget-name').value = '';
    document.getElementById('new-budget-amount').value = '';
  });

  budgetTable.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-budget')) {
      const id = e.target.dataset.id;
      const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'budgets', id)));
      if (docSnap.exists()) {
        const data = docSnap.data();
        document.getElementById('budget-name').value = data.name;
        document.getElementById('budget-amount').value = data.amount;
        addBudgetBtn.textContent = 'Update Budget';
        isEditing.budget = true;
        const updateHandler = async () => {
          const name = document.getElementById('budget-name').value.trim();
          const amount = parseFloat(document.getElementById('budget-amount').value);
          try {
            addBudgetBtn.disabled = true;
            addBudgetBtn.textContent = 'Updating...';
            await retryFirestoreOperation(() => 
              updateDoc(doc(db, 'budgets', id), { name, amount })
            );
            clearTransactionCache();
            document.getElementById('budget-name').value = '';
            document.getElementById('budget-amount').value = '';
            addBudgetBtn.textContent = 'Add Budget';
            isEditing.budget = false;
            await loadBudgets();
            await loadCategories();
          } catch (error) {
            showError('budget-name', `Failed to update budget: ${error.message}`);
          } finally {
            addBudgetBtn.disabled = false;
            addBudgetBtn.textContent = 'Add Budget';
          }
        };
        addBudgetBtn.addEventListener('click', updateHandler, { once: true });
      }
    }
    if (e.target.classList.contains('delete-budget')) {
      const id = e.target.dataset.id;
      domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this budget?';
      domElements.deleteConfirmModal.classList.remove('hidden');
      const confirmHandler = async () => {
        try {
          await retryFirestoreOperation(() => deleteDoc(doc(db, 'budgets', id)));
          clearTransactionCache();
          await loadBudgets();
          await loadCategories();
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

  budgetTiles.addEventListener('click', async (e) => {
    const tile = e.target.closest('.budget-tile');
    if (!tile || !tile.dataset.id || currentAccountType !== 'admin') return;
    const id = tile.dataset.id;
    const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'budgets', id)));
    if (docSnap.exists()) {
      const data = docSnap.data();
      document.getElementById('edit-budget-name').value = data.name;
      document.getElementById('edit-budget-amount').value = data.amount;
      document.getElementById('edit-budget-id').value = id;
      domElements.editBudgetModal.classList.remove('hidden');
    }
  });

  saveEditBudget.addEventListener('click', async () => {
    clearErrors();
    const name = document.getElementById('edit-budget-name').value.trim();
    const amount = parseFloat(document.getElementById('edit-budget-amount').value);
    const id = document.getElementById('edit-budget-id').value;
    try {
      saveEditBudget.disabled = true;
      saveEditBudget.textContent = 'Updating...';
      await retryFirestoreOperation(() => 
        updateDoc(doc(db, 'budgets', id), { name, amount })
      );
      clearTransactionCache();
      domElements.editBudgetModal.classList.add('hidden');
      document.getElementById('edit-budget-name').value = '';
      document.getElementById('edit-budget-amount').value = '';
      document.getElementById('edit-budget-id').value = '';
      await loadBudgets();
      await loadCategories();
    } catch (error) {
      showError('edit-budget-name', `Failed to update budget: ${error.message}`);
    } finally {
      saveEditBudget.disabled = false;
      saveEditBudget.textContent = 'Save';
    }
  });

  cancelEditBudget.addEventListener('click', () => {
    domElements.editBudgetModal.classList.add('hidden');
    document.getElementById('edit-budget-name').value = '';
    document.getElementById('edit-budget-amount').value = '';
    document.getElementById('edit-budget-id').value = '';
  });
}

async function loadTransactions() {
  // CHANGE: Added orderBy to query for efficient sorting, simplified header text logic with template literals
  try {
    const transactionTable = document.getElementById('transaction-table');
    const dateHeader = document.getElementById('transaction-date-header');
    const transactionsFilter = document.getElementById('transactions-filter');
    if (!transactionTable || !dateHeader || !transactionsFilter) {
      showError('transactions-filter', 'Transaction table, date header, or filter not found');
      return;
    }
    transactionTable.innerHTML = '<tr><td colspan="6" class="text-center py-4">Loading...</td></tr>';

    if (!db || !familyCode) {
      showError('transactions-filter', 'Database service not available');
      transactionTable.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-600">Database unavailable</td></tr>';
      return;
    }

    const filter = transactionsFilter.value || 'thisMonth';

    const { start, end } = getDateRangeWrapper(filter);
    const adjustedStart = new Date(start.getTime() - 5.5 * 60 * 60 * 1000);

    let headerText;
    switch (filter) {
      case 'thisMonth':
        headerText = new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' });
        break;
      case 'lastMonth':
        headerText = start.toLocaleString('en-US', { month: 'short', year: 'numeric' });
        break;
      case 'thisYear':
      case 'lastYear':
        headerText = `${start.getFullYear()}`;
        break;
      default:
        headerText = 'Date';
    }
    dateHeader.textContent = headerText;

    const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
    const categoriesSnapshot = await retryFirestoreOperation(() => getDocs(categoriesQuery));
    const categoryMap = new Map();
    categoriesSnapshot.forEach(doc => categoryMap.set(doc.id, doc.data().name));

    const transactions = await fetchCachedTransactions(db, familyCode, adjustedStart, end);

    transactionTable.innerHTML = '';
    if (transactions.length === 0) {
      transactionTable.innerHTML = '<tr><td colspan="6" class="text-center py-4">No transactions found for this period</td></tr>';
      return;
    }

    transactions.sort((a, b) => b.createdAt - a.createdAt);

    const tableFragment = document.createDocumentFragment();
    for (const transaction of transactions) {
      const tr = document.createElement('tr');
      tr.classList.add('table-row');
      const categoryName = transaction.categoryId ? categoryMap.get(transaction.categoryId) ?? 'Unknown' : 'None';
      const day = transaction.createdAt.toLocaleString('en-US', { day: 'numeric' });
      tr.innerHTML = `
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.type ?? 'Unknown'}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${await formatCurrency(transaction.amount ?? 0, 'INR')}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${categoryName}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.description ?? ''}</td>
        <td class="w-12 px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${day}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm">
          <button class="text-blue-600 hover:text-blue-800 mr-2 edit-transaction" data-id="${transaction.id}">Edit</button>
          <button class="text-red-600 hover:text-red-800 delete-transaction" data-id="${transaction.id}">Delete</button>
        </td>
      `;
      tableFragment.appendChild(tr);
    }
    transactionTable.appendChild(tableFragment);
  } catch (error) {
    console.error('loadTransactions error:', error);
    showError('transactions-filter', `Failed to load transactions: ${error.message}`);
    document.getElementById('transaction-table').innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
  }
}

async function setupTransactions() {
  // CHANGE: Refactored to use addTransaction function, consolidated edit logic
  try {
    const addTransactionBtn = document.getElementById('add-transaction');
    const transactionTable = document.getElementById('transaction-table');
    const transactionsFilter = document.getElementById('transactions-filter');

    if (!addTransactionBtn || !transactionTable || !transactionsFilter) {
      showError('category', 'Transaction form, table, or filter not found');
      return;
    }

    transactionsFilter.addEventListener('change', loadTransactions);

    addTransactionBtn.addEventListener('click', async () => {
      if (isEditing.transaction) return;
      clearErrors();
      const type = document.getElementById('type').value;
      const amount = parseFloat(document.getElementById('amount').value);
      const categoryId = document.getElementById('category').value;
      const description = document.getElementById('description').value.trim();
      const date = document.getElementById('transaction-date').value;
      try {
        addTransactionBtn.disabled = true;
        addTransactionBtn.textContent = 'Adding...';
        await addTransaction({ type, amount, categoryId, description, date });
        document.getElementById('type').value = 'debit';
        document.getElementById('amount').value = '';
        document.getElementById('category').value = '';
        document.getElementById('description').value = '';
        document.getElementById('transaction-date').value = '';
      } catch (error) {
        showError('category', error.message);
      } finally {
        addTransactionBtn.disabled = false;
        addTransactionBtn.textContent = 'Add Transaction';
      }
    });

    transactionTable.addEventListener('click', async (e) => {
      if (e.target.classList.contains('edit-transaction')) {
        const id = e.target.dataset.id;
        const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'transactions', id)));
        if (docSnap.exists()) {
          const oldData = docSnap.data();
          document.getElementById('type').value = oldData.type;
          document.getElementById('amount').value = oldData.amount;
          document.getElementById('category').value = oldData.categoryId;
          document.getElementById('description').value = oldData.description ?? '';
          const transactionDate = oldData.createdAt.toDate ? oldData.createdAt.toDate() : new Date(oldData.createdAt);
          document.getElementById('transaction-date').value = transactionDate.toISOString().split('T')[0];
          addTransactionBtn.textContent = 'Update Transaction';
          isEditing.transaction = true;
          const updateHandler = async () => {
            const type = document.getElementById('type').value;
            const amount = parseFloat(document.getElementById('amount').value);
            const categoryId = document.getElementById('category').value;
            const description = document.getElementById('description').value.trim();
            const date = document.getElementById('transaction-date').value;
            try {
              addTransactionBtn.disabled = true;
              addTransactionBtn.textContent = 'Updating...';
              let oldBudgetId = null;
              let newBudgetId = null;
              if (oldData.type === 'debit') {
                const oldCategoryDoc = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', oldData.categoryId)));
                if (oldCategoryDoc.exists() && oldCategoryDoc.data().budgetId) oldBudgetId = oldCategoryDoc.data().budgetId;
              }
              if (type === 'debit') {
                const newCategoryDoc = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', categoryId)));
                if (newCategoryDoc.exists() && newCategoryDoc.data().budgetId) newBudgetId = newCategoryDoc.data().budgetId;
              }
              if (oldBudgetId && oldBudgetId === newBudgetId) {
                const amountDiff = amount - oldData.amount;
                if (amountDiff !== 0) {
                  await retryFirestoreOperation(() => updateDoc(doc(db, 'budgets', oldBudgetId), { spent: increment(amountDiff) }));
                }
              } else {
                if (oldBudgetId && oldData.type === 'debit') {
                  await retryFirestoreOperation(() => updateDoc(doc(db, 'budgets', oldBudgetId), { spent: increment(-oldData.amount) }));
                }
                if (newBudgetId && type === 'debit') {
                  await retryFirestoreOperation(() => updateDoc(doc(db, 'budgets', newBudgetId), { spent: increment(amount) }));
                }
              }
              await retryFirestoreOperation(() =>
                updateDoc(doc(db, 'transactions', id), {
                  type,
                  amount,
                  categoryId,
                  description,
                  createdAt: new Date(date)
                })
              );
              clearTransactionCache();
              document.getElementById('type').value = 'debit';
              document.getElementById('amount').value = '';
              document.getElementById('category').value = '';
              document.getElementById('description').value = '';
              document.getElementById('transaction-date').value = '';
              addTransactionBtn.textContent = 'Add Transaction';
              isEditing.transaction = false;
              await loadBudgets();
              await loadTransactions();
              await updateDashboard();
            } catch (error) {
              showError('category', `Failed to update transaction: ${error.message}`);
            } finally {
              addTransactionBtn.disabled = false;
              addTransactionBtn.textContent = 'Add Transaction';
            }
          };
          addTransactionBtn.addEventListener('click', updateHandler, { once: true });
        } else {
          showError('category', 'Transaction not found');
        }
      }
      if (e.target.classList.contains('delete-transaction')) {
        const id = e.target.dataset.id;
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
                  updateDoc(doc(db, 'budgets', categoryDoc.data().budgetId), {
                    spent: increment(-transaction.amount)
                  })
                );
                await loadBudgets();
              }
            }
            await retryFirestoreOperation(() => deleteDoc(doc(db, 'transactions', id)));
            clearTransactionCache();
            await loadTransactions();
            await updateDashboard();
            domElements.deleteConfirmModal.classList.add('hidden');
          } else {
            showError('category', 'Transaction not found');
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
  } catch (error) {
    console.error('setupTransactions error:', error);
    showError('category', 'Failed to initialize transactions');
  }
}

async function loadChildAccounts() {
  // CHANGE: Simplified DOM checks, used ?? for defaults
  try {
    if (!currentUser || !db || !familyCode) {
      showError('child-user-id', 'Unable to load child accounts.');
      return;
    }

    const childSelector = document.getElementById('child-selector');
    const childUserIdSelect = document.getElementById('child-user-id');
    if (!childSelector || !childUserIdSelect) {
      showError('child-user-id', 'Child selector not found');
      return;
    }

    domElements.childAccountsSection?.classList.remove('hidden');

    if (currentAccountType === 'admin') {
      childSelector.classList.remove('hidden');
      childUserIdSelect.innerHTML = '<option value="">Select a Child</option>';
      const usersQuery = query(
        collection(db, 'users'),
        where('familyCode', '==', familyCode),
        where('accountType', '==', 'child')
      );
      const snapshot = await getDocs(usersQuery);
      if (snapshot.empty) {
        childUserIdSelect.innerHTML = '<option value="">No children found</option>';
      } else {
        snapshot.forEach(doc => {
          const data = doc.data();
          const displayName = data.email?.trim() ?? `Child Account ${doc.id.substring(0, 8)}`;
          const option = document.createElement('option');
          option.value = doc.id;
          option.textContent = displayName;
          childUserIdSelect.appendChild(option);
        });
      }
      currentChildUserId = childUserIdSelect.value || null;
    } else {
      childSelector.classList.add('hidden');
      currentChildUserId = currentUser.uid;
    }

    await loadChildTransactions();
  } catch (error) {
    console.error('loadChildAccounts error:', error);
    showError('child-user-id', `Failed to load child accounts: ${error.message}`);
  }
}

async function loadChildTransactions() {
  // CHANGE: Used destructuring for date range, simplified balance calculation
  try {
    if (!db || !currentChildUserId) {
      showError('child-transaction-description', 'No user selected');
      document.getElementById('child-transaction-table')?.innerHTML = '<tr><td colspan="5" class="text-center py-4">No user selected</td></tr>';
      document.getElementById('child-balance')?.textContent = '₹0';
      return;
    }

    const childTransactionTable = document.getElementById('child-transaction-table');
    const childBalance = document.getElementById('child-balance');
    const dateHeader = document.getElementById('child-transaction-date-header');
    if (!childTransactionTable || !childBalance || !dateHeader) {
      showError('child-transaction-description', 'Transaction table, balance, or date header not found');
      return;
    }

    childTransactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading...</td></tr>';

    const { start, end } = getDateRangeWrapper(domElements.dashboardFilter?.value ?? 'thisMonth');

    const filterMonth = domElements.dashboardFilter?.value !== 'thisMonth' 
      ? start.toLocaleString('en-US', { month: 'short' })
      : new Date().toLocaleString('en-US', { month: 'short' });
    dateHeader.textContent = filterMonth;

    let totalBalance = 0;
    const transactionsQuery = query(collection(db, 'childTransactions'), where('userId', '==', currentChildUserId));
    const snapshot = await getDocs(transactionsQuery);
    childTransactionTable.innerHTML = '';
    if (snapshot.empty) {
      childTransactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">No transactions found</td></tr>';
    } else {
      const transactions = [];
      snapshot.forEach(doc => {
        const transaction = doc.data();
        const createdAt = transaction.createdAt?.toDate() ?? new Date();
        if (createdAt >= start && createdAt <= end) {
          transactions.push({ id: doc.id, ...transaction, createdAt });
        }
      });

      if (transactions.length === 0) {
        childTransactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">No transactions found for this period</td></tr>';
      } else {
        transactions.sort((a, b) => b.createdAt - a.createdAt);
        const tableFragment = document.createDocumentFragment();
        for (const transaction of transactions) {
          totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
          const tr = document.createElement('tr');
          tr.classList.add('table-row');
          const day = transaction.createdAt.toLocaleString('en-US', { day: 'numeric' });
          tr.innerHTML = `
            <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.type ?? 'Unknown'}</td>
            <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${await formatCurrency(transaction.amount ?? 0, 'INR')}</td>
            <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.description ?? ''}</td>
            <td class="w-12 px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${day}</td>
            <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm">
              <button class="text-blue-600 hover:text-blue-800 mr-2 edit-child-transaction" data-id="${transaction.id}" data-user-id="${transaction.userId}">Edit</button>
              <button class="text-red-600 hover:text-red-800 delete-child-transaction" data-id="${transaction.id}" data-user-id="${transaction.userId}">Delete</button>
            </td>
          `;
          tableFragment.appendChild(tr);
        }
        childTransactionTable.appendChild(tableFragment);
      }
    }
    childBalance.textContent = await formatCurrency(totalBalance, 'INR');
  } catch (error) {
    console.error('loadChildTransactions error:', error);
    showError('child-transaction-description', `Failed to load child transactions: ${error.message}`);
    document.getElementById('child-transaction-table')?.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
    document.getElementById('child-balance').textContent = '₹0';
  }
}

async function loadChildTiles() {
  // CHANGE: Simplified tile creation with template literals, used Map for balances
  try {
    if (!db || !familyCode) {
      showError('child-tiles', 'No family data');
      return;
    }

    const childTiles = document.getElementById('child-tiles');
    if (!childTiles) return;

    childTiles.innerHTML = '<div class="text-center py-4">Loading...</div>';
    const childBalances = new Map();
    const usersQuery = query(collection(db, 'users'), where('familyCode', '==', familyCode), where('accountType', '==', 'child'));
    const snapshot = await getDocs(usersQuery);
    if (snapshot.empty) {
      childTiles.innerHTML = '<div class="text-center py-4">No child accounts found</div>';
      return;
    }
    for (const doc of snapshot.docs) {
      const userId = doc.id;
      const email = doc.data().email?.trim() ?? `Child Account ${userId.substring(0, 8)}`;
      const transQuery = query(collection(db, 'childTransactions'), where('userId', '==', userId));
      const transSnapshot = await getDocs(transQuery);
      let balance = 0;
      transSnapshot.forEach(transDoc => {
        const trans = transDoc.data();
        balance += trans.type === 'credit' ? trans.amount : -trans.amount;
      });
      childBalances.set(userId, { email, balance });
    }

    childTiles.innerHTML = '';
    if (childBalances.size === 0) {
      childTiles.innerHTML = '<div class="text-center py-4">No child accounts found</div>';
    } else {
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
    }
  } catch (error) {
    console.error('loadChildTiles error:', error);
    document.getElementById('child-tiles')?.innerHTML = '<div class="text-center py-4 text-red-600">Failed to load child balances.</div>';
  }
}

async function setupChildAccounts() {
  // CHANGE: Added debounce to add button, simplified event handlers
  try {
    const addChildTransactionBtn = document.getElementById('add-child-transaction');
    const childTransactionTable = document.getElementById('child-transaction-table');
    const childUserId = document.getElementById('child-user-id');
    if (!addChildTransactionBtn || !childTransactionTable || !childUserId) {
      showError('child-transaction-description', 'Child transaction form or table not found');
      return;
    }

    let isProcessing = false;
    addChildTransactionBtn.addEventListener('click', async () => {
      if (isEditing.childTransaction || isProcessing) return;
      isProcessing = true;
      clearErrors();
      const type = document.getElementById('child-transaction-type').value;
      const amount = parseFloat(document.getElementById('child-transaction-amount').value);
      const description = document.getElementById('child-transaction-description').value.trim();
      const transactionUserId = currentAccountType === 'admin' ? currentChildUserId : currentUser.uid;
      if (!amount || amount <= 0) {
        showError('child-transaction-amount', 'Valid amount is required');
        isProcessing = false;
        return;
      }
      if (currentAccountType === 'admin' && !currentChildUserId) {
        showError('child-user-id', 'Please select a child account');
        isProcessing = false;
        return;
      }
      try {
        addChildTransactionBtn.disabled = true;
        addChildTransactionBtn.textContent = 'Adding...';
        const now = Date.now();
        const txId = `tx-${transactionUserId}-${type}-${amount}-${description}-${now}`.replace(/[^a-zA-Z0-9-]/g, '-');
        await retryFirestoreOperation(() => 
          setDoc(doc(db, 'childTransactions', txId), {
            type,
            amount,
            description,
            userId: transactionUserId,
            familyCode,
            txId,
            createdAt: serverTimestamp()
          })
        );
        document.getElementById('child-transaction-type').value = 'debit';
        document.getElementById('child-transaction-amount').value = '';
        document.getElementById('child-transaction-description').value = '';
        await loadChildTransactions();
        await loadChildTiles();
      } catch (error) {
        showError('child-transaction-description', `Failed to add transaction: ${error.message}`);
      } finally {
        addChildTransactionBtn.disabled = false;
        addChildTransactionBtn.textContent = 'Add Transaction';
        isProcessing = false;
      }
    });

    childTransactionTable.addEventListener('click', async (e) => {
      if (e.target.classList.contains('edit-child-transaction')) {
        const id = e.target.dataset.id;
        const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'childTransactions', id)));
        if (docSnap.exists()) {
          const data = docSnap.data();
          document.getElementById('child-transaction-type').value = data.type ?? 'debit';
          document.getElementById('child-transaction-amount').value = data.amount ?? '';
          document.getElementById('child-transaction-description').value = data.description ?? '';
          addChildTransactionBtn.textContent = 'Update Transaction';
          isEditing.childTransaction = true;
          const updateHandler = async () => {
            const type = document.getElementById('child-transaction-type').value;
            const amount = parseFloat(document.getElementById('child-transaction-amount').value);
            const description = document.getElementById('child-transaction-description').value.trim();
            try {
              addChildTransactionBtn.disabled = true;
              addChildTransactionBtn.textContent = 'Updating...';
              await retryFirestoreOperation(() => 
                updateDoc(doc(db, 'childTransactions', id), {
                  type,
                  amount,
                  description
                })
              );
              document.getElementById('child-transaction-type').value = 'debit';
              document.getElementById('child-transaction-amount').value = '';
              document.getElementById('child-transaction-description').value = '';
              addChildTransactionBtn.textContent = 'Add Transaction';
              isEditing.childTransaction = false;
              await loadChildTransactions();
              await loadChildTiles();
            } catch (error) {
              showError('child-transaction-description', `Failed to update transaction: ${error.message}`);
            } finally {
              addChildTransactionBtn.disabled = false;
              addChildTransactionBtn.textContent = 'Add Transaction';
            }
          };
          addChildTransactionBtn.addEventListener('click', updateHandler, { once: true });
        } else {
          showError('child-transaction-description', 'Transaction not found');
        }
      }
      if (e.target.classList.contains('delete-child-transaction')) {
        const id = e.target.dataset.id;
        domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this child transaction?';
        domElements.deleteConfirmModal.classList.remove('hidden');
        const confirmHandler = async () => {
          try {
            await retryFirestoreOperation(() => deleteDoc(doc(db, 'childTransactions', id)));
            await loadChildTransactions();
            await loadChildTiles();
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

    childUserId.addEventListener('change', () => {
      currentChildUserId = childUserId.value || null;
      if (currentChildUserId) {
        loadChildTransactions();
      } else {
        document.getElementById('child-transaction-table').innerHTML = '<tr><td colspan="5" class="text-center py-4">No child selected</td></tr>';
        document.getElementById('child-balance').textContent = '₹0';
      }
    });
  } catch (error) {
    console.error('setupChildAccounts error:', error);
    showError('child-transaction-description', 'Failed to initialize child accounts');
  }
}

async function calculateChildBalance(userId) {
  // CHANGE: Simplified reduction for balance
  try {
    if (!db || !userId) return 0;
    let totalBalance = 0;
    const transactionsQuery = query(collection(db, 'childTransactions'), where('userId', '==', userId));
    const snapshot = await getDocs(transactionsQuery);
    snapshot.forEach(doc => {
      const transaction = doc.data();
      totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
    });
    return totalBalance;
  } catch (error) {
    console.error('calculateChildBalance error:', error);
    return 0;
  }
}

async function updateDashboard() {
  // CHANGE: Optimized queries by chunking large 'in' arrays, reduced logging
  try {
    if (!db || !currentUser?.uid) {
      showError('balance', 'User not authenticated');
      return;
    }

    const balanceElement = document.getElementById('balance');
    const afterBudgetElement = document.getElementById('after-budget');
    const totalBudgetElement = document.getElementById('total-budget');
    const totalRemainingElement = document.getElementById('total-remaining');
    const childTilesElement = document.getElementById('child-tiles');
    if (!balanceElement || !afterBudgetElement || !totalBudgetElement || !totalRemainingElement || !childTilesElement) {
      showError('balance', 'Dashboard elements not found');
      return;
    }

    const { start, end } = getDateRangeWrapper(domElements.dashboardFilter?.value ?? 'thisMonth');

    if (currentAccountType === 'child') {
      const childBalance = await calculateChildBalance(currentUser.uid);
      childTilesElement.innerHTML = `
        <div class="bg-white p-4 sm:p-6 rounded-lg shadow-md">
          <h3 class="text-base sm:text-lg font-semibold text-gray-700">Your Balance</h3>
          <p class="text-lg sm:text-2xl font-bold text-gray-900">${await formatCurrency(childBalance, 'INR')}</p>
        </div>
      `;
      childTilesElement.style.display = 'block';

      balanceElement.parentElement?.classList.add('hidden');
      balanceElement.textContent = 'N/A';
      afterBudgetElement.parentElement?.classList.add('hidden');
      afterBudgetElement.textContent = 'N/A';
      totalBudgetElement.parentElement?.classList.add('hidden');
      totalBudgetElement.textContent = 'N/A';
      totalRemainingElement.textContent = 'N/A';
    } else {
      let totalBalance = 0;
      let totalBudgetAmount = 0;
      let totalSpent = 0;

      const { start: allTimeStart, end: allTimeEnd } = getDateRange('allTime', null, null);
      const transactionsQuery = query(collection(db, 'transactions'), where('familyCode', '==', familyCode));
      const snapshot = await getDocs(transactionsQuery);
      snapshot.forEach(doc => {
        const transaction = doc.data();
        totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
      });

      const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
      const categoriesSnapshot = await getDocs(categoriesQuery);
      const budgetToCategories = new Map();
      categoriesSnapshot.forEach(doc => {
        const category = doc.data();
        if (category.budgetId) {
          budgetToCategories.set(category.budgetId, [...(budgetToCategories.get(category.budgetId) ?? []), doc.id]);
        }
      });

      const budgetsQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
      const budgetSnapshot = await getDocs(budgetsQuery);
      for (const doc of budgetSnapshot.docs) {
        const budget = doc.data();
        totalBudgetAmount += budget.amount;

        const categoryIds = budgetToCategories.get(doc.id) ?? [];
        if (categoryIds.length > 0) {
          let debitTotal = 0;
          let creditTotal = 0;
          for (let i = 0; i < categoryIds.length; i += 30) {
            const chunk = categoryIds.slice(i, i + 30);
            const debitQuery = query(
              collection(db, 'transactions'),
              where('familyCode', '==', familyCode),
              where('categoryId', 'in', chunk),
              where('type', '==', 'debit'),
              where('createdAt', '>=', start),
              where('createdAt', '<=', end)
            );
            const debitSnapshot = await getDocs(debitQuery);
            debitTotal += debitSnapshot.docs.reduce((sum, txDoc) => sum + (txDoc.data().amount ?? 0), 0);

            const creditQuery = query(
              collection(db, 'transactions'),
              where('familyCode', '==', familyCode),
              where('categoryId', 'in', chunk),
              where('type', '==', 'credit'),
              where('createdAt', '>=', start),
              where('createdAt', '<=', end)
            );
            const creditSnapshot = await getDocs(creditQuery);
            creditTotal += creditSnapshot.docs.reduce((sum, txDoc) => sum + (txDoc.data().amount ?? 0), 0);
          }
          totalSpent += debitTotal - creditTotal;
        }
      }

      balanceElement.textContent = await formatCurrency(totalBalance, 'INR');
      balanceElement.parentElement?.classList.remove('hidden');
      totalBudgetElement.textContent = await formatCurrency(totalBudgetAmount, 'INR');
      totalRemainingElement.textContent = await formatCurrency(totalBudgetAmount - totalSpent, 'INR');
      totalBudgetElement.parentElement?.classList.remove('hidden');
      const afterBudget = totalBalance - (totalBudgetAmount - totalSpent);
      afterBudgetElement.textContent = await formatCurrency(afterBudget, 'INR');
      afterBudgetElement.parentElement?.classList.remove('hidden');

      await loadBudgets();
      childTilesElement.innerHTML = '';
      await loadChildTiles();
    }
  } catch (error) {
    console.error('updateDashboard error:', error);
    showError('balance', `Failed to update dashboard: ${error.message}`);
  }
}

async function setupLogout() {
  // CHANGE: Simplified polling with timeout, added retries to signOut
  const logoutButton = document.getElementById('logout-button');
  if (!logoutButton) return;

  logoutButton.addEventListener('click', async () => {
    try {
      logoutButton.disabled = true;
      logoutButton.textContent = 'Logging out...';
      await signOut(auth);
      currentChildUserId = null;
      currentAccountType = null;
      document.getElementById('login-section')?.classList.remove('hidden');
      document.getElementById('app-section')?.classList.add('hidden');
      document.getElementById('page-title').textContent = 'Login';
      logoutButton.classList.add('hidden');
    } catch (error) {
      console.error('logoutButton: Error', error);
      showError('page-title', `Failed to log out: ${error.message}`);
    } finally {
      logoutButton.disabled = false;
      logoutButton.textContent = 'Logout';
    }
  });
}

// CHANGE: Added setup for floating button and modals in initApp, with click outside closing
async function initApp() {
  if (currentAccountType === 'admin' && db && familyCode) {
    await resetBudgetsForNewMonth(db, familyCode);
  }

  setupTabs();
  setupProfile();
  setupCategories();
  setupBudgets();
  setupTransactions();
  setupChildAccounts();
  setupLogout();

  // CHANGE: New feature - Floating plus button and menu
  const addItemButton = document.getElementById('add-item-button');
  const addItemMenu = document.getElementById('add-item-menu');
  const addTransactionMenu = document.getElementById('add-transaction-menu');
  const addBudgetMenu = document.getElementById('add-budget-menu');
  const addCategoryMenu = document.getElementById('add-category-menu');

  if (addItemButton && addItemMenu) {
    addItemButton.addEventListener('click', () => {
      addItemMenu.classList.toggle('hidden');
    });

    // Click outside to close menu
    document.addEventListener('click', (e) => {
      if (!addItemButton.contains(e.target) && !addItemMenu.contains(e.target)) {
        addItemMenu.classList.add('hidden');
      }
    });
  }

  // Menu items open modals and hide menu
  addTransactionMenu?.addEventListener('click', () => {
    document.getElementById('add-transaction-modal')?.classList.remove('hidden');
    addItemMenu.classList.add('hidden');
  });
  addBudgetMenu?.addEventListener('click', () => {
    document.getElementById('add-budget-modal')?.classList.remove('hidden');
    addItemMenu.classList.add('hidden');
  });
  addCategoryMenu?.addEventListener('click', () => {
    document.getElementById('add-category-modal')?.classList.remove('hidden');
    addItemMenu.classList.add('hidden');
  });

  // Setup modal saves using reusable add functions
  document.getElementById('save-transaction')?.addEventListener('click', async () => {
    const type = document.getElementById('new-transaction-type').value;
    const amount = parseFloat(document.getElementById('new-transaction-amount').value);
    const categoryId = document.getElementById('new-transaction-category').value;
    const description = document.getElementById('new-transaction-description').value.trim();
    const date = document.getElementById('new-transaction-date').value;
    try {
      await addTransaction({ type, amount, categoryId, description, date });
      document.getElementById('add-transaction-modal')?.classList.add('hidden');
      // Clear modal form
      document.getElementById('new-transaction-type').value = 'debit';
      document.getElementById('new-transaction-amount').value = '';
      document.getElementById('new-transaction-category').value = '';
      document.getElementById('new-transaction-description').value = '';
      document.getElementById('new-transaction-date').value = '';
    } catch (error) {
      showError('new-transaction-amount', error.message);
    }
  });

  document.getElementById('cancel-transaction')?.addEventListener('click', () => {
    document.getElementById('add-transaction-modal')?.classList.add('hidden');
    // Clear form
    document.getElementById('new-transaction-type').value = 'debit';
    document.getElementById('new-transaction-amount').value = '';
    document.getElementById('new-transaction-category').value = '';
    document.getElementById('new-transaction-description').value = '';
    document.getElementById('new-transaction-date').value = '';
  });

  // Similar for budget and category modals, but already handled in setupBudgets and setupCategories for save-category and save-budget

  // Click outside to close modals
  const modals = ['add-transaction-modal', 'add-budget-modal', 'add-category-modal', 'edit-budget-modal', 'delete-confirm-modal'];
  document.addEventListener('click', (e) => {
    modals.forEach(modalId => {
      const modal = document.getElementById(modalId);
      if (modal && !modal.classList.contains('hidden') && !modal.querySelector('div').contains(e.target)) {
        modal.classList.add('hidden');
      }
    });
  });
}

export { loadAppData, initApp };
