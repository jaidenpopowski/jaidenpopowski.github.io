// auth.js
// Handles auth state across every page.
// Injected into every page via header.html (already wired in _site.yml).

import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── Shared auth state (importable by other scripts) ────────────────────────

export let currentUser = null;
export let isPaid = false;

// Resolves once auth + paid status is known — use this in page scripts
// e.g.  import { authReady } from "./auth.js";
//        authReady.then(({ user, paid }) => { ... });
export const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;

    if (user) {
      try {
        const userRef = doc(db, "users", user.uid);
        let snap = await getDoc(userRef);

        // Backfill missing doc for pre-existing Auth users
        if (!snap.exists()) {
          await setDoc(userRef, {
            email: user.email,
            paid: false,
            createdAt: serverTimestamp()
          });
          snap = await getDoc(userRef);
        }

        isPaid = snap.data().paid === true;
      } catch (e) {
        console.error("Firestore user doc error:", e);
        isPaid = false;
      }
    } else {
      isPaid = false;
    }

    resolve({ user, paid: isPaid });
  });
});

// ─── Helpers for page scripts ────────────────────────────────────────────────

/**
 * Redirect to login if not authenticated.
 * Optionally also require paid status.
 * Usage: requireAuth(true) on a premium page.
 */
export async function requireAuth(requirePaid = false) {
  const { user, paid } = await authReady;

  if (!user) {
    window.location.href = `/account.html?redirect=${encodeURIComponent(window.location.pathname)}`;
    return false;
  }

  if (requirePaid && !paid) {
    window.location.href = `/account.html?redirect=${encodeURIComponent(window.location.pathname)}`;
    return false;
  }

  return true;
}

/**
 * Get an auth token for use in Firebase Storage fetches.
 * Returns null if not logged in.
 */
export async function getAuthToken() {
  await authReady;
  if (!currentUser) return null;
  return await currentUser.getIdToken();
}
