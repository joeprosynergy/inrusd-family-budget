import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { showError, clearErrors } from './core.js';

export function setupAuth() {
  console.log('Setting up auth event listeners');
  const auth = getAuth();
  const db = getFirestore();

  // Login button
  const loginButton = document.getElementById('login-button');
  if (!loginButton) {
    console.error('Login button not found');
    return;
  }
  loginButton.addEventListener('click', async () => {
    console.log('Login button clicked');
    clearErrors();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    if (!email || !password) {
      showError('login-email', 'Please enter email and password');
      return;
    }
    try {
      console.log('Attempting signInWithEmailAndPassword');
      await signInWithEmailAndPassword(auth, email, password);
      console.log('Login successful');
    } catch (error) {
      console.error('Login failed:', error.message);
      showError('login-email', error.message);
    }
  });

  // Signup button
  const signupButton = document.getElementById('signup-button');
  if (!signupButton) {
    console.error('Signup button not found');
    return;
  }
  signupButton.addEventListener('click', async () => {
    console.log('Signup button clicked');
    clearErrors();
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;
    const familyCode = document.getElementById('signup-family-code').value;
    const currency = document.getElementById('signup-currency').value;
    const accountType = document.getElementById('signup-account-type').value;
    if (!email || !password || !confirmPassword || !familyCode || !currency || !accountType) {
      showError('signup-email', 'Please fill in all fields');
      return;
    }
    if (password !== confirmPassword) {
      showError('signup-password', 'Passwords do not match');
      return;
    }
    try {
      console.log('Attempting createUserWithEmailAndPassword');
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      console.log('Signup successful, creating user document');
      await setDoc(doc(db, 'users', userCredential.user.uid), {
        email,
        familyCode,
        currency,
        accountType
      });
      console.log('User document created');
    } catch (error) {
      console.error('Signup failed:', error.message);
      showError('signup-email', error.message);
    }
  });

  // Reset button
  const resetButton = document.getElementById('reset-button');
  if (!resetButton) {
    console.error('Reset button not found');
    return;
  }
  resetButton.addEventListener('click', async () => {
    console.log('Reset button clicked');
    clearErrors();
    const email = document.getElementById('reset-email').value;
    if (!email) {
      showError('reset-email', 'Please enter an email');
      return;
    }
    try {
      console.log('Attempting sendPasswordResetEmail');
      await sendPasswordResetEmail(auth, email);
      console.log('Password reset email sent');
      showError('reset-email', 'Password reset email sent', false);
    } catch (error) {
      console.error('Password reset failed:', error.message);
      showError('reset-email', error.message);
    }
  });

  console.log('Auth event listeners setup complete');
}
