// auth.js
import { showError, clearErrors, setUserCurrency, setFamilyCode } from './core.js';
import { generateFamilyCode, isValidFamilyCode, familyCodeExists, retryFirestoreOperation } from './utils.js';

let isSetup = false;
const DEBOUNCE_MS = 500; // Debounce delay for form submissions

/**
 * Validates email format
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Debounces a function
 * @param {Function} func
 * @param {number} wait
 * @returns {Function}
 */
function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Sets up authentication event listeners
 * @param {Function} loadAppDataCallback
 */
export async function setupAuth(loadAppDataCallback) {
  if (isSetup) {
    console.log('setupAuth: Already initialized, skipping');
    return;
  }
  isSetup = true;
  console.log('setupAuth: Starting');

  const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } = await import('firebase/auth');
  const { getFirestore, doc, setDoc, serverTimestamp } = await import('firebase/firestore');
  const auth = getAuth();
  const db = getFirestore();

  // Helper to log and get DOM element
  function checkElement(id) {
    const element = document.getElementById(id);
    console.log(`Checking element ${id}: ${element ? 'found' : 'not found'}`);
    return element;
  }

  // Toggle family code input based on account type
  const accountTypeSelect = checkElement('signup-account-type');
  const familyCodeOption = checkElement('admin-family-code-option');
  accountTypeSelect?.addEventListener('change', () => {
    console.log('signup-account-type: Changed', { value: accountTypeSelect.value });
    const familyCodeInput = checkElement('signup-family-code');
    if (accountTypeSelect.value === 'child') {
      familyCodeOption.classList.add('hidden');
      familyCodeInput.setAttribute('required', 'true');
      familyCodeInput.placeholder = 'Enter existing 6-digit alphanumeric Family Code';
    } else {
      familyCodeOption.classList.remove('hidden');
      familyCodeInput.removeAttribute('required');
      familyCodeInput.placeholder = '6-digit alphanumeric Family Code (optional)';
    }
  });

  // Login handler
  const loginForm = checkElement('login-form');
  const loginButton = checkElement('login-button');
  if (loginButton) {
    const handleLogin = debounce(async (event) => {
      event.preventDefault(); // Prevent default behavior (form submit or button click)
      console.log(loginForm ? 'Login form submitted' : 'Login button clicked');
      clearErrors();
      const email = checkElement('login-email')?.value.trim();
      const password = checkElement('login-password')?.value;
      if (!email || !password) {
        showError('login-email', 'Please enter email and password');
        return;
      }
      if (!isValidEmail(email)) {
        showError('login-email', 'Invalid email format');
        return;
      }
      try {
        loginButton.disabled = true;
        loginButton.textContent = 'Logging in...';
        await signInWithEmailAndPassword(auth, email, password);
        console.log('Login successful');
      } catch (error) {
        console.error('Login failed:', { code: error.code, message: error.message });
        const errorMessages = {
          'auth/user-not-found': 'No user found with this email',
          'auth/wrong-password': 'Incorrect password',
          'auth/invalid-email': 'Invalid email format',
          'auth/too-many-requests': 'Too many attempts, try again later'
        };
        showError('login-email', errorMessages[error.code] || error.message);
      } finally {
        loginButton.disabled = false;
        loginButton.textContent = 'Login';
      }
    }, DEBOUNCE_MS);

    if (loginForm) {
      console.log('Attaching login handler to login-form submit');
      loginForm.addEventListener('submit', handleLogin);
    } else {
      console.log('No login-form found, attaching login handler to login-button click');
      loginButton.addEventListener('click', handleLogin);
    }
  } else {
    console.error('Cannot setup login: login-button missing');
  }

  // Signup handler
  const signupButton = checkElement('signup-button');
  if (signupButton) {
    const handleSignup = debounce(async () => {
      console.log('Signup button clicked');
      clearErrors();
      const email = checkElement('signup-email')?.value.trim();
      const password = checkElement('signup-password')?.value;
      const confirmPassword = checkElement('signup-confirm-password')?.value;
      const familyCodeInputRaw = checkElement('signup-family-code')?.value || '';
      const familyCodeInput = familyCodeInputRaw.trim().toUpperCase();
      const currency = checkElement('signup-currency')?.value;
      const accountType = checkElement('signup-account-type')?.value;
      const useExisting = checkElement('use-existing-family-code')?.checked ?? false;

      console.log('Signup inputs:', { email, currency, accountType, familyCode: familyCodeInput, useExisting });

      // Validate inputs
      if (!isValidEmail(email)) {
        showError('signup-email', 'Valid email is required');
        return;
      }
      if (!password || password.length < 6) {
        showError('signup-password', 'Password must be at least 6 characters');
        return;
      }
      if (password !== confirmPassword) {
        showError('signup-confirm-password', 'Passwords do not match');
        return;
      }
      if (!['INR', 'USD', 'ZAR'].includes(currency)) {
        showError('signup-currency', 'Valid currency is required');
        return;
      }
      if (!['admin', 'child'].includes(accountType)) {
        showError('signup-account-type', 'Valid account type is required');
        return;
      }

      let userCredential;
      try {
        signupButton.disabled = true;
        signupButton.textContent = 'Signing up...';
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
        console.log('Signup successful:', userCredential.user.uid);
      } catch (error) {
        console.error('Signup failed:', { code: error.code, message: error.message });
        const errorMessages = {
          'auth/email-already-in-use': 'This email is already in use',
          'auth/invalid-email': 'Invalid email format',
          'auth/weak-password': 'Password is too weak'
        };
        showError('signup-email', errorMessages[error.code] || error.message);
        signupButton.disabled = false;
        signupButton.textContent = 'Sign Up';
        return;
      }

      // Validate family code
      let finalFamilyCode;
      try {
        if (accountType === 'child') {
          if (!familyCodeInput) {
            showError('signup-family-code', 'Family code is required for child accounts');
            throw new Error('Missing family code');
          }
          if (!isValidFamilyCode(familyCodeInput)) {
            showError('signup-family-code', 'Family code must be 6 uppercase alphanumeric characters (A-Z, 0-9)');
            throw new Error('Invalid family code format');
          }
          const exists = await retryFirestoreOperation(() => familyCodeExists(db, familyCodeInput));
          if (!exists) {
            showError('signup-family-code', 'Family code does not exist');
            throw new Error('Family code does not exist');
          }
          finalFamilyCode = familyCodeInput;
        } else {
          if (useExisting && familyCodeInput) {
            if (!isValidFamilyCode(familyCodeInput)) {
              showError('signup-family-code', 'Family code must be 6 uppercase alphanumeric characters (A-Z, 0-9)');
              throw new Error('Invalid family code format');
            }
            const exists = await retryFirestoreOperation(() => familyCodeExists(db, familyCodeInput));
            if (!exists) {
              showError('signup-family-code', 'Family code does not exist');
              throw new Error('Family code does not exist');
            }
            finalFamilyCode = familyCodeInput;
          } else {
            finalFamilyCode = await retryFirestoreOperation(() => generateFamilyCode(db));
          }
        }

        // Create user document
        await setDoc(doc(db, 'users', userCredential.user.uid), {
          email,
          familyCode: finalFamilyCode,
          currency,
          accountType,
          createdAt: serverTimestamp()
        });
        console.log('User document created:', { uid: userCredential.user.uid, familyCode: finalFamilyCode });

        // Update app state
        setUserCurrency(currency);
        setFamilyCode(finalFamilyCode);
        checkElement('signup-email').value = '';
        checkElement('signup-password').value = '';
        checkElement('signup-confirm-password').value = '';
        checkElement('signup-family-code').value = '';
        checkElement('signup-currency').value = 'INR';
        checkElement('signup-account-type').value = 'admin';
        checkElement('use-existing-family-code').checked = false;
        checkElement('signup-modal').classList.add('hidden');
        checkElement('auth-section').classList.add('hidden');
        checkElement('app-section').classList.remove('hidden');
        checkElement('page-title').textContent = 'Budget Dashboard';
        checkElement('login-modal').focus(); // Accessibility: focus on login modal
        await loadAppDataCallback();
      } catch (error) {
        console.error('Post-signup error:', { code: error.code, message: error.message });
        showError('signup-family-code', error.message || 'Failed to complete signup');
        try {
          await userCredential.user.delete();
          console.log('Deleted incomplete user:', userCredential.user.uid);
        } catch (deleteError) {
          console.error('Failed to delete incomplete user:', { code: deleteError.code, message: deleteError.message });
        }
      } finally {
        signupButton.disabled = false;
        signupButton.textContent = 'Sign Up';
      }
    }, DEBOUNCE_MS);
    signupButton.addEventListener('click', handleSignup);
  } else {
    console.error('Cannot setup signup: signup-button missing');
  }

  // Reset handler
  const resetButton = checkElement('reset-button');
  if (resetButton) {
    const handleReset = debounce(async () => {
      console.log('Reset button clicked');
      clearErrors();
      const email = checkElement('reset-email')?.value.trim();
      if (!email) {
        showError('reset-email', 'Please enter an email');
        return;
      }
      if (!isValidEmail(email)) {
        showError('reset-email', 'Invalid email format');
        return;
      }
      try {
        await sendPasswordResetEmail(auth, email);
        showError('reset-email', 'Password reset email sent', false);
      } catch (error) {
        console.error('Password reset failed:', { code: error.code, message: error.message });
        const errorMessages = {
          'auth/user-not-found': 'No user found with this email',
          'auth/invalid-email': 'Invalid email format'
        };
        showError('reset-email', errorMessages[error.code] || error.message);
      }
    }, DEBOUNCE_MS);
    resetButton.addEventListener('click', handleReset);
  } else {
    console.error('Cannot setup reset: reset-button missing');
  }

  // Modal toggling event listeners (for updated index.html)
  const showSignupBtn = checkElement('show-signup-btn');
  showSignupBtn?.addEventListener('click', () => {
    checkElement('signup-modal').classList.remove('hidden');
    checkElement('login-modal').classList.add('hidden');
    checkElement('signup-email').focus(); // Accessibility
  });

  const showResetBtn = checkElement('show-reset-btn');
  showResetBtn?.addEventListener('click', () => {
    checkElement('reset-modal').classList.remove('hidden');
    checkElement('login-modal').classList.add('hidden');
    checkElement('reset-email').focus(); // Accessibility
  });

  const showLoginFromSignupBtn = checkElement('show-login-from-signup-btn');
  showLoginFromSignupBtn?.addEventListener('click', () => {
    checkElement('login-modal').classList.remove('hidden');
    checkElement('signup-modal').classList.add('hidden');
    checkElement('login-email').focus(); // Accessibility
  });

  const showLoginFromResetBtn = checkElement('show-login-from-reset-btn');
  showLoginFromResetBtn?.addEventListener('click', () => {
    checkElement('login-modal').classList.remove('hidden');
    checkElement('reset-modal').classList.add('hidden');
    checkElement('login-email').focus(); // Accessibility
  });

  console.log('setupAuth: Complete');
}
