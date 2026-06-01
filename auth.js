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

    updateNavUI(user, isPaid);
    resolve({ user, paid: isPaid });
  });
});

// ─── Nav UI ──────────────────────────────────────────────────────────────────

function updateNavUI(user, paid) {
  // Inject the auth nav item into the R Markdown navbar
  // R Markdown renders a Bootstrap navbar — we hook into it at runtime.
  const navbar = document.querySelector(".navbar-nav.navbar-right, .navbar-right");
  if (!navbar) return;

  // Remove any existing auth item we may have injected previously
  const existing = document.getElementById("sbj-auth-nav");
  if (existing) existing.remove();

  const li = document.createElement("li");
  li.id = "sbj-auth-nav";

  if (user) {
    // Logged in — show account + logout
    li.innerHTML = `
      <li class="dropdown" id="sbj-auth-nav">
        <a href="#" class="dropdown-toggle" data-toggle="dropdown" role="button">
          <span style="margin-right:4px;"></span>${paid ? "Premium" : "Free"} <span class="caret"></span>
        </a>
        <ul class="dropdown-menu">
          <li><a href="/account.html">My Account</a></li>
          ${!paid ? '<li><a href="/upgrade.html" style="font-weight:600;color:#e05c00;">Upgrade to Premium</a></li>' : ""}
          <li role="separator" class="divider"></li>
          <li><a href="#" id="sbj-logout">Log Out</a></li>
        </ul>
      </li>`;
  } else {
    // Logged out — show login link
    li.innerHTML = `<a href="/login.html">Log In</a>`;
  }

  navbar.appendChild(li);

  // Wire logout
  const logoutBtn = document.getElementById("sbj-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut(auth);
      window.location.href = "/index.html";
    });
  }
}

// ─── Helpers for page scripts ────────────────────────────────────────────────

/**
 * Redirect to login if not authenticated.
 * Optionally also require paid status.
 * Usage: requireAuth(true) on a premium page.
 */
export async function requireAuth(requirePaid = false) {
  const { user, paid } = await authReady;

  if (!user) {
    window.location.href = `/login.html?redirect=${encodeURIComponent(window.location.pathname)}`;
    return false;
  }

  if (requirePaid && !paid) {
    window.location.href = `/upgrade.html?redirect=${encodeURIComponent(window.location.pathname)}`;
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
