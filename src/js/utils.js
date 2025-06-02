// Replaces the entire utils.js file from artifact c2d44821-31ce-4c5f-96b4-963f4eff2711
// Updates resetBudgetsForNewMonth to save historical spending in spendingHistory

import { collection, query, where, getDocs, doc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { showError } from './core.js';

// Retry Firestore Operation
async function retryFirestoreOperation(operation, maxRetries = 3, delay = 1000, operationData = null) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Firestore operation attempt ${attempt}/${maxRetries}`);
      return await operation();
    } catch (error) {
      console.error('Firestore operation failed:', {
        attempt,
        code: error.code,
        message: error.message,
        operationData: operationData ? JSON.stringify(operationData, null, 2) : 'No operation data provided'
      });
      if (attempt === maxRetries || error.code === 'permission-denied') {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Fetch Exchange Rate
async function fetchExchangeRate(fromCurrency, toCurrency, cache = { rate: null, timestamp: null }, CACHE_TTL = 3600000) {
  try {
    const cacheKey = `exchangeRate_${fromCurrency}_${toCurrency}`;
    const cachedData = localStorage.getItem(cacheKey);
    const now = Date.now();

    // Check localStorage cache
    if (cachedData) {
      const { rate, timestamp } = JSON.parse(cachedData);
      if (timestamp && (now - timestamp) < CACHE_TTL) {
        console.log(`Using localStorage cached exchange rate for ${fromCurrency} to ${toCurrency}:`, rate);
        cache.rate = rate;
        cache.timestamp = timestamp;
        return rate;
      }
    }

    // Check in-memory cache
    if (cache.rate && cache.timestamp && (now - cache.timestamp) < CACHE_TTL) {
      console.log(`Using in-memory cached exchange rate for ${fromCurrency} to ${toCurrency}:`, cache.rate);
      return rate;
    }

    console.log(`Fetching exchange rate from API for ${fromCurrency} to ${toCurrency}`);
    const response = await fetch(`https://v6.exchangerate-api.com/v6/18891e972833c8dd062c1283/latest/${fromCurrency}`);
    const data = await response.json();
    if (data.result !== 'success') throw new Error(`Failed to fetch exchange rate for ${fromCurrency} to ${toCurrency}`);
    const rate = data.conversion_rates[toCurrency];
    if (!rate) throw new Error(`Conversion rate for ${toCurrency} not found`);
    cache.rate = rate;
    cache.timestamp = now;
    
    // Store in localStorage
    localStorage.setItem(cacheKey, JSON.stringify({ rate, timestamp: now }));
    console.log(`Exchange rate fetched and cached for ${fromCurrency} to ${toCurrency}:`, rate);
    return rate;
  } catch (error) {
    console.error(`Error fetching exchange rate for ${fromCurrency} to ${toCurrency}:`, error);
    // Fallback rates
    const fallbackRates = {
      'INR_USD': 0.012,
      'INR_ZAR': 0.22,
      'USD_ZAR': 18.0
    };
    const key = `${fromCurrency}_${toCurrency}`;
    const fallbackRate = fallbackRates[key] || 1.0;
    console.warn(`Using fallback rate for ${key}:`, fallbackRate);
    return fallbackRate;
  }
}

// Get Date Range for Filters
function getDateRange(filter, startDateInput, endDateInput) {
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
      const startDate = startDateInput?.value ? new Date(startDateInput.value) : null;
      const endDate = endDateInput?.value ? new Date(endDateInput.value) : null;
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
    case 'allTime':
      start.setTime(0); // Epoch start
      end.setTime(now.getTime());
      end.setHours(23, 59, 59, 999);
      break;
    default:
      start.setTime(0);
      break;
  }
  return { start, end };
}

