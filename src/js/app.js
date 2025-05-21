// App module: Handles dashboard, transactions, budgets, categories, child accounts, and profile
import {
  auth,
  db,
  currentUser,
  userCurrency,
  familyCode,
  domElements,
  formatCurrency,
  showError,
  clearErrors,
  fetchExchangeRate,
  setUserCurrency,
  setFamilyCode
} from './core.js';

let isEditing = { transaction: false, budget: false, category: false, profile: false, childTransaction: false };
let currentChildUserId = null;
let currentAccountType = null;

// Utility: Retry Firestore Operation (to be moved to utils.js)
async function retryFirestoreOperation(operation, maxRetries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Firestore operation attempt ${attempt}/${maxRetries}`);
      return await operation();
    } catch (error) {
      console.error('Firestore operation failed:', { attempt, code: error.code, message: error.message });
      if (attempt === maxRetries || error.code === 'permission-denied') {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Get Date Range for Filters
function getDateRange(filter) {
  const now = new Date();
  const start = new Date();
  const end = new Date();
  
  switch (filter) {
    case '1week':
      start.setDate(now.getDate() - 7);
      break;
    case '1month':
      start.setMonth(now.getMonth() - 1);
      break;
    case 'thisMonth':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(now.getMonth() + 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'lastMonth':
      start.setMonth(now.getMonth() - 1);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(now.getMonth());
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'thisYear':
      start.setMonth(0);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(11);
      end.setDate(31);
      end.setHours(23, 59, 59, 999);
      break;
    case 'lastYear':
      start.setFullYear(now.getFullYear() - 1);
      start.setMonth(0);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setFullYear(now.getFullYear() - 1);
      end.setMonth(11);
      end.setDate(31);
      end.setHours(23, 59, 59, 999);
      break;
    case 'custom':
      const startDate = domElements.filterStartDate?.value ? new Date(domElements.filterStartDate.value) : null;
      const endDate = domElements.filterEndDate?.value ? new Date(domElements.filterEndDate.value) : null;
      if (startDate && endDate && startDate <= endDate) {
        start.setTime(startDate.getTime());
        start.setHours(0, 0, 0, 0);
        end.setTime(endDate.getTime());
        end.setHours(23, 59, 59, 999);
      } else {
        console.warn('Invalid custom date range; using default (all time)');
        start.setTime(0);
      }
      break;
    default:
      start.setTime(0);
      break;
  }
  return { start, end };
}

// Load App Data
async function loadAppData() {
  console.log('Loading app data');
  if (!currentUser || !familyCode || !db) {
    console.error('Cannot load app data: missing user, familyCode, or Firestore');
    return;
  }
  try {
    await fetchExchangeRate();
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
    console.log('App data loaded successfully');
  } catch (error) {
    console.error('Error loading app data:', error);
    showError('page-title', 'Failed to load app data.');
  }
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
        db.collection('users').doc(currentUser.uid).update({
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
        db.collection('users').doc(currentUser.uid).update({ currency: newCurrency })
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
    await retryFirestoreOperation(() => 
      db.collection('users').doc(currentUser.uid).get()
        .then(doc => {
          if (doc.exists) {
            const data = doc.data();
            domElements.profileCurrency.value = data.currency || 'INR';
            domElements.profileFamilyCode.value = data.familyCode || '--';
            domElements.profileAccountType.value = data.accountType || '--';
            currentAccountType = data.accountType || '--';
            console.log('Profile data loaded:', { email: currentUser.email, currency: data.currency, familyCode: data.familyCode, accountType: data.accountType });
          } else {
            console.error('User document not found:', currentUser.uid);
            showError('profile-email', 'Profile data not found.');
          }
        })
    );
  } catch (error) {
    console.error('Error loading profile data:', error);
    showError('profile-email', 'Failed to load profile data.');
  }
}

// Categories
async function loadCategories() {
  console.log('Loading categories');
  if (!db) {
    console.error('Firestore not available');
    return;
  }
  try {
    const categorySelect = document.getElementById('category');
    const categoryBudgetSelect = domElements.categoryBudgetSelect;
    const newCategoryBudgetSelect = document.getElementById('new-category-budget');
    categorySelect.innerHTML = '<option value="">Select Category</option><option value="add-new">Add New</option>';
    categoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
    if (newCategoryBudgetSelect) {
      newCategoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
    }

    await retryFirestoreOperation(() => 
      db.collection('budgets').where('familyCode', '==', familyCode).get()
        .then(snapshot => {
          snapshot.forEach(doc => {
            const budget = doc.data();
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = budget.name;
            categoryBudgetSelect.insertBefore(option, categoryBudgetSelect.querySelector('option[value="add-new"]'));
            if (newCategoryBudgetSelect) {
              const newOption = document.createElement('option');
              newOption.value = doc.id;
              newOption.textContent = budget.name;
              newCategoryBudgetSelect.insertBefore(newOption, newCategoryBudgetSelect.querySelector('option[value="add-new"]'));
            }
          });
        })
    );

    await retryFirestoreOperation(() => 
      db.collection('categories').where('familyCode', '==', familyCode).get()
        .then(snapshot => {
          snapshot.forEach(doc => {
            const category = doc.data();
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = category.name;
            categorySelect.insertBefore(option, categorySelect.querySelector('option[value="add-new"]'));
          });

          const categoryTable = document.getElementById('category-table');
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
                tr.children[2].textContent = budgetDoc.exists ? budgetDoc.data().name : 'None';
              }).catch(error => {
                console.error('Error fetching budget for category:', error);
                tr.children[2].textContent = 'Error';
              });
            }
          });
        })
    );
  } catch (error) {
    console.error('Error loading categories:', error);
    showError('category-name', 'Failed to load categories.');
  }
}

function setupCategories() {
  console.log('Setting up category event listeners');
  const addCategory = document.getElementById('add-category');
  const categorySelect = document.getElementById('category');
  const saveCategory = document.getElementById('save-category');
  const cancelCategory = document.getElementById('cancel-category');
  const categoryTable = document.getElementById('category-table');

  addCategory?.addEventListener('click', async () => {
    console.log('Add Category clicked', { isEditing: isEditing.category });
    if (isEditing.category) return;
    clearErrors();
    const name = document.getElementById('category-name')?.value.trim();
    const type = document.getElementById('category-type')?.value;
    const budgetId = document.getElementById('category-budget')?.value === 'none' ? null : document.getElementById('category-budget').value;
    if (!name) {
      showError('category-name', 'Name is required');
      return;
    }
    if (!currentUser || !db) {
      showError('category-name', 'Database service not available');
      return;
    }
    try {
      addCategory.disabled = true;
      addCategory.textContent = 'Adding...';
      await retryFirestoreOperation(() => 
        db.collection('categories').add({
          name,
          type,
          budgetId,
          familyCode,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        })
      );
      console.log('Category added:', { name, type, budgetId });
      document.getElementById('category-name').value = '';
      document.getElementById('category-type').value = 'income';
      document.getElementById('category-budget').value = 'none';
      addCategory.innerHTML = 'Add Category';
      await loadCategories();
    } catch (error) {
      console.error('Error adding category:', error);
      showError('category-name', 'Failed to add category.');
    } finally {
      addCategory.disabled = false;
      addCategory.textContent = 'Add Category';
    }
  });

  categorySelect?.addEventListener('change', () => {
    console.log('Category select changed:', categorySelect.value);
    if (categorySelect.value === 'add-new') {
      domElements.addCategoryModal?.classList.remove('hidden');
      categorySelect.value = '';
    }
  });

  saveCategory?.addEventListener('click', async () => {
    console.log('Save Category clicked');
    clearErrors();
    const name = document.getElementById('new-category-name')?.value.trim();
    const type = document.getElementById('new-category-type')?.value;
    const budgetId = document.getElementById('new-category-budget')?.value === 'none' ? null : document.getElementById('new-category-budget').value;
    if (!name) {
      showError('new-category-name', 'Name is required');
      return;
    }
    if (!currentUser || !db) {
      showError('new-category-name', 'Database service not available');
      return;
    }
    try {
      saveCategory.disabled = true;
      saveCategory.textContent = 'Saving...';
      await retryFirestoreOperation(() => 
        db.collection('categories').add({
          name,
          type,
          budgetId,
          familyCode,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        })
      );
      console.log('Category saved:', { name, type, budgetId });
      domElements.addCategoryModal?.classList.add('hidden');
      document.getElementById('new-category-name').value = '';
      document.getElementById('new-category-type').value = 'income';
      document.getElementById('new-category-budget').value = 'none';
      await loadCategories();
    } catch (error) {
      console.error('Error saving category:', error);
      showError('new-category-name', 'Failed to save category.');
    } finally {
      saveCategory.disabled = false;
      saveCategory.textContent = 'Save';
    }
  });

  cancelCategory?.addEventListener('click', () => {
    console.log('Cancel Category clicked');
    domElements.addCategoryModal?.classList.add('hidden');
    document.getElementById('new-category-name').value = '';
    document.getElementById('new-category-type').value = 'income';
    document.getElementById('new-category-budget').value = 'none';
  });

  categoryTable?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-category')) {
      console.log('Edit Category clicked:', e.target.dataset.id);
      const id = e.target.dataset.id;
      if (!db) return;
      try {
        const doc = await retryFirestoreOperation(() => db.collection('categories').doc(id).get());
        if (doc.exists) {
          document.getElementById('category-name').value = doc.data().name;
          document.getElementById('category-type').value = doc.data().type;
          document.getElementById('category-budget').value = doc.data().budgetId || 'none';
          addCategory.innerHTML = 'Update Category';
          isEditing.category = true;
          console.log('Entered edit mode for category:', id);
          const updateHandler = async () => {
            const name = document.getElementById('category-name')?.value.trim();
            const type = document.getElementById('category-type')?.value;
            const budgetId = document.getElementById('category-budget')?.value === 'none' ? null : document.getElementById('category-budget').value;
            if (!name) {
              showError('category-name', 'Name is required');
              return;
            }
            try {
              addCategory.disabled = true;
              addCategory.textContent = 'Updating...';
              await retryFirestoreOperation(() => 
                db.collection('categories').doc(id).update({ name, type, budgetId })
              );
              console.log('Category updated:', { id, name, type, budgetId });
              document.getElementById('category-name').value = '';
              document.getElementById('category-type').value = 'income';
              document.getElementById('category-budget').value = 'none';
              addCategory.innerHTML = 'Add Category';
              isEditing.category = false;
              await loadCategories();
            } catch (error) {
              console.error('Error updating category:', error);
              showError('category-name', 'Failed to update category.');
            } finally {
              addCategory.disabled = false;
              addCategory.textContent = 'Add Category';
              isEditing.category = false;
            }
          };
          addCategory.removeEventListener('click', addCategory._updateHandler);
          addCategory._updateHandler = updateHandler;
          addCategory.addEventListener('click', updateHandler, { once: true });
        }
      } catch (error) {
        console.error('Error fetching category:', error);
        showError('category-name', 'Failed to fetch category.');
      }
    }
    if (e.target.classList.contains('delete-category')) {
      console.log('Delete Category clicked:', e.target.dataset.id);
      const id = e.target.dataset.id;
      if (domElements.deleteConfirmModal && db) {
        domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this category?';
        domElements.deleteConfirmModal.classList.remove('hidden');
        const confirmHandler = async () => {
          try {
            await retryFirestoreOperation(() => db.collection('categories').doc(id).delete());
            console.log('Category deleted:', { id });
            await loadCategories();
            domElements.deleteConfirmModal.classList.add('hidden');
          } catch (error) {
            console.error('Error deleting category:', error);
            showError('category-name', 'Failed to delete category.');
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
    const { start, end } = getDateRange(domElements.dashboardFilter?.value || '');
    let totalBudgetAmount = 0;
    let totalRemainingAmount = 0;
    await retryFirestoreOperation(() => 
      db.collection('budgets').where('familyCode', '==', familyCode).get()
        .then(snapshot => {
          budgetTable.innerHTML = '';
          budgetTiles.innerHTML = '';
          snapshot.forEach(doc => {
            const budget = doc.data();
            const createdAt = budget.createdAt ? budget.createdAt.toDate() : new Date();
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
        })
    );
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
        db.collection('budgets').add({
          name,
          amount,
          spent: 0,
          familyCode,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
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
        db.collection('budgets').add({
          name,
          amount,
          spent: 0,
          familyCode,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
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
        const doc = await retryFirestoreOperation(() => db.collection('budgets').doc(id).get());
        if (doc.exists) {
          document.getElementById('budget-name').value = doc.data().name;
          document.getElementById('budget-amount').value = doc.data().amount;
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
                db.collection('budgets').doc(id).update({ name, amount })
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
            await retryFirestoreOperation(() => db.collection('budgets').doc(id).delete());
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
  console.log('Loading transactions');
  if (!db) {
    console.error('Firestore not available');
    return;
  }
  try {
    const transactionTable = document.getElementById('transaction-table');
    transactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading...</td></tr>';
    const { start, end } = getDateRange(domElements.dashboardFilter?.value || '');
    await retryFirestoreOperation(() => 
      db.collection('transactions').where('familyCode', '==', familyCode).get()
        .then(snapshot => {
          transactionTable.innerHTML = '';
          snapshot.forEach(doc => {
            const transaction = doc.data();
            const createdAt = transaction.createdAt ? transaction.createdAt.toDate() : new Date();
            if (createdAt >= start && createdAt <= end) {
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
                transactionTable.appendChild(tr);
              }).catch(error => {
                console.error('Error fetching category for transaction:', error);
              });
            }
          });
        })
    );
  } catch (error) {
    console.error('Error loading transactions:', error);
    showError('category', 'Failed to load transactions.');
  }
}

function setupTransactions() {
  console.log('Setting up transaction event listeners');
  const addTransaction = document.getElementById('add-transaction');
  const transactionTable = document.getElementById('transaction-table');

  addTransaction?.addEventListener('click', async () => {
    console.log('Add Transaction clicked', { isEditing: isEditing.transaction });
    if (isEditing.transaction) return;
    clearErrors();
    const type = document.getElementById('type')?.value;
    const amount = parseFloat(document.getElementById('amount')?.value);
    const categoryId = document.getElementById('category')?.value;
    const description = document.getElementById('description')?.value.trim();
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
      const docRef = await retryFirestoreOperation(() => 
        db.collection('transactions').add({
          type,
          amount,
          categoryId,
          description,
          familyCode,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        })
      );
      if (type === 'debit') {
        const categoryDoc = await db.collection('categories').doc(categoryId).get();
        if (categoryDoc.exists && categoryDoc.data().budgetId) {
          await retryFirestoreOperation(() => 
            db.collection('budgets').doc(categoryDoc.data().budgetId).update({
              spent: firebase.firestore.FieldValue.increment(amount)
            })
          );
          await loadBudgets();
        }
      }
      console.log('Transaction added:', { id: docRef.id, type, amount, categoryId });
      document.getElementById('type').value = 'debit';
      document.getElementById('amount').value = '';
      document.getElementById('category').value = '';
      document.getElementById('description').value = '';
      addTransaction.innerHTML = 'Add Transaction';
      await loadTransactions();
      await updateDashboard();
    } catch (error) {
      console.error('Error adding transaction:', error);
      showError('category', 'Failed to add transaction.');
    } finally {
      addTransaction.disabled = false;
      addTransaction.textContent = 'Add Transaction';
    }
  });

  transactionTable?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-transaction')) {
      console.log('Edit Transaction clicked:', e.target.dataset.id);
      const id = e.target.dataset.id;
      if (!db) return;
      try {
        const doc = await retryFirestoreOperation(() => db.collection('transactions').doc(id).get());
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
            const type = document.getElementById('type')?.value;
            const amount = parseFloat(document.getElementById('amount')?.value);
            const categoryId = document.getElementById('category')?.value;
            const description = document.getElementById('description')?.value.trim();
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
                const amountDiff = amount - oldData.amount;
                if (amountDiff !== 0) {
                  await retryFirestoreOperation(() => 
                    db.collection('budgets').doc(oldBudgetId).update({
                      spent: firebase.firestore.FieldValue.increment(amountDiff)
                    })
                  );
                }
              } else {
                if (oldBudgetId && oldData.type === 'debit') {
                  await retryFirestoreOperation(() => 
                    db.collection('budgets').doc(oldBudgetId).update({
                      spent: firebase.firestore.FieldValue.increment(-oldData.amount)
                    })
                  );
                }
                if (newBudgetId && type === 'debit') {
                  await retryFirestoreOperation(() => 
                    db.collection('budgets').doc(newBudgetId).update({
                      spent: firebase.firestore.FieldValue.increment(amount)
                    })
                  );
                }
              }
              await retryFirestoreOperation(() => 
                db.collection('transactions').doc(id).update({
                  type,
                  amount,
                  categoryId,
                  description
                })
              );
              console.log('Transaction updated:', { id, type, amount, categoryId });
              document.getElementById('type').value = 'debit';
              document.getElementById('amount').value = '';
              document.getElementById('category').value = '';
              document.getElementById('description').value = '';
              addTransaction.innerHTML = 'Add Transaction';
              isEditing.transaction = false;
              await loadBudgets();
              await loadTransactions();
              await updateDashboard();
            } catch (error) {
              console.error('Error updating transaction:', error);
              showError('category', 'Failed to update transaction.');
            } finally {
              addTransaction.disabled = false;
              addTransaction.textContent = 'Add Transaction';
              isEditing.transaction = false;
            }
          };
          addTransaction.removeEventListener('click', addTransaction._updateHandler);
          addTransaction._updateHandler = updateHandler;
          addTransaction.addEventListener('click', updateHandler, { once: true });
        }
      } catch (error) {
        console.error('Error fetching transaction:', error);
        showError('category', 'Failed to fetch transaction.');
      }
    }
    if (e.target.classList.contains('delete-transaction')) {
      console.log('Delete Transaction clicked:', e.target.dataset.id);
      const id = e.target.dataset.id;
      if (domElements.deleteConfirmModal && db) {
        domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this transaction?';
        domElements.deleteConfirmModal.classList.remove('hidden');
        const confirmHandler = async () => {
          try {
            const doc = await db.collection('transactions').doc(id).get();
            if (doc.exists) {
              const transaction = doc.data();
              if (transaction.type === 'debit' && transaction.categoryId) {
                const categoryDoc = await db.collection('categories').doc(transaction.categoryId).get();
                if (categoryDoc.exists && categoryDoc.data().budgetId) {
                  await retryFirestoreOperation(() => 
                    db.collection('budgets').doc(categoryDoc.data().budgetId).update({
                      spent: firebase.firestore.FieldValue.increment(-transaction.amount)
                    })
                  );
                  await loadBudgets();
                }
              }
              await retryFirestoreOperation(() => db.collection('transactions').doc(id).delete());
              console.log('Transaction deleted:', { id });
              await loadTransactions();
              await updateDashboard();
              domElements.deleteConfirmModal.classList.add('hidden');
            }
          } catch (error) {
            console.error('Error deleting transaction:', error);
            showError('category', 'Failed to delete transaction.');
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

// Child Accounts
async function loadChildAccounts() {
  console.log('Loading child accounts', { familyCode, accountType: currentAccountType });
  if (!currentUser || !db || !familyCode) {
    console.error('Cannot load child accounts: missing user, Firestore, or familyCode');
    showError('child-user-id', 'Unable to load child accounts.');
    return;
  }
  try {
    if (currentAccountType === 'admin') {
      domElements.childSelector?.classList.remove('hidden');
      domElements.childUserId.innerHTML = '<option value="">Select a Child</option>';
      await retryFirestoreOperation(() => 
        db.collection('users')
          .where('familyCode', '==', familyCode)
          .where('accountType', '==', 'child')
          .get()
          .then(snapshot => {
            if (snapshot.empty) {
              domElements.childUserId.innerHTML = '<option value="">No children found</option>';
            } else {
              snapshot.forEach(doc => {
                const data = doc.data();
                const displayName = data.email && data.email.trim() !== '' ? data.email : `Child Account ${doc.id.substring(0, 8)}`;
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = displayName;
                domElements.childUserId.appendChild(option);
              });
            }
          })
      );
      currentChildUserId = domElements.childUserId.value || currentUser.uid;
    } else {
      domElements.childSelector?.classList.add('hidden');
      currentChildUserId = currentUser.uid;
    }
    await loadChildTransactions();
  } catch (error) {
    console.error('Error loading child accounts:', error);
    showError('child-user-id', 'Failed to load child accounts.');
    domElements.childUserId.innerHTML = '<option value="">Error loading children</option>';
  }
}

async function loadChildTransactions() {
  console.log('Loading child transactions for user:', currentChildUserId);
  if (!db || !currentChildUserId) {
    console.error('Firestore or user ID not available');
    domElements.childTransactionTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">No user selected</td></tr>';
    domElements.childBalance.textContent = formatCurrency(0, 'INR');
    return;
  }
  try {
    domElements.childTransactionTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">Loading...</td></tr>';
    let totalBalance = 0;
    await retryFirestoreOperation(() => 
      db.collection('childTransactions')
        .where('userId', '==', currentChildUserId)
        .get()
        .then(snapshot => {
          domElements.childTransactionTable.innerHTML = '';
          if (snapshot.empty) {
            domElements.childTransactionTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">No transactions found</td></tr>';
          } else {
            snapshot.forEach(doc => {
              const transaction = doc.data();
              totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
              const tr = document.createElement('tr');
              tr.classList.add('table-row');
              tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${transaction.type}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatCurrency(transaction.amount, 'INR')}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${transaction.description}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">
                  <button class="text-blue-600 hover:text-blue-800 mr-2 edit-child-transaction" data-id="${doc.id}" data-user-id="${transaction.userId}">Edit</button>
                  <button class="text-red-600 hover:text-red-800 delete-child-transaction" data-id="${doc.id}" data-user-id="${transaction.userId}">Delete</button>
                </td>
              `;
              domElements.childTransactionTable.appendChild(tr);
            });
          }
          domElements.childBalance.textContent = formatCurrency(totalBalance, 'INR');
        })
    );
  } catch (error) {
    console.error('Error loading child transactions:', error);
    showError('child-transaction-description', 'Failed to load child transactions.');
    domElements.childTransactionTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">Error loading transactions</td></tr>';
    domElements.childBalance.textContent = formatCurrency(0, 'INR');
  }
}

