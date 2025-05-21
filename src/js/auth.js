import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { showError, clearErrors } from './core.js';

export function setupAuth() {
  console.log('setupAuth: Starting');
  const auth = getAuth();
  const db = getFirestore();

  // Helper to log DOM element status
  function checkElement(id) {
    const element = document.getElementById(id);
    console.log(`Checking element ${id}: ${element ? 'found' : 'not found'}`);
    return element;
  }

  // Login button
  const loginButton = checkElement('login-button');
  if (loginButton) {
    loginButton.addEventListener('click', async () => {
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
    });
  } else {
    console.error('Cannot setup login: login-button missing');
  }

  // Signup button
  const signupButton = checkElement('signup-button');
  if (signupButton) {
    signupButton.addEventListener('click', async () => {
      console.log('Signup button clicked');
      clearErrors();
      const email = document.getElementById('signup-email')?.value;
      const password = document.getElementById('signup-password')?.value;
      const confirmPassword = document.getElementById('signup-confirm-password')?.value;
      const familyCode = document.getElementById('signup-family-code')?.value;
      const currency = document.getElementById('signup-currency')?.value;
      const accountType = document.getElementById('signup-account-type')?.value;
      if (!email || !password || !confirmPassword || !familyCode || !currency || !accountType) {
        console.log('Missing signup fields');
        showError('signup-email', 'Please fill in all fields');
        return;
      }
      if (password !== confirmPassword) {
        console.log('Passwords do not match');
        showError('signup-password', 'Passwords do not match');
        return;
      }
      try {
        console.log('Attempting createUserWithEmailAndPassword');
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        console.log('Signup successful:', userCredential.user.uid);
        console.log('Creating user document');
        await setDoc(doc(db, 'users', userCredential.user.uid), {
          email,
          familyCode,
          currency,
          accountType
        });
        console.log('User document created');
      } catch (error) {
        console.error('Signup failed:', {
          code: error.code,
          message: error.message
        });
        showError('signup-email', error.message);
      }
    });
  } else {
    console.error('Cannot setup signup: signup-button missing');
  }

  // Reset button
  const resetButton = checkElement('reset-button');
  if (resetButton) {
    resetButton.addEventListener('click', async () => {
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
    });
  } else {
    console.error('Cannot setup reset: reset-button missing');
  }

  console.log('setupAuth: Complete');
}
