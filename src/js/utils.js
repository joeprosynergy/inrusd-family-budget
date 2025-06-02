// utils.js
import { collection, query, where, getDocs, doc, updateDoc, batch } from 'firebase/firestore';
import { showError } from './core.js';

/**
 * Retries a Firestore operation
 * @param {Function} operation
 * @param {number} maxRetries
 * @param {number} baseDelay
 * @param {any} operationData
 * @returns {Promise<any>}
 */
async function retryFirestoreOperation(operation, maxRetries = 3, baseDelay = 1000, operationData = null) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Firestore operation attempt ${attempt}/${maxRetries}`);
      return await operation();
    } catch (error) {
      console.error('Firestore operation failed:', {
        attempt,
        code: error.code,
        message: error.message,
        operationData: operationData ? JSON.stringify(operationData, null, 2) : 'No operation data'
      });
      if (attempt === maxRetries || error.code === 'permission-denied') {
        throw error;
      }
      const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Fetches exchange rate
 * @param {string} fromCurrency
 * @param {string} toCurrency
 * @param {{ rate: number | null, timestamp: number | null }} cache
 * @param {number} CACHE_TTL
 * @returns {Promise<number>}
 */
async function fetchExchangeRate(fromCurrency, toCurrency, cache = { rate: null, timestamp: null }, CACHE_TTL = 3600000) {
  const cacheKey = `exchangeRate_${fromCurrency}_${toCurrency}`;
  const now = Date.now();

  // Check localStorage cache
  const cachedData = localStorage.getItem(cacheKey);
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
    return cache.rate;
  }

  // Fetch from API with retry
  let attempts = 0;
  const maxAttempts = 3;
  while (attempts < maxAttempts) {
    attempts++;
    try {
      console.log(`Fetching exchange rate attempt ${attempts}/${maxAttempts} for ${fromCurrency} to ${toCurrency}`);
      const response = await fetch(`https://v6.exchangerate-api.com/v6/18891e972833c8dd062c1283/latest/${fromCurrency}`);
      const data = await response.json();
      if (data.result !== 'success' || !data.conversion_rates?.[toCurrency]) {
        throw new Error(`Invalid API response for ${fromCurrency} to ${toCurrency}`);
      }
      const rate = data.conversion_rates[toCurrency];
      cache.rate = rate;
      cache.timestamp = now;
      localStorage.setItem(cacheKey, JSON.stringify({ rate, timestamp: now }));
      console.log(`Exchange rate fetched:`, rate);
      return rate;
    } catch (error) {
      console.error(`Exchange rate fetch failed:`, error.message);
      if (attempts === maxAttempts) {
        const fallbackRates = { INR_USD: 0.012, INR_ZAR: 0.22, USD_ZAR: 18.0 };
        const key = `${fromCurrency}_${toCurrency}`;
        const fallbackRate = fallbackRates[key] || 1.0;
        console.warn(`Using fallback rate for ${key}:`, fallbackRate);
        return fallbackRate;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Gets date range for filters
 * @param {string} filter
 * @param {HTMLInputElement | null} startDateInput
 * @param {HTMLInputElement | null} endDateInput
 * @returns {{ start: Date, end: Date }}
 */
function getDateRange(filter, startDateInput, endDateInput) {
  const now = new Date();
  const start = new Date();
  const end = new Date();

  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(23, 59, 59, 999);

  switch (filter) {
    case '1week':
      start.setUTCDate(now.getUTCDate() - 7);
      break;
    case '1month':
      start.setUTCMonth(now.getUTCMonth() - 1);
      break;
    case 'thisMonth':
      start.setUTCDate(1);
      end.setUTCMonth(now.getUTCMonth() + 1);
      end.setUTCDate(0);
      break;
    case 'lastMonth':
      start.setUTCMonth(now.getUTCMonth() - 1);
      start.setUTCDate(1);
      end.setUTCMonth(now.getUTCMonth());
      end.setUTCDate(0);
      break;
    case 'thisYear':
      start.setUTCMonth(0);
      start.setUTCDate(1);
      end.setUTCMonth(11);
      end.setUTCDate(31);
      break;
    case 'lastYear':
      start.setUTCFullYear(now.getUTCFullYear() - 1);
      start.setUTCMonth(0);
      start.setUTCDate(1);
      end.setUTCFullYear(now.getUTCFullYear() - 1);
      end.setUTCMonth(11);
      end.setUTCDate(31);
      break;
    case 'custom':
      const startDate = startDateInput?.value ? new Date(startDateInput.value) : null;
      const endDate = endDateInput?.value ? new Date(endDateInput.value) : null;
      if (startDate && endDate && startDate <= endDate && !isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
        start.setTime(startDate.getTime());
        start.setUTCHours(0, 0, 0, 0);
        end.setTime(endDate.getTime());
        end.setUTCHours(23, 59, 59, 999);
      } else {
        console.warn('Invalid custom date range; using all time');
        start.setTime(0);
      }
      break;
    case 'allTime':
      start.setTime(0);
      end.setTime(now.getTime());
      break;
    default:
      start.setTime(0);
      break;
  }
  return { start, end };
}

/**
 * Resets budgets for new month
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} familyCode
 * @param {string} accountType
 */
async function resetBudgetsForNewMonth(db, familyCode, accountType) {
  console.log('resetBudgetsForNewMonth: Starting', { familyCode, accountType });
  if (!db || !familyCode) {
    console.error('resetBudgetsForNewMonth: Missing db or familyCode', { db: !!db, familyCode });
    return;
  }
  if (accountType !== 'admin') {
    console.log('resetBudgetsForNewMonth: Non-admin user, skipping reset', { accountType });
    return;
  }

  try {
    const now = new Date();
    const currentMonthYear = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const prevMonthYear = `${now.getUTCFullYear()}-${String(now.getUTCMonth()).padStart(2, '0')}`;
    console.log('resetBudgetsForNewMonth: Month check', { currentMonthYear, prevMonthYear });

    const budgetsQuery = query(collection(db, 'budgets'), where('familyCode', '==', familyCode));
    const snapshot = await retryFirestoreOperation(() => getDocs(budgetsQuery));
    console.log('resetBudgetsForNewMonth: Budgets fetched', { count: snapshot.size });

    const batch = db.batch();
    let updateCount = 0;

    for (const docSnap of snapshot.docs) {
      const budget = docSnap.data();
      if (!budget.name || typeof budget.spent !== 'number') {
        console.warn('resetBudgetsForNewMonth: Invalid budget data', { budgetId: docSnap.id });
        continue;
      }
      let lastResetMonth = budget.lastResetMonth || '1970-01';
      if (lastResetMonth.match(/^[0-9]{4}-[0-9]{1,2}$/)) {
        const parts = lastResetMonth.split('-');
        lastResetMonth = `${parts[0]}-${parts[1].padStart(2, '0')}`;
      } else {
        lastResetMonth = '1970-01';
      }

      if (lastResetMonth !== currentMonthYear) {
        const budgetRef = doc(db, 'budgets', docSnap.id);
        const spendingHistory = budget.spendingHistory?.mapValue?.fields || {};
        if (budget.spent > 0 && lastResetMonth !== '1970-01') {
          spendingHistory[prevMonthYear] = { integerValue: budget.spent };
        }
        batch.update(budgetRef, {
          spent: 0,
          lastResetMonth: currentMonthYear,
          spendingHistory
        });
        updateCount++;
        console.log('resetBudgetsForNewMonth: Queued update', { budgetId: docSnap.id });
      }
    }

    if (updateCount > 0) {
      await retryFirestoreOperation(() => batch.commit());
      console.log('resetBudgetsForNewMonth: Batch update complete', { updated: updateCount });
    } else {
      console.log('resetBudgetsForNewMonth: No budgets need resetting');
    }
  } catch (error) {
    console.error('resetBudgetsForNewMonth: Error', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    showError('budget-name', `Failed to reset budgets: ${error.message}`);
  }
}

/**
 * Generates unique family code
 * @param {import('firebase/firestore').Firestore} db
 * @returns {Promise<string>}
 */
async function generateFamilyCode(db) {
  console.log('generateFamilyCode: Starting');
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 10;

  while (!isUnique && attempts < maxAttempts) {
    code = Array.from({ length: 6 }, () => characters.charAt(Math.floor(Math.random() * characters.length))).join('');
    console.log('generateFamilyCode: Generated code', { code, attempt: attempts + 1 });

    const usersQuery = query(collection(db, 'users'), where('familyCode', '==', code));
    const snapshot = await retryFirestoreOperation(() => getDocs(usersQuery));
    if (snapshot.empty) {
      isUnique = true;
      console.log('generateFamilyCode: Code is unique', { code });
    }
    attempts++;
  }

  if (!isUnique) {
    throw new Error('Could not generate a unique family code');
  }
  return code;
}

/**
 * Validates family code format
 * @param {string} code
 * @returns {boolean}
 */
function isValidFamilyCode(code) {
  return /^[A-Z0-9]{6}$/.test(code);
}

/**
 * Checks if family code exists
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} code
 * @returns {Promise<boolean>}
 */
async function familyCodeExists(db, code) {
  if (!isValidFamilyCode(code)) {
    throw new Error('Invalid family code format');
  }
  const usersQuery = query(collection(db, 'users'), where('familyCode', '==', code));
  const snapshot = await retryFirestoreOperation(() => getDocs(usersQuery));
  return !snapshot.empty;
}

export { retryFirestoreOperation, fetchExchangeRate, getDateRange, resetBudgetsForNewMonth, generateFamilyCode, isValidFamilyCode, familyCodeExists };
