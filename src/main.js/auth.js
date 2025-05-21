// Authentication module: Handles login, signup, password reset, and logout
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'firebase/auth';
import { auth, db, domElements, showError, clearErrors } from './core.js';

function setupAuth() {
  console.log('Setting up authentication event listeners');

  // Modal switching functions
  const showLoginModal = () => {
    console.log('Showing login modal');
    domElements.loginModal?.classList.remove('hidden');
    domElements.signupModal?.classList.add('hidden');
    domElements.resetModal?.classList.add('hidden');
  };

  const showSignupModal = () => {
    console.log('Showing signup modal');
    domElements.signupModal?.classList.remove('hidden');
    domElements.loginModal?.classList.add('hidden');
    domElements.resetModal?.classList.add('hidden');
  };

  const showResetModal = () => {
    console.log('Showing reset modal');
    domElements.resetModal?.classList.remove('hidden');
    domElements.loginModal?.classList.add('hidden');
    domElements.signupModal?.classList.add('hidden');
  };

  // Bind modal switching event listeners
  domElements.showSignupBtn?.addEventListener('click', showSignupModal);
  domElements.showResetBtn?.addEventListener('click', showResetModal);
  domElements.showLoginFromSignupBtn?.addEventListener('click', showLoginModal);
  domElements.showLoginFromResetBtn?.addEventListener('click', showLoginModal);

  // Signup
  domElements.signupButton?.addEventListener('click', async () => {
    console.log('Signup button clicked');
    clearErrors();
    const email = document.getElementById('signup-email')?.value.trim();
    const password = document.getElementById('signup-password')?.value;
    const confirmPassword = document.getElementById('signup-confirm-password')?.value;
    const currency = document.getElementById('signup-currency')?.value;
    const familyCodeInput = document.getElementById('signup-family-code')?.value.trim();
    const accountType = document.getElementById('signup-account-type')?.value;

    console.log('Validating signup inputs:', { email, currency, familyCodeInput, accountType });

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
    if (!familyCodeInput) {
      showError('signup-family-code', 'Family code is required');
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

    if (!auth || !db) {
      showError('signup-email', 'Authentication or database service not available');
      return;
    }

    try {
      domElements.signupButton.disabled = true;
      domElements.signupButton.textContent = 'Signing up...';
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      console.log('User created:', credential.user.uid);

      await db.collection('users').doc(credential.user.uid).set({
        currency,
        familyCode: familyCodeInput,
        accountType,
        email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log('User data saved to Firestore:', { uid: credential.user.uid, currency, familyCodeInput, accountType });

      // Reset form
      document.getElementById('signup-email').value = '';
      document.getElementById('signup-password').value = '';
      document.getElementById('signup-confirm-password').value = '';
      document.getElementById('signup-family-code').value = '';
      document.getElementById('signup-currency').value = 'INR';
      document.getElementById('signup-account-type').value = 'admin';
    } catch (error) {
      console.error('Signup error:', { code: error.code, message: error.message });
      let errorMessage = error.message || 'Failed to sign up.';
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'This email is already registered. Please log in or use a different email.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email format.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password is too weak.';
      } else if (error.code === 'auth/network-request-failed') {
        errorMessage = 'Network error. Please check your connection.';
      }
      showError('signup-email', errorMessage);
    } finally {
      domElements.signupButton.disabled = false;
      domElements.signupButton.textContent = 'Sign Up';
    }
  });

  // Login
  domElements.loginButton?.addEventListener('click', async () => {
    console.log('Login button clicked');
    clearErrors();
    const email = document.getElementById('login-email')?.value.trim();
    const password = document.getElementById('login-password')?.value;

    if (!email) {
      showError('login-email', 'Email is required');
      return;
    }
    if (!password) {
      showError('login-password', 'Password is required');
      return;
    }
    if (!auth) {
      showError('login-email', 'Authentication service not available');
      return;
    }

    try {
      domElements.loginButton.disabled = true;
      domElements.loginButton.textContent = 'Logging in...';
      await signInWithEmailAndPassword(auth, email, password);
      console.log('Login successful');
    } catch (error) {
      console.error('Login error:', { code: error.code, message: error.message });
      showError('login-password', error.message || 'Failed to log in.');
    } finally {
      domElements.loginButton.disabled = false;
      domElements.loginButton.textContent = 'Login';
    }
  });

  // Password Reset
  domElements.resetButton?.addEventListener('click', async () => {
    console.log('Reset button clicked');
    clearErrors();
    const email = document.getElementById('reset-email')?.value.trim();

    if (!email) {
      showError('reset-email', 'Email is required');
      return;
    }
    if (!auth) {
      showError('reset-email', 'Authentication service not available');
      return;
    }

    try {
      domElements.resetButton.disabled = true;
      domElements.resetButton.textContent = 'Sending...';
      await sendPasswordResetEmail(auth, email);
      console.log('Password reset email sent');
      alert('Password reset email sent');
      showLoginModal();
    } catch (error) {
      console.error('Reset error:', { code: error.code, message: error.message });
      showError('reset-email', error.message || 'Failed to send reset email');
    } finally {
      domElements.resetButton.disabled = false;
      domElements.resetButton.textContent = 'Send Reset Link';
    }
  });

  // Logout
  domElements.logoutButton?.addEventListener('click', async () => {
    console.log('Logout button clicked');
    if (!auth) {
      showError('logout-button', 'Authentication service not available');
      return;
    }
    try {
      await signOut(auth);
      console.log('Logout successful');
    } catch (error) {
      console.error('Logout error:', { code: error.code, message: error.message });
      showError('logout-button', 'Failed to log out.');
    }
  });
}

export { setupAuth };
