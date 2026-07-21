// NOTE: the .onrender.com / .vercel.app defaults below MUST match the actual
// deployed service URLs. If you claim different service names at deploy, update
// these (and background.js + manifest.json) to the real URLs.
const BACKEND = (typeof __BACKEND_URL__ !== "undefined") ? __BACKEND_URL__ : "https://jobhuntpro-linkedin-api.onrender.com";
const FRONTEND = (typeof __FRONTEND_URL__ !== "undefined") ? __FRONTEND_URL__ : "https://job-hunt-pro.vercel.app";
const COLD_API = (typeof __COLD_API_URL__ !== "undefined") ? __COLD_API_URL__ : "https://jobhuntpro-cold-api.onrender.com";
const GOOGLE_CLIENT_ID = (typeof __GOOGLE_CLIENT_ID__ !== "undefined") ? __GOOGLE_CLIENT_ID__ : "423029767273-arma4d61l5ktli5gutmdgdee5krqpqm9.apps.googleusercontent.com";

const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

function sanitizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsed));
}

function setLimitInput(limit) {
  const input = document.getElementById("daily-limit-input");
  if (input) input.value = String(limit);
}

function showView(loggedIn, email) {
  document.getElementById("login-view").style.display = loggedIn ? "none" : "block";
  document.getElementById("main-view").style.display = loggedIn ? "block" : "none";
  if (loggedIn && email) {
    const el = document.getElementById("user-email");
    if (el) el.textContent = email;
  }
  const link = document.getElementById("dashboard-link");
  if (link) link.href = FRONTEND;
}

// Check login state on popup open
chrome.storage.sync.get(["jh_token", "jh_email"], (data) => {
  if (data.jh_token && data.jh_email) {
    chrome.runtime.sendMessage({ type: "TOKEN_SYNC", token: data.jh_token, email: data.jh_email });
    showView(true, data.jh_email);
    loadStats();
  } else {
    showView(false);
  }
});

// Google Sign-In
const googleBtn = document.getElementById("google-signin-btn");
if (googleBtn) {
  googleBtn.addEventListener("click", async () => {
    const errorEl = document.getElementById("login-error");
    const loadingEl = document.getElementById("login-loading");
    errorEl.style.display = "none";
    googleBtn.style.display = "none";
    loadingEl.style.display = "block";

    try {
      const idToken = await getGoogleIdToken();
      if (!idToken) throw new Error("Sign-in was cancelled");

      const res = await fetch(`${COLD_API}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: idToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Sign-in failed");

      await chrome.storage.sync.set({ jh_token: data.token, jh_email: data.user.email });
      chrome.runtime.sendMessage({ type: "TOKEN_SYNC", token: data.token, email: data.user.email });
      showView(true, data.user.email);
      loadStats();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
      googleBtn.style.display = "inline-flex";
    } finally {
      loadingEl.style.display = "none";
    }
  });
}

async function getGoogleIdToken() {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_CLIENT_ID) {
      reject(new Error("GOOGLE_CLIENT_ID not configured in extension"));
      return;
    }

    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const redirectUri = chrome.identity.getRedirectURL();

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "id_token");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("nonce", nonce);
    authUrl.searchParams.set("prompt", "select_account");

    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          resolve(null); // cancelled
          return;
        }
        try {
          const hash = new URL(responseUrl).hash.slice(1); // strip leading #
          const params = new URLSearchParams(hash);
          resolve(params.get("id_token") || null);
        } catch {
          resolve(null);
        }
      }
    );
  });
}

// Logout
const logoutBtn = document.getElementById("logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "TOKEN_SYNC", token: null, email: "" });
    showView(false);
  });
}

// Master on/off switch — a manual pause independent of the queue's own run-state (which is
// backend-authoritative and gets overwritten by syncRunState every 30s). This one is purely
// local and stays put until the user flips it again, so it also works as a way to stop
// background scraping/auto-connect entirely without signing out or removing the extension.
const MASTER_ENABLED_KEY = "jh_master_enabled";

function setMasterToggleUI(enabled) {
  const btn = document.getElementById("master-toggle");
  const label = document.getElementById("master-toggle-label");
  if (!btn || !label) return;
  btn.classList.toggle("master-toggle-off", !enabled);
  label.textContent = enabled ? "Extension On" : "Extension Off";
}

function loadMasterToggle() {
  chrome.storage.local.get([MASTER_ENABLED_KEY], (data) => {
    setMasterToggleUI(data[MASTER_ENABLED_KEY] !== false);
  });
}

const masterToggleBtn = document.getElementById("master-toggle");
if (masterToggleBtn) {
  masterToggleBtn.addEventListener("click", () => {
    chrome.storage.local.get([MASTER_ENABLED_KEY], (data) => {
      const next = data[MASTER_ENABLED_KEY] === false; // was off -> turning on, and vice versa
      chrome.storage.local.set({ [MASTER_ENABLED_KEY]: next }, () => setMasterToggleUI(next));
    });
  });
}
loadMasterToggle();

function loadStats() {
  chrome.runtime.sendMessage({ type: "GET_DAILY_STATS" }, (res) => {
    const todayEl = document.getElementById("connections-today");
    if (todayEl && res) todayEl.textContent = res.connections_today ?? 0;
    if (res && typeof res.daily_limit !== "undefined") setLimitInput(res.daily_limit);
  });

  chrome.storage.local.get(["connect_running"], (data) => {
    const statusEl = document.getElementById("queue-status");
    if (!statusEl) return;
    statusEl.textContent = data.connect_running ? "Running" : "Paused";
    statusEl.style.color = data.connect_running ? "#bbf7d0" : "#cbd5e1";
    statusEl.style.borderColor = data.connect_running ? "rgba(74, 222, 128, 0.45)" : "rgba(148, 163, 184, 0.3)";
    statusEl.style.background = data.connect_running ? "rgba(34, 197, 94, 0.2)" : "rgba(100, 116, 139, 0.22)";
  });
}

const saveBtn = document.getElementById("save-limit-btn");
const input = document.getElementById("daily-limit-input");

function saveLimit() {
  const normalized = sanitizeLimit(input?.value);
  if (normalized == null) return;
  chrome.runtime.sendMessage({ type: "SET_DAILY_LIMIT", limit: normalized }, (res) => {
    if (!res?.ok) return;
    setLimitInput(res.daily_limit);
  });
}

if (saveBtn) saveBtn.addEventListener("click", saveLimit);
if (input) {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveLimit();
  });
}
