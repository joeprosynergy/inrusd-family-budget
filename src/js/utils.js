// Utilities module: Shared functions for Firestore retries, exchange rates, and date ranges

// Retry Firestore Operation
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

// Fetch Exchange Rate
async function fetchExchangeRate(cache = { rate: null, timestamp: null }, CACHE_TTL = 3600000) {
  try {
    const now = Date.now();
    if (cache.rate && cache.timestamp && (now - cache.timestamp) < CACHE_TTL) {
      console.log('Using cached exchange rate:', cache.rate);
      return cache.rate;
    }
    console.log('Fetching exchange rate from API');
    const response = await fetch('https://v6.exchangerate-api.com/v6/18891e972833c8dd062c1283/latest/INR');
    const data = await response.json();
    if (data.result !== 'success') throw new Error('Failed to fetch exchange rate');
    const rate = data.conversion_rates.USD;
    cache.rate = rate;
    cache.timestamp = now;
    console.log('Exchange rate fetched:', rate);
    return rate;
  } catch (error) {
    console.error('Error fetching exchange rate:', error);
    return 0.012; // Fallback rate
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
    default:
      start.setTime(0);
      break;
  }
  return { start, end };
}

export { retryFirestoreOperation, fetchExchangeRate, getDateRange };
