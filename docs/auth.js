import { auth, signOut } from './firebase.js';

const logoutButton = document.getElementById('logout-button');

auth.onAuthStateChanged(user => {
  if (user) {
    const loginContainer = document.getElementById('login-container');
    if (loginContainer) loginContainer.style.display = 'none';

    const premiumContent = document.getElementById('premium-content');
    if (premiumContent) premiumContent.style.display = 'block';
    
    logoutButton.style.display = 'block';
    
  } else {
    const loginContainer = document.getElementById('login-container');
    if (loginContainer) {
      loginContainer.innerHTML = '<iframe src="login-prompt.html" width="100%" height="400px" frameborder="0"></iframe>';
      loginContainer.style.display = 'block';
    }
    
    logoutButton.style.display = 'none';

    const premiumContent = document.getElementById('premium-content');
    if (premiumContent) premiumContent.style.display = 'none';
  }
});

logoutButton.addEventListener('click', function() {
  signOut(auth)
    .then(() => {
      alert('Logged out successfully!');
      window.location.reload(); // Refresh the page to apply changes (or you can redirect to a login page)
    })
    .catch(error => {
      alert(`Logout failed: ${error.message}`);
    });
});