// Reset Budgets for New Month
async function resetBudgetsForNewMonth(db, familyCode, accountType) {
  console.log('resetBudgetsForNewMonth: Starting', { familyCode, accountType });
  if (!db || !familyCode) {
    console.error('resetBudgetsForNewMonth: Missing db or familyCode', { db: !!db, familyCode });
    return; // Silently return to avoid blocking budget loading
  }
  if (accountType !== 'admin') {
    console.log('resetBudgetsForNewMonth: Non-admin user, skipping reset', { accountType });
    return;
  }

  try {
    const now = new Date();
    const currentMonthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; // e.g., "2025-06"
    const prevMonthYear = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`; // e.g., "2025-05"
    console.log('resetBudgetsForNewMonth: Current month-year', { currentMonthYear, prevMonthYear });

    const budgetsQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
    let snapshot;
    try {
      snapshot = await retryFirestoreOperation(() => getDocs(budgetsQuery));
    } catch (error) {
      console.error('resetBudgetsForNewMonth: Failed to fetch budgets', {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      return; // Avoid throwing to allow budget loading to continue
    }
    console.log('resetBudgetsForNewMonth: Budgets fetched', { count: snapshot.size });

    const updatePromises = [];
    snapshot.forEach(doc => {
      const budget = doc.data();
      if (!budget.name || typeof budget.spent !== 'number') {
        console.warn('resetBudgetsForNewMonth: Invalid budget data, skipping', { budgetId: doc.id, data: budget });
        return;
      }
      // Normalize lastResetMonth format
      let lastResetMonth = budget.lastResetMonth || '1970-01';
      if (typeof lastResetMonth === 'string' && lastResetMonth.match(/^[0-9]{4}-[0-9]{1,2}$/)) {
        const parts = lastResetMonth.split('-');
        lastResetMonth = `${parts[0]}-${parts[1].padStart(2, '0')}`;
      } else {
        console.warn('resetBudgetsForNewMonth: Invalid lastResetMonth format, using default', {
          budgetId: doc.id,
          lastResetMonth
        });
        lastResetMonth = '1970-01';
      }
      console.log('resetBudgetsForNewMonth: Checking budget', { budgetId: doc.id, lastResetMonth, currentMonthYear });

      if (lastResetMonth !== currentMonthYear) {
        console.log('resetBudgetsForNewMonth: Budget needs reset', { budgetId: doc.id, name: budget.name });
        const updateData = {
          fields: {
            spent: { integerValue: 0 },
            lastResetMonth: { stringValue: currentMonthYear },
            spendingHistory: {
              mapValue: {
                fields: budget.spendingHistory?.mapValue?.fields || {},
              }
            }
          }
        };
        // Save current spent to spendingHistory for the previous month
        if (budget.spent > 0 && lastResetMonth !== '1970-01') {
          updateData.fields.spendingHistory.mapValue.fields[lastResetMonth] = { integerValue: budget.spent };
        }
        console.log('resetBudgetsForNewMonth: Preparing REST update', { budgetId: doc.id, updateData });
        const docPath = `budgets/${doc.id}`;
        console.log('resetBudgetsForNewMonth: Document path', { budgetId: doc.id, docPath });
        updatePromises.push(
          retryFirestoreOperation(
            async () => {
              console.log('resetBudgetsForNewMonth: Executing REST PATCH', { budgetId: doc.id });
              const auth = getAuth();
              const user = auth.currentUser;
              if (!user) {
                throw new Error('User not authenticated');
              }
              const token = await user.getIdToken();
              const projectId = db.app.options.projectId;
              const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}?updateMask.fieldPaths=spent&updateMask.fieldPaths=lastResetMonth&updateMask.fieldPaths=spendingHistory`;
              const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(updateData)
              });
              if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`REST API error: ${JSON.stringify(errorData)}`);
              }
              console.log('resetBudgetsForNewMonth: REST PATCH successful', { budgetId: doc.id });
            },
            3,
            1000,
            updateData
          )
        );
      } else {
        console.log('resetBudgetsForNewMonth: Budget already reset this month', { budgetId: doc.id, name: budget.name });
      }
    });

    if (updatePromises.length > 0) {
      console.log('resetBudgetsForNewMonth: Updating budgets', { count: updatePromises.length });
      await Promise.all(updatePromises);
      console.log('resetBudgetsForNewMonth: Budgets reset complete', { updated: updatePromises.length });
    } else {
      console.log('resetBudgetsForNewMonth: No budgets need resetting');
    }
  } catch (error) {
    console.error('resetBudgetsForNewMonth: Error resetting budgets', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('budget-name', `Failed to reset budgets: ${error.message}`);
  }
}

// Generate Family Code
async function generateFamilyCode(db) {
  console.log('generateFamilyCode: Starting');
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 10;

  while (!isUnique && attempts < maxAttempts) {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    console.log('generateFamilyCode: Generated code', { code, attempt: attempts + 1 });

    try {
      const usersQuery = query(collection(db, 'users'), where('familyCode', '==', code));
      const snapshot = await getDocs(usersQuery);
      if (snapshot.empty) {
        isUnique = true;
        console.log('generateFamilyCode: Code is unique', { code });
      } else {
        console.log('generateFamilyCode: Code already in use', { code });
      }
    } catch (error) {
      console.error('generateFamilyCode: Error checking code uniqueness', {
        code: error.code,
        message: error.message
      });
      throw new Error('Failed to validate family code uniqueness');
    }
    attempts++;
  }

  if (!isUnique) {
    throw new Error('Could not generate a unique family code after maximum attempts');
  }

  return code;
}

// Validate Family Code Format
function isValidFamilyCode(code) {
  const regex = /^[A-Z0-9]{6}$/;
  return regex.test(code);
}

// Check Family Code Existence
async function familyCodeExists(db, code) {
  try {
    const usersQuery = query(collection(db, 'users'), where('familyCode', '==', code));
    const snapshot = await getDocs(usersQuery);
    return !snapshot.empty;
  } catch (error) {
    console.error('familyCodeExists: Error checking code existence', {
      code: error.code,
      message: error.message
    });
    throw new Error('Failed to check family code existence');
  }
}

export { retryFirestoreOperation, fetchExchangeRate, getDateRange, resetBudgetsForNewMonth, generateFamilyCode, isValidFamilyCode, familyCodeExists };
