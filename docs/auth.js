import { auth } from './firebase.js';

auth.onAuthStateChanged(user => {
  if (user) {
    const loginContainer = document.getElementById('login-container');
    if (loginContainer) loginContainer.style.display = 'none';

    const premiumContent = document.getElementById('premium-content');
    if (premiumContent) premiumContent.style.display = 'block';
  } else {
    const loginContainer = document.getElementById('login-container');
    if (loginContainer) {
      loginContainer.innerHTML = '<iframe src="login-prompt.html" width="100%" height="400px" frameborder="0"></iframe>';
      loginContainer.style.display = 'block';
    }

    const premiumContent = document.getElementById('premium-content');
    if (premiumContent) premiumContent.style.display = 'none';
  }
});
