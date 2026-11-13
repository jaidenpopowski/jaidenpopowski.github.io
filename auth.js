// auth.js
// Handles auth state across every page.
// Injected into every page via header.html (already wired in _site.yml).

import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
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

// ─── Login overlay (available on every page) ─────────────────────────────────

let loginRedirectPath = null;
let loginModalBuilt = false;

function accountSignupUrl() {
  const redirect = loginRedirectPath ||
    (window.location.pathname + window.location.search + window.location.hash);
  const q = new URLSearchParams();
  q.set("signup", "1");
  if (redirect && redirect !== "/account.html" && !redirect.startsWith("/account")) {
    q.set("redirect", redirect);
  }
  return `/account.html?${q.toString()}`;
}

function friendlyAuthError(code) {
  const map = {
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
    "auth/invalid-credential": "Incorrect email or password."
  };
  return map[code] || "Something went wrong. Please try again.";
}

function ensureLoginModal() {
  if (loginModalBuilt) return document.getElementById("sbj-login-modal");
  loginModalBuilt = true;

  const wrap = document.createElement("div");
  wrap.id = "sbj-login-modal";
  wrap.className = "account-modal";
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="account-modal-backdrop" data-sbj-login-close></div>
    <div class="account-modal-card" role="dialog" aria-modal="true" aria-labelledby="sbj-login-title">
      <button type="button" class="account-modal-close" data-sbj-login-close aria-label="Close">&times;</button>
      <h2 id="sbj-login-title">Log in</h2>
      <p class="account-col-sub">Access your Stats By Jaiden account.</p>
      <div id="sbj-login-alert" class="auth-alert error" style="display:none;"></div>
      <div class="form-group">
        <label for="sbj-login-email">Email</label>
        <input type="email" id="sbj-login-email" class="form-control" placeholder="you@example.com" autocomplete="email" />
      </div>
      <div class="form-group">
        <label for="sbj-login-password">
          Password
          <a href="#" class="forgot-link" id="sbj-login-forgot">Forgot?</a>
        </label>
        <input type="password" id="sbj-login-password" class="form-control" placeholder="••••••••" autocomplete="current-password" />
      </div>
      <button type="button" class="btn-auth" id="sbj-login-submit">Log In</button>
      <p class="auth-switch">
        No account?
        <a href="/account.html?signup=1" id="sbj-login-create">Create one</a>
      </p>
    </div>
  `;
  document.body.appendChild(wrap);

  const alertEl = wrap.querySelector("#sbj-login-alert");
  const emailEl = wrap.querySelector("#sbj-login-email");
  const passwordEl = wrap.querySelector("#sbj-login-password");
  const submitBtn = wrap.querySelector("#sbj-login-submit");
  const createLink = wrap.querySelector("#sbj-login-create");
  const forgotLink = wrap.querySelector("#sbj-login-forgot");

  function showAlert(msg, type = "error") {
    alertEl.textContent = msg;
    alertEl.className = `auth-alert ${type}`;
    alertEl.style.display = "block";
  }

  function clearAlert() {
    alertEl.style.display = "none";
    alertEl.textContent = "";
  }

  wrap.querySelectorAll("[data-sbj-login-close]").forEach((el) => {
    el.addEventListener("click", () => closeLoginModal());
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !wrap.hidden) closeLoginModal();
  });

  createLink.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = accountSignupUrl();
  });

  forgotLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = emailEl.value.trim();
    if (!email) {
      showAlert("Enter your email above first.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      showAlert("Reset email sent — check your inbox.", "success");
    } catch (err) {
      showAlert(friendlyAuthError(err.code));
    }
  });

  async function doLogin() {
    clearAlert();
    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in…";
    try {
      await signInWithEmailAndPassword(
        auth,
        emailEl.value.trim(),
        passwordEl.value
      );
      const redirect = loginRedirectPath;
      closeLoginModal();
      if (redirect) {
        window.location.href = redirect;
      }
      // else stay on page; onAuthStateChanged will refresh UI
    } catch (err) {
      showAlert(friendlyAuthError(err.code));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Log In";
    }
  }

  submitBtn.addEventListener("click", doLogin);
  passwordEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });

  return wrap;
}

/**
 * Open the site-wide login overlay.
 * @param {{ redirect?: string|null }} [opts]
 *   redirect — after success, go here (default: stay on current page)
 */
export function openLoginModal(opts = {}) {
  // Don't overlay on the account page itself — it has an inline login form
  if (/\/account(\.html)?$/i.test(window.location.pathname)) {
    const q = new URLSearchParams();
    if (opts.redirect) q.set("redirect", opts.redirect);
    const qs = q.toString();
    window.location.href = `/account.html${qs ? `?${qs}` : ""}`;
    return;
  }

  loginRedirectPath =
    opts.redirect === undefined
      ? null
      : opts.redirect;

  const modal = ensureLoginModal();
  const createLink = modal.querySelector("#sbj-login-create");
  if (createLink) createLink.href = accountSignupUrl();

  const alertEl = modal.querySelector("#sbj-login-alert");
  if (alertEl) {
    alertEl.style.display = "none";
    alertEl.textContent = "";
  }

  modal.hidden = false;
  document.body.style.overflow = "hidden";
  const emailEl = modal.querySelector("#sbj-login-email");
  if (emailEl) emailEl.focus();
}

export function closeLoginModal() {
  const modal = document.getElementById("sbj-login-modal");
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = "";
}

// ─── Helpers for page scripts ────────────────────────────────────────────────

/**
 * Ensure authenticated (and optionally paid).
 * Logged out → opens login overlay (Create account goes to /account).
 * Logged in but unpaid when requirePaid → send to /account to upgrade.
 * Usage: requireAuth(true) on a premium page.
 */
export async function requireAuth(requirePaid = false) {
  const { user, paid } = await authReady;

  if (!user) {
    openLoginModal({ redirect: null });
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

export { signOut };

// Bridge for non-module page scripts (e.g. fantasy_draft_futures.js)
if (typeof window !== "undefined") {
  window.SbjAuth = {
    get currentUser() {
      return currentUser;
    },
    get isPaid() {
      return isPaid;
    },
    authReady,
    getAuthToken,
    requireAuth,
    openLoginModal,
    closeLoginModal,
    auth,
    db
  };
}