async function loadChildTiles() {
  console.log('Loading child tiles');
  if (!db || !familyCode) {
    console.error('Firestore or familyCode not available');
    domElements.childTiles.innerHTML = '<div class="text-center py-4">No family data</div>';
    return;
  }
  try {
    domElements.childTiles.innerHTML = '<div class="text-center py-4">Loading...</div>';
    const childBalances = new Map();
    await retryFirestoreOperation(() => 
      db.collection('users')
        .where('familyCode', '==', familyCode)
        .where('accountType', '==', 'child')
        .get()
        .then(snapshot => {
          if (snapshot.empty) {
            domElements.childTiles.innerHTML = '<div class="text-center py-4">No child accounts found</div>';
            return [];
          }
          const promises = snapshot.docs.map(doc => {
            const userId = doc.id;
            const email = doc.data().email && doc.data().email.trim() !== '' ? doc.data().email : `Child Account ${userId.substring(0, 8)}`;
            return retryFirestoreOperation(() => 
              db.collection('childTransactions')
                .where('userId', '==', userId)
                .get()
                .then(transSnapshot => {
                  let balance = 0;
                  transSnapshot.forEach(transDoc => {
                    const trans = transDoc.data();
                    balance += trans.type === 'credit' ? trans.amount : -trans.amount;
                  });
                  childBalances.set(userId, { email, balance });
                })
                .catch(error => {
                  console.warn('No transactions for child:', { userId, email, error: error.message });
                  childBalances.set(userId, { email, balance: 0 });
                })
            );
          });
          return Promise.all(promises);
        })
    );
    domElements.childTiles.innerHTML = '';
    if (childBalances.size === 0) {
      domElements.childTiles.innerHTML = '<div class="text-center py-4">No child accounts found</div>';
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
        domElements.childTiles.appendChild(tile);
      });
    }
  } catch (error) {
    console.error('Error loading child tiles:', error);
    domElements.childTiles.innerHTML = '<div class="text-center py-4 text-red-600">Failed to load child balances.</div>';
  }
}

