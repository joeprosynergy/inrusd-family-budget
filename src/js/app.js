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

let categoryCache = new Map();
let budgetCache = new Map();

function debounceFunction(func, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => func(...args), delay);
  };
}

function toggleClasses(element, addClass, condition) {
  if (element) {
    element.classList.toggle(addClass, condition);
  }
}

async function loadAppData() {
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
    console.error('loadAppData error:', error);
    showError('page-title', 'Failed to load app data.');
  }
}

function getDateRangeWrapper(filter) {
  return getDateRange(filter, domElements.filterStartDate, domElements.filterEndDate);
}

function setupTabs() {
  const tabs = [
    { id: 'dashboard', name: 'Dashboard', section: domElements.dashboardSection, loadFunc: updateDashboard },
    { id: 'transactions', name: 'Transactions', section: domElements.transactionsSection, loadFunc: loadTransactions },
    { id: 'budgets', name: 'Budgets', section: domElements.budgetsSection, loadFunc: loadBudgets },
    { id: 'categories', name: 'Categories', section: domElements.categoriesSection, loadFunc: loadCategories },
    { id: 'child-accounts', name: 'Child Accounts', section: domElements.childAccountsSection, loadFunc: loadChildAccounts },
    { id: 'profile', name: 'Profile', section: domElements.profileSection, loadFunc: loadProfileData }
  ];
  let currentTabIndex = 0;

  async function switchTab(tabId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    tabs.forEach(t => {
      toggleClasses(t.section, 'hidden', t.id !== tabId);
      const tabButton = domElements[`${t.id.replace('-', '')}Tab`];
      const mobileTabButton = domElements[`${t.id.replace('-', '')}TabMobile`];
      toggleClasses(tabButton, 'bg-blue-800', t.id === tabId);
      toggleClasses(mobileTabButton, 'bg-blue-800', t.id === tabId);
      if (tabButton) tabButton.setAttribute('aria-selected', t.id === tabId);
      if (mobileTabButton) mobileTabButton.setAttribute('aria-selected', t.id === tabId);
    });
    if (domElements.pageTitle) domElements.pageTitle.textContent = tab.name;
    currentTabIndex = tabs.findIndex(t => t.id === tabId);

    try {
      if (tab.loadFunc && !loadedTabs[tab.id.replace('-', '')]) {
        await tab.loadFunc();
        loadedTabs[tab.id.replace('-', '')] = true;
      }
    } catch (error) {
      console.error(`Failed to load tab ${tabId}:`, error);
      showError('page-title', `Failed to load ${tab.name}.`);
    }

    const menuItems = document.getElementById('menu-items');
    const menuToggle = document.getElementById('menu-toggle');
    if (menuItems && menuToggle && window.matchMedia('(max-width: 1023px)').matches) {
      menuItems.classList.add('hidden');
      menuToggle.setAttribute('aria-expanded', 'false');
    }
  }

  tabs.forEach(tab => {
    const tabButton = domElements[`${tab.id.replace('-', '')}Tab`];
    const mobileTabButton = domElements[`${tab.id.replace('-', '')}TabMobile`];
    if (tabButton) tabButton.addEventListener('click', () => switchTab(tab.id));
    if (mobileTabButton) mobileTabButton.addEventListener('click', () => switchTab(tab.id));
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

async function setupProfile() {
  try {
    domElements.editProfile?.addEventListener('click', () => {
      isEditing.profile = true;
      domElements.profileEmail?.removeAttribute('readonly');
      domElements.profileCurrency?.removeAttribute('disabled');
      domElements.profileAccountType?.removeAttribute('disabled');
      toggleClasses(domElements.profileEmail, 'bg-gray-100', false);
      toggleClasses(domElements.profileCurrency, 'bg-gray-100', false);
      toggleClasses(domElements.profileAccountType, 'bg-gray-100', false);
      domElements.profileFamilyCode?.setAttribute('readonly', 'true');
      toggleClasses(domElements.profileFamilyCode, 'bg-gray-100', true);
      toggleClasses(domElements.editProfile, 'hidden', true);
      toggleClasses(domElements.saveProfile, 'hidden', false);
    });

    const debouncedSaveProfile = debounceFunction(async () => {
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
        toggleClasses(domElements.profileEmail, 'bg-gray-100', true);
        toggleClasses(domElements.profileCurrency, 'bg-gray-100', true);
        toggleClasses(domElements.profileAccountType, 'bg-gray-100', true);
        toggleClasses(domElements.editProfile, 'hidden', false);
        toggleClasses(domElements.saveProfile, 'hidden', true);
        domElements.currencyToggle.value = currency;
        await Promise.all([
          loadBudgets(),
          loadTransactions(),
          loadChildAccounts(),
          updateDashboard()
        ]);
      } catch (error) {
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
    domElements.saveProfile?.addEventListener('click', debouncedSaveProfile);

    domElements.currencyToggle?.addEventListener('change', async () => {
      const newCurrency = domElements.currencyToggle.value;
      try {
        if (!['INR', 'USD', 'ZAR'].includes(newCurrency)) {
          showError('currency-toggle', 'Invalid currency selected.');
          return;
        }
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
      toggleClasses(domElements.customDateRange, 'hidden', domElements.dashboardFilter.value !== 'custom');
      updateDashboard();
    });
  } catch (error) {
    console.error('setupProfile error:', error);
    showError('profile-email', 'Failed to setup profile.');
  }
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
      setFamilyCode(data.familyCode || familyCode);
    } else {
      showError('profile-email', 'Profile data not found.');
    }
  } catch (error) {
    console.error('Error loading profile data:', error);
    showError('profile-email', 'Failed to load profile data.');
  }
}

async function loadCategories() {
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

    categorySelect.innerHTML = '<option value="">Select Category</option><option value="add-new">Add New</option>';
    newCategorySelect.innerHTML = '<option value="">Select Category</option><option value="add-new">Add New</option>';
    categoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
    if (newCategoryBudgetSelect) {
      newCategoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
    }
    categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">Loading...</td></tr>';

    let budgetsSnapshot;
    if (budgetCache.size > 0) {
      budgetsSnapshot = { docs: Array.from(budgetCache.values()) };
    } else {
      const budgetsQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
      budgetsSnapshot = await retryFirestoreOperation(() => getDocs(budgetsQuery));
      budgetsSnapshot.docs.forEach(doc => budgetCache.set(doc.id, doc));
    }
    const budgetMap = new Map();
    budgetsSnapshot.docs.forEach(doc => {
      budgetMap.set(doc.id, doc.data().name);
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = doc.data().name;
      categoryBudgetSelect.insertBefore(option, categoryBudgetSelect.querySelector('option[value="add-new"]'));
      if (newCategoryBudgetSelect) {
        const newOption = option.cloneNode(true);
        newCategoryBudgetSelect.insertBefore(newOption, newCategoryBudgetSelect.querySelector('option[value="add-new"]'));
      }
    });

    let categoriesSnapshot;
    if (categoryCache.size > 0) {
      categoriesSnapshot = { docs: Array.from(categoryCache.values()) };
    } else {
      const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
      categoriesSnapshot = await retryFirestoreOperation(() => getDocs(categoriesQuery));
      categoriesSnapshot.docs.forEach(doc => categoryCache.set(doc.id, doc));
    }

    categoryTable.innerHTML = '';
    if (categoriesSnapshot.docs.length === 0) {
      categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">No categories found</td></tr>';
      return;
    }

    const tableFragment = document.createDocumentFragment();
    categoriesSnapshot.docs.forEach(doc => {
      const category = doc.data();
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = category.name;
      categorySelect.insertBefore(option, categorySelect.querySelector('option[value="add-new"]'));
      newCategorySelect.insertBefore(option.cloneNode(true), newCategorySelect.querySelector('option[value="add-new"]'));

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
      tableFragment.appendChild(tr);
    });
    categoryTable.appendChild(tableFragment);
  } catch (error) {
    console.error('loadCategories error:', error);
    showError('category-name', `Failed to load categories: ${error.message}`);
    const categoryTableError = document.getElementById('category-table');
    if (categoryTableError) {
      categoryTableError.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-600">Error loading categories</td></tr>';
    }
  }
}

async function setupCategories() {
  try {
    const addCategory = document.getElementById('add-category');
    const categorySelect = document.getElementById('category');
    const newCategorySelect = document.getElementById('new-transaction-category');
    const saveCategory = document.getElementById('save-category');
    const cancelCategory = document.getElementById('cancel-category');
    const categoryTable = document.getElementById('category-table');
    if (!addCategory || !categorySelect || !newCategorySelect || !saveCategory || !cancelCategory || !categoryTable) {
      showError('category-name', 'Category form or table not found');
      return;
    }

    const debouncedAddCategory = debounceFunction(async () => {
      if (isEditing.category) return;
      clearErrors();
      const nameInput = document.getElementById('category-name');
      const typeSelect = document.getElementById('category-type');
      const budgetSelect = document.getElementById('category-budget-select');
      if (!nameInput || !typeSelect || !budgetSelect) {
        showError('category-name', 'Form elements not found');
        return;
      }
      const name = nameInput.value.trim();
      const type = typeSelect.value;
      const budgetId = budgetSelect.value === 'none' ? null : budgetSelect.value;
      if (!name) {
        showError('category-name', 'Name is required');
        return;
      }
      if (!type) {
        showError('category-type', 'Type is required');
        return;
      }
      if (!currentUser || !db) {
        showError('category-name', 'Database service not available');
        return;
      }
      try {
        addCategory.disabled = true;
        addCategory.textContent = 'Adding...';
        const docRef = await retryFirestoreOperation(() => 
          addDoc(collection(db, 'categories'), {
            name,
            type,
            budgetId,
            familyCode,
            createdAt: serverTimestamp()
          })
        );
        categoryCache.set(docRef.id, { id: docRef.id, data: () => ({ name, type, budgetId, familyCode }) });
        nameInput.value = '';
        typeSelect.value = 'income';
        budgetSelect.value = 'none';
        await loadCategories();
      } catch (error) {
        showError('category-name', `Failed to add category: ${error.message}`);
      } finally {
        addCategory.disabled = false;
        addCategory.textContent = 'Add Category';
      }
    });
    addCategory.addEventListener('click', debouncedAddCategory);

    categorySelect.addEventListener('change', () => {
      if (categorySelect.value === 'add-new') {
        if (domElements.addCategoryModal) domElements.addCategoryModal.classList.remove('hidden');
        categorySelect.value = '';
      }
    });

    newCategorySelect.addEventListener('change', () => {
      if (newCategorySelect.value === 'add-new') {
        if (domElements.addCategoryModal) domElements.addCategoryModal.classList.remove('hidden');
        newCategorySelect.value = '';
      }
    });

    const debouncedSaveCategory = debounceFunction(async () => {
      clearErrors();
      const nameInput = document.getElementById('new-category-name');
      const typeSelect = document.getElementById('new-category-type');
      const budgetSelect = document.getElementById('new-category-budget');
      if (!nameInput || !typeSelect || !budgetSelect) {
        showError('new-category-name', 'Modal form elements not found');
        return;
      }
      const name = nameInput.value.trim();
      const type = typeSelect.value;
      const budgetId = budgetSelect.value === 'none' ? null : budgetSelect.value;
      if (!name) {
        showError('new-category-name', 'Name is required');
        return;
      }
      if (!type) {
        showError('new-category-type', 'Type is required');
        return;
      }
      if (!currentUser || !db) {
        showError('new-category-name', 'Database service not available');
        return;
      }
      try {
        saveCategory.disabled = true;
        saveCategory.textContent = 'Saving...';
        const docRef = await retryFirestoreOperation(() => 
          addDoc(collection(db, 'categories'), {
            name,
            type,
            budgetId,
            familyCode,
            createdAt: serverTimestamp()
          })
        );
        categoryCache.set(docRef.id, { id: docRef.id, data: () => ({ name, type, budgetId, familyCode }) });
        if (domElements.addCategoryModal) domElements.addCategoryModal.classList.add('hidden');
        nameInput.value = '';
        typeSelect.value = 'income';
        budgetSelect.value = 'none';
        await loadCategories();
      } catch (error) {
        showError('new-category-name', `Failed to save category: ${error.message}`);
      } finally {
        saveCategory.disabled = false;
        saveCategory.textContent = 'Save';
      }
    });
    saveCategory.addEventListener('click', debouncedSaveCategory);

    cancelCategory.addEventListener('click', () => {
      if (domElements.addCategoryModal) domElements.addCategoryModal.classList.add('hidden');
      // CHANGE: Fixed invalid optional chaining on LHS by using if checks
      const newCatName = document.getElementById('new-category-name');
      if (newCatName) newCatName.value = '';
      const newCatType = document.getElementById('new-category-type');
      if (newCatType) newCatType.value = 'income';
      const newCatBudget = document.getElementById('new-category-budget');
      if (newCatBudget) newCatBudget.value = 'none';
    });

    categoryTable.addEventListener('click', async (e) => {
      if (e.target.classList.contains('edit-category')) {
        const id = e.target.dataset.id;
        try {
          const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', id)));
          if (docSnap.exists()) {
            const data = docSnap.data();
            const nameInput = document.getElementById('category-name');
            const typeSelect = document.getElementById('category-type');
            const budgetSelect = document.getElementById('category-budget-select');
            if (!nameInput || !typeSelect || !budgetSelect) {
              showError('category-name', 'Form elements not found');
              return;
            }
            nameInput.value = data.name || '';
            typeSelect.value = data.type || 'income';
            budgetSelect.value = data.budgetId || 'none';
            addCategory.innerHTML = 'Update Category';
            isEditing.category = true;
            const updateHandler = async () => {
              const name = nameInput.value.trim();
              const type = typeSelect.value;
              const budgetId = budgetSelect.value === 'none' ? null : budgetSelect.value;
              if (!name) {
                showError('category-name', 'Name is required');
                return;
              }
              if (!type) {
                showError('category-type', 'Type is required');
                return;
              }
              try {
                addCategory.disabled = true;
                addCategory.textContent = 'Updating...';
                await retryFirestoreOperation(() => 
                  updateDoc(doc(db, 'categories', id), { name, type, budgetId })
                );
                categoryCache.set(id, { id, data: () => ({ name, type, budgetId, familyCode }) });
                nameInput.value = '';
                typeSelect.value = 'income';
                budgetSelect.value = 'none';
                addCategory.innerHTML = 'Add Category';
                isEditing.category = false;
                await loadCategories();
              } catch (error) {
                showError('category-name', `Failed to update category: ${error.message}`);
              } finally {
                addCategory.disabled = false;
                addCategory.textContent = 'Add Category';
                isEditing.category = false;
              }
            };
            addCategory.removeEventListener('click', addCategory._updateHandler);
            addCategory._updateHandler = updateHandler;
            addCategory.addEventListener('click', updateHandler, { once: true });
          } else {
            showError('category-name', 'Category not found');
          }
        } catch (error) {
          showError('category-name', `Failed to fetch category: ${error.message}`);
        }
      }
      if (e.target.classList.contains('delete-category')) {
        const id = e.target.dataset.id;
        if (!domElements.deleteConfirmModal || !db) {
          showError('category-name', 'Cannot delete: Missing components');
          return;
        }
        domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this category?';
        domElements.deleteConfirmModal.classList.remove('hidden');
        const confirmHandler = async () => {
          try {
            await retryFirestoreOperation(() => deleteDoc(doc(db, 'categories', id)));
            categoryCache.delete(id);
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
  if (!db) {
    showError('budget-name', 'Database service not available');
    return;
  }

  if (currentAccountType === 'admin') {
    try {
      await resetBudgetsForNewMonth(db, familyCode, currentAccountType);
    } catch (error) {
      console.error('Budget reset failed:', error);
    }
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

    const filter = domElements.dashboardFilter?.value || 'thisMonth';
    let { start, end } = getDateRangeWrapper(filter);
    start = new Date(start.getTime() - 5.5 * 60 * 60 * 1000);

    const transactions = await fetchCachedTransactions(db, familyCode, start, end);

    let categoriesSnapshot;
    if (categoryCache.size > 0) {
      categoriesSnapshot = { docs: Array.from(categoryCache.values()) };
    } else {
      const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
      categoriesSnapshot = await retryFirestoreOperation(() => getDocs(categoriesQuery));
      categoriesSnapshot.docs.forEach(doc => categoryCache.set(doc.id, doc));
    }
    const budgetToCategories = new Map();
    categoriesSnapshot.docs.forEach(doc => {
      const category = doc.data();
      if (category.budgetId) {
        budgetToCategories.set(category.budgetId, [...(budgetToCategories.get(category.budgetId) || []), doc.id]);
      }
    });

    let totalBudgetAmount = 0;
    let totalRemainingAmount = 0;
    const budgetsQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
    const snapshot = await retryFirestoreOperation(() => getDocs(budgetsQuery));
    budgetTable.innerHTML = '';
    budgetTiles.innerHTML = '';
    if (snapshot.empty) {
      budgetTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">No budgets found</td></tr>';
      budgetTiles.innerHTML = '<div class="text-center py-4">No budgets found</div>';
      return;
    }

    budgetCache.clear();
    const tableFragment = document.createDocumentFragment();
    const tilesFragment = document.createDocumentFragment();
    snapshot.docs.forEach(doc => {
      budgetCache.set(doc.id, doc);
      const budget = doc.data();
      let spent = 0;
      const categoryIds = budgetToCategories.get(doc.id) || [];
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
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatCurrency(budget.amount, 'INR')}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatCurrency(spent, 'INR')}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatCurrency(budget.amount - spent, 'INR')}</td>
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
        <p class="text-sm text-gray-500">Budget: <span id="${doc.id}-budget">${formatCurrency(budget.amount, 'INR')}</span></p>
        <p class="text-sm text-gray-500">Spent: <span id="${doc.id}-spent">${formatCurrency(spent, 'INR')}</span></p>
        <p class="text-sm font-semibold text-gray-700 mt-2">
          Remaining: <span id="${doc.id}-remaining">${formatCurrency(budget.amount - spent, 'INR')}</span>
        </p>
        <div class="w-full bg-gray-200 rounded-full mt-4 progress-bar">
          <div class="bg-green-600 progress-bar" style="width: ${percentage}%"></div>
        </div>
      `;
      tilesFragment.appendChild(tile);
    });
    budgetTable.appendChild(tableFragment);
    budgetTiles.appendChild(tilesFragment);
    const totalBudgetElement = document.getElementById('total-budget');
    const totalRemainingElement = document.getElementById('total-remaining');
    if (totalBudgetElement && totalRemainingElement) {
      totalBudgetElement.textContent = formatCurrency(totalBudgetAmount, 'INR');
      totalRemainingElement.textContent = formatCurrency(totalRemainingAmount, 'INR');
    }
  } catch (error) {
    console.error('loadBudgets: Error loading budgets', error);
    showError('budget-name', `Failed to load budgets: ${error.message}`);
    const budgetTableError = document.getElementById('budget-table');
    if (budgetTableError) {
      budgetTableError.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-600">Error loading budgets</td></tr>';
    }
    const budgetTilesError = document.getElementById('budget-tiles');
    if (budgetTilesError) {
      budgetTilesError.innerHTML = '<div class="text-center py-4 text-red-600">Error loading budgets</div>';
    }
  }
}

async function setupBudgets() {
  const addBudget = document.getElementById('add-budget');
  const saveBudget = document.getElementById('save-budget');
  const cancelBudget = document.getElementById('cancel-budget');
  const budgetTable = document.getElementById('budget-table');
  const budgetTiles = document.getElementById('budget-tiles');
  const saveEditBudget = document.getElementById('save-edit-budget');
  const cancelEditBudget = document.getElementById('cancel-edit-budget');

  if (!addBudget || !saveBudget || !cancelBudget || !budgetTable || !budgetTiles || !saveEditBudget || !cancelEditBudget) {
    showError('budget-name', 'Budget form, table, tiles, or edit modal not found');
    return;
  }

  const debouncedAddBudget = debounceFunction(async () => {
    if (isEditing.budget) return;
    clearErrors();
    const nameInput = document.getElementById('budget-name');
    const amountInput = document.getElementById('budget-amount');
    if (!nameInput || !amountInput) {
      showError('budget-name', 'Form inputs not found');
      return;
    }
    const name = nameInput.value.trim();
    const amountRaw = amountInput.value.trim();
    const amount = parseFloat(amountRaw);

    if (!name) {
      showError('budget-name', 'Budget name is required');
      return;
    }
    if (!amountRaw || isNaN(amount) || amount <= 0) {
      showError('budget-amount', 'Valid positive amount is required');
      return;
    }
    if (!currentUser || !db) {
      showError('budget-name', 'Database service not available');
      return;
    }
    if (currentAccountType !== 'admin') {
      showError('budget-name', 'Only admins can add budgets');
      return;
    }

    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
    const verifiedFamilyCode = userDoc.data()?.familyCode;
    if (!verifiedFamilyCode) {
      showError('budget-name', 'Invalid user configuration');
      return;
    }

    try {
      addBudget.disabled = true;
      addBudget.textContent = 'Adding...';
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
      const docRef = await retryFirestoreOperation(() => 
        addDoc(collection(db, 'budgets'), budgetData)
      );
      budgetCache.set(docRef.id, { id: docRef.id, data: () => budgetData });
      clearTransactionCache();
      nameInput.value = '';
      amountInput.value = '';
      await loadBudgets();
      await loadCategories();
    } catch (error) {
      showError('budget-name', `Failed to add budget: ${error.message}`);
    } finally {
      addBudget.disabled = false;
      addBudget.textContent = 'Add Budget';
    }
  });
  addBudget.addEventListener('click', debouncedAddBudget);

  domElements.categoryBudgetSelect?.addEventListener('change', () => {
    if (domElements.categoryBudgetSelect.value === 'add-new') {
      if (domElements.addBudgetModal) domElements.addBudgetModal.classList.remove('hidden');
      domElements.categoryBudgetSelect.value = 'none';
    }
  });

  const debouncedSaveBudget = debounceFunction(async () => {
    clearErrors();
    const nameInput = document.getElementById('new-budget-name');
    const amountInput = document.getElementById('new-budget-amount');
    if (!nameInput || !amountInput) {
      showError('new-budget-name', 'Modal form inputs not found');
      return;
    }
    const name = nameInput.value.trim();
    const amountRaw = amountInput.value.trim();
    const amount = parseFloat(amountRaw);

    if (!name) {
      showError('new-budget-name', 'Budget name is required');
      return;
    }
    if (!amountRaw || isNaN(amount) || amount <= 0) {
      showError('new-budget-amount', 'Valid positive amount is required');
      return;
    }
    if (!currentUser || !db) {
      showError('new-budget-name', 'Database service not available');
      return;
    }
    if (currentAccountType !== 'admin') {
      showError('new-budget-name', 'Only admins can add budgets');
      return;
    }

    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
    const verifiedFamilyCode = userDoc.data()?.familyCode;
    if (!verifiedFamilyCode) {
      showError('new-budget-name', 'Invalid user configuration');
      return;
    }

    try {
      saveBudget.disabled = true;
      saveBudget.textContent = 'Saving...';
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
      const docRef = await retryFirestoreOperation(() => 
        addDoc(collection(db, 'budgets'), budgetData)
      );
      budgetCache.set(docRef.id, { id: docRef.id, data: () => budgetData });
      clearTransactionCache();
      if (domElements.addBudgetModal) domElements.addBudgetModal.classList.add('hidden');
      nameInput.value = '';
      amountInput.value = '';
      await loadBudgets();
      await loadCategories();
    } catch (error) {
      showError('new-budget-name', `Failed to save budget: ${error.message}`);
    } finally {
      saveBudget.disabled = false;
      saveBudget.textContent = 'Save';
    }
  });
  saveBudget.addEventListener('click', debouncedSaveBudget);

  cancelBudget.addEventListener('click', () => {
    if (domElements.addBudgetModal) domElements.addBudgetModal.classList.add('hidden');
    // CHANGE: Fixed invalid optional chaining on LHS by using if checks
    const newBudgetName = document.getElementById('new-budget-name');
    if (newBudgetName) newBudgetName.value = '';
    const newBudgetAmount = document.getElementById('new-budget-amount');
    if (newBudgetAmount) newBudgetAmount.value = '';
  });

  budgetTable.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-budget')) {
      const id = e.target.dataset.id;
      try {
        const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'budgets', id)));
        if (docSnap.exists()) {
          const data = docSnap.data();
          const nameInput = document.getElementById('budget-name');
          const amountInput = document.getElementById('budget-amount');
          if (nameInput) nameInput.value = data.name;
          if (amountInput) amountInput.value = data.amount;
          addBudget.innerHTML = 'Update Budget';
          isEditing.budget = true;
          const updateHandler = async () => {
            const nameInput = document.getElementById('budget-name');
            const amountInput = document.getElementById('budget-amount');
            if (!nameInput || !amountInput) {
              showError('budget-name', 'Form inputs not found');
              return;
            }
            const name = nameInput.value.trim();
            const amountRaw = amountInput.value.trim();
            const amount = parseFloat(amountRaw);
            if (!name) {
              showError('budget-name', 'Budget name is required');
              return;
            }
            if (!amountRaw || isNaN(amount) || amount <= 0) {
              showError('budget-amount', 'Valid positive amount is required');
              return;
            }
            try {
              addBudget.disabled = true;
              addBudget.textContent = 'Updating...';
              await retryFirestoreOperation(() => 
                updateDoc(doc(db, 'budgets', id), { name, amount })
              );
              const cached = budgetCache.get(id);
              if (cached) {
                const data = cached.data();
                data.name = name;
                data.amount = amount;
              }
              clearTransactionCache();
              nameInput.value = '';
              amountInput.value = '';
              addBudget.innerHTML = 'Add Budget';
              isEditing.budget = false;
              await loadBudgets();
              await loadCategories();
            } catch (error) {
              showError('budget-name', `Failed to update budget: ${error.message}`);
            } finally {
              addBudget.disabled = false;
              addBudget.textContent = 'Add Budget';
              isEditing.budget = false;
            }
          };
          addBudget.removeEventListener('click', addBudget._updateHandler);
          addBudget._updateHandler = updateHandler;
          addBudget.addEventListener('click', updateHandler, { once: true });
        }
      } catch (error) {
        showError('budget-name', `Failed to fetch budget: ${error.message}`);
      }
    }
    if (e.target.classList.contains('delete-budget')) {
      const id = e.target.dataset.id;
      if (domElements.deleteConfirmModal && db) {
        domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this budget?';
        domElements.deleteConfirmModal.classList.remove('hidden');
        const confirmHandler = async () => {
          try {
            await retryFirestoreOperation(() => deleteDoc(doc(db, 'budgets', id)));
            budgetCache.delete(id);
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
    }
  });

  budgetTiles.addEventListener('click', async (e) => {
    const tile = e.target.closest('.budget-tile');
    if (!tile || !tile.dataset.id || currentAccountType !== 'admin') return;
    const id = tile.dataset.id;
    try {
      const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'budgets', id)));
      if (docSnap.exists()) {
        const data = docSnap.data();
        const nameInput = document.getElementById('edit-budget-name');
        const amountInput = document.getElementById('edit-budget-amount');
        const idInput = document.getElementById('edit-budget-id');
        if (!nameInput || !amountInput || !idInput) {
          showError('edit-budget-name', 'Edit form not found');
          return;
        }
        nameInput.value = data.name;
        amountInput.value = data.amount;
        idInput.value = id;
        domElements.editBudgetModal.classList.remove('hidden');
      }
    } catch (error) {
      showError('edit-budget-name', `Failed to fetch budget: ${error.message}`);
    }
  });

  const debouncedSaveEditBudget = debounceFunction(async () => {
    clearErrors();
    const nameInput = document.getElementById('edit-budget-name');
    const amountInput = document.getElementById('edit-budget-amount');
    const idInput = document.getElementById('edit-budget-id');
    if (!nameInput || !amountInput || !idInput) {
      showError('edit-budget-name', 'Modal form inputs not found');
      return;
    }
    const name = nameInput.value.trim();
    const amountRaw = amountInput.value.trim();
    const amount = parseFloat(amountRaw);
    const id = idInput.value;

    if (!name) {
      showError('edit-budget-name', 'Budget name is required');
      return;
    }
    if (!amountRaw || isNaN(amount) || amount <= 0) {
      showError('edit-budget-amount', 'Valid positive amount is required');
      return;
    }
    if (!id) {
      showError('edit-budget-name', 'Invalid budget ID');
      return;
    }
    try {
      saveEditBudget.disabled = true;
      saveEditBudget.textContent = 'Updating...';
      await retryFirestoreOperation(() => 
        updateDoc(doc(db, 'budgets', id), { name, amount })
      );
      const cached = budgetCache.get(id);
      if (cached) {
        const data = cached.data();
        data.name = name;
        data.amount = amount;
      }
      clearTransactionCache();
      domElements.editBudgetModal.classList.add('hidden');
      nameInput.value = '';
      amountInput.value = '';
      idInput.value = '';
      await loadBudgets();
      await loadCategories();
    } catch (error) {
      showError('edit-budget-name', `Failed to update budget: ${error.message}`);
    } finally {
      saveEditBudget.disabled = false;
      saveEditBudget.textContent = 'Save';
    }
  });
  saveEditBudget.addEventListener('click', debouncedSaveEditBudget);

  cancelEditBudget.addEventListener('click', () => {
    domElements.editBudgetModal.classList.add('hidden');
    // CHANGE: Fixed invalid optional chaining on LHS by using if checks
    const editBudgetName = document.getElementById('edit-budget-name');
    if (editBudgetName) editBudgetName.value = '';
    const editBudgetAmount = document.getElementById('edit-budget-amount');
    if (editBudgetAmount) editBudgetAmount.value = '';
    const editBudgetId = document.getElementById('edit-budget-id');
    if (editBudgetId) editBudgetId.value = '';
  });
}

async function loadTransactions() {
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
      const transTableError = document.getElementById('transaction-table');
      if (transTableError) {
        transTableError.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-600">Database unavailable</td></tr>';
      }
      return;
    }

    transactionsFilter.value = transactionsFilter.value || 'thisMonth';
    const filter = transactionsFilter.value;

    const { start, end } = getDateRangeWrapper(filter);

    const adjustedStart = new Date(start.getTime() - 5.5 * 60 * 60 * 1000);

    let headerText;
    switch (filter) {
      case 'thisMonth':
        headerText = new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' });
        break;
      case 'lastMonth':
        headerText = new Date(start).toLocaleString('en-US', { month: 'short', year: 'numeric' });
        break;
      case 'thisYear':
      case 'lastYear':
        headerText = start.getFullYear().toString();
        break;
      default:
        headerText = 'Date';
    }
    dateHeader.textContent = headerText;

    let categoriesSnapshot;
    if (categoryCache.size > 0) {
      categoriesSnapshot = { docs: Array.from(categoryCache.values()) };
    } else {
      const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
      categoriesSnapshot = await retryFirestoreOperation(() => getDocs(categoriesQuery));
      categoriesSnapshot.docs.forEach(doc => categoryCache.set(doc.id, doc));
    }
    const categoryMap = new Map();
    categoriesSnapshot.docs.forEach(doc => {
      categoryMap.set(doc.id, doc.data().name);
    });

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
      tableFragment.appendChild(tr);
    }
    transactionTable.appendChild(tableFragment);
  } catch (error) {
    console.error('loadTransactions error:', error);
    showError('transactions-filter', `Failed to load transactions: ${error.message}`);
    const transTableError = document.getElementById('transaction-table');
    if (transTableError) {
      transTableError.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
    }
  }
}

async function setupTransactions() {
  try {
    const addTransaction = document.getElementById('add-transaction');
    const transactionTable = document.getElementById('transaction-table');
    const transactionsFilter = document.getElementById('transactions-filter');

    if (!addTransaction || !transactionTable || !transactionsFilter) {
      showError('category', 'Transaction form, table, or filter not found');
      return;
    }

    transactionsFilter.addEventListener('change', () => {
      loadTransactions();
    });

    const debouncedAddTransaction = debounceFunction(async () => {
      if (isEditing.transaction) return;
      clearErrors();
      const typeInput = document.getElementById('type');
      const amountInput = document.getElementById('amount');
      const categoryInput = document.getElementById('category');
      const descriptionInput = document.getElementById('description');
      const dateInput = document.getElementById('transaction-date');
      if (!typeInput || !amountInput || !categoryInput || !descriptionInput || !dateInput) {
        showError('category', 'Form elements not found');
        return;
      }
      const type = typeInput.value;
      const amount = parseFloat(amountInput.value);
      const categoryId = categoryInput.value;
      const description = descriptionInput.value.trim();
      const transactionDate = dateInput.value ? new Date(dateInput.value) : new Date();
      if (!amount || amount <= 0) {
        showError('amount', 'Valid amount is required');
        return;
      }
      if (!categoryId) {
        showError('category', 'Category is required');
        return;
      }
      if (!dateInput.value || isNaN(transactionDate.getTime())) {
        showError('transaction-date', 'Valid date is required');
        return;
      }
      if (!currentUser || !db) {
        showError('category', 'Database service not available');
        return;
      }
      try {
        addTransaction.disabled = true;
        addTransaction.textContent = 'Adding...';
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
        typeInput.value = 'debit';
        amountInput.value = '';
        categoryInput.value = '';
        descriptionInput.value = '';
        dateInput.value = '';
        await loadTransactions();
        await updateDashboard();
      } catch (error) {
        showError('category', `Failed to add transaction: ${error.message}`);
      } finally {
        addTransaction.disabled = false;
        addTransaction.textContent = 'Add Transaction';
      }
    });
    addTransaction.addEventListener('click', debouncedAddTransaction);

    transactionTable.addEventListener('click', async (e) => {
      if (e.target.classList.contains('edit-transaction')) {
        const id = e.target.dataset.id;
        try {
          const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'transactions', id)));
          if (docSnap.exists()) {
            const oldData = docSnap.data();
            const typeInput = document.getElementById('type');
            const amountInput = document.getElementById('amount');
            const categoryInput = document.getElementById('category');
            const descriptionInput = document.getElementById('description');
            const dateInput = document.getElementById('transaction-date');
            if (!typeInput || !amountInput || !categoryInput || !descriptionInput || !dateInput) {
              showError('category', 'Form elements not found');
              return;
            }
            typeInput.value = oldData.type;
            amountInput.value = oldData.amount;
            categoryInput.value = oldData.categoryId;
            descriptionInput.value = oldData.description || '';
            const transactionDate = oldData.createdAt.toDate ? oldData.createdAt.toDate() : new Date(oldData.createdAt);
            dateInput.value = transactionDate.toISOString().split('T')[0];
            addTransaction.innerHTML = 'Update Transaction';
            isEditing.transaction = true;
            const updateHandler = async () => {
              const type = typeInput.value;
              const amount = parseFloat(amountInput.value);
              const categoryId = categoryInput.value;
              const description = descriptionInput.value.trim();
              const newTransactionDate = dateInput.value ? new Date(dateInput.value) : new Date();
              if (!amount || amount <= 0) {
                showError('amount', 'Valid amount is required');
                return;
              }
              if (!categoryId) {
                showError('category', 'Category is required');
                return;
              }
              if (!dateInput.value || isNaN(newTransactionDate.getTime())) {
                showError('transaction-date', 'Valid date is required');
                return;
              }
              try {
                addTransaction.disabled = true;
                addTransaction.textContent = 'Updating...';
                let oldBudgetId = null;
                let newBudgetId = null;
                if (oldData.type === 'debit') {
                  const oldCategoryDoc = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', oldData.categoryId)));
                  if (oldCategoryDoc.exists() && oldCategoryDoc.data().budgetId) {
                    oldBudgetId = oldCategoryDoc.data().budgetId;
                  }
                }
                if (type === 'debit') {
                  const newCategoryDoc = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', categoryId)));
                  if (newCategoryDoc.exists() && newCategoryDoc.data().budgetId) {
                    newBudgetId = newCategoryDoc.data().budgetId;
                  }
                }
                if (oldBudgetId && oldBudgetId === newBudgetId) {
                  const amountDiff = amount - oldData.amount;
                  if (amountDiff !== 0) {
                    await retryFirestoreOperation(() =>
                      updateDoc(doc(db, 'budgets', oldBudgetId), {
                        spent: increment(amountDiff)
                      })
                    );
                  }
                } else {
                  if (oldBudgetId && oldData.type === 'debit') {
                    await retryFirestoreOperation(() =>
                      updateDoc(doc(db, 'budgets', oldBudgetId), {
                        spent: increment(-oldData.amount)
                      })
                    );
                  }
                  if (newBudgetId && type === 'debit') {
                    await retryFirestoreOperation(() =>
                      updateDoc(doc(db, 'budgets', newBudgetId), {
                        spent: increment(amount)
                      })
                    );
                  }
                }
                await retryFirestoreOperation(() =>
                  updateDoc(doc(db, 'transactions', id), {
                    type,
                    amount,
                    categoryId,
                    description,
                    createdAt: newTransactionDate
                  })
                );
                clearTransactionCache();
                typeInput.value = 'debit';
                amountInput.value = '';
                categoryInput.value = '';
                descriptionInput.value = '';
                dateInput.value = '';
                addTransaction.innerHTML = 'Add Transaction';
                isEditing.transaction = false;
                await loadBudgets();
                await loadTransactions();
                await updateDashboard();
              } catch (error) {
                showError('category', `Failed to update transaction: ${error.message}`);
              } finally {
                addTransaction.disabled = false;
                addTransaction.textContent = 'Add Transaction';
                isEditing.transaction = false;
              }
            };
            addTransaction.removeEventListener('click', addTransaction._updateHandler);
            addTransaction._updateHandler = updateHandler;
            addTransaction.addEventListener('click', updateHandler, { once: true });
          } else {
            showError('category', 'Transaction not found');
          }
        } catch (error) {
          showError('category', `Failed to fetch transaction: ${error.message}`);
        }
      }
      if (e.target.classList.contains('delete-transaction')) {
        const id = e.target.dataset.id;
        if (!domElements.deleteConfirmModal || !db) {
          showError('category', 'Cannot delete: Missing components');
          return;
        }
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
                    updateDoc(doc(db, 'budgets', categoryDoc.data().budgetId), {
                      spent: increment(-transaction.amount)
                    })
                  );
                  await loadBudgets();
                }
              }
              await retryFirestoreOperation(() => deleteDoc(doc(db, 'transactions', id)));
              clearTransactionCache();
              await loadBudgets();
              await loadTransactions();
              await updateDashboard();
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
  } catch (error) {
    console.error('setupTransactions error:', error);
    showError('category', 'Failed to initialize transactions');
  }
}

async function loadChildAccounts() {
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

    if (domElements.childAccountsSection) domElements.childAccountsSection.classList.remove('hidden');

    if (currentAccountType === 'admin') {
      childSelector.classList.remove('hidden');
      childUserIdSelect.innerHTML = '<option value="">Select a Child</option>';
      const usersQuery = query(
        collection(db, 'users'),
        where('familyCode', '==', familyCode),
        where('accountType', '==', 'child')
      );
      const snapshot = await retryFirestoreOperation(() => getDocs(usersQuery));
      if (snapshot.empty) {
        childUserIdSelect.innerHTML = '<option value="">No children found</option>';
      } else {
        snapshot.forEach(doc => {
          const data = doc.data();
          const displayName = data.email && data.email.trim() !== '' ? data.email : `Child Account ${doc.id.substring(0, 8)}`;
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
  try {
    if (!db || !currentChildUserId) {
      showError('child-transaction-description', 'No user selected');
      const childTableNoUser = document.getElementById('child-transaction-table');
      if (childTableNoUser) {
        childTableNoUser.innerHTML = '<tr><td colspan="5" class="text-center py-4">No user selected</td></tr>';
      }
      const childBalanceNoUser = document.getElementById('child-balance');
      if (childBalanceNoUser) {
        childBalanceNoUser.textContent = '₹0';
      }
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

    const { start, end } = getDateRangeWrapper(domElements.dashboardFilter?.value || 'thisMonth');

    const filterMonth = domElements.dashboardFilter?.value && domElements.dashboardFilter.value !== 'thisMonth'
      ? start.toLocaleString('en-US', { month: 'short' })
      : new Date().toLocaleString('en-US', { month: 'short' });
    dateHeader.textContent = filterMonth;

    let totalBalance = 0;
    const transactionsQuery = query(collection(db, 'childTransactions'), where('userId', '==', currentChildUserId));
    const snapshot = await retryFirestoreOperation(() => getDocs(transactionsQuery));
    childTransactionTable.innerHTML = '';
    if (snapshot.empty) {
      childTransactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">No transactions found</td></tr>';
    } else {
      const transactions = [];
      snapshot.forEach(doc => {
        const transaction = doc.data();
        const createdAt = transaction.createdAt && transaction.createdAt.toDate ? transaction.createdAt.toDate() : new Date();
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
            <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.type || 'Unknown'}</td>
            <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${formatCurrency(transaction.amount || 0, 'INR')}</td>
            <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.description || ''}</td>
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
    childBalance.textContent = formatCurrency(totalBalance, 'INR');
  } catch (error) {
    console.error('loadChildTransactions error:', error);
    showError('child-transaction-description', `Failed to load child transactions: ${error.message}`);
    const childTableError = document.getElementById('child-transaction-table');
    if (childTableError) {
      childTableError.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
    }
    const childBalanceError = document.getElementById('child-balance');
    if (childBalanceError) {
      childBalanceError.textContent = '₹0';
    }
  }
}

async function loadChildTiles() {
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
      let balance = 0;
      transSnapshot.forEach(transDoc => {
        const trans = transDoc.data();
        balance += trans.type === 'credit' ? trans.amount : -trans.amount;
      });
      childBalances.set(userId, { email, balance });
    }));

    childTiles.innerHTML = '';
    if (childBalances.size === 0) {
      childTiles.innerHTML = '<div class="text-center py-4">No child accounts found</div>';
    } else {
      for (const [userId, { email, balance }] of childBalances) {
        const tile = document.createElement('div');
        tile.classList.add('bg-white', 'rounded-lg', 'shadow-md', 'p-6', 'child-tile');
        tile.innerHTML = `
          <h3 class="text-lg font-semibold text-gray-700">${email}</h3>
          <p class="text-sm font-semibold text-gray-700 mt-2">
            Balance: <span id="child-${userId}-balance">${formatCurrency(balance, 'INR')}</span>
          </p>
        `;
        childTiles.appendChild(tile);
      }
    }
  } catch (error) {
    console.error('loadChildTiles error:', error);
    const childTilesError = document.getElementById('child-tiles');
    if (childTilesError) {
      childTilesError.innerHTML = '<div class="text-center py-4 text-red-600">Failed to load child balances.</div>';
    }
  }
}

async function setupChildAccounts() {
  try {
    const addChildTransaction = document.getElementById('add-child-transaction');
    const childTransactionTable = document.getElementById('child-transaction-table');
    const childUserId = document.getElementById('child-user-id');
    if (!addChildTransaction || !childTransactionTable || !childUserId) {
      showError('child-transaction-description', 'Child transaction form or table not found');
      return;
    }

    const debouncedAddChildTransaction = debounceFunction(async () => {
      if (isEditing.childTransaction) return;
      clearErrors();
      const typeInput = document.getElementById('child-transaction-type');
      const amountInput = document.getElementById('child-transaction-amount');
      const descriptionInput = document.getElementById('child-transaction-description');
      if (!typeInput || !amountInput || !descriptionInput) {
        showError('child-transaction-description', 'Form elements not found');
        return;
      }
      const type = typeInput.value;
      const amount = parseFloat(amountInput.value);
      const description = descriptionInput.value.trim();
      const transactionUserId = currentAccountType === 'admin' ? currentChildUserId : currentUser.uid;
      if (!amount || amount <= 0) {
        showError('child-transaction-amount', 'Valid amount is required');
        return;
      }
      if (currentAccountType === 'admin' && !currentChildUserId) {
        showError('child-user-id', 'Please select a child account');
        return;
      }
      if (!currentUser || !db) {
        showError('child-transaction-description', 'Database service not available');
        return;
      }
      try {
        addChildTransaction.disabled = true;
        addChildTransaction.textContent = 'Adding...';
        const now = new Date();
        const txId = `tx-${transactionUserId}-${type}-${amount}-${description}-${now.getTime()}`.replace(/[^a-zA-Z0-9-]/g, '-');
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
        typeInput.value = 'debit';
        amountInput.value = '';
        descriptionInput.value = '';
        await loadChildTransactions();
        await loadChildTiles();
      } catch (error) {
        showError('child-transaction-description', `Failed to add transaction: ${error.message}`);
      } finally {
        addChildTransaction.disabled = false;
        addChildTransaction.textContent = 'Add Transaction';
      }
    }, 300);
    addChildTransaction.addEventListener('click', debouncedAddChildTransaction);

    childTransactionTable.addEventListener('click', async (e) => {
      if (e.target.classList.contains('edit-child-transaction')) {
        const id = e.target.dataset.id;
        try {
          const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'childTransactions', id)));
          if (docSnap.exists()) {
            const data = docSnap.data();
            const typeInput = document.getElementById('child-transaction-type');
            const amountInput = document.getElementById('child-transaction-amount');
            const descriptionInput = document.getElementById('child-transaction-description');
            if (!typeInput || !amountInput || !descriptionInput) {
              showError('child-transaction-description', 'Form elements not found');
              return;
            }
            typeInput.value = data.type || 'debit';
            amountInput.value = data.amount || '';
            descriptionInput.value = data.description || '';
            addChildTransaction.innerHTML = 'Update Transaction';
            isEditing.childTransaction = true;
            const updateHandler = async () => {
              const type = typeInput.value;
              const amount = parseFloat(amountInput.value);
              const description = descriptionInput.value.trim();
              if (!amount || amount <= 0) {
                showError('child-transaction-amount', 'Valid amount is required');
                return;
              }
              try {
                addChildTransaction.disabled = true;
                addChildTransaction.textContent = 'Updating...';
                await retryFirestoreOperation(() => 
                  updateDoc(doc(db, 'childTransactions', id), {
                    type,
                    amount,
                    description
                  })
                );
                typeInput.value = 'debit';
                amountInput.value = '';
                descriptionInput.value = '';
                addChildTransaction.innerHTML = 'Add Transaction';
                isEditing.childTransaction = false;
                await loadChildTransactions();
                await loadChildTiles();
              } catch (error) {
                showError('child-transaction-description', `Failed to update transaction: ${error.message}`);
              } finally {
                addChildTransaction.disabled = false;
                addChildTransaction.textContent = 'Add Transaction';
                isEditing.childTransaction = false;
              }
            };
            addChildTransaction.removeEventListener('click', addChildTransaction._updateHandler);
            addChildTransaction._updateHandler = updateHandler;
            addChildTransaction.addEventListener('click', updateHandler, { once: true });
          } else {
            showError('child-transaction-description', 'Transaction not found');
          }
        } catch (error) {
          showError('child-transaction-description', `Failed to fetch transaction: ${error.message}`);
        }
      }
      if (e.target.classList.contains('delete-child-transaction')) {
        const id = e.target.dataset.id;
        if (!domElements.deleteConfirmModal || !db) {
          showError('child-transaction-description', 'Cannot delete: Missing components');
          return;
        }
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
        const childTableNoSelect = document.getElementById('child-transaction-table');
        if (childTableNoSelect) {
          childTableNoSelect.innerHTML = '<tr><td colspan="5" class="text-center py-4">No child selected</td></tr>';
        }
        const childBalanceNoSelect = document.getElementById('child-balance');
        if (childBalanceNoSelect) {
          childBalanceNoSelect.textContent = '₹0';
        }
      }
    });
  } catch (error) {
    console.error('setupChildAccounts error:', error);
    showError('child-transaction-description', 'Failed to initialize child accounts');
  }
}

async function calculateChildBalance(userId) {
  try {
    if (!db || !userId) return 0;
    let totalBalance = 0;
    const transactionsQuery = query(collection(db, 'childTransactions'), where('userId', '==', userId));
    const snapshot = await retryFirestoreOperation(() => getDocs(transactionsQuery));
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
  try {
    if (!db) {
      showError('balance', 'Database service not available');
      return;
    }
    if (!currentUser || !currentUser.uid) {
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

    const { start, end } = getDateRangeWrapper(domElements.dashboardFilter?.value || 'thisMonth');

    if (currentAccountType === 'child') {
      const childBalance = await calculateChildBalance(currentUser.uid);
      childTilesElement.innerHTML = '';
      const tile = document.createElement('div');
      tile.classList.add('bg-white', 'p-4', 'sm:p-6', 'rounded-lg', 'shadow-md');
      tile.innerHTML = `
        <h3 class="text-base sm:text-lg font-semibold text-gray-700">Your Balance</h3>
        <p class="text-lg sm:text-2xl font-bold text-gray-900">${formatCurrency(childBalance, 'INR')}</p>
      `;
      childTilesElement.appendChild(tile);
      childTilesElement.style.display = 'block';

      if (balanceElement.parentElement) balanceElement.parentElement.classList.add('hidden');
      balanceElement.textContent = 'N/A';
      if (afterBudgetElement.parentElement) afterBudgetElement.parentElement.classList.add('hidden');
      afterBudgetElement.textContent = 'N/A';
      if (totalBudgetElement.parentElement) totalBudgetElement.parentElement.classList.add('hidden');
      totalBudgetElement.textContent = 'N/A';
      totalRemainingElement.textContent = 'N/A';
    } else {
      let totalBalance = 0;
      let totalBudgetAmount = 0;
      let totalSpent = 0;

      const { start: allTimeStart, end: allTimeEnd } = getDateRange('allTime', null, null);
      const transactionsQuery = query(collection(db, 'transactions'), where('familyCode', '==', familyCode));
      const snapshot = await retryFirestoreOperation(() => getDocs(transactionsQuery));
      snapshot.forEach(doc => {
        const transaction = doc.data();
        totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
      });

      let categoriesSnapshot = { docs: Array.from(categoryCache.values()) };
      if (categoryCache.size === 0) {
        const catQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
        categoriesSnapshot = await retryFirestoreOperation(() => getDocs(catQuery));
        categoriesSnapshot.docs.forEach(doc => categoryCache.set(doc.id, doc));
      }
      const budgetToCategories = new Map();
      categoriesSnapshot.docs.forEach(doc => {
        const category = doc.data();
        if (category.budgetId) {
          budgetToCategories.set(category.budgetId, [...(budgetToCategories.get(category.budgetId) || []), doc.id]);
        }
      });

      let budgetsSnapshot = { docs: Array.from(budgetCache.values()) };
      if (budgetCache.size === 0) {
        const budQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
        budgetsSnapshot = await retryFirestoreOperation(() => getDocs(budQuery));
        budgetsSnapshot.docs.forEach(doc => budgetCache.set(doc.id, doc));
      }
      for (const doc of budgetsSnapshot.docs) {
        const budget = doc.data();
        totalBudgetAmount += budget.amount;

        const categoryIds = budgetToCategories.get(doc.id) || [];
        if (categoryIds.length > 0) {
          let debitTotal = 0;
          let creditTotal = 0;
          const chunks = [];
          for (let i = 0; i < categoryIds.length; i += 30) {
            chunks.push(categoryIds.slice(i, i + 30));
          }
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

      balanceElement.textContent = formatCurrency(totalBalance, 'INR');
      if (balanceElement.parentElement) balanceElement.parentElement.classList.remove('hidden');
      totalBudgetElement.textContent = formatCurrency(totalBudgetAmount, 'INR');
      totalRemainingElement.textContent = formatCurrency(totalBudgetAmount - totalSpent, 'INR');
      if (totalBudgetElement.parentElement) totalBudgetElement.parentElement.classList.remove('hidden');
      const afterBudget = totalBalance - (totalBudgetAmount - totalSpent);
      afterBudgetElement.textContent = formatCurrency(afterBudget, 'INR');
      if (afterBudgetElement.parentElement) afterBudgetElement.parentElement.classList.remove('hidden');

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
  const maxAttempts = 10;
  let attempts = 0;
  const pollInterval = setInterval(() => {
    attempts++;
    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) {
      clearInterval(pollInterval);
      logoutButton.addEventListener('click', async () => {
        try {
          if (!auth) {
            showError('page-title', 'Authentication service not available');
            return;
          }
          logoutButton.disabled = true;
          logoutButton.textContent = 'Logging out...';
          await signOut(auth);
          currentChildUserId = null;
          currentAccountType = null;
          if (document.getElementById('login-section')) document.getElementById('login-section').classList.remove('hidden');
          if (document.getElementById('app-section')) document.getElementById('app-section').classList.add('hidden');
          const pageTitle = document.getElementById('page-title');
          if (pageTitle) pageTitle.textContent = 'Login';
          logoutButton.classList.add('hidden');
        } catch (error) {
          showError('page-title', `Failed to log out: ${error.message}`);
        } finally {
          logoutButton.disabled = false;
          logoutButton.textContent = 'Logout';
        }
      });
    } else if (attempts >= maxAttempts) {
      clearInterval(pollInterval);
    }
  }, 500);
}

async function initApp() {
  try {
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
    setupFloatingPlusButton();
  } catch (error) {
    console.error('initApp error:', error);
    showError('page-title', 'Failed to initialize app.');
  }
}

function setupFloatingPlusButton() {
  const fab = document.createElement('button');
  fab.id = 'fab-plus';
  fab.classList.add('fixed', 'bottom-4', 'right-4', 'bg-blue-600', 'text-white', 'rounded-full', 'w-12', 'h-12', 'flex', 'items-center', 'justify-center', 'shadow-lg', 'hover:bg-blue-700');
  fab.innerHTML = '+';
  document.body.appendChild(fab);

  const menuModal = document.createElement('div');
  menuModal.id = 'fab-menu-modal';
  menuModal.classList.add('hidden', 'fixed', 'inset-0', 'bg-black', 'bg-opacity-50', 'flex', 'items-center', 'justify-center');
  const menuContent = document.createElement('div');
  menuContent.classList.add('bg-white', 'p-4', 'rounded-lg', 'shadow-md');
  menuContent.innerHTML = `
    <h3 class="text-lg font-semibold mb-2">Add New</h3>
    <ul>
      <li><button id="add-transaction-option" class="block w-full text-left py-2">Add Transaction</button></li>
      <li><button id="add-budget-option" class="block w-full text-left py-2">Add Budget</button></li>
      <li><button id="add-category-option" class="block w-full text-left py-2 ${currentAccountType !== 'admin' ? 'hidden' : ''}">Add Category</button></li>
    </ul>
    <button id="close-menu" class="mt-2 text-red-600">Close</button>
  `;
  menuModal.appendChild(menuContent);
  document.body.appendChild(menuModal);

  const transactionModal = document.createElement('div');
  transactionModal.id = 'add-transaction-modal';
  transactionModal.classList.add('hidden', 'fixed', 'inset-0', 'bg-black', 'bg-opacity-50', 'flex', 'items-center', 'justify-center');
  const transContent = document.createElement('div');
  transContent.classList.add('bg-white', 'p-4', 'rounded-lg', 'shadow-md');
  transContent.innerHTML = `
    <h3 class="text-lg font-semibold mb-2">Add Transaction</h3>
    <select id="fab-trans-type" class="border p-1 mb-2"><option value="debit">Debit</option><option value="credit">Credit</option></select>
    <input id="fab-trans-amount" type="number" placeholder="Amount" class="border p-1 mb-2">
    <select id="fab-trans-category" class="border p-1 mb-2"></select>
    <input id="fab-trans-description" type="text" placeholder="Description" class="border p-1 mb-2">
    <input id="fab-trans-date" type="date" class="border p-1 mb-2">
    <button id="save-fab-trans" class="bg-blue-600 text-white p-2">Save</button>
    <button id="close-trans" class="mt-2 text-red-600">Close</button>
  `;
  transactionModal.appendChild(transContent);
  document.body.appendChild(transactionModal);

  const fabCategorySelect = document.getElementById('fab-trans-category');
  if (fabCategorySelect) {
    fabCategorySelect.innerHTML = '<option value="">Select Category</option>';
    categoryCache.forEach((doc) => {
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = doc.data().name;
      fabCategorySelect.appendChild(option);
    });
  }

  fab.addEventListener('click', () => {
    menuModal.classList.remove('hidden');
  });

  document.getElementById('close-menu')?.addEventListener('click', () => {
    menuModal.classList.add('hidden');
  });

  document.getElementById('add-transaction-option')?.addEventListener('click', () => {
    menuModal.classList.add('hidden');
    transactionModal.classList.remove('hidden');
  });

  document.getElementById('add-budget-option')?.addEventListener('click', () => {
    menuModal.classList.add('hidden');
    if (domElements.addBudgetModal) domElements.addBudgetModal.classList.remove('hidden');
  });

  document.getElementById('add-category-option')?.addEventListener('click', () => {
    menuModal.classList.add('hidden');
    if (domElements.addCategoryModal) domElements.addCategoryModal.classList.remove('hidden');
  });

  document.getElementById('close-trans')?.addEventListener('click', () => {
    transactionModal.classList.add('hidden');
  });

  document.getElementById('save-fab-trans')?.addEventListener('click', async () => {
    const type = document.getElementById('fab-trans-type')?.value;
    const amount = parseFloat(document.getElementById('fab-trans-amount')?.value);
    const categoryId = document.getElementById('fab-trans-category')?.value;
    const description = document.getElementById('fab-trans-description')?.value.trim();
    const date = new Date(document.getElementById('fab-trans-date')?.value || Date.now());
    if (!amount || !categoryId) return;
    try {
      await retryFirestoreOperation(() =>
        addDoc(collection(db, 'transactions'), {
          type,
          amount,
          categoryId,
          description,
          familyCode,
          createdAt: date
        })
      );
      if (type === 'debit') {
        const categoryDoc = await getDoc(doc(db, 'categories', categoryId));
        if (categoryDoc.exists() && categoryDoc.data().budgetId) {
          await updateDoc(doc(db, 'budgets', categoryDoc.data().budgetId), { spent: increment(amount) });
        }
      }
      clearTransactionCache();
      transactionModal.classList.add('hidden');
      await loadTransactions();
      await updateDashboard();
    } catch (error) {
      console.error('FAB add transaction error:', error);
    }
  });
}

export { loadAppData, initApp };
