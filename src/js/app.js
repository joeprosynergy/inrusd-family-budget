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
import { retryFirestoreOperation, fetchExchangeRate, getDateRange } from './utils.js';
import { collection, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp, increment } from 'firebase/firestore';

let isEditing = { transaction: false, budget: false, category: false, profile: false, childTransaction: false };
let currentChildUserId = null;
let currentAccountType = null;

// Load App Data
async function loadAppData() {
  console.log('loadAppData: Starting');
  if (!currentUser || !familyCode || !db) {
    console.error('Cannot load app data: missing user, familyCode, or Firestore');
    return;
  }
  try {
    console.log('Fetching exchange rate');
    await fetchExchangeRate(exchangeRateCache); // Use exchangeRateCache from core.js
    if (domElements.currencyToggle) {
      domElements.currencyToggle.value = userCurrency;
    }
    await Promise.all([
      loadCategories(),
      loadBudgets(),
      loadTransactions(),
      loadChildAccounts(),
      loadProfileData(),
      updateDashboard()
    ]);
    console.log('loadAppData: Complete');
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

// Tab Switching
function setupTabs() {
  console.log('Setting up tab navigation');
  const showDashboard = () => {
    console.log('Showing dashboard');
    domElements.dashboardTab?.classList.add('bg-blue-800');
    domElements.transactionsTab?.classList.remove('bg-blue-800');
    domElements.budgetsTab?.classList.remove('bg-blue-800');
    domElements.categoriesTab?.classList.remove('bg-blue-800');
    domElements.childAccountsTab?.classList.remove('bg-blue-800');
    domElements.profileTab?.classList.remove('bg-blue-800');
    domElements.dashboardSection?.classList.remove('hidden');
    domElements.transactionsSection?.classList.add('hidden');
    domElements.budgetsSection?.classList.add('hidden');
    domElements.categoriesSection?.classList.add('hidden');
    domElements.childAccountsSection?.classList.add('hidden');
    domElements.profileSection?.classList.add('hidden');
    if (domElements.pageTitle) domElements.pageTitle.textContent = 'Budget Dashboard';
  };

  const showTransactions = () => {
    console.log('Showing transactions');
    domElements.transactionsTab?.classList.add('bg-blue-800');
    domElements.dashboardTab?.classList.remove('bg-blue-800');
    domElements.budgetsTab?.classList.remove('bg-blue-800');
    domElements.categoriesTab?.classList.remove('bg-blue-800');
    domElements.childAccountsTab?.classList.remove('bg-blue-800');
    domElements.profileTab?.classList.remove('bg-blue-800');
    domElements.transactionsSection?.classList.remove('hidden');
    domElements.dashboardSection?.classList.add('hidden');
    domElements.budgetsSection?.classList.add('hidden');
    domElements.categoriesSection?.classList.add('hidden');
    domElements.childAccountsSection?.classList.add('hidden');
    domElements.profileSection?.classList.add('hidden');
    if (domElements.pageTitle) domElements.pageTitle.textContent = 'Transactions';
  };

  const showBudgets = () => {
    console.log('Showing budgets');
    domElements.budgetsTab?.classList.add('bg-blue-800');
    domElements.dashboardTab?.classList.remove('bg-blue-800');
    domElements.transactionsTab?.classList.remove('bg-blue-800');
    domElements.categoriesTab?.classList.remove('bg-blue-800');
    domElements.childAccountsTab?.classList.remove('bg-blue-800');
    domElements.profileTab?.classList.remove('bg-blue-800');
    domElements.budgetsSection?.classList.remove('hidden');
    domElements.dashboardSection?.classList.add('hidden');
    domElements.transactionsSection?.classList.add('hidden');
    domElements.categoriesSection?.classList.add('hidden');
    domElements.childAccountsSection?.classList.add('hidden');
    domElements.profileSection?.classList.add('hidden');
    if (domElements.pageTitle) domElements.pageTitle.textContent = 'Budgets';
  };

  const showCategories = () => {
    console.log('Showing categories');
    domElements.categoriesTab?.classList.add('bg-blue-800');
    domElements.dashboardTab?.classList.remove('bg-blue-800');
    domElements.transactionsTab?.classList.remove('bg-blue-800');
    domElements.budgetsTab?.classList.remove('bg-blue-800');
    domElements.childAccountsTab?.classList.remove('bg-blue-800');
    domElements.profileTab?.classList.remove('bg-blue-800');
    domElements.categoriesSection?.classList.remove('hidden');
    domElements.dashboardSection?.classList.add('hidden');
    domElements.transactionsSection?.classList.add('hidden');
    domElements.budgetsSection?.classList.add('hidden');
    domElements.childAccountsSection?.classList.add('hidden');
    domElements.profileSection?.classList.add('hidden');
    if (domElements.pageTitle) domElements.pageTitle.textContent = 'Categories';
  };

  const showChildAccounts = () => {
    console.log('Showing child accounts');
    domElements.childAccountsTab?.classList.add('bg-blue-800');
    domElements.dashboardTab?.classList.remove('bg-blue-800');
    domElements.transactionsTab?.classList.remove('bg-blue-800');
    domElements.budgetsTab?.classList.remove('bg-blue-800');
    domElements.categoriesTab?.classList.remove('bg-blue-800');
    domElements.profileTab?.classList.remove('bg-blue-800');
    domElements.childAccountsSection?.classList.remove('hidden');
    domElements.dashboardSection?.classList.add('hidden');
    domElements.transactionsSection?.classList.add('hidden');
    domElements.budgetsSection?.classList.add('hidden');
    domElements.categoriesSection?.classList.add('hidden');
    domElements.profileSection?.classList.add('hidden');
    if (domElements.pageTitle) domElements.pageTitle.textContent = 'Child Accounts';
    loadChildAccounts();
  };

  const showProfile = () => {
    console.log('Showing profile');
    domElements.profileTab?.classList.add('bg-blue-800');
    domElements.dashboardTab?.classList.remove('bg-blue-800');
    domElements.transactionsTab?.classList.remove('bg-blue-800');
    domElements.budgetsTab?.classList.remove('bg-blue-800');
    domElements.categoriesTab?.classList.remove('bg-blue-800');
    domElements.childAccountsTab?.classList.remove('bg-blue-800');
    domElements.profileSection?.classList.remove('hidden');
    domElements.dashboardSection?.classList.add('hidden');
    domElements.transactionsSection?.classList.add('hidden');
    domElements.budgetsSection?.classList.add('hidden');
    domElements.categoriesSection?.classList.add('hidden');
    domElements.childAccountsSection?.classList.add('hidden');
    if (domElements.pageTitle) domElements.pageTitle.textContent = 'User Profile';
    loadProfileData();
  };

  domElements.dashboardTab?.addEventListener('click', showDashboard);
  domElements.transactionsTab?.addEventListener('click', showTransactions);
  domElements.budgetsTab?.addEventListener('click', showBudgets);
  domElements.categoriesTab?.addEventListener('click', showCategories);
  domElements.childAccountsTab?.addEventListener('click', showChildAccounts);
  domElements.profileTab?.addEventListener('click', showProfile);
}

// Profile Management
async function setupProfile() {
  console.log('Setting up profile event listeners');
  domElements.editProfile?.addEventListener('click', () => {
    console.log('Edit Profile clicked');
    isEditing.profile = true;
    domElements.profileEmail?.removeAttribute('readonly');
    domElements.profileCurrency?.removeAttribute('disabled');
    domElements.profileFamilyCode?.removeAttribute('readonly');
    domElements.profileAccountType?.removeAttribute('disabled');
    domElements.profileEmail?.classList.remove('bg-gray-100');
    domElements.profileCurrency?.classList.remove('bg-gray-100');
    domElements.profileFamilyCode?.classList.remove('bg-gray-100');
    domElements.profileAccountType?.classList.remove('bg-gray-100');
    domElements.editProfile?.classList.add('hidden');
    domElements.saveProfile?.classList.remove('hidden');
  });

  domElements.saveProfile?.addEventListener('click', async () => {
    console.log('Save Profile clicked');
    clearErrors();
    const email = domElements.profileEmail?.value.trim();
    const currency = domElements.profileCurrency?.value;
    const familyCodeInput = domElements.profileFamilyCode?.value.trim();
    const accountType = domElements.profileAccountType?.value;

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
      domElements.saveProfile.disabled = true;
      domElements.saveProfile.textContent = 'Saving...';
      if (email !== currentUser.email) {
        console.log('Updating email in Firebase Auth:', email);
        await auth.currentUser.updateEmail(email);
      }
      await retryFirestoreOperation(() => 
        updateDoc(doc(db, 'users', currentUser.uid), {
          currency,
          familyCode: familyCodeInput,
          accountType
        })
      );
      console.log('Profile updated:', { email, currency, familyCode: familyCodeInput, accountType });
      setUserCurrency(currency);
      setFamilyCode(familyCodeInput);
      isEditing.profile = false;
      domElements.profileEmail?.setAttribute('readonly', 'true');
      domElements.profileCurrency?.setAttribute('disabled', 'true');
      domElements.profileFamilyCode?.setAttribute('readonly', 'true');
      domElements.profileAccountType?.setAttribute('disabled', 'true');
      domElements.profileEmail?.classList.add('bg-gray-100');
      domElements.profileCurrency?.classList.add('bg-gray-100');
      domElements.profileFamilyCode?.classList.add('bg-gray-100');
      domElements.profileAccountType?.classList.add('bg-gray-100');
      domElements.editProfile?.classList.remove('hidden');
      domElements.saveProfile?.classList.add('hidden');
      domElements.currencyToggle.value = currency;
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
    } finally {
      domElements.saveProfile.disabled = false;
      domElements.saveProfile.textContent = 'Save';
    }
  });

  domElements.currencyToggle?.addEventListener('change', async () => {
    const newCurrency = domElements.currencyToggle.value;
    console.log('Currency toggle changed to:', newCurrency);
    try {
      if (!currentUser || !db) {
        throw new Error('Missing user or Firestore');
      }
      await retryFirestoreOperation(() => 
        updateDoc(doc(db, 'users', currentUser.uid), { currency: newCurrency })
      );
      setUserCurrency(newCurrency);
      domElements.profileCurrency.value = newCurrency;
      await loadBudgets();
      await loadTransactions();
      await loadChildAccounts();
      await updateDashboard();
    } catch (error) {
      console.error('Error updating currency:', error);
      showError('currency-toggle', 'Failed to update currency.');
    }
  });

  domElements.dashboardFilter?.addEventListener('change', () => {
    console.log('Dashboard filter changed:', domElements.dashboardFilter.value);
    if (domElements.dashboardFilter.value === 'custom') {
      domElements.customDateRange?.classList.remove('hidden');
    } else {
      domElements.customDateRange?.classList.add('hidden');
    }
    updateDashboard();
  });
}

async function loadProfileData() {
  console.log('Loading profile data');
  if (!currentUser || !db) {
    console.error('Cannot load profile data: missing user or Firestore');
    return;
  }
  try {
    domElements.profileEmail.value = currentUser.email || '--';
    domElements.profileCurrency.value = userCurrency || 'INR';
    domElements.profileFamilyCode.value = familyCode || '--';
    domElements.profileAccountType.value = '--';
    await retryFirestoreOperation(async () => {
      const docSnap = await getDoc(doc(db, 'users', currentUser.uid));
      if (docSnap.exists()) {
        const data = docSnap.data();
        domElements.profileCurrency.value = data.currency || 'INR';
        domElements.profileFamilyCode.value = data.familyCode || '--';
        domElements.profileAccountType.value = data.accountType || '--';
        currentAccountType = data.accountType || '--';
        console.log('Profile data loaded:', { email: currentUser.email, currency: data.currency, familyCode: data.familyCode, accountType: data.accountType });
      } else {
        console.error('User document not found:', currentUser.uid);
        showError('profile-email', 'Profile data not found.');
      }
    });
  } catch (error) {
    console.error('Error loading profile data:', error);
    showError('profile-email', 'Failed to load profile data.');
  }
}

// Categories
async function loadCategories() {
  console.log('loadCategories: Starting');
  try {
    // Verify Firestore and familyCode
    if (!db || !familyCode) {
      console.error('loadCategories: Firestore or familyCode not available', { db: !!db, familyCode });
      showError('category-name', 'Database service not available');
      return;
    }

    // Verify DOM elements
    const categorySelect = document.getElementById('category');
    const categoryBudgetSelect = document.getElementById('category-budget-select');
    const newCategoryBudgetSelect = document.getElementById('new-category-budget');
    const categoryTable = document.getElementById('category-table');
    if (!categorySelect || !categoryBudgetSelect || !categoryTable) {
      console.error('loadCategories: Missing DOM elements', {
        categorySelect: !!categorySelect,
        categoryBudgetSelect: !!categoryBudgetSelect,
        categoryTable: !!categoryTable
      });
      showError('category-name', 'Category form or table not found');
      return;
    }

    // Initialize DOM
    categorySelect.innerHTML = '<option value="">Select Category</option><option value="add-new">Add New</option>';
    categoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
    if (newCategoryBudgetSelect) {
      newCategoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
    }
    categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">Loading...</td></tr>';

    // Pre-fetch budgets
    console.log('loadCategories: Fetching budgets');
    const budgetsQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
    let budgetsSnapshot;
    try {
      budgetsSnapshot = await retryFirestoreOperation(() => getDocs(budgetsQuery));
    } catch (error) {
      console.warn('loadCategories: Failed to fetch budgets, proceeding with fallback', {
        code: error.code,
        message: error.message
      });
      budgetsSnapshot = { docs: [] }; // Fallback to empty budgets
    }
    const budgetMap = new Map();
    budgetsSnapshot.forEach(doc => {
      budgetMap.set(doc.id, doc.data().name);
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = doc.data().name;
      categoryBudgetSelect.insertBefore(option, categoryBudgetSelect.querySelector('option[value="add-new"]'));
      if (newCategoryBudgetSelect) {
        const newOption = document.createElement('option');
        newOption.value = doc.id;
        newOption.textContent = doc.data().name;
        newCategoryBudgetSelect.insertBefore(newOption, newCategoryBudgetSelect.querySelector('option[value="add-new"]'));
      }
    });
    console.log('loadCategories: Budgets loaded', { count: budgetsSnapshot.size });

    // Fetch categories
    console.log('loadCategories: Fetching categories');
    const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
    let categoriesSnapshot;
    try {
      categoriesSnapshot = await retryFirestoreOperation(() => getDocs(categoriesQuery));
    } catch (error) {
      console.error('loadCategories: Failed to fetch categories', {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-600">Failed to load categories</td></tr>';
      showError('category-name', `Failed to load categories: ${error.message}`);
      return;
    }
    console.log('loadCategories: Categories fetched', { count: categoriesSnapshot.size });

    // Update category select
    categoriesSnapshot.forEach(doc => {
      const category = doc.data();
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = category.name;
      categorySelect.insertBefore(option, categorySelect.querySelector('option[value="add-new"]'));
    });

    // Update category table
    categoryTable.innerHTML = '';
    if (categoriesSnapshot.empty) {
      categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">No categories found</td></tr>';
      console.log('loadCategories: No categories in Firestore');
      return;
    }

    categoriesSnapshot.forEach(doc => {
      const category = doc.data();
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
      categoryTable.appendChild(tr);
    });
    console.log('loadCategories: Table updated', { rendered: categoriesSnapshot.size });
  } catch (error) {
    console.error('loadCategories error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('category-name', `Failed to load categories: ${error.message}`);
    const categoryTable = document.getElementById('category-table');
    if (categoryTable) {
      categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-600">Error loading categories</td></tr>';
    }
  }
}

function setupCategories() {
  console.log('setupCategories: Starting');
  try {
    // Verify DOM elements
    const addCategory = document.getElementById('add-category');
    const categorySelect = document.getElementById('category');
    const saveCategory = document.getElementById('save-category');
    const cancelCategory = document.getElementById('cancel-category');
    const categoryTable = document.getElementById('category-table');
    if (!addCategory || !categorySelect || !saveCategory || !cancelCategory || !categoryTable) {
      console.error('setupCategories: Missing DOM elements', {
        addCategory: !!addCategory,
        categorySelect: !!categorySelect,
        saveCategory: !!saveCategory,
        cancelCategory: !!cancelCategory,
        categoryTable: !!categoryTable
      });
      showError('category-name', 'Category form or table not found');
      return;
    }

    // Add Category
    addCategory.addEventListener('click', async () => {
      console.log('addCategory: Clicked', { isEditing: isEditing.category });
      if (isEditing.category) {
        console.log('addCategory: Skipped, in edit mode');
        return;
      }
      clearErrors();
      const nameInput = document.getElementById('category-name');
      const typeSelect = document.getElementById('category-type');
      const budgetSelect = document.getElementById('category-budget-select');
      if (!nameInput || !typeSelect || !budgetSelect) {
        console.error('addCategory: Missing form elements', {
          nameInput: !!nameInput,
          typeSelect: !!typeSelect,
          budgetSelect: !!budgetSelect
        });
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
        console.error('addCategory: Missing user or Firestore');
        showError('category-name', 'Database service not available');
        return;
      }
      try {
        addCategory.disabled = true;
        addCategory.textContent = 'Adding...';
        console.log('addCategory: Adding category', { name, type, budgetId });
        await retryFirestoreOperation(() => 
          addDoc(collection(db, 'categories'), {
            name,
            type,
            budgetId,
            familyCode,
            createdAt: serverTimestamp()
          })
        );
        console.log('addCategory: Category added', { name, type, budgetId });
        nameInput.value = '';
        typeSelect.value = 'income';
        budgetSelect.value = 'none';
        addCategory.innerHTML = 'Add Category';
        await loadCategories();
      } catch (error) {
        console.error('addCategory error:', {
          code: error.code,
          message: error.message,
          stack: error.stack
        });
        showError('category-name', `Failed to add category: ${error.message}`);
      } finally {
        addCategory.disabled = false;
        addCategory.textContent = 'Add Category';
      }
    });

    // Category Select Change
    categorySelect.addEventListener('change', () => {
      console.log('categorySelect: Changed', { value: categorySelect.value });
      if (categorySelect.value === 'add-new') {
        if (domElements.addCategoryModal) {
          domElements.addCategoryModal.classList.remove('hidden');
          categorySelect.value = '';
          console.log('categorySelect: Opened add category modal');
        } else {
          console.error('categorySelect: Add category modal not found');
          showError('category', 'Add category modal not found');
        }
      }
    });

    // Save Category (Modal)
    saveCategory.addEventListener('click', async () => {
      console.log('saveCategory: Clicked');
      clearErrors();
      const nameInput = document.getElementById('new-category-name');
      const typeSelect = document.getElementById('new-category-type');
      const budgetSelect = document.getElementById('new-category-budget');
      if (!nameInput || !typeSelect || !budgetSelect) {
        console.error('saveCategory: Missing modal form elements', {
          nameInput: !!nameInput,
          typeSelect: !!typeSelect,
          budgetSelect: !!budgetSelect
        });
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
        console.error('saveCategory: Missing user or Firestore');
        showError('new-category-name', 'Database service not available');
        return;
      }
      try {
        saveCategory.disabled = true;
        saveCategory.textContent = 'Saving...';
        console.log('saveCategory: Saving category', { name, type, budgetId });
        await retryFirestoreOperation(() => 
          addDoc(collection(db, 'categories'), {
            name,
            type,
            budgetId,
            familyCode,
            createdAt: serverTimestamp()
          })
        );
        console.log('saveCategory: Category saved', { name, type, budgetId });
        if (domElements.addCategoryModal) {
          domElements.addCategoryModal.classList.add('hidden');
        }
        nameInput.value = '';
        typeSelect.value = 'income';
        budgetSelect.value = 'none';
        await loadCategories();
      } catch (error) {
        console.error('saveCategory error:', {
          code: error.code,
          message: error.message,
          stack: error.stack
        });
        showError('new-category-name', `Failed to save category: ${error.message}`);
      } finally {
        saveCategory.disabled = false;
        saveCategory.textContent = 'Save';
      }
    });

    // Cancel Category (Modal)
    cancelCategory.addEventListener('click', () => {
      console.log('cancelCategory: Clicked');
      try {
        if (domElements.addCategoryModal) {
          domElements.addCategoryModal.classList.add('hidden');
        }
        const nameInput = document.getElementById('new-category-name');
        const typeSelect = document.getElementById('new-category-type');
        const budgetSelect = document.getElementById('new-category-budget');
        if (nameInput) nameInput.value = '';
        if (typeSelect) typeSelect.value = 'income';
        if (budgetSelect) budgetSelect.value = 'none';
        console.log('cancelCategory: Modal closed and inputs cleared');
      } catch (error) {
        console.error('cancelCategory error:', {
          code: error.code,
          message: error.message,
          stack: error.stack
        });
      }
    });

    // Table Actions (Edit/Delete)
    categoryTable.addEventListener('click', async (e) => {
      if (e.target.classList.contains('edit-category')) {
        console.log('editCategory: Clicked', { id: e.target.dataset.id });
        const id = e.target.dataset.id;
        if (!db) {
          console.error('editCategory: Firestore not available');
          showError('category-name', 'Database service not available');
          return;
        }
        try {
          const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', id)));
          if (docSnap.exists()) {
            const data = docSnap.data();
            console.log('editCategory: Category data fetched', { id, data });
            const nameInput = document.getElementById('category-name');
            const typeSelect = document.getElementById('category-type');
            const budgetSelect = document.getElementById('category-budget-select');
            if (!nameInput || !typeSelect || !budgetSelect) {
              console.error('editCategory: Missing form elements', {
                nameInput: !!nameInput,
                typeSelect: !!typeSelect,
                budgetSelect: !!budgetSelect
              });
              showError('category-name', 'Form elements not found');
              return;
            }
            nameInput.value = data.name || '';
            typeSelect.value = data.type || 'income';
            budgetSelect.value = data.budgetId || 'none';
            addCategory.innerHTML = 'Update Category';
            isEditing.category = true;
            console.log('editCategory: Entered edit mode', { id });
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
                console.log('editCategory: Updating category', { id, name, type, budgetId });
                await retryFirestoreOperation(() => 
                  updateDoc(doc(db, 'categories', id), { name, type, budgetId })
                );
                console.log('editCategory: Category updated', { id, name, type, budgetId });
                nameInput.value = '';
                typeSelect.value = 'income';
                budgetSelect.value = 'none';
                addCategory.innerHTML = 'Add Category';
                isEditing.category = false;
                await loadCategories();
              } catch (error) {
                console.error('editCategory error:', {
                  code: error.code,
                  message: error.message,
                  stack: error.stack
                });
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
            console.error('editCategory: Category not found', { id });
            showError('category-name', 'Category not found');
          }
        } catch (error) {
          console.error('editCategory error:', {
            code: error.code,
            message: error.message,
            stack: error.stack
          });
          showError('category-name', `Failed to fetch category: ${error.message}`);
        }
      }
      if (e.target.classList.contains('delete-category')) {
        console.log('deleteCategory: Clicked', { id: e.target.dataset.id });
        const id = e.target.dataset.id;
        if (!domElements.deleteConfirmModal || !db) {
          console.error('deleteCategory: Missing modal or Firestore', {
            deleteConfirmModal: !!domElements.deleteConfirmModal,
            db: !!db
          });
          showError('category-name', 'Cannot delete: Missing components');
          return;
        }
        domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this category?';
        domElements.deleteConfirmModal.classList.remove('hidden');
        const confirmHandler = async () => {
          try {
            console.log('deleteCategory: Deleting category', { id });
            await retryFirestoreOperation(() => deleteDoc(doc(db, 'categories', id)));
            console.log('deleteCategory: Category deleted', { id });
            await loadCategories();
            domElements.deleteConfirmModal.classList.add('hidden');
          } catch (error) {
            console.error('deleteCategory error:', {
              code: error.code,
              message: error.message,
              stack: error.stack
            });
            showError('category-name', `Failed to delete category: ${error.message}`);
          }
          domElements.confirmDelete.removeEventListener('click', confirmHandler);
        };
        const cancelHandler = () => {
          console.log('deleteCategory: Cancelled');
          domElements.deleteConfirmModal.classList.add('hidden');
          domElements.cancelDelete.removeEventListener('click', cancelHandler);
        };
        domElements.confirmDelete.addEventListener('click', confirmHandler, { once: true });
        domElements.cancelDelete.addEventListener('click', cancelHandler, { once: true });
      }
    });
  } catch (error) {
    console.error('setupCategories error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('category-name', 'Failed to initialize categories');
  }
}

    
// Budgets
async function loadBudgets() {
  console.log('Loading budgets');
  if (!db) {
    console.error('Firestore not available');
    return;
  }
  try {
    const budgetTable = document.getElementById('budget-table');
    const budgetTiles = document.getElementById('budget-tiles');
    budgetTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading...</td></tr>';
    budgetTiles.innerHTML = '<div class="text-center py-4">Loading...</div>';
    const { start, end } = getDateRangeWrapper(domElements.dashboardFilter?.value || '');
    let totalBudgetAmount = 0;
    let totalRemainingAmount = 0;
    await retryFirestoreOperation(async () => {
      const budgetsQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
      const snapshot = await getDocs(budgetsQuery);
      budgetTable.innerHTML = '';
      budgetTiles.innerHTML = '';
      snapshot.forEach(doc => {
        const budget = doc.data();
        const createdAt = budget.createdAt ? new Date(budget.createdAt.toDate()) : new Date();
        if (createdAt >= start && createdAt <= end) {
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
          budgetTiles.appendChild(tile);
        }
      });
      document.getElementById('total-budget').textContent = formatCurrency(totalBudgetAmount, 'INR');
      document.getElementById('total-remaining').textContent = formatCurrency(totalRemainingAmount, 'INR');
    });
  } catch (error) {
    console.error('Error loading budgets:', error);
    showError('budget-name', 'Failed to load budgets.');
  }
}

function setupBudgets() {
  console.log('Setting up budget event listeners');
  const addBudget = document.getElementById('add-budget');
  const saveBudget = document.getElementById('save-budget');
  const cancelBudget = document.getElementById('cancel-budget');
  const budgetTable = document.getElementById('budget-table');

  addBudget?.addEventListener('click', async () => {
    console.log('Add Budget clicked', { isEditing: isEditing.budget });
    if (isEditing.budget) return;
    clearErrors();
    const name = document.getElementById('budget-name')?.value.trim();
    const amount = parseFloat(document.getElementById('budget-amount')?.value);
    if (!name) {
      showError('budget-name', 'Name is required');
      return;
    }
    if (!amount || amount <= 0) {
      showError('budget-amount', 'Valid amount is required');
      return;
    }
    if (!currentUser || !db) {
      showError('budget-name', 'Database service not available');
      return;
    }
    try {
      addBudget.disabled = true;
      addBudget.textContent = 'Adding...';
      await retryFirestoreOperation(() => 
        addDoc(collection(db, 'budgets'), {
          name,
          amount,
          spent: 0,
          familyCode,
          createdAt: serverTimestamp()
        })
      );
      console.log('Budget added:', { name, amount });
      document.getElementById('budget-name').value = '';
      document.getElementById('budget-amount').value = '';
      addBudget.innerHTML = 'Add Budget';
      await loadBudgets();
      await loadCategories();
    } catch (error) {
      console.error('Error adding budget:', error);
      showError('budget-name', 'Failed to add budget.');
    } finally {
      addBudget.disabled = false;
      addBudget.textContent = 'Add Budget';
    }
  });

  domElements.categoryBudgetSelect?.addEventListener('change', () => {
    console.log('Category Budget select changed:', domElements.categoryBudgetSelect.value);
    if (domElements.categoryBudgetSelect.value === 'add-new') {
      domElements.addBudgetModal?.classList.remove('hidden');
      domElements.categoryBudgetSelect.value = 'none';
    }
  });

  saveBudget?.addEventListener('click', async () => {
    console.log('Save Budget clicked');
    clearErrors();
    const name = document.getElementById('new-budget-name')?.value.trim();
    const amount = parseFloat(document.getElementById('new-budget-amount')?.value);
    if (!name) {
      showError('new-budget-name', 'Name is required');
      return;
    }
    if (!amount || amount <= 0) {
      showError('new-budget-amount', 'Valid amount is required');
      return;
    }
    if (!currentUser || !db) {
      showError('new-budget-name', 'Database service not available');
      return;
    }
    try {
      saveBudget.disabled = true;
      saveBudget.textContent = 'Saving...';
      await retryFirestoreOperation(() => 
        addDoc(collection(db, 'budgets'), {
          name,
          amount,
          spent: 0,
          familyCode,
          createdAt: serverTimestamp()
        })
      );
      console.log('Budget saved:', { name, amount });
      domElements.addBudgetModal?.classList.add('hidden');
      document.getElementById('new-budget-name').value = '';
      document.getElementById('new-budget-amount').value = '';
      await loadBudgets();
      await loadCategories();
    } catch (error) {
      console.error('Error saving budget:', error);
      showError('new-budget-name', 'Failed to save budget.');
    } finally {
      saveBudget.disabled = false;
      saveBudget.textContent = 'Save';
    }
  });

  cancelBudget?.addEventListener('click', () => {
    console.log('Cancel Budget clicked');
    domElements.addBudgetModal?.classList.add('hidden');
    document.getElementById('new-budget-name').value = '';
    document.getElementById('new-budget-amount').value = '';
  });

  budgetTable?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-budget')) {
      console.log('Edit Budget clicked:', e.target.dataset.id);
      const id = e.target.dataset.id;
      if (!db) return;
      try {
        const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'budgets', id)));
        if (docSnap.exists()) {
          const data = docSnap.data();
          document.getElementById('budget-name').value = data.name;
          document.getElementById('budget-amount').value = data.amount;
          addBudget.innerHTML = 'Update Budget';
          isEditing.budget = true;
          console.log('Entered edit mode for budget:', id);
          const updateHandler = async () => {
            const name = document.getElementById('budget-name')?.value.trim();
            const amount = parseFloat(document.getElementById('budget-amount')?.value);
            if (!name) {
              showError('budget-name', 'Name is required');
              return;
            }
            if (!amount || amount <= 0) {
              showError('budget-amount', 'Valid amount is required');
              return;
            }
            try {
              addBudget.disabled = true;
              addBudget.textContent = 'Updating...';
              await retryFirestoreOperation(() => 
                updateDoc(doc(db, 'budgets', id), { name, amount })
              );
              console.log('Budget updated:', { id, name, amount });
              document.getElementById('budget-name').value = '';
              document.getElementById('budget-amount').value = '';
              addBudget.innerHTML = 'Add Budget';
              isEditing.budget = false;
              await loadBudgets();
              await loadCategories();
            } catch (error) {
              console.error('Error updating budget:', error);
              showError('budget-name', 'Failed to update budget.');
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
        console.error('Error fetching budget:', error);
        showError('budget-name', 'Failed to fetch budget.');
      }
    }
    if (e.target.classList.contains('delete-budget')) {
      console.log('Delete Budget clicked:', e.target.dataset.id);
      const id = e.target.dataset.id;
      if (domElements.deleteConfirmModal && db) {
        domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this budget?';
        domElements.deleteConfirmModal.classList.remove('hidden');
        const confirmHandler = async () => {
          try {
            await retryFirestoreOperation(() => deleteDoc(doc(db, 'budgets', id)));
            console.log('Budget deleted:', { id });
            await loadBudgets();
            await loadCategories();
            domElements.deleteConfirmModal.classList.add('hidden');
          } catch (error) {
            console.error('Error deleting budget:', error);
            showError('budget-name', 'Failed to delete budget.');
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
}

// Transactions
async function loadTransactions() {
  console.log('loadTransactions: Starting');
  try {
    // Verify DOM elements
    const transactionTable = document.getElementById('transaction-table');
    if (!transactionTable) {
      console.error('loadTransactions: Transaction table not found');
      showError('category', 'Transaction table not found');
      return;
    }
    transactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading...</td></tr>';

    // Verify Firestore and familyCode
    if (!db || !familyCode) {
      console.error('loadTransactions: Firestore or familyCode not available', { db: !!db, familyCode });
      showError('category', 'Database service not available');
      transactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-600">Database unavailable</td></tr>';
      return;
    }

    // Use a broad date range to avoid over-filtering
    const { start, end } = getDateRangeWrapper(domElements.dashboardFilter?.value || 'allTime');
    console.log('loadTransactions: Date range', { start: start.toISOString(), end: end.toISOString() });

    // Pre-fetch categories
    console.log('loadTransactions: Fetching categories');
    const categoriesQuery = query(collection(db, 'categories'), where('familyCode', '==', familyCode));
    let categoriesSnapshot;
    try {
      categoriesSnapshot = await getDocs(categoriesQuery);
    } catch (error) {
      console.warn('loadTransactions: Failed to fetch categories, proceeding with fallback', {
        code: error.code,
        message: error.message
      });
      categoriesSnapshot = { docs: [] }; // Fallback to empty categories
    }
    const categoryMap = new Map();
    categoriesSnapshot.forEach(doc => {
      categoryMap.set(doc.id, doc.data().name);
    });
    console.log('loadTransactions: Categories loaded', { count: categoriesSnapshot.size });

    // Fetch transactions
    console.log('loadTransactions: Fetching transactions');
    const transactionsQuery = query(collection(db, 'transactions'), where('familyCode', '==', familyCode));
    let snapshot;
    try {
      snapshot = await retryFirestoreOperation(() => getDocs(transactionsQuery));
    } catch (error) {
      console.error('loadTransactions: Failed to fetch transactions', {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      transactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-600">Failed to load transactions</td></tr>';
      showError('category', `Failed to load transactions: ${error.message}`);
      return;
    }
    console.log('loadTransactions: Transactions fetched', { count: snapshot.size });

    transactionTable.innerHTML = '';
    if (snapshot.empty) {
      transactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">No transactions found</td></tr>';
      console.log('loadTransactions: No transactions in Firestore');
      return;
    }

    const transactions = [];
    snapshot.forEach(doc => {
      const transaction = doc.data();
      const createdAt = transaction.createdAt && transaction.createdAt.toDate ? new Date(transaction.createdAt.toDate()) : new Date();
      if (createdAt >= start && createdAt <= end) {
        transactions.push({ id: doc.id, ...transaction });
      }
    });
    console.log('loadTransactions: Transactions after date filter', { count: transactions.length });

    if (transactions.length === 0) {
      transactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">No transactions found for this period</td></tr>';
      console.log('loadTransactions: No transactions in date range');
      return;
    }

    transactions.forEach(transaction => {
      const tr = document.createElement('tr');
      tr.classList.add('table-row');
      const categoryName = transaction.categoryId ? categoryMap.get(transaction.categoryId) || 'Unknown' : 'None';
      tr.innerHTML = `
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.type || 'Unknown'}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${formatCurrency(transaction.amount || 0, 'INR')}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${categoryName}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.description || ''}</td>
        <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm">
          <button class="text-blue-600 hover:text-blue-800 mr-2 edit-transaction" data-id="${transaction.id}">Edit</button>
          <button class="text-red-600 hover:text-red-800 delete-transaction" data-id="${transaction.id}">Delete</button>
        </td>
      `;
      transactionTable.appendChild(tr);
    });
    console.log('loadTransactions: Table updated', { rendered: transactions.length });
  } catch (error) {
    console.error('loadTransactions error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('category', `Failed to load transactions: ${error.message}`);
    const transactionTable = document.getElementById('transaction-table');
    if (transactionTable) {
      transactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
    }
  }
}

function setupTransactions() {
  console.log('setupTransactions: Starting');
  try {
    const addTransaction = document.getElementById('add-transaction');
    const transactionTable = document.getElementById('transaction-table');

    if (!addTransaction || !transactionTable) {
      console.error('setupTransactions: Missing DOM elements', {
        addTransaction: !!addTransaction,
        transactionTable: !!transactionTable
      });
      showError('category', 'Transaction form or table not found');
      return;
    }

    addTransaction.addEventListener('click', async () => {
      console.log('addTransaction: Clicked', { isEditing: isEditing.transaction });
      if (isEditing.transaction) {
        console.log('addTransaction: Skipped, in edit mode');
        return;
      }
      clearErrors();
      const typeInput = document.getElementById('type');
      const amountInput = document.getElementById('amount');
      const categoryInput = document.getElementById('category');
      const descriptionInput = document.getElementById('description');
      if (!typeInput || !amountInput || !categoryInput || !descriptionInput) {
        console.error('addTransaction: Missing form elements', {
          typeInput: !!typeInput,
          amountInput: !!amountInput,
          categoryInput: !!categoryInput,
          descriptionInput: !!descriptionInput
        });
        showError('category', 'Form elements not found');
        return;
      }
      const type = typeInput.value;
      const amount = parseFloat(amountInput.value);
      const categoryId = categoryInput.value;
      const description = descriptionInput.value.trim();
      if (!amount || amount <= 0) {
        showError('amount', 'Valid amount is required');
        return;
      }
      if (!categoryId) {
        showError('category', 'Category is required');
        return;
      }
      if (!currentUser || !db) {
        showError('category', 'Database service not available');
        return;
      }
      try {
        addTransaction.disabled = true;
        addTransaction.textContent = 'Adding...';
        console.log('addTransaction: Adding transaction', { type, amount, categoryId, description });
        const docRef = await retryFirestoreOperation(() => 
          addDoc(collection(db, 'transactions'), {
            type,
            amount,
            categoryId,
            description,
            familyCode,
            createdAt: serverTimestamp()
          })
        );
        if (type === 'debit') {
          const categoryDoc = await getDoc(doc(db, 'categories', categoryId));
          if (categoryDoc.exists() && categoryDoc.data().budgetId) {
            await retryFirestoreOperation(() => 
              updateDoc(doc(db, 'budgets', categoryDoc.data().budgetId), {
                spent: increment(amount)
              })
            );
            console.log('addTransaction: Updated budget spent', { budgetId: categoryDoc.data().budgetId, amount });
            await loadBudgets();
          }
        }
        console.log('addTransaction: Transaction added', { id: docRef.id, type, amount, categoryId });
        typeInput.value = 'debit';
        amountInput.value = '';
        categoryInput.value = '';
        descriptionInput.value = '';
        addTransaction.innerHTML = 'Add Transaction';
        await loadTransactions();
        await updateDashboard();
      } catch (error) {
        console.error('addTransaction error:', {
          code: error.code,
          message: error.message,
          stack: error.stack
        });
        showError('category', `Failed to add transaction: ${error.message}`);
      } finally {
        addTransaction.disabled = false;
        addTransaction.textContent = 'Add Transaction';
      }
    });

    transactionTable.addEventListener('click', async (e) => {
      if (e.target.classList.contains('edit-transaction')) {
        console.log('editTransaction: Clicked', { id: e.target.dataset.id });
        const id = e.target.dataset.id;
        if (!db) {
          console.error('editTransaction: Firestore not available');
          showError('category', 'Database service not available');
          return;
        }
        try {
          const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'transactions', id)));
          if (docSnap.exists()) {
            const oldData = docSnap.data();
            const typeInput = document.getElementById('type');
            const amountInput = document.getElementById('amount');
            const categoryInput = document.getElementById('category');
            const descriptionInput = document.getElementById('description');
            if (!typeInput || !amountInput || !categoryInput || !descriptionInput) {
              console.error('editTransaction: Missing form elements', {
                typeInput: !!typeInput,
                amountInput: !!amountInput,
                categoryInput: !!categoryInput,
                descriptionInput: !!descriptionInput
              });
              showError('category', 'Form elements not found');
              return;
            }
            typeInput.value = oldData.type;
            amountInput.value = oldData.amount;
            categoryInput.value = oldData.categoryId;
            descriptionInput.value = oldData.description || '';
            addTransaction.innerHTML = 'Update Transaction';
            isEditing.transaction = true;
            console.log('editTransaction: Entered edit mode', { id });
            const updateHandler = async () => {
              const type = typeInput.value;
              const amount = parseFloat(amountInput.value);
              const categoryId = categoryInput.value;
              const description = descriptionInput.value.trim();
              if (!amount || amount <= 0) {
                showError('amount', 'Valid amount is required');
                return;
              }
              if (!categoryId) {
                showError('category', 'Category is required');
                return;
              }
              try {
                addTransaction.disabled = true;
                addTransaction.textContent = 'Updating...';
                let oldBudgetId = null;
                let newBudgetId = null;
                if (oldData.type === 'debit') {
                  const oldCategoryDoc = await getDoc(doc(db, 'categories', oldData.categoryId));
                  if (oldCategoryDoc.exists() && oldCategoryDoc.data().budgetId) {
                    oldBudgetId = oldCategoryDoc.data().budgetId;
                  }
                }
                if (type === 'debit') {
                  const newCategoryDoc = await getDoc(doc(db, 'categories', categoryId));
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
                    console.log('editTransaction: Updated budget spent', { budgetId: oldBudgetId, amountDiff });
                  }
                } else {
                  if (oldBudgetId && oldData.type === 'debit') {
                    await retryFirestoreOperation(() => 
                      updateDoc(doc(db, 'budgets', oldBudgetId), {
                        spent: increment(-oldData.amount)
                      })
                    );
                    console.log('editTransaction: Reverted budget spent', { budgetId: oldBudgetId, amount: oldData.amount });
                  }
                  if (newBudgetId && type === 'debit') {
                    await retryFirestoreOperation(() => 
                      updateDoc(doc(db, 'budgets', newBudgetId), {
                        spent: increment(amount)
                      })
                    );
                    console.log('editTransaction: Updated budget spent', { budgetId: newBudgetId, amount });
                  }
                }
                await retryFirestoreOperation(() => 
                  updateDoc(doc(db, 'transactions', id), {
                    type,
                    amount,
                    categoryId,
                    description
                  })
                );
                console.log('editTransaction: Transaction updated', { id, type, amount, categoryId });
                typeInput.value = 'debit';
                amountInput.value = '';
                categoryInput.value = '';
                descriptionInput.value = '';
                addTransaction.innerHTML = 'Add Transaction';
                isEditing.transaction = false;
                await loadBudgets();
                await loadTransactions();
                await updateDashboard();
              } catch (error) {
                console.error('editTransaction error:', {
                  code: error.code,
                  message: error.message,
                  stack: error.stack
                });
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
            console.error('editTransaction: Transaction not found', { id });
            showError('category', 'Transaction not found');
          }
        } catch (error) {
          console.error('editTransaction error:', {
            code: error.code,
            message: error.message,
            stack: error.stack
          });
          showError('category', `Failed to fetch transaction: ${error.message}`);
        }
      }
      if (e.target.classList.contains('delete-transaction')) {
        console.log('deleteTransaction: Clicked', { id: e.target.dataset.id });
        const id = e.target.dataset.id;
        if (!domElements.deleteConfirmModal || !db) {
          console.error('deleteTransaction: Missing modal or Firestore', {
            deleteConfirmModal: !!domElements.deleteConfirmModal,
            db: !!db
          });
          showError('category', 'Cannot delete: Missing components');
          return;
        }
        domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this transaction?';
        domElements.deleteConfirmModal.classList.remove('hidden');
        const confirmHandler = async () => {
          try {
            const docSnap = await getDoc(doc(db, 'transactions', id));
            if (docSnap.exists()) {
              const transaction = docSnap.data();
              if (transaction.type === 'debit' && transaction.categoryId) {
                const categoryDoc = await getDoc(doc(db, 'categories', transaction.categoryId));
                if (categoryDoc.exists() && categoryDoc.data().budgetId) {
                  await retryFirestoreOperation(() => 
                    updateDoc(doc(db, 'budgets', categoryDoc.data().budgetId), {
                      spent: increment(-transaction.amount)
                    })
                  );
                  console.log('deleteTransaction: Reverted budget spent', { budgetId: categoryDoc.data().budgetId, amount: transaction.amount });
                  await loadBudgets();
                }
              }
              await retryFirestoreOperation(() => deleteDoc(doc(db, 'transactions', id)));
              console.log('deleteTransaction: Transaction deleted', { id });
              await loadTransactions();
              await updateDashboard();
              domElements.deleteConfirmModal.classList.add('hidden');
            } else {
              console.error('deleteTransaction: Transaction not found', { id });
              showError('category', 'Transaction not found');
            }
          } catch (error) {
            console.error('deleteTransaction error:', {
              code: error.code,
              message: error.message,
              stack: error.stack
            });
            showError('category', `Failed to delete transaction: ${error.message}`);
          }
          domElements.confirmDelete.removeEventListener('click', confirmHandler);
        };
        const cancelHandler = () => {
          console.log('deleteTransaction: Cancelled');
          domElements.deleteConfirmModal.classList.add('hidden');
          domElements.cancelDelete.removeEventListener('click', cancelHandler);
        };
        domElements.confirmDelete.addEventListener('click', confirmHandler, { once: true });
        domElements.cancelDelete.addEventListener('click', cancelHandler, { once: true });
      }
    });
  } catch (error) {
    console.error('setupTransactions error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('category', 'Failed to initialize transactions');
  }
}

// Child Accounts
async function loadChildAccounts() {
  console.log('loadChildAccounts: Starting', { familyCode, accountType: currentAccountType });
  try {
    // Verify prerequisites
    if (!currentUser || !db || !familyCode) {
      console.error('loadChildAccounts: Missing user, Firestore, or familyCode', {
        currentUser: !!currentUser,
        db: !!db,
        familyCode
      });
      showError('child-user-id', 'Unable to load child accounts.');
      return;
    }

    // Verify DOM elements
    const childSelector = document.getElementById('child-selector');
    const childUserIdSelect = document.getElementById('child-user-id');
    if (!childSelector || !childUserIdSelect) {
      console.error('loadChildAccounts: Missing DOM elements', {
        childSelector: !!childSelector,
        childUserIdSelect: !!childUserIdSelect
      });
      showError('child-user-id', 'Child selector not found');
      return;
    }

    if (currentAccountType === 'admin') {
      console.log('loadChildAccounts: Admin mode, loading child users');
      childSelector.classList.remove('hidden');
      childUserIdSelect.innerHTML = '<option value="">Select a Child</option>';
      try {
        await retryFirestoreOperation(async () => {
          const usersQuery = query(
            collection(db, 'users'),
            where('familyCode', '==', familyCode),
            where('accountType', '==', 'child')
          );
          const snapshot = await getDocs(usersQuery);
          console.log('loadChildAccounts: Child users fetched', { count: snapshot.size });
          if (snapshot.empty) {
            childUserIdSelect.innerHTML = '<option value="">No children found</option>';
            console.log('loadChildAccounts: No child users found');
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
        });
      } catch (error) {
        console.error('loadChildAccounts: Failed to fetch child users', {
          code: error.code,
          message: error.message,
          stack: error.stack
        });
        childUserIdSelect.innerHTML = '<option value="">Error loading children</option>';
        showError('child-user-id', `Failed to load child accounts: ${error.message}`);
        return;
      }
      currentChildUserId = childUserIdSelect.value || null;
    } else {
      console.log('loadChildAccounts: Non-admin mode, using current user');
      childSelector.classList.add('hidden');
      currentChildUserId = currentUser.uid;
    }

    console.log('loadChildAccounts: Loading child transactions for user:', currentChildUserId);
    await loadChildTransactions();
  } catch (error) {
    console.error('loadChildAccounts error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('child-user-id', `Failed to load child accounts: ${error.message}`);
    const childUserIdSelect = document.getElementById('child-user-id');
    if (childUserIdSelect) {
      childUserIdSelect.innerHTML = '<option value="">Error loading children</option>';
    }
  }
}

async function loadChildTransactions() {
  console.log('loadChildTransactions: Starting for user:', currentChildUserId);
  try {
    // Verify Firestore and user ID
    if (!db || !currentChildUserId) {
      console.error('loadChildTransactions: Firestore or user ID not available', {
        db: !!db,
        currentChildUserId
      });
      showError('child-transaction-description', 'No user selected');
      const table = document.getElementById('child-transaction-table');
      if (table) {
        table.innerHTML = '<tr><td colspan="4" class="text-center py-4">No user selected</td></tr>';
      }
      const balance = document.getElementById('child-balance');
      if (balance) {
        balance.textContent = formatCurrency(0, 'INR');
      }
      return;
    }

    // Verify DOM elements
    const childTransactionTable = document.getElementById('child-transaction-table');
    const childBalance = document.getElementById('child-balance');
    if (!childTransactionTable || !childBalance) {
      console.error('loadChildTransactions: Missing DOM elements', {
        childTransactionTable: !!childTransactionTable,
        childBalance: !!childBalance
      });
      showError('child-transaction-description', 'Transaction table or balance not found');
      return;
    }

    childTransactionTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">Loading...</td></tr>';
    let totalBalance = 0;
    try {
      await retryFirestoreOperation(async () => {
        const transactionsQuery = query(collection(db, 'childTransactions'), where('userId', '==', currentChildUserId));
        const snapshot = await getDocs(transactionsQuery);
        console.log('loadChildTransactions: Transactions fetched', { count: snapshot.size });
        childTransactionTable.innerHTML = '';
        if (snapshot.empty) {
          childTransactionTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">No transactions found</td></tr>';
          console.log('loadChildTransactions: No transactions found');
        } else {
          snapshot.forEach(doc => {
            const transaction = doc.data();
            totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
            const tr = document.createElement('tr');
            tr.classList.add('table-row');
            tr.innerHTML = `
              <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.type || 'Unknown'}</td>
              <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${formatCurrency(transaction.amount || 0, 'INR')}</td>
              <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.description || ''}</td>
              <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm">
                <button class="text-blue-600 hover:text-blue-800 mr-2 edit-child-transaction" data-id="${doc.id}" data-user-id="${transaction.userId}">Edit</button>
                <button class="text-red-600 hover:text-red-800 delete-child-transaction" data-id="${doc.id}" data-user-id="${transaction.userId}">Delete</button>
              </td>
            `;
            childTransactionTable.appendChild(tr);
          });
        }
        childBalance.textContent = formatCurrency(totalBalance, 'INR');
      });
    } catch (error) {
      console.error('loadChildTransactions error:', {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      showError('child-transaction-description', `Failed to load child transactions: ${error.message}`);
      childTransactionTable.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
      childBalance.textContent = formatCurrency(0, 'INR');
    }
  } catch (error) {
    console.error('loadChildTransactions error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('child-transaction-description', `Failed to load child transactions: ${error.message}`);
    const table = document.getElementById('child-transaction-table');
    if (table) {
      table.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
    }
    const balance = document.getElementById('child-balance');
    if (balance) {
      balance.textContent = formatCurrency(0, 'INR');
    }
  }
}

async function loadChildTiles() {
  console.log('loadChildTiles: Starting');
  try {
    // Verify Firestore and familyCode
    if (!db || !familyCode) {
      console.error('loadChildTiles: Firestore or familyCode not available', { db: !!db, familyCode });
      showError('child-tiles', 'No family data');
      return;
    }

    // Verify DOM element
    const childTiles = document.getElementById('child-tiles');
    if (!childTiles) {
      console.warn('loadChildTiles: Child tiles element not found, skipping');
      return; // Skip if missing, as it's not critical
    }

    childTiles.innerHTML = '<div class="text-center py-4">Loading...</div>';
    const childBalances = new Map();
    try {
      await retryFirestoreOperation(async () => {
        const usersQuery = query(collection(db, 'users'), where('familyCode', '==', familyCode), where('accountType', '==', 'child'));
        const snapshot = await getDocs(usersQuery);
        console.log('loadChildTiles: Child users fetched', { count: snapshot.size });
        if (snapshot.empty) {
          childTiles.innerHTML = '<div class="text-center py-4">No child accounts found</div>';
          console.log('loadChildTiles: No child accounts found');
          return [];
        }
        const promises = snapshot.docs.map(async doc => {
          const userId = doc.id;
          const email = doc.data().email && doc.data().email.trim() !== '' ? doc.data().email : `Child Account ${userId.substring(0, 8)}`;
          try {
            const transQuery = query(collection(db, 'childTransactions'), where('userId', '==', userId));
            const transSnapshot = await getDocs(transQuery);
            let balance = 0;
            transSnapshot.forEach(transDoc => {
              const trans = transDoc.data();
              balance += trans.type === 'credit' ? trans.amount : -trans.amount;
            });
            childBalances.set(userId, { email, balance });
          } catch (error) {
            console.warn('loadChildTiles: No transactions for child', {
              userId,
              email,
              error: error.message
            });
            childBalances.set(userId, { email, balance: 0 });
          }
        });
        return Promise.all(promises);
      });
    } catch (error) {
      console.error('loadChildTiles: Failed to fetch child users', {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      childTiles.innerHTML = '<div class="text-center py-4 text-red-600">Failed to load child balances.</div>';
      showError('child-tiles', `Failed to load child balances: ${error.message}`);
      return;
    }

    childTiles.innerHTML = '';
    if (childBalances.size === 0) {
      childTiles.innerHTML = '<div class="text-center py-4">No child accounts found</div>';
      console.log('loadChildTiles: No child balances to display');
    } else {
      childBalances.forEach(({ email, balance }, userId) => {
        const tile = document.createElement('div');
        tile.classList.add('bg-white', 'rounded-lg', 'shadow-md', 'p-6', 'child-tile');
        tile.innerHTML = `
          <h3 class="text-lg font-semibold text-gray-700">${email}</h3>
          <p class="text-sm font-semibold text-gray-700 mt-2">
            Balance: <span id="child-${userId}-balance">${formatCurrency(balance, 'INR')}</span>
          </p>
        `;
        childTiles.appendChild(tile);
      });
      console.log('loadChildTiles: Tiles updated', { rendered: childBalances.size });
    }
  } catch (error) {
    console.error('loadChildTiles error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    const childTiles = document.getElementById('child-tiles');
    if (childTiles) {
      childTiles.innerHTML = '<div class="text-center py-4 text-red-600">Failed to load child balances.</div>';
    }
  }
}

function setupChildAccounts() {
  console.log('setupChildAccounts: Starting');
  try {
    // Verify DOM elements
    const addChildTransaction = document.getElementById('add-child-transaction');
    const childTransactionTable = document.getElementById('child-transaction-table');
    const childUserId = document.getElementById('child-user-id');
    if (!addChildTransaction || !childTransactionTable || !childUserId) {
      console.error('setupChildAccounts: Missing DOM elements', {
        addChildTransaction: !!addChildTransaction,
        childTransactionTable: !!childTransactionTable,
        childUserId: !!childUserId
      });
      showError('child-transaction-description', 'Child transaction form or table not found');
      return;
    }

    // Add Child Transaction (with idempotency)
    if (!addChildTransaction._listenerBound) {
      let isProcessing = false;
      const DEBOUNCE_MS = 5000;
      let lastAddClickTime = 0;

      const addChildTransactionHandler = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const now = Date.now();
        if (now - lastAddClickTime < DEBOUNCE_MS || isProcessing) {
          console.log('addChildTransaction: Ignored due to debounce or processing', {
            timeSinceLastClick: now - lastAddClickTime,
            isProcessing
          });
          return;
        }
        lastAddClickTime = now;
        isProcessing = true;

        console.log('addChildTransaction: Clicked', {
          isEditing: isEditing.childTransaction,
          currentChildUserId,
          currentAccountType,
          authState: !!currentUser
        });
        if (isEditing.childTransaction) {
          console.log('addChildTransaction: Skipped, in edit mode');
          isProcessing = false;
          return;
        }
        clearErrors();
        const typeInput = document.getElementById('child-transaction-type');
        const amountInput = document.getElementById('child-transaction-amount');
        const descriptionInput = document.getElementById('child-transaction-description');
        if (!typeInput || !amountInput || !descriptionInput) {
          console.error('addChildTransaction: Missing form elements', {
            typeInput: !!typeInput,
            amountInput: !!amountInput,
            descriptionInput: !!descriptionInput
          });
          showError('child-transaction-description', 'Form elements not found');
          isProcessing = false;
          return;
        }
        const type = typeInput.value;
        const amount = parseFloat(amountInput.value);
        const description = descriptionInput.value.trim();
        const transactionUserId = currentAccountType === 'admin' ? currentChildUserId : currentUser.uid;
        const txId = `tx-${transactionUserId}-${type}-${amount}-${description}-${now}`.replace(/[^a-zA-Z0-9-]/g, '-');
        if (!amount || amount <= 0) {
          console.log('addChildTransaction: Invalid amount', { amount });
          showError('child-transaction-amount', 'Valid amount is required');
          isProcessing = false;
          return;
        }
        if (currentAccountType === 'admin' && !currentChildUserId) {
          console.error('addChildTransaction: No child user selected for admin account');
          showError('child-user-id', 'Please select a child account');
          isProcessing = false;
          return;
        }
        if (!currentUser || !db) {
          console.error('addChildTransaction: Missing user or Firestore', {
            currentUser: !!currentUser,
            db: !!db
          });
          showError('child-transaction-description', 'Database service not available');
          isProcessing = false;
          return;
        }

        // Retry transaction write with auth validation
        let writeSuccess = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            addChildTransaction.disabled = true;
            addChildTransaction.textContent = `Adding (Attempt ${attempt}/3)...`;
            console.log('addChildTransaction: Adding transaction', {
              attempt,
              txId,
              type,
              amount,
              transactionUserId,
              description,
              familyCode
            });
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
            console.log('addChildTransaction: Transaction added', { type, amount, userId: transactionUserId, txId });
            writeSuccess = true;
            break;
          } catch (error) {
            console.error('addChildTransaction: Write attempt failed', {
              attempt,
              code: error.code,
              message: error.message,
              stack: error.stack
            });
            if (attempt < 3) {
              console.log('addChildTransaction: Retrying after delay');
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }

        if (writeSuccess) {
          typeInput.value = 'debit';
          amountInput.value = '';
          descriptionInput.value = '';
          addChildTransaction.innerHTML = 'Add Transaction';
          await loadChildTransactions();
          await loadChildTiles();
        } else {
          showError('child-transaction-description', 'Failed to add transaction: Permission denied or connectivity issue');
        }

        addChildTransaction.disabled = false;
        addChildTransaction.textContent = 'Add Transaction';
        isProcessing = false;
      };

      addChildTransaction.addEventListener('click', addChildTransactionHandler);
      addChildTransaction._listenerBound = true;
    }

    // Table Actions (Edit/Delete)
    childTransactionTable.addEventListener('click', async (e) => {
      if (e.target.classList.contains('edit-child-transaction')) {
        console.log('editChildTransaction: Clicked', { id: e.target.dataset.id });
        const id = e.target.dataset.id;
        if (!db) {
          console.error('editChildTransaction: Firestore not available');
          showError('child-transaction-description', 'Database service not available');
          return;
        }
        try {
          const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'childTransactions', id)));
          if (docSnap.exists()) {
            const data = docSnap.data();
            console.log('editChildTransaction: Transaction data fetched', { id, data });
            const typeInput = document.getElementById('child-transaction-type');
            const amountInput = document.getElementById('child-transaction-amount');
            const descriptionInput = document.getElementById('child-transaction-description');
            if (!typeInput || !amountInput || !descriptionInput) {
              console.error('editChildTransaction: Missing form elements', {
                typeInput: !!typeInput,
                amountInput: !!amountInput,
                descriptionInput: !!descriptionInput
              });
              showError('child-transaction-description', 'Form elements not found');
              return;
            }
            typeInput.value = data.type || 'debit';
            amountInput.value = data.amount || '';
            descriptionInput.value = data.description || '';
            addChildTransaction.innerHTML = 'Update Transaction';
            isEditing.childTransaction = true;
            console.log('editChildTransaction: Entered edit mode', { id });
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
                console.log('editChildTransaction: Updating transaction', { id, type, amount, description });
                await retryFirestoreOperation(() => 
                  updateDoc(doc(db, 'childTransactions', id), {
                    type,
                    amount,
                    description
                  })
                );
                console.log('editChildTransaction: Transaction updated', { id, type, amount });
                typeInput.value = 'debit';
                amountInput.value = '';
                descriptionInput.value = '';
                addChildTransaction.innerHTML = 'Add Transaction';
                isEditing.childTransaction = false;
                await loadChildTransactions();
                await loadChildTiles();
              } catch (error) {
                console.error('editChildTransaction error:', {
                  code: error.code,
                  message: error.message,
                  stack: error.stack
                });
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
            console.error('editChildTransaction: Transaction not found', { id });
            showError('child-transaction-description', 'Transaction not found');
          }
        } catch (error) {
          console.error('editChildTransaction error:', {
            code: error.code,
            message: error.message,
            stack: error.stack
          });
          showError('child-transaction-description', `Failed to fetch transaction: ${error.message}`);
        }
      }
      if (e.target.classList.contains('delete-child-transaction')) {
        console.log('deleteChildTransaction: Clicked', { id: e.target.dataset.id });
        const id = e.target.dataset.id;
        if (!domElements.deleteConfirmModal || !db) {
          console.error('deleteChildTransaction: Missing modal or Firestore', {
            deleteConfirmModal: !!domElements.deleteConfirmModal,
            db: !!db
          });
          showError('child-transaction-description', 'Cannot delete: Missing components');
          return;
        }
        domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this child transaction?';
        domElements.deleteConfirmModal.classList.remove('hidden');
        const confirmHandler = async () => {
          try {
            console.log('deleteChildTransaction: Deleting transaction', { id });
            await retryFirestoreOperation(() => deleteDoc(doc(db, 'childTransactions', id)));
            console.log('deleteChildTransaction: Transaction deleted', { id });
            await loadChildTransactions();
            await loadChildTiles();
            domElements.deleteConfirmModal.classList.add('hidden');
          } catch (error) {
            console.error('deleteChildTransaction error:', {
              code: error.code,
              message: error.message,
              stack: error.stack
            });
            showError('child-transaction-description', `Failed to delete transaction: ${error.message}`);
          }
          domElements.confirmDelete.removeEventListener('click', confirmHandler);
        };
        const cancelHandler = () => {
          console.log('deleteChildTransaction: Cancelled');
          domElements.deleteConfirmModal.classList.add('hidden');
          domElements.cancelDelete.removeEventListener('click', cancelHandler);
        };
        domElements.confirmDelete.addEventListener('click', confirmHandler, { once: true });
        domElements.cancelDelete.addEventListener('click', cancelHandler, { once: true });
      }
    });

    // Child User Selection
    childUserId.addEventListener('change', () => {
      console.log('childUserId: Changed', { value: childUserId.value });
      currentChildUserId = childUserId.value || null;
      if (currentChildUserId) {
        console.log('childUserId: Loading transactions for child', { currentChildUserId });
        loadChildTransactions();
      } else {
        console.log('childUserId: No child selected');
        const table = document.getElementById('child-transaction-table');
        if (table) {
          table.innerHTML = '<tr><td colspan="4" class="text-center py-4">No child selected</td></tr>';
        }
        const balance = document.getElementById('child-balance');
        if (balance) {
          balance.textContent = formatCurrency(0, 'INR');
        }
      }
    });
  } catch (error) {
    console.error('setupChildAccounts error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('child-transaction-description', 'Failed to initialize child accounts');
  }
}

// Helper function to calculate child balance
async function calculateChildBalance(userId) {
  console.log('calculateChildBalance: Starting for user:', userId);
  try {
    if (!db || !userId) {
      console.error('calculateChildBalance: Firestore or user ID not available', { db: !!db, userId });
      return 0;
    }
    let totalBalance = 0;
    await retryFirestoreOperation(async () => {
      const transactionsQuery = query(collection(db, 'childTransactions'), where('userId', '==', userId));
      const snapshot = await getDocs(transactionsQuery);
      console.log('calculateChildBalance: Child transactions fetched', { count: snapshot.size });
      snapshot.forEach(doc => {
        const transaction = doc.data();
        totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
      });
    });
    console.log('calculateChildBalance: Balance calculated', { totalBalance });
    return totalBalance;
  } catch (error) {
    console.error('calculateChildBalance error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    return 0;
  }
}

// Dashboard Updates
async function updateDashboard() {
  console.log('updateDashboard: Starting', { accountType: currentAccountType });
  try {
    if (!db) {
      console.error('updateDashboard: Firestore not available');
      showError('balance', 'Database service not available');
      return;
    }

    // Verify DOM elements
    const balanceElement = document.getElementById('balance');
    const afterBudgetElement = document.getElementById('after-budget');
    const totalBudgetElement = document.getElementById('total-budget');
    const totalRemainingElement = document.getElementById('total-remaining');
    const childTilesElement = document.getElementById('child-tiles');
    if (!balanceElement || !afterBudgetElement || !totalBudgetElement || !totalRemainingElement || !childTilesElement) {
      console.error('updateDashboard: Missing DOM elements', {
        balanceElement: !!balanceElement,
        afterBudgetElement: !!afterBudgetElement,
        totalBudgetElement: !!totalBudgetElement,
        totalRemainingElement: !!totalRemainingElement,
        childTilesElement: !!childTilesElement
      });
      showError('balance', 'Dashboard elements not found');
      return;
    }

    const { start, end } = getDateRangeWrapper(domElements.dashboardFilter?.value || 'thisMonth');
    console.log('updateDashboard: Date range', { start: start.toISOString(), end: end.toISOString() });

    if (currentAccountType === 'child') {
      // Child user: Show only their childTransactions balance in a tile
      console.log('updateDashboard: Child mode, calculating child balance');
      const childBalance = await calculateChildBalance(currentUser.uid);
      childTilesElement.innerHTML = ''; // Clear any existing tiles
      const tile = document.createElement('div');
      tile.classList.add('bg-white', 'p-4', 'sm:p-6', 'rounded-lg', 'shadow-md');
      tile.innerHTML = `
        <h3 class="text-base sm:text-lg font-semibold text-gray-700">Your Balance</h3>
        <p class="text-lg sm:text-2xl font-bold text-gray-900">${formatCurrency(childBalance, 'INR')}</p>
      `;
      childTilesElement.appendChild(tile);
      console.log('updateDashboard: Child balance tile added', { balance: childBalance });

      // Hide family-wide summary tiles for child users
      balanceElement.textContent = 'N/A';
      balanceElement.parentElement.classList.add('hidden');
      afterBudgetElement.textContent = 'N/A';
      afterBudgetElement.parentElement.classList.add('hidden');
      totalBudgetElement.textContent = 'N/A';
      totalBudgetElement.parentElement.classList.add('hidden');
      totalRemainingElement.textContent = 'N/A';
      totalRemainingElement.parentElement.classList.add('hidden');
    } else {
      // Admin user: Show family-wide balance and budgets
      console.log('updateDashboard: Admin mode, calculating family balance');
      let totalBalance = 0;
      let totalBudgetAmount = 0;
      let totalSpent = 0;
      await Promise.all([
        retryFirestoreOperation(async () => {
          const transactionsQuery = query(collection(db, 'transactions'), where('familyCode', '==', familyCode));
          const snapshot = await getDocs(transactionsQuery);
          console.log('updateDashboard: Transactions fetched', { count: snapshot.size });
          snapshot.forEach(doc => {
            const transaction = doc.data();
            const createdAt = transaction.createdAt ? new Date(transaction.createdAt.toDate()) : new Date();
            if (createdAt >= start && createdAt <= end) {
              totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
            }
          });
          balanceElement.textContent = formatCurrency(totalBalance, 'INR');
          balanceElement.parentElement.classList.remove('hidden');
        }),
        retryFirestoreOperation(async () => {
          const budgetsQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
          const snapshot = await getDocs(budgetsQuery);
          console.log('updateDashboard: Budgets fetched', { count: snapshot.size });
          snapshot.forEach(doc => {
            const budget = doc.data();
            const createdAt = budget.createdAt ? new Date(budget.createdAt.toDate()) : new Date();
            if (createdAt >= start && createdAt <= end) {
              totalBudgetAmount += budget.amount;
              totalSpent += budget.spent || 0;
            }
          });
          totalBudgetElement.textContent = formatCurrency(totalBudgetAmount, 'INR');
          totalBudgetElement.parentElement.classList.remove('hidden');
          totalRemainingElement.textContent = formatCurrency(totalBudgetAmount - totalSpent, 'INR');
          totalRemainingElement.parentElement.classList.remove('hidden');
          afterBudgetElement.textContent = formatCurrency(totalBalance - totalBudgetAmount, 'INR');
          afterBudgetElement.parentElement.classList.remove('hidden');
        })
      ]);
      childTilesElement.innerHTML = ''; // Clear child tiles before admin load
      await loadChildTiles(); // Load admin child tiles
    }
    console.log('updateDashboard: Complete');
  } catch (error) {
    console.error('updateDashboard error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('balance', `Failed to update dashboard: ${error.message}`);
  }
}






// Logout Setup
function setupLogout() {
  console.log('setupLogout: Starting');
  // Wait for DOM to be fully loaded
  document.addEventListener('DOMContentLoaded', () => {
    console.log('setupLogout: DOMContentLoaded');
    try {
      const logoutButton = document.getElementById('logout-button');
      if (!logoutButton) {
        console.error('setupLogout: Logout button not found');
        return;
      }

      logoutButton.addEventListener('click', async () => {
        console.log('logoutButton: Clicked');
        try {
          if (!auth) {
            console.error('logoutButton: Firebase auth not available', { auth });
            showError('page-title', 'Authentication service not available');
            return;
          }
          logoutButton.disabled = true;
          logoutButton.textContent = 'Logging out...';

          // Retry signOut to handle connectivity issues
          let signOutSuccess = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              console.log('logoutButton: Sign out attempt', { attempt });
              await signOut(auth);
              signOutSuccess = true;
              break;
            } catch (error) {
              console.error('logoutButton: Sign out attempt failed', {
                attempt,
                code: error.code,
                message: error.message,
                stack: error.stack
              });
              if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          }

          if (signOutSuccess) {
            console.log('logoutButton: Sign out successful');
            // Reset local state
            currentChildUserId = null;
            currentAccountType = null;

            // Update UI to show login screen
            const loginSection = document.getElementById('login-section');
            const appSection = document.getElementById('app-section');
            const pageTitle = document.getElementById('page-title');

            if (loginSection) {
              loginSection.classList.remove('hidden');
            } else {
              console.warn('logoutButton: login-section not found');
            }
            if (appSection) {
              appSection.classList.add('hidden');
            } else {
              console.warn('logoutButton: app-section not found');
            }
            if (pageTitle) {
              pageTitle.textContent = 'Login';
            } else {
              console.warn('logoutButton: page-title not found');
            }
            if (logoutButton) {
              logoutButton.classList.add('hidden');
            }

            console.log('logoutButton: UI reset to login screen');
          } else {
            console.error('logoutButton: All sign out attempts failed');
            showError('page-title', 'Failed to log out: Connectivity issue');
          }
        } catch (error) {
          console.error('logoutButton: Error', {
            code: error.code,
            message: error.message,
            stack: error.stack
          });
          showError('page-title', `Failed to log out: ${error.message}`);
        } finally {
          logoutButton.disabled = false;
          logoutButton.textContent = 'Logout';
        }
      });
      console.log('setupLogout: Event listener added');
    } catch (error) {
      console.error('setupLogout error:', {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
    }
  }, { once: true });
}

// Initialize App
async function initApp() {
  console.log('initApp: Starting');
  try {
    setupTabs();
    setupProfile();
    setupCategories();
    setupBudgets();
    setupTransactions();
    setupChildAccounts();
    setupLogout();
    console.log('initApp: Complete');
  } catch (error) {
    console.error('initApp error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('page-title', 'Failed to initialize app.');
  }
}

export { loadAppData, initApp };
