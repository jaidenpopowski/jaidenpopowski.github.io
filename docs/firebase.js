import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut  } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyACB9eE4apOc76p2vlGeH3GqH5fViq12mw",
  authDomain: "statsbyjaiden.firebaseapp.com",
  projectId: "statsbyjaiden",
  storageBucket: "statsbyjaiden.firebaseapp.com",
  messagingSenderId: "596428392018",
  appId: "1:596428392018:web:31623cf26159f1ff18818b"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Initialize Firebase Auth and Firestore (if needed)
export { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, db };