function setupChildAccounts() {
  console.log('Setting up child account event listeners');
  const addChildTransaction = domElements.addChildTransaction;
  const childTransactionTable = domElements.childTransactionTable;
  const childUserId = domElements.childUserId;

  // Add Child Transaction (with idempotency)
  if (addChildTransaction && !addChildTransaction._listenerBound) {
    let isProcessing = false;
    const DEBOUNCE_MS = 5000;
    let lastAddClickTime = 0;

    const addChildTransactionHandler = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      if (now - lastAddClickTime < DEBOUNCE_MS || isProcessing) {
        console.log('Add Child Transaction ignored:', { timeSinceLastClick: now - lastAddClickTime, isProcessing });
        return;
      }
      lastAddClickTime = now;
      isProcessing = true;

      console.log('Add Child Transaction clicked', { isEditing: isEditing.childTransaction });
      if (isEditing.childTransaction) return;
      clearErrors();
      const type = domElements.childTransactionType?.value;
      const amount = parseFloat(domElements.childTransactionAmount?.value);
      const description = domElements.childTransactionDescription?.value.trim();
      const transactionUserId = currentAccountType === 'admin' ? currentChildUserId : currentUser.uid;
      const txId = `tx-${transactionUserId}-${type}-${amount}-${description}-${now}`.replace(/[^a-zA-Z0-9-]/g, '-');
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
      if (!currentUser || !db) {
        showError('child-transaction-description', 'Database service not available');
        isProcessing = false;
        return;
      }
      try {
        addChildTransaction.disabled = true;
        addChildTransaction.textContent = 'Adding...';
        await retryFirestoreOperation(() => 
          db.collection('childTransactions').doc(txId).set({
            type,
            amount,
            description,
            userId: transactionUserId,
            familyCode,
            txId,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          })
        );
        console.log('Child transaction added:', { type, amount, userId: transactionUserId, txId });
        domElements.childTransactionType.value = 'debit';
        domElements.childTransactionAmount.value = '';
        domElements.childTransactionDescription.value = '';
        addChildTransaction.innerHTML = 'Add Transaction';
        await loadChildTransactions();
        await loadChildTiles();
      } catch (error) {
        console.error('Error adding child transaction:', error);
        showError('child-transaction-description', 'Failed to add transaction.');
      } finally {
        addChildTransaction.disabled = false;
        addChildTransaction.textContent = 'Add Transaction';
        isProcessing = false;
      }
    };

    addChildTransaction.addEventListener('click', addChildTransactionHandler);
    addChildTransaction._listenerBound = true;
  }

  childTransactionTable?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-child-transaction')) {
      console.log('Edit Child Transaction clicked:', e.target.dataset.id);
      const id = e.target.dataset.id;
      if (!db) return;
      try {
        const doc = await retryFirestoreOperation(() => db.collection('childTransactions').doc(id).get());
        if (doc.exists) {
          const data = doc.data();
          domElements.childTransactionType.value = data.type;
          domElements.childTransactionAmount.value = data.amount;
          domElements.childTransactionDescription.value = data.description;
          addChildTransaction.innerHTML = 'Update Transaction';
          isEditing.childTransaction = true;
          console.log('Entered edit mode for child transaction:', id);
          const updateHandler = async () => {
            const type = domElements.childTransactionType?.value;
            const amount = parseFloat(domElements.childTransactionAmount?.value);
            const description = domElements.childTransactionDescription?.value.trim();
            if (!amount || amount <= 0) {
              showError('child-transaction-amount', 'Valid amount is required');
              return;
            }
            try {
              addChildTransaction.disabled = true;
              addChildTransaction.textContent = 'Updating...';
              await retryFirestoreOperation(() => 
                db.collection('childTransactions').doc(id).update({
                  type,
                  amount,
                  description
                })
              );
              console.log('Child transaction updated:', { id, type, amount });
              domElements.childTransactionType.value = 'debit';
              domElements.childTransactionAmount.value = '';
              domElements.childTransactionDescription.value = '';
              addChildTransaction.innerHTML = 'Add Transaction';
              isEditing.childTransaction = false;
              await loadChildTransactions();
              await loadChildTiles();
            } catch (error) {
              console.error('Error updating child transaction:', error);
              showError('child-transaction-description', 'Failed to update transaction.');
            } finally {
              addChildTransaction.disabled = false;
              addChildTransaction.textContent = 'Add Transaction';
              isEditing.childTransaction = false;
            }
          };
          addChildTransaction.removeEventListener('click', addChildTransaction._updateHandler);
          addChildTransaction._updateHandler = updateHandler;
          addChildTransaction.addEventListener('click', updateHandler, { once: true });
        }
      } catch (error) {
        console.error('Error fetching child transaction:', error);
        showError('child-transaction-description', 'Failed to fetch transaction.');
      }
    }
    if (e.target.classList.contains('delete-child-transaction')) {
      console.log('Delete Child Transaction clicked:', e.target.dataset.id);
      const id = e.target.dataset.id;
      if (domElements.deleteConfirmModal && db) {
        domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this child transaction?';
        domElements.deleteConfirmModal.classList.remove('hidden');
        const confirmHandler = async () => {
          try {
            await retryFirestoreOperation(() => db.collection('childTransactions').doc(id).delete());
            console.log('Child transaction deleted:', { id });
            await loadChildTransactions();
            await loadChildTiles();
            domElements.deleteConfirmModal.classList.add('hidden');
          } catch (error) {
            console.error('Error deleting child transaction:', error);
            showError('child-transaction-description', 'Failed to delete transaction.');
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

  childUserId?.addEventListener('change', () => {
    console.log('Child user selected:', childUserId.value);
    currentChildUserId = childUserId.value || currentUser.uid;
    loadChildTransactions();
  });
}

// Dashboard Updates
async function updateDashboard() {
  console.log('Updating dashboard');
  if (!db) {
    console.error('Firestore not available');
    return;
  }
  try {
    const { start, end } = getDateRange(domElements.dashboardFilter?.value || '');
    let totalBalance = 0;
    let totalBudgetAmount = 0;
    await Promise.all([
      retryFirestoreOperation(() => 
        db.collection('transactions').where('familyCode', '==', familyCode).get()
          .then(snapshot => {
            snapshot.forEach(doc => {
              const transaction = doc.data();
              const createdAt = transaction.createdAt ? transaction.createdAt.toDate() : new Date();
              if (createdAt >= start && createdAt <= end) {
                totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
              }
            });
            document.getElementById('balance').textContent = formatCurrency(totalBalance, 'INR');
          })
      ),
      retryFirestoreOperation(() => 
        db.collection('budgets').where('familyCode', '==', familyCode).get()
          .then(snapshot => {
            snapshot.forEach(doc => {
              const budget = doc.data();
              const createdAt = budget.createdAt ? budget.createdAt.toDate() : new Date();
              if (createdAt >= start && createdAt <= end) {
                totalBudgetAmount += budget.amount;
              }
            });
          })
      )
    ]);
    document.getElementById('after-budget').textContent = formatCurrency(totalBalance - totalBudgetAmount, 'INR');
    await loadChildTiles();
  } catch (error) {
    console.error('Error updating dashboard:', error);
    showError('balance', 'Failed to update dashboard.');
  }
}

// Initialize App
function initApp() {
  console.log('Initializing app module');
  setupTabs();
  setupProfile();
  setupCategories();
  setupBudgets();
  setupTransactions();
  setupChildAccounts();
}

export { loadAppData, initApp };
