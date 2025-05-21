// Utils module: Shared utility functions for Firestore retries and exchange rate fetching

// Retry Firestore Operation
async function retryFirestoreOperation(operation, maxRetries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Firestore operation attempt ${attempt}/${maxRetries}`);
      return await operation();
    } catch (error) {
      console.error('Firestore operation failed:', {
        attempt,
        code: error.code,
        message: error.message
      });
      if (attempt === maxRetries || error.code === 'permission-denied') {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Exchange Rate Cache
let exchangeRateCache = {
  rate: null,
  timestamp: null
};
const CACHE_TTL = 3600000; // 1 hour in milliseconds

// Fetch Exchange Rate
async function fetchExchangeRate() {
  try {
    const now = Date.now();
    if (exchangeRateCache.rate && exchangeRateCache.timestamp && (now - exchangeRateCache.timestamp) < CACHE_TTL) {
      console.log('Using cached exchange rate:', exchangeRateCache.rate);
      return exchangeRateCache.rate;
    }
    console.log('Fetching exchange rate from API');
    const response = await fetch('https://v6.exchangerate-api.com/v6/18891e972833c8dd062c1283/latest/INR');
    const data = await response.json();
    if (data.result !== 'success') {
      throw new Error('Failed to fetch exchange rate');
    }
    const rate = data.conversion_rates.USD;
    exchangeRateCache = { rate, timestamp: now };
    console.log('Exchange rate fetched:', rate);
    return rate;
  } catch (error) {
    console.error('Error fetching exchange rate:', {
      message: error.message,
      stack: error.stack
    });
    return 0.012; // Fallback rate (approx INR to USD as of May 2025)
  }
}

export { retryFirestoreOperation, fetchExchangeRate, exchangeRateCache };
