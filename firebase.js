// firebase.js
// Place this file in your docs/ folder alongside your HTML pages.
// Replace the firebaseConfig values with your own from the Firebase console:
// Project Settings > General > Your apps > Firebase SDK snippet > Config

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyACB9eE4apOc76p2vlGeH3GqH5fViq12mw",
  authDomain: "statsbyjaiden.firebaseapp.com",
  projectId: "statsbyjaiden",
  storageBucket: "statsbyjaiden.firebasestorage.app",
  messagingSenderId: "596428392018",
  appId: "1:596428392018:web:31623cf26159f1ff18818b"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
