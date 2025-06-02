// app.js (Section 1: Initialization and Core Functions)
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
import { retryFirestoreOperation, fetchExchangeRate, getDateRange, resetBudgetsForNewMonth } from './utils.js';
import { collection, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp, increment } from 'firebase/firestore';

let isEditing = { transaction: false, budget: false, category: false, profile: false, childTransaction: false };
let currentChildUserId = null;
let currentAccountType = null;
let loadedTabs = { budgets: false, transactions: false, childAccounts: false };

/**
 * Loads app data after login
 * @returns {Promise<void>}
 */
async function loadAppData() {
  console.log('loadAppData: Starting');
  if (!currentUser || !familyCode || !db) {
    console.error('loadAppData: Missing user, familyCode, or Firestore');
    const loadingSpinner = document.getElementById('loading-spinner');
    if (loadingSpinner) {
      loadingSpinner.classList.add('hidden');
      loadingSpinner.setAttribute('aria-busy', 'false');
    }
    showError('page-title', 'Failed to load app data: Missing configuration.');
    return;
  }

  try {
    // Show loading spinner
    const loadingSpinner = document.getElementById('loading-spinner');
    if (loadingSpinner) {
      loadingSpinner.classList.remove('hidden');
      loadingSpinner.setAttribute('aria-busy', 'true');
    }

    // Fetch exchange rates with caching
    console.log('loadAppData: Fetching exchange rates');
    const cacheKey = 'exchange_rates';
    const cachedRates = localStorage.getItem(cacheKey);
    const CACHE_TTL = 3600000; // 1 hour
    if (cachedRates) {
      const { rates, timestamp } = JSON.parse(cachedRates);
      if (Date.now() - timestamp < CACHE_TTL) {
        exchangeRateCache.INR_USD.rate = rates.INR_USD;
        exchangeRateCache.INR_ZAR.rate = rates.INR_ZAR;
        exchangeRateCache.USD_ZAR.rate = rates.USD_ZAR;
        console.log('loadAppData: Using cached exchange rates');
      } else {
        await fetchExchangeRates();
      }
    } else {
      await fetchExchangeRates();
    }

    if (domElements.currencyToggle) {
      domElements.currencyToggle.value = userCurrency;
    }

    // Load critical data with timeout
    await Promise.race([
      Promise.all([
        loadProfileData(),
        updateDashboard()
      ]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Data load timeout')), 10000))
    ]);

    // Defer categories loading
    loadCategories().catch(error => {
      console.error('loadAppData: Failed to load categories', {
        code: error.code,
        message: error.message
      });
    });

    console.log('loadAppData: Critical data loaded');
  } catch (error) {
    console.error('loadAppData error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('page-title', 'Failed to load app data.');
  } finally {
    // Hide loading spinner
    const loadingSpinner = document.getElementById('loading-spinner');
    if (loadingSpinner) {
      loadingSpinner.classList.add('hidden');
      loadingSpinner.setAttribute('aria-busy', 'false');
    }
  }
}

/**
 * Fetches and caches exchange rates
 * @returns {Promise<void>}
 */
async function fetchExchangeRates() {
  const rates = {
    INR_USD: await fetchExchangeRate('INR', 'USD', exchangeRateCache.INR_USD),
    INR_ZAR: await fetchExchangeRate('INR', 'ZAR', exchangeRateCache.INR_ZAR),
    USD_ZAR: await fetchExchangeRate('USD', 'ZAR', exchangeRateCache.USD_ZAR)
  };
  localStorage.setItem('exchange_rates', JSON.stringify({
    rates,
    timestamp: Date.now()
  }));
  console.log('loadAppData: Exchange rates fetched and cached');
}

/**
 * Wraps getDateRange with DOM inputs
 * @param {string} filter
 * @returns {{ start: Date, end: Date }}
 */
function getDateRangeWrapper(filter) {
  return getDateRange(filter, domElements.filterStartDate, domElements.filterEndDate);
}

/**
 * Sets up tab navigation
 */
function setupTabs() {
  console.log('setupTabs: Starting');

  const tabs = [
    { id: 'dashboard', name: 'Dashboard', show: showDashboard },
    { id: 'transactions', name: 'Transactions', show: showTransactions },
    { id: 'budgets', name: 'Budgets', show: showBudgets },
    { id: 'categories', name: 'Categories', show: showCategories },
    { id: 'child-accounts', name: 'Child Accounts', show: showChildAccounts },
    { id: 'profile', name: 'Profile', show: showProfile }
  ];
  let currentTabIndex = 0;

  function debounce(func, wait) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

  function switchTab(tabId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) {
      console.error('Invalid tab ID:', tabId);
      return;
    }
    console.log('Switching to tab:', tabId);
    tab.show();
    currentTabIndex = tabs.findIndex(t => t.id === tabId);

    tabs.forEach(t => {
      const tabButton = domElements[`${t.id.replace('-', '')}Tab`];
      if (tabButton) {
        tabButton.setAttribute('aria-selected', t.id === tabId ? 'true' : 'false');
      }
    });

    const currentTabName = document.getElementById('current-tab-name');
    if (currentTabName) {
      currentTabName.textContent = tab.name;
      currentTabName.setAttribute('aria-live', 'polite');
    }

    const menuItems = document.getElementById('menu-items');
    const menuToggle = document.getElementById('menu-toggle');
    if (menuItems && menuToggle && window.matchMedia('(max-width: 768px)').matches) {
      menuItems.classList.add('hidden');
      menuToggle.setAttribute('aria-expanded', 'false');
    }
  }

  function showDashboard() {
    console.log('Showing dashboard');
    updateTabStyles('dashboard');
    domElements.dashboardSection?.classList.remove('hidden');
    hideOtherSections(['transactions', 'budgets', 'categories', 'childAccounts', 'profile']);
    if (domElements.pageTitle) domElements.pageTitle.textContent = 'Budget Dashboard';
  }

  async function showTransactions() {
    console.log('Showing transactions');
    updateTabStyles('transactions');
    domElements.transactionsSection?.classList.remove('hidden');
    hideOtherSections(['dashboard', 'budgets', 'categories', 'childAccounts', 'profile']);
    if (domElements.pageTitle) domElements.pageTitle.textContent = 'Transactions';
    if (!loadedTabs.transactions) {
      await loadTransactions();
      loadedTabs.transactions = true;
    }
  }

  async function showBudgets() {
    console.log('Showing budgets');
    updateTabStyles('budgets');
    domElements.budgetsSection?.classList.remove('hidden');
    hideOtherSections(['dashboard', 'transactions', 'categories', 'childAccounts', 'profile']);
    if (domElements.pageTitle) domElements.pageTitle.textContent = 'Budgets';
    if (!loadedTabs.budgets) {
      await loadBudgets();
      loadedTabs.budgets = true;
    }
  }

  async function showCategories() {
    console.log('Showing categories');
    updateTabStyles('categories');
    domElements.categoriesSection?.classList.remove('hidden');
    hideOtherSections(['dashboard', 'transactions', 'budgets', 'childAccounts', 'profile']);
    if (domElements.pageTitle) domElements.pageTitle.textContent = 'Categories';
  }

  async function showChildAccounts() {
    console.log('Showing child accounts');
    updateTabStyles('childAccounts');
    domElements.childAccountsSection?.classList.remove('hidden');
    hideOtherSections(['dashboard', 'transactions', 'budgets', 'categories', 'profile']);
    if (domElements.pageTitle) domElements.pageTitle.textContent = 'Child Accounts';
    if (!loadedTabs.childAccounts) {
      await loadChildAccounts();
      loadedTabs.childAccounts = true;
    }
  }

  function showProfile() {
    console.log('Showing profile');
    updateTabStyles('profile');
    domElements.profileSection?.classList.remove('hidden');
    hideOtherSections(['dashboard', 'transactions', 'budgets', 'categories', 'childAccounts']);
    if (domElements.pageTitle) domElements.pageTitle.textContent = 'User Profile';
    loadProfileData();
  }

  function updateTabStyles(activeTab) {
    const tabKeys = ['dashboard', 'transactions', 'budgets', 'categories', 'childAccounts', 'profile'];
    tabKeys.forEach(key => {
      const tabElement = domElements[`${key}Tab`];
      if (tabElement) {
        tabElement.classList.toggle('bg-blue-800', key === activeTab);
      }
    });
  }

  function hideOtherSections(exclude) {
    const sections = ['dashboard', 'transactions', 'budgets', 'categories', 'childAccounts', 'profile'];
    sections.forEach(key => {
      if (!exclude.includes(key)) {
        const sectionElement = domElements[`${key}Section`];
        if (sectionElement) sectionElement.classList.add('hidden');
      }
    });
  }

  tabs.forEach(tab => {
    const tabButton = domElements[`${tab.id.replace('-', '')}Tab`];
    if (tabButton) {
      tabButton.addEventListener('click', () => switchTab(tab.id));
    }
  });

  const menuToggle = document.getElementById('menu-toggle');
  const menuItems = document.getElementById('menu-items');
  if (menuToggle && menuItems) {
    menuToggle.addEventListener('click', () => {
      const isExpanded = menuItems.classList.contains('hidden');
      menuItems.classList.toggle('hidden');
      menuToggle.setAttribute('aria-expanded', isExpanded.toString());
      console.log('Menu toggled:', { isExpanded });
    });
  }

  const swipeContainer = document.getElementById('swipeable-tabs');
  if (swipeContainer && window.matchMedia('(max-width: 768px)').matches) {
    let touchStartX = 0;
    let touchStartY = 0;
    const minSwipeDistance = 50;

    const handleSwipe = debounce((event) => {
      if (event.target.closest('.no-swipe')) {
        console.log('Swipe ignored: started on no-swipe element');
        return;
      }
      const touchEndX = event.changedTouches[0].clientX;
      const touchEndY = event.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = Math.abs(touchEndY - touchStartY);
      console.log('Swipe end:', { x: touchEndX, y: touchEndY, deltaX, deltaY });

      if (deltaY > 50 || Math.abs(deltaX) < minSwipeDistance) {
        console.log('Swipe ignored: vertical scroll or too small');
        return;
      }

      if (deltaX < 0 && currentTabIndex < tabs.length - 1) {
        console.log('Left swipe: next tab');
        switchTab(tabs[currentTabIndex + 1].id);
      } else if (deltaX > 0 && currentTabIndex > 0) {
        console.log('Right swipe: previous tab');
        switchTab(tabs[currentTabIndex - 1].id);
      }
    }, 200);

    swipeContainer.addEventListener('touchstart', (event) => {
      if (event.target.closest('.no-swipe')) return;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
      console.log('Swipe start:', { x: touchStartX, y: touchStartY });
    });

    swipeContainer.addEventListener('touchend', handleSwipe);
  }

  switchTab('dashboard');
}

/**
 * Initializes the app
 * @returns {Promise<void>}
 */
async function initApp() {
  console.log('initApp: Starting');
  try {
    if (currentUser && currentAccountType === 'admin' && db && familyCode) {
      console.log('initApp: Checking budget reset for admin');
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          await resetBudgetsForNewMonth(db, familyCode, currentAccountType);
          console.log('initApp: Budget reset complete');
          break;
        } catch (error) {
          attempts++;
          console.error('initApp: Budget reset attempt failed', {
            attempt: attempts,
            code: error.code,
            message: error.message
          });
          if (attempts === maxAttempts) {
            console.warn('initApp: Max budget reset attempts reached, proceeding');
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    setupTabs();
    setupProfile();
    // Defer non-critical setups
    setTimeout(() => {
      setupCategories();
      setupBudgets();
      setupTransactions();
      setupChildAccounts();
      setupLogout();
    }, 0);
    console.log('initApp: Complete');
  } catch (error) {
    console.error('initApp error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('page-title', 'Failed to initialize app.');
    const loadingSpinner = document.getElementById('loading-spinner');
    if (loadingSpinner) {
      loadingSpinner.classList.add('hidden');
      loadingSpinner.setAttribute('aria-busy', 'false');
    }
  }
}

// ... (Sections 2 and 3 to be provided if requested)

// Export only the functions needed
export { loadAppData, initApp };

// End of Section 1

// app.js (Section 2: Profile and Categories)

// Start of Section 2

/**
 * Sets up profile event listeners
 * @returns {Promise<void>}
 */
async function setupProfile() {
  console.log('setupProfile: Starting');
  try {
    const debounce = (func, wait) => {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
      };
    };

    const editProfile = domElements.editProfile;
    if (editProfile) {
      editProfile.addEventListener('click', () => {
        console.log('Edit Profile clicked');
        isEditing.profile = true;
        const fields = [
          { element: domElements.profileEmail, attr: 'readonly', class: 'bg-gray-100' },
          { element: domElements.profileCurrency, attr: 'disabled', class: 'bg-gray-100' },
          { element: domElements.profileAccountType, attr: 'disabled', class: 'bg-gray-100' }
        ];
        fields.forEach(({ element, attr, class: className }) => {
          if (element) {
            element.removeAttribute(attr);
            element.classList.remove(className);
          }
        });
        if (domElements.profileFamilyCode) {
          domElements.profileFamilyCode.setAttribute('readonly', 'true');
          domElements.profileFamilyCode.classList.add('bg-gray-100');
        }
        editProfile.classList.add('hidden');
        domElements.saveProfile?.classList.remove('hidden');
        domElements.profileEmail?.focus();
      });
    }

    const saveProfile = domElements.saveProfile;
    if (saveProfile) {
      const handleSave = debounce(async () => {
        console.log('Save Profile clicked');
        clearErrors();
        const email = domElements.profileEmail?.value.trim();
        const currency = domElements.profileCurrency?.value;
        const accountType = domElements.profileAccountType?.value;

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          showError('profile-email', 'Valid email is required');
          return;
        }
        if (!['INR', 'USD', 'ZAR'].includes(currency)) {
          showError('profile-currency', 'Valid currency (INR, USD, ZAR) is required');
          return;
        }
        if (!['admin', 'child'].includes(accountType)) {
          showError('profile-account-type', 'Valid account type (admin, child) is required');
          return;
        }

        try {
          saveProfile.disabled = true;
          saveProfile.textContent = 'Saving...';
          if (email !== currentUser.email) {
            console.log('Updating email:', email);
            await auth.currentUser.updateEmail(email);
          }
          await retryFirestoreOperation(() =>
            updateDoc(doc(db, 'users', currentUser.uid), { currency, accountType })
          );
          console.log('Profile updated:', { email, currency, accountType });
          setUserCurrency(currency);
          isEditing.profile = false;
          const fields = [
            { element: domElements.profileEmail, attr: 'readonly', class: 'bg-gray-100' },
            { element: domElements.profileCurrency, attr: 'disabled', class: 'bg-gray-100' },
            { element: domElements.profileAccountType, attr: 'disabled', class: 'bg-gray-100' }
          ];
          fields.forEach(({ element, attr, class: className }) => {
            if (element) {
              element.setAttribute(attr, 'true');
              element.classList.add(className);
            }
          });
          editProfile?.classList.remove('hidden');
          saveProfile.classList.add('hidden');
          domElements.currencyToggle.value = currency;
          await Promise.all([
            loadBudgets(),
            loadTransactions(),
            loadChildAccounts(),
            updateDashboard()
          ]);
        } catch (error) {
          console.error('saveProfile error:', {
            code: error.code,
            message: error.message,
            stack: error.stack
          });
          const errorMessages = {
            'auth/email-already-in-use': 'This email is already in use.',
            'auth/invalid-email': 'Invalid email format.',
            'auth/requires-recent-login': 'Please log out and log in again to update email.'
          };
          showError('profile-email', errorMessages[error.code] || 'Failed to save profile.');
        } finally {
          saveProfile.disabled = false;
          saveProfile.textContent = 'Save Profile';
        }
      }, 500);
      saveProfile.addEventListener('click', handleSave);
    }

    const currencyToggle = domElements.currencyToggle;
    if (currencyToggle) {
      const handleCurrencyChange = debounce(async () => {
        const newCurrency = currencyToggle.value;
        console.log('Currency toggle changed:', newCurrency);
        try {
          if (!['INR', 'USD', 'ZAR'].includes(newCurrency)) {
            throw new Error('Invalid currency selected');
          }
          if (!currentUser || !db) {
            throw new Error('Missing user or Firestore');
          }
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
          console.log('Currency updated:', newCurrency);
        } catch (error) {
          console.error('currencyToggle error:', {
            code: error.code,
            message: error.message,
            stack: error.stack
          });
          showError('currency-toggle', 'Failed to update currency.');
        }
      }, 500);
      currencyToggle.addEventListener('change', handleCurrencyChange);
    }

    const dashboardFilter = domElements.dashboardFilter;
    if (dashboardFilter) {
      dashboardFilter.addEventListener('change', () => {
        console.log('Dashboard filter changed:', dashboardFilter.value);
        domElements.customDateRange?.classList.toggle('hidden', dashboardFilter.value !== 'custom');
        updateDashboard();
      });
    }
  } catch (error) {
    console.error('setupProfile error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('profile-email', 'Failed to initialize profile.');
  }
}

/**
 * Loads profile data
 * @returns {Promise<void>}
 */
async function loadProfileData() {
  console.log('loadProfileData: Starting');
  if (!currentUser || !db) {
    console.error('loadProfileData: Missing user or Firestore');
    showError('profile-email', 'Database service not available');
    return;
  }

  try {
    const cacheKey = `profile_${currentUser.uid}`;
    const cachedProfile = localStorage.getItem(cacheKey);
    const CACHE_TTL = 600000; // 10 minutes
    if (cachedProfile) {
      const { data, timestamp } = JSON.parse(cachedProfile);
      if (Date.now() - timestamp < CACHE_TTL) {
        applyProfileData(data);
        console.log('loadProfileData: Using cached profile');
        return;
      }
    }

    const docSnap = await Promise.race([
      retryFirestoreOperation(() => getDoc(doc(db, 'users', currentUser.uid))),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Profile load timeout')), 5000))
    ]);

    if (docSnap.exists()) {
      const data = docSnap.data();
      applyProfileData(data);
      localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
      console.log('loadProfileData: Profile loaded:', {
        email: currentUser.email,
        currency: data.currency,
        familyCode: data.familyCode,
        accountType: data.accountType
      });
    } else {
      console.error('loadProfileData: User document not found:', currentUser.uid);
      showError('profile-email', 'Profile data not found.');
    }
  } catch (error) {
    console.error('loadProfileData error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('profile-email', 'Failed to load profile data.');
  }
}

/**
 * Applies profile data to DOM
 * @param {Object} data
 */
function applyProfileData(data) {
  domElements.profileEmail.value = currentUser.email || '--';
  domElements.profileCurrency.value = data.currency || 'INR';
  domElements.profileFamilyCode.value = data.familyCode || '--';
  domElements.profileAccountType.value = data.accountType || '--';
  currentAccountType = data.accountType || '--';
}

/**
 * Loads categories
 * @returns {Promise<void>}
 */
async function loadCategories() {
  console.log('loadCategories: Starting');
  try {
    if (!db || !familyCode) {
      console.error('loadCategories: Missing Firestore or familyCode', { db: !!db, familyCode });
      showError('category-name', 'Database service not available');
      return;
    }

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

    categorySelect.innerHTML = '<option value="">Select Category</option><option value="add-new">Add New</option>';
    categoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
    if (newCategoryBudgetSelect) {
      newCategoryBudgetSelect.innerHTML = '<option value="none">None</option><option value="add-new">Add New</option>';
    }
    categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4">Loading...</td></tr>';

    const cacheKey = `categories_${familyCode}`;
    const cachedCategories = localStorage.getItem(cacheKey);
    const CACHE_TTL = 600000;
    if (cachedCategories) {
      const { categories, budgets, timestamp } = JSON.parse(cachedCategories);
      if (Date.now() - timestamp < CACHE_TTL) {
        applyCategoriesData(categories, budgets, categorySelect, categoryBudgetSelect, newCategoryBudgetSelect, categoryTable);
        console.log('loadCategories: Using cached categories');
        return;
      }
    }

    const [budgetsSnapshot, categoriesSnapshot] = await Promise.all([
      retryFirestoreOperation(() => getDocs(query(collection(db, 'budgets'), where('familyCode', '==', familyCode)))).catch(error => {
        console.warn('loadCategories: Budget fetch failed', {
          code: error.code,
          message: error.message
        });
        return { docs: [] };
      }),
      retryFirestoreOperation(() => getDocs(query(collection(db, 'categories'), where('familyCode', '==', familyCode))))
    ]);

    console.log('loadCategories: Data fetched', {
      budgets: budgetsSnapshot.size,
      categories: categoriesSnapshot.size
    });

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

    const categories = [];
    categoriesSnapshot.forEach(doc => {
      categories.push({ id: doc.id, ...doc.data() });
    });

    applyCategoriesData(categories, budgetMap, categorySelect, categoryBudgetSelect, newCategoryBudgetSelect, categoryTable);
    localStorage.setItem(cacheKey, JSON.stringify({
      categories,
      budgets: Object.fromEntries(budgetMap),
      timestamp: Date.now()
    }));
  } catch (error) {
    console.error('loadCategories error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('category-name', 'Failed to load categories.');
    if (categoryTable) {
      categoryTable.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-600">Error loading categories</td></tr>';
    }
  }
}

/**
 * Applies categories data to DOM
 * @param {Array} categories
 * @param {Map} budgetMap
 * @param {HTMLSelectElement} categorySelect
 * @param {HTMLSelectElement} categoryBudgetSelect
 * @param {HTMLSelectElement|null} newCategoryBudgetSelect
 * @param {HTMLElement} categoryTable
 */
function applyCategoriesData(categories, budgetMap, categorySelect, categoryBudgetSelect, newCategoryBudgetSelect, categoryTable) {
  categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    categorySelect.insertBefore(option, categorySelect.querySelector('option[value="add-new"]'));
  });

  categoryTable.innerHTML = categories.length === 0
    ? '<tr><td colspan="4" class="text-center py-4">No categories found</td></tr>'
    : '';

  categories.forEach(category => {
    const tr = document.createElement('tr');
    tr.classList.add('table-row');
    const budgetName = category.budgetId ? budgetMap.get(category.budgetId) || 'Unknown' : 'None';
    tr.innerHTML = `
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${category.name || 'Unknown'}</td>
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${category.type || 'Unknown'}</td>
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${budgetName}</td>
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm">
        <button class="text-blue-600 hover:text-blue-800 mr-2 edit-category" data-id="${category.id}" aria-label="Edit ${category.name}">Edit</button>
        <button class="text-red-600 hover:text-red-800 delete-category" data-id="${category.id}" aria-label="Delete ${category.name}">Delete</button>
      </td>
    `;
    categoryTable.appendChild(tr);
  });
  console.log('loadCategories: Table updated', { rendered: categories.length });
}

/**
 * Sets up category event listeners
 * @returns {Promise<void>}
 */
async function setupCategories() {
  console.log('setupCategories: Starting');
  try {
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

    const debounce = (func, wait) => {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
      };
    };

    const handleAddCategory = debounce(async () => {
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
        console.error('addCategory: Missing form elements');
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
      if (!['income', 'expense'].includes(type)) {
        showError('category-type', 'Valid type (income, expense) is required');
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
    }, 500);
    addCategory.addEventListener('click', handleAddCategory);

    categorySelect.addEventListener('change', () => {
      console.log('categorySelect: Changed', { value: categorySelect.value });
      if (categorySelect.value === 'add-new') {
        if (domElements.addCategoryModal) {
          domElements.addCategoryModal.classList.remove('hidden');
          domElements.addCategoryModal.setAttribute('aria-hidden', 'false');
          categorySelect.value = '';
          document.getElementById('new-category-name')?.focus();
        } else {
          showError('category', 'Add category modal not found');
        }
      }
    });

    const handleSaveCategory = debounce(async () => {
      console.log('saveCategory: Clicked');
      clearErrors();
      const nameInput = document.getElementById('new-category-name');
      const typeSelect = document.getElementById('new-category-type');
      const budgetSelect = document.getElementById('new-category-budget');
      if (!nameInput || !typeSelect || !budgetSelect) {
        console.error('saveCategory: Missing modal form elements');
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
      if (!['income', 'expense'].includes(type)) {
        showError('new-category-type', 'Valid type (income, expense) is required');
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
          addDoc(collection(db, 'categories'), {
            name,
            type,
            budgetId,
            familyCode,
            createdAt: serverTimestamp()
          })
        );
        console.log('saveCategory: Category saved', { name, type, budgetId });
        domElements.addCategoryModal?.classList.add('hidden');
        domElements.addCategoryModal?.setAttribute('aria-hidden', 'true');
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
    }, 500);
    saveCategory.addEventListener('click', handleSaveCategory);

    cancelCategory.addEventListener('click', () => {
      console.log('cancelCategory: Clicked');
      domElements.addCategoryModal?.classList.add('hidden');
      domElements.addCategoryModal?.setAttribute('aria-hidden', 'true');
      document.getElementById('new-category-name').value = '';
      document.getElementById('new-category-type').value = 'income';
      document.getElementById('new-category-budget').value = 'none';
      categorySelect.focus();
    });

    categoryTable.addEventListener('click', async (e) => {
      if (e.target.classList.contains('edit-category')) {
        console.log('editCategory: Clicked', { id: e.target.dataset.id });
        const id = e.target.dataset.id;
        if (!db) {
          showError('category-name', 'Database service not available');
          return;
        }
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
              if (!['income', 'expense'].includes(type)) {
                showError('category-type', 'Valid type required');
                return;
              }
              try {
                addCategory.disabled = true;
                addCategory.textContent = 'Updating...';
                await retryFirestoreOperation(() =>
                  updateDoc(doc(db, 'categories', id), { name, type, budgetId })
                );
                console.log('editCategory: Category updated', { id, name, type, budgetId });
                nameInput.value = '';
                typeSelect.value = 'income';
                budgetSelect.value = 'none';
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
          showError('category-name', 'Cannot delete: Missing components');
          return;
        }
        domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this category?';
        domElements.deleteConfirmModal.classList.remove('hidden');
        domElements.deleteConfirmModal.setAttribute('aria-hidden', 'false');
        const confirmHandler = async () => {
          try {
            await retryFirestoreOperation(() => deleteDoc(doc(db, 'categories', id)));
            console.log('deleteCategory: Category deleted', { id });
            await loadCategories();
            domElements.deleteConfirmModal.classList.add('hidden');
            domElements.deleteConfirmModal.setAttribute('aria-hidden', 'true');
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
          domElements.deleteConfirmModal.setAttribute('aria-hidden', 'true');
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
    showError('category-name', 'Failed to initialize categories.');
  }
}

// End of Section 2

// app.js (Section 3: Budgets, Transactions, Child Accounts, and Dashboard)

// Start of Section 3

/**
 * Loads budgets and updates UI
 * @returns {Promise<void>}
 */
async function loadBudgets() {
  console.log('loadBudgets: Starting', { familyCode });
  if (!db) {
    console.error('loadBudgets: Firestore not available');
    showError('budget-name', 'Database service not available');
    return;
  }

  try {
    const budgetTable = document.getElementById('budget-table');
    const budgetTiles = document.getElementById('budget-tiles');
    if (!budgetTable || !budgetTiles) {
      console.error('loadBudgets: Missing DOM elements', {
        budgetTable: !!budgetTable,
        budgetTiles: !!budgetTiles
      });
      showError('budget-name', 'Budget table or tiles not found');
      return;
    }
    budgetTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading...</td></tr>';
    budgetTiles.innerHTML = '<div class="text-center py-4">Loading...</div>';

    if (currentAccountType === 'admin') {
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          console.log('loadBudgets: Attempting budget reset', { attempt: attempts + 1 });
          await resetBudgetsForNewMonth(db, familyCode, currentAccountType);
          console.log('loadBudgets: Budget reset complete');
          break;
        } catch (error) {
          attempts++;
          console.error('loadBudgets: Budget reset failed', {
            attempt: attempts,
            code: error.code,
            message: error.message
          });
          if (attempts === maxAttempts) {
            console.warn('loadBudgets: Max reset attempts reached, proceeding');
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    const cacheKey = `budgets_${familyCode}`;
    const cachedBudgets = localStorage.getItem(cacheKey);
    const CACHE_TTL = 600000;
    if (cachedBudgets) {
      const { budgets, timestamp } = JSON.parse(cachedBudgets);
      if (Date.now() - timestamp < CACHE_TTL) {
        applyBudgetsData(budgets, budgetTable, budgetTiles);
        console.log('loadBudgets: Using cached budgets');
        return;
      }
    }

    const filter = domElements.dashboardFilter?.value || 'thisMonth';
    let { start, end } = getDateRangeWrapper(filter);
    start = new Date(start.getTime() - 5.5 * 60 * 60 * 1000);
    console.log('loadBudgets: Filter applied', { filter, start: start.toISOString(), end: end.toISOString() });

    const [categoriesSnapshot, budgetsSnapshot] = await Promise.all([
      retryFirestoreOperation(() => getDocs(query(collection(db, 'categories'), where('familyCode', '==', familyCode)))).catch(() => ({ docs: [] })),
      retryFirestoreOperation(() => getDocs(query(collection(db, 'budgets'), where('familyCode', '==', familyCode))))
    ]);

    const budgetToCategories = new Map();
    categoriesSnapshot.forEach(doc => {
      const category = doc.data();
      if (category.budgetId) {
        if (!budgetToCategories.has(category.budgetId)) {
          budgetToCategories.set(category.budgetId, []);
        }
        budgetToCategories.get(category.budgetId).push(doc.id);
      }
    });

    const budgets = [];
    let totalBudgetAmount = 0;
    let totalRemainingAmount = 0;

    for (const doc of budgetsSnapshot.docs) {
      const budget = doc.data();
      let spent = 0;
      const categoryIds = budgetToCategories.get(doc.id) || [];
      if (categoryIds.length > 0) {
        const chunks = [];
        for (let i = 0; i < categoryIds.length; i += 30) {
          chunks.push(categoryIds.slice(i, i + 30));
        }
        let debitTotal = 0;
        let creditTotal = 0;
        for (const chunk of chunks) {
          const [debitSnapshot, creditSnapshot] = await Promise.all([
            retryFirestoreOperation(() => getDocs(query(
              collection(db, 'transactions'),
              where('familyCode', '==', familyCode),
              where('categoryId', 'in', chunk),
              where('type', '==', 'debit'),
              where('createdAt', '>=', start),
              where('createdAt', '<=', end)
            ))).catch(() => ({ docs: [] })),
            retryFirestoreOperation(() => getDocs(query(
              collection(db, 'transactions'),
              where('familyCode', '==', familyCode),
              where('categoryId', 'in', chunk),
              where('type', '==', 'credit'),
              where('createdAt', '>=', start),
              where('createdAt', '<=', end)
            ))).catch(() => ({ docs: [] }))
          ]);
          debitTotal += debitSnapshot.docs.reduce((sum, txDoc) => sum + (txDoc.data().amount || 0), 0);
          creditTotal += creditSnapshot.docs.reduce((sum, txDoc) => sum + (txDoc.data().amount || 0), 0);
        }
        spent = debitTotal - creditTotal;
      }
      totalBudgetAmount += budget.amount;
      totalRemainingAmount += budget.amount - spent;
      budgets.push({ id: doc.id, ...budget, spent });
    }

    applyBudgetsData(budgets, budgetTable, budgetTiles);
    localStorage.setItem(cacheKey, JSON.stringify({ budgets, timestamp: Date.now() }));
    const totalBudgetElement = document.getElementById('total-budget');
    const totalRemainingElement = document.getElementById('total-remaining');
    if (totalBudgetElement && totalRemainingElement) {
      totalBudgetElement.textContent = await formatCurrency(totalBudgetAmount, 'INR');
      totalRemainingElement.textContent = await formatCurrency(totalRemainingAmount, 'INR');
    }
  } catch (error) {
    console.error('loadBudgets error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('budget-name', 'Failed to load budgets.');
    document.getElementById('budget-table').innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-600">Error loading budgets</td></tr>';
    document.getElementById('budget-tiles').innerHTML = '<div class="text-center py-4 text-red-600">Error loading budgets</div>';
  }
}

/**
 * Applies budgets data to DOM
 * @param {Array} budgets
 * @param {HTMLElement} budgetTable
 * @param {HTMLElement} budgetTiles
 */
async function applyBudgetsData(budgets, budgetTable, budgetTiles) {
  budgetTable.innerHTML = budgets.length === 0
    ? '<tr><td colspan="5" class="text-center py-4">No budgets found</td></tr>'
    : '';
  budgetTiles.innerHTML = budgets.length === 0
    ? '<div class="text-center py-4">No budgets found</div>'
    : '';

  for (const budget of budgets) {
    const tr = document.createElement('tr');
    tr.classList.add('table-row');
    tr.innerHTML = `
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${budget.name}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${await formatCurrency(budget.amount, 'INR')}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${await formatCurrency(budget.spent, 'INR')}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${await formatCurrency(budget.amount - budget.spent, 'INR')}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm">
        <button class="text-blue-600 hover:text-blue-800 mr-2 edit-budget" data-id="${budget.id}" aria-label="Edit ${budget.name}">Edit</button>
        <button class="text-red-600 hover:text-red-800 delete-budget" data-id="${budget.id}" aria-label="Delete ${budget.name}">Delete</button>
      </td>
    `;
    budgetTable.appendChild(tr);

    const tile = document.createElement('div');
    tile.classList.add('bg-white', 'rounded-lg', 'shadow-md', 'p-6', 'budget-tile');
    const percentage = budget.amount ? (budget.spent / budget.amount) * 100 : 0;
    tile.innerHTML = `
      <h3 class="text-lg font-semibold text-gray-700">${budget.name}</h3>
      <p class="text-sm text-gray-500">Budget: <span id="${budget.id}-budget">${await formatCurrency(budget.amount, 'INR')}</span></p>
      <p class="text-sm text-gray-500">Spent: <span id="${budget.id}-spent">${await formatCurrency(budget.spent, 'INR')}</span></p>
      <p class="text-sm font-semibold text-gray-700 mt-2">Remaining: <span id="${budget.id}-remaining">${await formatCurrency(budget.amount - budget.spent, 'INR')}</span></p>
      <div class="w-full bg-gray-200 rounded-full mt-4 progress-bar">
        <div class="bg-green-600 progress-bar" style="width: ${percentage}%"></div>
      </div>
    `;
    budgetTiles.appendChild(tile);
  }
  console.log('loadBudgets: UI updated', { budgetCount: budgets.length });
}

/**
 * Sets up budget event listeners
 * @returns {Promise<void>}
 */
async function setupBudgets() {
  console.log('setupBudgets: Starting');
  try {
    const addBudget = document.getElementById('add-budget');
    const saveBudget = document.getElementById('save-budget');
    const cancelBudget = document.getElementById('cancel-budget');
    const budgetTable = document.getElementById('budget-table');

    if (!addBudget || !saveBudget || !cancelBudget || !budgetTable) {
      console.error('setupBudgets: Missing DOM elements', {
        addBudget: !!addBudget,
        saveBudget: !!saveBudget,
        cancelBudget: !!cancelBudget,
        budgetTable: !!budgetTable
      });
      showError('budget-name', 'Budget form or table not found');
      return;
    }

    const debounce = (func, wait) => {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
      };
    };

    const handleAddBudget = debounce(async () => {
      console.log('addBudget: Clicked', { isEditing: isEditing.budget });
      if (isEditing.budget) return;
      clearErrors();
      const nameInput = document.getElementById('budget-name');
      const amountInput = document.getElementById('budget-amount');
      if (!nameInput || !amountInput) {
        showError('budget-name', 'Form inputs not found');
        return;
      }
      const name = nameInput.value.trim();
      const amount = parseFloat(amountInput.value.trim());
      if (!name) {
        showError('budget-name', 'Budget name is required');
        return;
      }
      if (isNaN(amount) || amount <= 0) {
        showError('budget-amount', 'Valid positive amount is required');
        return;
      }
      if (!currentUser || !db || currentAccountType !== 'admin') {
        showError('budget-name', 'Only admins can add budgets');
        return;
      }
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      if (!userDoc.exists() || !userDoc.data().familyCode) {
        showError('budget-name', 'Invalid user configuration');
        return;
      }
      try {
        addBudget.disabled = true;
        addBudget.textContent = 'Adding...';
        const now = new Date();
        const currentMonthYear = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        await retryFirestoreOperation(() =>
          addDoc(collection(db, 'budgets'), {
            name,
            amount,
            spent: 0,
            familyCode,
            createdAt: serverTimestamp(),
            lastResetMonth: currentMonthYear
          })
        );
        console.log('addBudget: Budget added', { name, amount });
        nameInput.value = '';
        amountInput.value = '';
        await Promise.all([loadBudgets(), loadCategories()]);
      } catch (error) {
        console.error('addBudget error:', {
          code: error.code,
          message: error.message,
          stack: error.stack
        });
        showError('budget-name', `Failed to add budget: ${error.message}`);
      } finally {
        addBudget.disabled = false;
        addBudget.textContent = 'Add Budget';
      }
    }, 500);
    addBudget.addEventListener('click', handleAddBudget);

    domElements.categoryBudgetSelect?.addEventListener('change', () => {
      if (domElements.categoryBudgetSelect.value === 'add-new') {
        domElements.addBudgetModal?.classList.remove('hidden');
        domElements.addBudgetModal?.setAttribute('aria-hidden', 'false');
        domElements.categoryBudgetSelect.value = 'none';
        document.getElementById('new-budget-name')?.focus();
      }
    });

    const handleSaveBudget = debounce(async () => {
      console.log('saveBudget: Clicked');
      clearErrors();
      const nameInput = document.getElementById('new-budget-name');
      const amountInput = document.getElementById('new-budget-amount');
      if (!nameInput || !amountInput) {
        showError('new-budget-name', 'Modal form inputs not found');
        return;
      }
      const name = nameInput.value.trim();
      const amount = parseFloat(amountInput.value.trim());
      if (!name) {
        showError('new-budget-name', 'Budget name is required');
        return;
      }
      if (isNaN(amount) || amount <= 0) {
        showError('new-budget-amount', 'Valid positive amount is required');
        return;
      }
      if (!currentUser || !db || currentAccountType !== 'admin') {
        showError('new-budget-name', 'Only admins can add budgets');
        return;
      }
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      if (!userDoc.exists() || !userDoc.data().familyCode) {
        showError('new-budget-name', 'Invalid user configuration');
        return;
      }
      try {
        saveBudget.disabled = true;
        saveBudget.textContent = 'Saving...';
        const now = new Date();
        const currentMonthYear = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        await retryFirestoreOperation(() =>
          addDoc(collection(db, 'budgets'), {
            name,
            amount,
            spent: 0,
            familyCode,
            createdAt: serverTimestamp(),
            lastResetMonth: currentMonthYear
          })
        );
        console.log('saveBudget: Budget saved', { name, amount });
        domElements.addBudgetModal?.classList.add('hidden');
        domElements.addBudgetModal?.setAttribute('aria-hidden', 'true');
        nameInput.value = '';
        amountInput.value = '';
        await Promise.all([loadBudgets(), loadCategories()]);
      } catch (error) {
        console.error('saveBudget error:', {
          code: error.code,
          message: error.message,
          stack: error.stack
        });
        showError('new-budget-name', `Failed to save budget: ${error.message}`);
      } finally {
        saveBudget.disabled = false;
        saveBudget.textContent = 'Save';
      }
    }, 500);
    saveBudget.addEventListener('click', handleSaveBudget);

    cancelBudget.addEventListener('click', () => {
      console.log('cancelBudget: Clicked');
      domElements.addBudgetModal?.classList.add('hidden');
      domElements.addBudgetModal?.setAttribute('aria-hidden', 'true');
      document.getElementById('new-budget-name').value = '';
      document.getElementById('new-budget-amount').value = '';
    });

    budgetTable.addEventListener('click', async (e) => {
      if (e.target.classList.contains('edit-budget')) {
        console.log('editBudget: Clicked', { id: e.target.dataset.id });
        const id = e.target.dataset.id;
        if (!db) {
          showError('budget-name', 'Database service not available');
          return;
        }
        try {
          const docSnap = await retryFirestoreOperation(() => getDoc(doc(db, 'budgets', id)));
          if (docSnap.exists()) {
            const data = docSnap.data();
            const nameInput = document.getElementById('budget-name');
            const amountInput = document.getElementById('budget-amount');
            if (!nameInput || !amountInput) {
              showError('budget-name', 'Form inputs not found');
              return;
            }
            nameInput.value = data.name;
            amountInput.value = data.amount;
            addBudget.innerHTML = 'Update Budget';
            isEditing.budget = true;
            const updateHandler = async () => {
              const name = nameInput.value.trim();
              const amount = parseFloat(amountInput.value.trim());
              if (!name) {
                showError('budget-name', 'Budget name is required');
                return;
              }
              if (isNaN(amount) || amount <= 0) {
                showError('budget-amount', 'Valid positive amount is required');
                return;
              }
              try {
                addBudget.disabled = true;
                addBudget.textContent = 'Updating...';
                await retryFirestoreOperation(() =>
                  updateDoc(doc(db, 'budgets', id), { name, amount })
                );
                console.log('editBudget: Budget updated', { id, name, amount });
                nameInput.value = '';
                amountInput.value = '';
                isEditing.budget = false;
                await Promise.all([loadBudgets(), loadCategories()]);
              } catch (error) {
                console.error('editBudget error:', {
                  code: error.code,
                  message: error.message,
                  stack: error.stack
                });
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
          console.error('editBudget error:', {
            code: error.code,
            message: error.message,
            stack: error.stack
          });
          showError('budget-name', `Failed to fetch budget: ${error.message}`);
        }
      }
      if (e.target.classList.contains('delete-budget')) {
        console.log('deleteBudget: Clicked', { id: e.target.dataset.id });
        const id = e.target.dataset.id;
        if (!domElements.deleteConfirmModal || !db) {
          showError('budget-name', 'Cannot delete: Missing components');
          return;
        }
        domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this budget?';
        domElements.deleteConfirmModal.classList.remove('hidden');
        domElements.deleteConfirmModal.setAttribute('aria-hidden', 'false');
        const confirmHandler = async () => {
          try {
            await retryFirestoreOperation(() => deleteDoc(doc(db, 'budgets', id)));
            console.log('deleteBudget: Budget deleted', { id });
            await Promise.all([loadBudgets(), loadCategories()]);
            domElements.deleteConfirmModal.classList.add('hidden');
            domElements.deleteConfirmModal.setAttribute('aria-hidden', 'true');
          } catch (error) {
            console.error('deleteBudget error:', {
              code: error.code,
              message: error.message,
              stack: error.stack
            });
            showError('budget-name', `Failed to delete budget: ${error.message}`);
          }
          domElements.confirmDelete.removeEventListener('click', confirmHandler);
        };
        const cancelHandler = () => {
          console.log('deleteBudget: Cancelled');
          domElements.deleteConfirmModal.classList.add('hidden');
          domElements.deleteConfirmModal.setAttribute('aria-hidden', 'true');
          domElements.cancelDelete.removeEventListener('click', cancelHandler);
        };
        domElements.confirmDelete.addEventListener('click', confirmHandler, { once: true });
        domElements.cancelDelete.addEventListener('click', cancelHandler, { once: true });
      }
    });
  } catch (error) {
    console.error('setupBudgets error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('budget-name', 'Failed to initialize budgets.');
  }
}

/**
 * Loads transactions and updates UI
 * @returns {Promise<void>}
 */
async function loadTransactions() {
  console.log('loadTransactions: Starting', { familyCode });
  try {
    const transactionTable = document.getElementById('transaction-table');
    const dateHeader = document.getElementById('transaction-date-header');
    const transactionsFilter = document.getElementById('transactions-filter');
    if (!transactionTable || !dateHeader || !transactionsFilter) {
      console.error('loadTransactions: Missing DOM elements', {
        transactionTable: !!transactionTable,
        dateHeader: !!dateHeader,
        transactionsFilter: !!transactionsFilter
      });
      showError('transactions-filter', 'Transaction table or filter not found');
      return;
    }
    transactionTable.innerHTML = '<tr><td colspan="6" class="text-center py-4">Loading...</td></tr>';

    if (!db || !familyCode) {
      console.error('loadTransactions: Firestore or familyCode not available');
      showError('transactions-filter', 'Database service not available');
      transactionTable.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-600">Database unavailable</td></tr>';
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

    const cacheKey = `transactions_${familyCode}_${filter}`;
    const cachedTransactions = localStorage.getItem(cacheKey);
    const CACHE_TTL = 600000;
    if (cachedTransactions) {
      const { transactions, timestamp } = JSON.parse(cachedTransactions);
      if (Date.now() - timestamp < CACHE_TTL) {
        applyTransactionsData(transactions, transactionTable);
        console.log('loadTransactions: Using cached transactions');
        return;
      }
    }

    const [categoriesSnapshot, transactionsSnapshot] = await Promise.all([
      retryFirestoreOperation(() => getDocs(query(collection(db, 'categories'), where('familyCode', '==', familyCode)))).catch(() => ({ docs: [] })),
      retryFirestoreOperation(() => getDocs(query(
        collection(db, 'transactions'),
        where('familyCode', '==', familyCode),
        where('createdAt', '>=', adjustedStart),
        where('createdAt', '<=', end),
        orderBy('createdAt', 'desc')
      )))
    ]);

    const categoryMap = new Map();
    categoriesSnapshot.forEach(doc => categoryMap.set(doc.id, doc.data().name));

    const transactions = [];
    transactionsSnapshot.forEach(doc => {
      const transaction = doc.data();
      const createdAt = transaction.createdAt?.toDate() || new Date();
      transactions.push({ id: doc.id, ...transaction, createdAt });
    });

    applyTransactionsData(transactions, transactionTable);
    localStorage.setItem(cacheKey, JSON.stringify({ transactions, timestamp: Date.now() }));
  } catch (error) {
    console.error('loadTransactions error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('transactions-filter', 'Failed to load transactions.');
    document.getElementById('transaction-table').innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
  }
}

/**
 * Applies transactions data to DOM
 * @param {Array} transactions
 * @param {HTMLElement} transactionTable
 */
async function applyTransactionsData(transactions, transactionTable) {
  transactionTable.innerHTML = transactions.length === 0
    ? '<tr><td colspan="6" class="text-center py-4">No transactions found for this period</td></tr>'
    : '';

  transactions.sort((a, b) => b.createdAt - a.createdAt);
  for (const transaction of transactions) {
    const tr = document.createElement('tr');
    tr.classList.add('table-row');
    const categoryName = transaction.categoryId ? transaction.categoryName || 'Unknown' : 'None';
    const day = transaction.createdAt.toLocaleString('en-US', { day: 'numeric' });
    tr.innerHTML = `
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.type || 'Unknown'}</td>
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${await formatCurrency(transaction.amount || 0, 'INR')}</td>
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${categoryName}</td>
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.description || ''}</td>
      <td class="w-12 px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${day}</td>
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm">
        <button class="text-blue-600 hover:text-blue-800 mr-2 edit-transaction" data-id="${transaction.id}" aria-label="Edit transaction">Edit</button>
        <button class="text-red-600 hover:text-red-800 delete-transaction" data-id="${transaction.id}" aria-label="Delete transaction">Delete</button>
      </td>
    `;
    transactionTable.appendChild(tr);
  }
  console.log('loadTransactions: Table updated', { rendered: transactions.length });
}

/**
 * Sets up transaction event listeners
 * @returns {Promise<void>}
 */
async function setupTransactions() {
  console.log('setupTransactions: Starting');
  try {
    const addTransaction = document.getElementById('add-transaction');
    const transactionTable = document.getElementById('transaction-table');
    const transactionsFilter = document.getElementById('transactions-filter');

    if (!addTransaction || !transactionTable || !transactionsFilter) {
      console.error('setupTransactions: Missing DOM elements', {
        addTransaction: !!addTransaction,
        transactionTable: !!transactionTable,
        transactionsFilter: !!transactionsFilter
      });
      showError('category', 'Transaction form or table not found');
      return;
    }

    transactionsFilter.addEventListener('change', () => {
      console.log('Transactions filter changed', { filter: transactionsFilter.value });
      loadTransactions();
    });

    const debounce = (func, wait) => {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
      };
    };

    const handleAddTransaction = debounce(async () => {
      console.log('addTransaction: Clicked', { isEditing: isEditing.transaction });
      if (isEditing.transaction) return;
      clearErrors();
      const typeInput = document.getElementById('type');
      const amountInput = document.getElementById('amount');
      const categoryInput = document.getElementById('category');
      const descriptionInput = document.getElementById('description');
      if (!typeInput || !amountInput || !categoryInput || !descriptionInput) {
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
          const categoryDoc = await retryFirestoreOperation(() => getDoc(doc(db, 'categories', categoryId)));
          if (categoryDoc.exists() && categoryDoc.data().budgetId) {
            await retryFirestoreOperation(() =>
              updateDoc(doc(db, 'budgets', categoryDoc.data().budgetId), {
                spent: increment(amount)
              })
            );
            console.log('addTransaction: Updated budget spent', { budgetId: categoryDoc.data().budgetId, amount });
          }
        }
        console.log('addTransaction: Transaction added', { id: docRef.id });
        typeInput.value = 'debit';
        amountInput.value = '';
        categoryInput.value = '';
        descriptionInput.value = '';
        await Promise.all([loadTransactions(), loadBudgets(), updateDashboard()]);
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
    }, 500);
    addTransaction.addEventListener('click', handleAddTransaction);

    transactionTable.addEventListener('click', async (e) => {
      if (e.target.classList.contains('edit-transaction')) {
        console.log('editTransaction: Clicked', { id: e.target.dataset.id });
        const id = e.target.dataset.id;
        if (!db) {
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
              showError('category', 'Form elements not found');
              return;
            }
            typeInput.value = oldData.type;
            amountInput.value = oldData.amount;
            categoryInput.value = oldData.categoryId;
            descriptionInput.value = oldData.description || '';
            addTransaction.innerHTML = 'Update Transaction';
            isEditing.transaction = true;
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
                    description
                  })
                );
                console.log('editTransaction: Transaction updated', { id, type, amount });
                typeInput.value = 'debit';
                amountInput.value = '';
                categoryInput.value = '';
                descriptionInput.value = '';
                isEditing.transaction = false;
                await Promise.all([loadBudgets(), loadTransactions(), updateDashboard()]);
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
          showError('category', 'Cannot delete: Missing components');
          return;
        }
        domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this transaction?';
        domElements.deleteConfirmModal.classList.remove('hidden');
        domElements.deleteConfirmModal.setAttribute('aria-hidden', 'false');
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
                }
              }
              await retryFirestoreOperation(() => deleteDoc(doc(db, 'transactions', id)));
              console.log('deleteTransaction: Transaction deleted', { id });
              await Promise.all([loadBudgets(), loadTransactions(), updateDashboard()]);
              domElements.deleteConfirmModal.classList.add('hidden');
              domElements.deleteConfirmModal.setAttribute('aria-hidden', 'true');
            } else {
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
          domElements.deleteConfirmModal.setAttribute('aria-hidden', 'true');
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
    showError('category', 'Failed to initialize transactions.');
  }
}

/**
 * Loads child accounts and updates UI
 * @returns {Promise<void>}
 */
async function loadChildAccounts() {
  console.log('loadChildAccounts: Starting', { familyCode, accountType: currentAccountType });
  try {
    if (!currentUser || !db || !familyCode) {
      console.error('loadChildAccounts: Missing user, Firestore, or familyCode');
      showError('child-user-id', 'Unable to load child accounts.');
      return;
    }

    const childSelector = document.getElementById('child-selector');
    const childUserIdSelect = document.getElementById('child-user-id');
    if (!childSelector || !childUserIdSelect) {
      console.error('loadChildAccounts: Missing DOM elements');
      showError('child-user-id', 'Child selector not found');
      return;
    }

    if (currentAccountType === 'admin') {
      console.log('loadChildAccounts: Admin mode');
      childSelector.classList.remove('hidden');
      childUserIdSelect.innerHTML = '<option value="">Select a Child</option>';

      const cacheKey = `child_accounts_${familyCode}`;
      const cachedAccounts = localStorage.getItem(cacheKey);
      const CACHE_TTL = 600000;
      if (cachedAccounts) {
        const { accounts, timestamp } = JSON.parse(cachedAccounts);
        if (Date.now() - timestamp < CACHE_TTL) {
          applyChildAccountsData(accounts, childUserIdSelect);
          console.log('loadChildAccounts: Using cached child accounts');
          currentChildUserId = childUserIdSelect.value || null;
          await loadChildTransactions();
          return;
        }
      }

      const snapshot = await retryFirestoreOperation(() =>
        getDocs(query(
          collection(db, 'users'),
          where('familyCode', '==', familyCode),
          where('accountType', '==', 'child')
        ))
      );
      console.log('loadChildAccounts: Child users fetched', { count: snapshot.size });

      const accounts = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        accounts.push({
          id: doc.id,
          email: data.email && data.email.trim() !== '' ? data.email : `Child Account ${doc.id.substring(0, 8)}`
        });
      });

      applyChildAccountsData(accounts, childUserIdSelect);
      localStorage.setItem(cacheKey, JSON.stringify({ accounts, timestamp: Date.now() }));
      currentChildUserId = childUserIdSelect.value || null;
    } else {
      console.log('loadChildAccounts: Non-admin mode');
      childSelector.classList.add('hidden');
      currentChildUserId = currentUser.uid;
    }

    await loadChildTransactions();
  } catch (error) {
    console.error('loadChildAccounts error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('child-user-id', 'Failed to load child accounts.');
    document.getElementById('child-user-id').innerHTML = '<option value="">Error loading children</option>';
  }
}

/**
 * Applies child accounts data to DOM
 * @param {Array} accounts
 * @param {HTMLSelectElement} childUserIdSelect
 */
function applyChildAccountsData(accounts, childUserIdSelect) {
  childUserIdSelect.innerHTML = accounts.length === 0
    ? '<option value="">No children found</option>'
    : '<option value="">Select a Child</option>';
  accounts.forEach(account => {
    const option = document.createElement('option');
    option.value = account.id;
    option.textContent = account.email;
    childUserIdSelect.appendChild(option);
  });
}

/**
 * Loads child transactions and updates UI
 * @returns {Promise<void>}
 */
async function loadChildTransactions() {
  console.log('loadChildTransactions: Starting', { currentChildUserId });
  try {
    if (!db || !currentChildUserId) {
      console.error('loadChildTransactions: Firestore or user ID not available');
      showError('child-transaction-description', 'No user selected');
      document.getElementById('child-transaction-table').innerHTML = '<tr><td colspan="5" class="text-center py-4">No user selected</td></tr>';
      document.getElementById('child-balance').textContent = await formatCurrency(0, 'INR');
      return;
    }

    const childTransactionTable = document.getElementById('child-transaction-table');
    const childBalance = document.getElementById('child-balance');
    const dateHeader = document.getElementById('child-transaction-date-header');
    if (!childTransactionTable || !childBalance || !dateHeader) {
      console.error('loadChildTransactions: Missing DOM elements');
      showError('child-transaction-description', 'Transaction table or balance not found');
      return;
    }

    childTransactionTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading...</td></tr>';

    const { start, end } = getDateRangeWrapper(domElements.dashboardFilter?.value || 'thisMonth');
    const filterMonth = domElements.dashboardFilter?.value !== 'thisMonth'
      ? start.toLocaleString('en-US', { month: 'short' })
      : new Date().toLocaleString('en-US', { month: 'short' });
    dateHeader.textContent = filterMonth;

    const cacheKey = `child_transactions_${currentChildUserId}_${domElements.dashboardFilter?.value || 'thisMonth'}`;
    const cachedTransactions = localStorage.getItem(cacheKey);
    const CACHE_TTL = 600000;
    if (cachedTransactions) {
      const { transactions, balance, timestamp } = JSON.parse(cachedTransactions);
      if (Date.now() - timestamp < CACHE_TTL) {
        applyChildTransactionsData(transactions, childTransactionTable, childBalance, balance);
        console.log('loadChildTransactions: Using cached transactions');
        return;
      }
    }

    const snapshot = await retryFirestoreOperation(() =>
      getDocs(query(collection(db, 'childTransactions'), where('userId', '==', currentChildUserId)))
    );

    let totalBalance = 0;
    const transactions = [];
    snapshot.forEach(doc => {
      const transaction = doc.data();
      const createdAt = transaction.createdAt?.toDate() || new Date();
      if (createdAt >= start && createdAt <= end) {
        transactions.push({ id: doc.id, ...transaction, createdAt });
        totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
      }
    });

    applyChildTransactionsData(transactions, childTransactionTable, childBalance, totalBalance);
    localStorage.setItem(cacheKey, JSON.stringify({ transactions, balance: totalBalance, timestamp: Date.now() }));
  } catch (error) {
    console.error('loadChildTransactions error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('child-transaction-description', 'Failed to load child transactions.');
    document.getElementById('child-transaction-table').innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-600">Error loading transactions</td></tr>';
    document.getElementById('child-balance').textContent = await formatCurrency(0, 'INR');
  }
}

/**
 * Applies child transactions data to DOM
 * @param {Array} transactions
 * @param {HTMLElement} childTransactionTable
 * @param {HTMLElement} childBalance
 * @param {number} totalBalance
 */
async function applyChildTransactionsData(transactions, childTransactionTable, childBalance, totalBalance) {
  childTransactionTable.innerHTML = transactions.length === 0
    ? '<tr><td colspan="5" class="text-center py-4">No transactions found for this period</td></tr>'
    : '';

  transactions.sort((a, b) => b.createdAt - a.createdAt);
  for (const transaction of transactions) {
    const tr = document.createElement('tr');
    tr.classList.add('table-row');
    const day = transaction.createdAt.toLocaleString('en-US', { day: 'numeric' });
    tr.innerHTML = `
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.type || 'Unknown'}</td>
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${await formatCurrency(transaction.amount || 0, 'INR')}</td>
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${transaction.description || ''}</td>
      <td class="w-12 px-4 sm:px-6 py-3 text-left text-xs sm:text-sm text-gray-900">${day}</td>
      <td class="px-4 sm:px-6 py-3 text-left text-xs sm:text-sm">
        <button class="text-blue-600 hover:text-blue-800 mr-2 edit-child-transaction" data-id="${transaction.id}" data-user-id="${transaction.userId}" aria-label="Edit transaction">Edit</button>
        <button class="text-red-600 hover:text-red-800 delete-child-transaction" data-id="${transaction.id}" data-user-id="${transaction.userId}" aria-label="Delete transaction">Delete</button>
      </td>
    `;
    childTransactionTable.appendChild(tr);
  }
  childBalance.textContent = await formatCurrency(totalBalance, 'INR');
  console.log('loadChildTransactions: Table updated', { rendered: transactions.length, totalBalance });
}

/**
 * Loads child account tiles
 * @returns {Promise<void>}
 */
async function loadChildTiles() {
  console.log('loadChildTiles: Starting');
  try {
    if (!db || !familyCode) {
      console.error('loadChildTiles: Firestore or familyCode not available');
      showError('child-tiles', 'No family data');
      return;
    }

    const childTiles = document.getElementById('child-tiles');
    if (!childTiles) {
      console.warn('loadChildTiles: Child tiles element not found');
      return;
    }

    childTiles.innerHTML = '<div class="text-center py-4">Loading...</div>';

    const cacheKey = `child_tiles_${familyCode}`;
    const cachedTiles = localStorage.getItem(cacheKey);
    const CACHE_TTL = 600000;
    if (cachedTiles) {
      const { tiles, timestamp } = JSON.parse(cachedTiles);
      if (Date.now() - timestamp < CACHE_TTL) {
        applyChildTilesData(tiles, childTiles);
        console.log('loadChildTiles: Using cached tiles');
        return;
      }
    }

    const snapshot = await retryFirestoreOperation(() =>
      getDocs(query(collection(db, 'users'), where('familyCode', '==', familyCode), where('accountType', '==', 'child')))
    );

    const tiles = [];
    for (const doc of snapshot.docs) {
      const userId = doc.id;
      const email = doc.data().email && doc.data().email.trim() !== '' ? doc.data().email : `Child Account ${userId.substring(0, 8)}`;
      const balance = await calculateChildBalance(userId);
      tiles.push({ userId, email, balance });
    }

    applyChildTilesData(tiles, childTiles);
    localStorage.setItem(cacheKey, JSON.stringify({ tiles, timestamp: Date.now() }));
  } catch (error) {
    console.error('loadChildTiles error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('child-tiles', 'Failed to load child balances.');
    document.getElementById('child-tiles').innerHTML = '<div class="text-center py-4 text-red-600">Failed to load child balances.</div>';
  }
}

/**
 * Applies child tiles data to DOM
 * @param {Array} tiles
 * @param {HTMLElement} childTiles
 */
async function applyChildTilesData(tiles, childTiles) {
  childTiles.innerHTML = tiles.length === 0
    ? '<div class="text-center py-4">No child accounts found</div>'
    : '';
  for (const { userId, email, balance } of tiles) {
    const tile = document.createElement('div');
    tile.classList.add('bg-white', 'rounded-lg', 'shadow-md', 'p-6', 'child-tile');
    tile.innerHTML = `
      <h3 class="text-lg font-semibold text-gray-700">${email}</h3>
      <p class="text-sm font-semibold text-gray-700 mt-2">Balance: <span id="child-${userId}-balance">${await formatCurrency(balance, 'INR')}</span></p>
    `;
    childTiles.appendChild(tile);
  }
  console.log('loadChildTiles: Tiles updated', { rendered: tiles.length });
}

/**
 * Sets up child account event listeners
 * @returns {Promise<void>}
 */
async function setupChildAccounts() {
  console.log('setupChildAccounts: Starting');
  try {
    const addChildTransaction = document.getElementById('add-child-transaction');
    const childTransactionTable = document.getElementById('child-transaction-table');
    const childUserId = document.getElementById('child-user-id');
    if (!addChildTransaction || !childTransactionTable || !childUserId) {
      console.error('setupChildAccounts: Missing DOM elements');
      showError('child-transaction-description', 'Child transaction form or table not found');
      return;
    }

    const debounce = (func, wait) => {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
      };
    };

    if (!addChildTransaction._listenerBound) {
      const handleAddChildTransaction = debounce(async (event) => {
        event.preventDefault();
        event.stopPropagation();
        console.log('addChildTransaction: Clicked', { isEditing: isEditing.childTransaction });
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
          console.log('addChildTransaction: Transaction added', { txId });
          typeInput.value = 'debit';
          amountInput.value = '';
          descriptionInput.value = '';
          await Promise.all([loadChildTransactions(), loadChildTiles()]);
        } catch (error) {
          console.error('addChildTransaction error:', {
            code: error.code,
            message: error.message,
            stack: error.stack
          });
          showError('child-transaction-description', `Failed to add transaction: ${error.message}`);
        } finally {
          addChildTransaction.disabled = false;
          addChildTransaction.textContent = 'Add Transaction';
        }
      }, 500);
      addChildTransaction.addEventListener('click', handleAddChildTransaction);
      addChildTransaction._listenerBound = true;
    }

    childTransactionTable.addEventListener('click', async (e) => {
      if (e.target.classList.contains('edit-child-transaction')) {
        console.log('editChildTransaction: Clicked', { id: e.target.dataset.id });
        const id = e.target.dataset.id;
        if (!db) {
          showError('child-transaction-description', 'Database service not available');
          return;
        }
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
                  updateDoc(doc(db, 'childTransactions', id), { type, amount, description })
                );
                console.log('editChildTransaction: Transaction updated', { id });
                typeInput.value = 'debit';
                amountInput.value = '';
                descriptionInput.value = '';
                isEditing.childTransaction = false;
                await Promise.all([loadChildTransactions(), loadChildTiles()]);
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
          showError('child-transaction-description', 'Cannot delete: Missing components');
          return;
        }
        domElements.deleteConfirmMessage.textContent = 'Are you sure you want to delete this child transaction?';
        domElements.deleteConfirmModal.classList.remove('hidden');
        domElements.deleteConfirmModal.setAttribute('aria-hidden', 'false');
        const confirmHandler = async () => {
          try {
            await retryFirestoreOperation(() => deleteDoc(doc(db, 'childTransactions', id)));
            console.log('deleteChildTransaction: Transaction deleted', { id });
            await Promise.all([loadChildTransactions(), loadChildTiles()]);
            domElements.deleteConfirmModal.classList.add('hidden');
            domElements.deleteConfirmModal.setAttribute('aria-hidden', 'true');
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
          domElements.deleteConfirmModal.setAttribute('aria-hidden', 'true');
          domElements.cancelDelete.removeEventListener('click', cancelHandler);
        };
        domElements.confirmDelete.addEventListener('click', confirmHandler, { once: true });
        domElements.cancelDelete.addEventListener('click', cancelHandler, { once: true });
      }
    });

    childUserId.addEventListener('change', () => {
      console.log('childUserId: Changed', { value: childUserId.value });
      currentChildUserId = childUserId.value || null;
      if (currentChildUserId) {
        loadChildTransactions();
      } else {
        document.getElementById('child-transaction-table').innerHTML = '<tr><td colspan="5" class="text-center py-4">No child selected</td></tr>';
        document.getElementById('child-balance').textContent = formatCurrency(0, 'INR');
      }
    });
  } catch (error) {
    console.error('setupChildAccounts error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('child-transaction-description', 'Failed to initialize child accounts.');
  }
}

/**
 * Calculates balance for a child user
 * @param {string} userId
 * @returns {Promise<number>}
 */
async function calculateChildBalance(userId) {
  console.log('calculateChildBalance: Starting', { userId });
  try {
    if (!db || !userId) {
      console.error('calculateChildBalance: Firestore or user ID not available');
      return 0;
    }
    let totalBalance = 0;
    const snapshot = await retryFirestoreOperation(() =>
      getDocs(query(collection(db, 'childTransactions'), where('userId', '==', userId)))
    );
    snapshot.forEach(doc => {
      const transaction = doc.data();
      totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
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

/**
 * Updates dashboard UI
 * @returns {Promise<void>}
 */
async function updateDashboard() {
  console.log('updateDashboard: Starting', { accountType: currentAccountType });
  try {
    if (!db || !currentUser) {
      console.error('updateDashboard: Firestore or user not available');
      showError('balance', 'Database service not available');
      return;
    }

    const balanceElement = document.getElementById('balance');
    const afterBudgetElement = document.getElementById('after-budget');
    const totalBudgetElement = document.getElementById('total-budget');
    const totalRemainingElement = document.getElementById('total-remaining');
    const childTilesElement = document.getElementById('child-tiles');
    if (!balanceElement || !afterBudgetElement || !totalBudgetElement || !totalRemainingElement || !childTilesElement) {
      console.error('updateDashboard: Missing DOM elements');
      showError('balance', 'Dashboard elements not found');
      return;
    }

    const cacheKey = `dashboard_${familyCode}_${currentAccountType}`;
    const cachedDashboard = localStorage.getItem(cacheKey);
    const CACHE_TTL = 600000;
    if (cachedDashboard) {
      const { data, timestamp } = JSON.parse(cachedDashboard);
      if (Date.now() - timestamp < CACHE_TTL) {
        applyDashboardData(data, balanceElement, afterBudgetElement, totalBudgetElement, totalRemainingElement, childTilesElement);
        console.log('updateDashboard: Using cached dashboard');
        return;
      }
    }

    const { start, end } = getDateRangeWrapper(domElements.dashboardFilter?.value || 'thisMonth');

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

      const transactionsSnapshot = await retryFirestoreOperation(() =>
        getDocs(query(collection(db, 'transactions'), where('familyCode', '==', familyCode)))
      );
      transactionsSnapshot.forEach(doc => {
        const transaction = doc.data();
        totalBalance += transaction.type === 'credit' ? transaction.amount : -transaction.amount;
      });

      const [categoriesSnapshot, budgetsSnapshot] = await Promise.all([
        retryFirestoreOperation(() => getDocs(query(collection(db, 'categories'), where('familyCode', '==', familyCode)))),
        retryFirestoreOperation(() => getDocs(query(collection(db, 'budgets'), where('familyCode', '==', familyCode))))
      ]);

      const budgetToCategories = new Map();
      categoriesSnapshot.forEach(doc => {
        const category = doc.data();
        if (category.budgetId) {
          if (!budgetToCategories.has(category.budgetId)) {
            budgetToCategories.set(category.budgetId, []);
          }
          budgetToCategories.get(category.budgetId).push(doc.id);
        }
      });

      for (const doc of budgetsSnapshot.docs) {
        const budget = doc.data();
        totalBudgetAmount += budget.amount;
        const categoryIds = budgetToCategories.get(doc.id) || [];
        if (categoryIds.length > 0) {
          const chunks = [];
          for (let i = 0; i < categoryIds.length; i += 30) {
            chunks.push(categoryIds.slice(i, i + 30));
          }
          let debitTotal = 0;
          let creditTotal = 0;
          for (const chunk of chunks) {
            const [debitSnapshot, creditSnapshot] = await Promise.all([
              retryFirestoreOperation(() => getDocs(query(
                collection(db, 'transactions'),
                where('familyCode', '==', familyCode),
                where('categoryId', 'in', chunk),
                where('type', '==', 'debit'),
                where('createdAt', '>=', start),
                where('createdAt', '<=', end)
              ))).catch(() => ({ docs: [] })),
              retryFirestoreOperation(() => getDocs(query(
                collection(db, 'transactions'),
                where('familyCode', '==', familyCode),
                where('categoryId', 'in', chunk),
                where('type', '==', 'credit'),
                where('createdAt', '>=', start),
                where('createdAt', '<=', end)
              ))).catch(() => ({ docs: [] }))
            ]);
            debitTotal += debitSnapshot.docs.reduce((sum, txDoc) => sum + (txDoc.data().amount || 0), 0);
            creditTotal += creditSnapshot.docs.reduce((sum, txDoc) => sum + (txDoc.data().amount || 0), 0);
          }
          totalSpent += debitTotal - creditTotal;
        }
      }

      const data = {
        totalBalance,
        totalBudgetAmount,
        totalSpent,
        afterBudget: totalBalance - (totalBudgetAmount - totalSpent)
      };
      applyDashboardData(data, balanceElement, afterBudgetElement, totalBudgetElement, totalRemainingElement, childTilesElement);
      localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
      await loadBudgets();
      childTilesElement.innerHTML = '';
      await loadChildTiles();
    }
  } catch (error) {
    console.error('updateDashboard error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('balance', 'Failed to update dashboard.');
  }
}

/**
 * Applies dashboard data to DOM
 * @param {Object} data
 * @param {HTMLElement} balanceElement
 * @param {HTMLElement} afterBudgetElement
 * @param {HTMLElement} totalBudgetElement
 * @param {HTMLElement} totalRemainingElement
 * @param {HTMLElement} childTilesElement
 */
async function applyDashboardData(data, balanceElement, afterBudgetElement, totalBudgetElement, totalRemainingElement, childTilesElement) {
  balanceElement.textContent = await formatCurrency(data.totalBalance, 'INR');
  balanceElement.parentElement?.classList.remove('hidden');
  totalBudgetElement.textContent = await formatCurrency(data.totalBudgetAmount, 'INR');
  totalRemainingElement.textContent = await formatCurrency(data.totalBudgetAmount - data.totalSpent, 'INR');
  totalBudgetElement.parentElement?.classList.remove('hidden');
  afterBudgetElement.textContent = await formatCurrency(data.afterBudget, 'INR');
  afterBudgetElement.parentElement?.classList.remove('hidden');
  console.log('updateDashboard: Tiles updated', {
    totalBalance: data.totalBalance,
    totalBudgetAmount: data.totalBudgetAmount,
    totalSpent: data.totalSpent,
    afterBudget: data.afterBudget
  });
}

/**
 * Sets up logout event listener
 * @returns {Promise<void>}
 */
async function setupLogout() {
  console.log('setupLogout: Starting');
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
          showError('page-title', 'Authentication service not available');
          return;
        }
        logoutButton.disabled = true;
        logoutButton.textContent = 'Logging out...';

        let attempts = 0;
        const maxAttempts = 3;
        const baseDelay = 1000;
        while (attempts < maxAttempts) {
          try {
            await signOut(auth);
            console.log('logoutButton: Sign out successful');
            break;
          } catch (error) {
            attempts++;
            console.error('logoutButton: Sign out attempt failed', {
              attempt: attempts,
              code: error.code,
              message: error.message
            });
            if (attempts === maxAttempts) {
              throw new Error('Failed to sign out after max attempts');
            }
            const delay = baseDelay * Math.pow(2, attempts - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }

        currentChildUserId = null;
        currentAccountType = null;
        domElements.authSection?.classList.remove('hidden');
        domElements.appSection?.classList.add('hidden');
        if (domElements.pageTitle) domElements.pageTitle.textContent = 'Login';
        logoutButton.classList.add('hidden');
        const loadingSpinner = document.getElementById('loading-spinner');
        if (loadingSpinner) {
          loadingSpinner.classList.add('hidden');
          loadingSpinner.setAttribute('aria-busy', 'false');
        }
      } catch (error) {
        console.error('logoutButton error:', {
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
  } catch (error) {
    console.error('setupLogout error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('page-title', 'Failed to initialize logout.');
  }
}

// End of Section 3
