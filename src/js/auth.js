import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { showError, clearErrors, setUserCurrency, setFamilyCode, domElements } from './core.js';
import { generateFamilyCode, isValidFamilyCode, familyCodeExists } from './utils.js';

let isSetup = false;

export function setupAuth(loadAppDataCallback) {
  if (isSetup) {
    console.log('setupAuth: Already initialized, skipping');
    return;
  }
  isSetup = true;
  console.log('setupAuth: Starting');
  const auth = getAuth();
  const db = getFirestore();

  // Helper to log DOM element status
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
    if (accountTypeSelect.value === 'child') {
      familyCodeOption.classList.add('hidden');
      document.getElementById('signup-family-code').setAttribute('required', 'true');
      document.getElementById('signup-family-code').placeholder = 'Enter existing 6-digit alphanumeric Family Code';
    } else {
      familyCodeOption.classList.remove('hidden');
      document.getElementById('signup-family-code').removeAttribute('required');
      document.getElementById('signup-family-code').placeholder = '6-digit alphanumeric Family Code (optional)';
    }
  });

  // Login button
  const loginButton = checkElement('login-button');
  if (loginButton) {
    loginButton.removeEventListener('click', handleLogin); // Prevent duplicates
    loginButton.addEventListener('click', handleLogin);
    async function handleLogin() {
      console.log('Login button clicked');
      clearErrors();
      const email = document.getElementById('login-email')?.value;
      const password = document.getElementById('login-password')?.value;
      if (!email || !password) {
        console.log('Missing email or password');
        showError('login-email', 'Please enter email and password');
        return;
      }
      try {
        console.log('Attempting signInWithEmailAndPassword');
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        console.log('Login successful:', userCredential.user.uid);
      } catch (error) {
        console.error('Login failed:', {
          code: error.code,
          message: error.message
        });
        showError('login-email', error.message);
      }
    }
  } else {
    console.error('Cannot setup login: login-button missing');
  }

  // Signup button
  const signupButton = checkElement('signup-button');
  if (signupButton) {
    signupButton.removeEventListener('click', handleSignup); // Prevent duplicates
    signupButton.addEventListener('click', handleSignup);
    async function handleSignup() {
      console.log('Signup button clicked');
      clearErrors();
      const email = document.getElementById('signup-email')?.value.trim();
      const password = document.getElementById('signup-password')?.value;
      const confirmPassword = document.getElementById('signup-confirm-password')?.value;
      const familyCodeInput = document.getElementById('signup-family-code')?.value.trim();
      const currency = document.getElementById('signup-currency')?.value;
      const accountType = document.getElementById('signup-account-type')?.value;
      const useExisting = document.getElementById('use-existing-family-code')?.checked;

      console.log('Signup inputs:', { email, currency, accountType, familyCode: familyCodeInput, useExisting });

      // Validate inputs
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
      if (!currency || !['INR', 'USD'].includes(currency)) {
        showError('signup-currency', 'Valid currency is required');
        return;
      }
      if (!accountType || !['admin', 'child'].includes(accountType)) {
        showError('signup-account-type', 'Valid account type is required');
        return;
      }

      let finalFamilyCode = familyCodeInput;
      if (accountType === 'child') {
        if (!familyCodeInput) {
          showError('signup-family-code', 'Family code is required for child accounts');
          return;
        }
        if (!isValidFamilyCode(familyCodeInput)) {
          showError('signup-family-code', 'Family code must be 6 alphanumeric characters');
          return;
        }
        try {
          const exists = await familyCodeExists(db, familyCodeInput);
          if (!exists) {
            showError('signup-family-code', 'Family code does not exist');
            return;
          }
        } catch (error) {
          showError('signup-family-code', 'Failed to validate family code');
          return;
        }
      } else {
        if (useExisting && familyCodeInput) {
          if (!isValidFamilyCode(familyCodeInput)) {
            showError('signup-family-code', 'Family code must be 6 alphanumeric characters');
            return;
          }
          try {
            const exists = await familyCodeExists(db, familyCodeInput);
            if (exists) {
              showError('signup-family-code', 'Family code already in use');
              return;
            }
          } catch (error) {
            showError('signup-family-code', 'Failed to validate family code');
            return;
          }
        } else if (!familyCodeInput) {
          try {
            finalFamilyCode = await generateFamilyCode(db);
            console.log('Generated family code:', finalFamilyCode);
          } catch (error) {
            showError('signup-family-code', error.message);
            return;
          }
        } else {
          if (!isValidFamilyCode(familyCodeInput)) {
            showError('signup-family-code', 'Family code must be 6 alphanumeric characters');
            return;
          }
          try {
            const exists = await familyCodeExists(db, familyCodeInput);
            if (exists) {
              showError('signup-family-code', 'Family code already in use');
              return;
            }
          } catch (error) {
            showError('signup-family-code', 'Failed to validate family code');
            return;
          }
        }
      }

      try {
        signupButton.disabled = true;
        signupButton.textContent = 'Signing up...';
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        console.log('Signup successful:', userCredential.user.uid);
        await setDoc(doc(db, 'users', userCredential.user.uid), {
          email,
          familyCode: finalFamilyCode,
          currency,
          accountType,
          createdAt: serverTimestamp()
        });
        console.log('User document created:', { uid: userCredential.user.uid, familyCode: finalFamilyCode });
        setUserCurrency(currency);
        setFamilyCode(finalFamilyCode);
        document.getElementById('signup-email').value = '';
        document.getElementById('signup-password').value = '';
        document.getElementById('signup-confirm-password').value = '';
        document.getElementById('signup-family-code').value = '';
        document.getElementById('signup-currency').value = 'INR';
        document.getElementById('signup-account-type').value = 'admin';
        document.getElementById('use-existing-family-code').checked = false;
        document.getElementById('signup-modal').classList.add('hidden');
        document.getElementById('auth-section').classList.add('hidden');
        document.getElementById('app-section').classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Budget Dashboard';
        await loadAppDataCallback();
      } catch (error) {
        console.error('Signup failed:', {
          code: error.code,
          message: error.message
        });
        let errorMessage = error.message || 'Failed to sign up.';
        if (error.code === 'auth/email-already-in-use') {
          errorMessage = 'This email is already in use.';
        } else if (error.code === 'auth/invalid-email') {
          errorMessage = 'Invalid email format.';
        }
        showError('signup-email', errorMessage);
      } finally {
        signupButton.disabled = false;
        signupButton.textContent = 'Sign Up';
      }
    }
  } else {
    console.error('Cannot setup signup: signup-button missing');
  }

  // Reset button
  const resetButton = checkElement('reset-button');
  if (resetButton) {
    resetButton.removeEventListener('click', handleReset); // Prevent duplicates
    resetButton.addEventListener('click', handleReset);
    async function handleReset() {
      console.log('Reset button clicked');
      clearErrors();
      const email = document.getElementById('reset-email')?.value;
      if (!email) {
        console.log('Missing reset email');
        showError('reset-email', 'Please enter an email');
        return;
      }
      try {
        console.log('Attempting sendPasswordResetEmail');
        await sendPasswordResetEmail(auth, email);
        console.log('Password reset email sent');
        showError('reset-email', 'Password reset email sent', false);
      } catch (error) {
        console.error('Password reset failed:', {
          code: error.code,
          message: error.message
        });
        showError('reset-email', error.message);
      }
    }
  } else {
    console.error('Cannot setup reset: reset-button missing');
  }

  console.log('setupAuth: Complete');
}
