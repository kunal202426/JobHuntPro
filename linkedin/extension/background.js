// background.js — Service worker: message hub between content scripts and backend

// Tabs the extension itself opened for background work (scraping, connecting,
// applying), keyed by a purpose string (e.g. a source name or "linkedin_connect").
// We ONLY ever reuse a tab through this map — never chrome.tabs.query() for
// "any tab matching this host that isn't currently focused", because that
// would just as happily grab a tab the USER opened to read a profile or
// browse a job themselves (perfectly capable of being "not active" while they
// look at a different tab) and hijack it out from under them.
const _workerTabIds = {};

async function getOrCreateWorkerTab(key, url) {
  const existingId = _workerTabIds[key];
  if (existingId != null) {
    try {
      const tab = await chrome.tabs.get(existingId);
      if (tab) {
        await chrome.tabs.update(existingId, { url });
        return tab;
      }
    } catch {
      // Tab was closed or no longer exists — fall through and create a new one.
    }
  }
  const tab = await chrome.tabs.create({ url, active: false });
  _workerTabIds[key] = tab.id;
  return tab;
}

// MUST match the deployed LinkedIn API URL (and popup.js / manifest.json).
const BACKEND = (typeof __BACKEND_URL__ !== "undefined") ? __BACKEND_URL__ : "https://jobhuntpro-linkedin-api.onrender.com";
const DEFAULT_DAILY_LIMIT = 14; // Conservative daily cap inferred from the common ~100 invitations/week restriction.
const MIN_DAILY_LIMIT = 1;
const MAX_DAILY_LIMIT = 100;
const SESSION_ACTIVE_KEY = "jh_session_active";
const SCRAPE_SOURCES = {
  linkedin: {
    // keywords: boolean OR across the actual role titles we want (quoted phrases,
    // not a bare "Software" which matched almost anything mentioning the word —
    // Software Sales, random descriptions, etc.). f_TPR=r86400 → past 24h ·
    // f_E=1,2,3 → Internship/Entry/Associate only (no Mid-Senior/Director/Exec) ·
    // f_JT=F,I → Full-time + Internship only (excludes Contract/Part-time/Temp) ·
    // geoId=102713980 → India · sortBy=DD → newest first, so the truly-fresh
    // (minutes-old) postings are always at the top of the results.
    url: "https://www.linkedin.com/jobs/search/?keywords=%22Software%20Engineer%22%20OR%20%22Full%20Stack%20Engineer%22%20OR%20%22Backend%20Engineer%22%20OR%20%22Java%20Full%20Stack%22%20OR%20%22Full%20Stack%20Developer%22%20OR%20%22Backend%20Developer%22&f_TPR=r86400&f_E=1%2C2%2C3&f_JT=F%2CI&geoId=102713980&sortBy=DD",
    hostPrefix: "https://www.linkedin.com/",
    injectFile: "content/linkedin_jobs.js",
  },
  naukri: {
    url: "https://www.naukri.com/software-engineer-jobs",
    hostPrefix: "https://www.naukri.com/",
    injectFile: "content/naukri.js",
  },
  cutshort: {
    url: "https://cutshort.io/jobs",
    hostPrefix: "https://cutshort.io/",
    injectFile: "content/cutshort.js",
  },
  instahyre: {
    // Instahyre's Angular app does NOT read search filters (years, job_functions,
    // company_size, ...) from the query string on load — those only apply when
    // the sidebar form is submitted client-side. A direct URL with those params
    // just lands on the default recommended/matching feed and ignores them
    // (confirmed: it showed "No matching opportunities found"). So we use the
    // plain recommended feed and rely on the card + in-modal experience gate
    // (job_match.js / instahyre.js) to drop anything wanting >1 year.
    url: "https://www.instahyre.com/candidate/opportunities/",
    hostPrefix: "https://www.instahyre.com/",
    injectFile: "content/instahyre.js",
  },
  hiringcafe: {
    // Targeted at the SOURCE: searchQuery "Software Engineer" + the 4 tech
    // departments + roleYoeRange [0,1] (junior) + sortBy date. The scraper then
    // only trims to the last 24h. Location = India via IP geo. SSR embeds jobs in
    // __NEXT_DATA__.
    url: "https://hiring.cafe/?searchState=%7B%22searchQuery%22%3A%22Software+Engineer%22%2C%22dateFetchedPastNDays%22%3A2%2C%22departments%22%3A%5B%22Software+Development%22%2C%22Engineering%22%2C%22Information+Technology%22%2C%22Data+and+Analytics%22%5D%2C%22roleYoeRange%22%3A%5B0%2C1%5D%2C%22sortBy%22%3A%22date%22%7D",
    hostPrefix: "https://hiring.cafe/",
    injectFile: "content/hiringcafe.js",
  },
  wellfound: {
    // User's saved Wellfound profile filters apply automatically when logged in:
    // Software Engineer · Bengaluru · 0-1 years experience · sorted by Most Recent.
    url: "https://wellfound.com/jobs",
    hostPrefix: "https://wellfound.com/",
    injectFile: "content/wellfound.js",
  },
};

// NEW: Targeted Company Search
function normalizeCompanyQuery(value) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  return cleaned.length ? cleaned.slice(0, 80) : "";
}

// NEW: Targeted Company Search
function toKebabCase(value) {
  return normalizeCompanyQuery(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// NEW: Targeted Company Search
function buildCompanySearchUrl(source, company) {
  const encoded = encodeURIComponent(company);
  if (source === "linkedin") {
    // Same junior-only (f_E) + past-24h filters for targeted company search.
    return `https://www.linkedin.com/jobs/search/?keywords=${encoded}&f_TPR=r86400&f_E=1%2C2%2C3&sortBy=DD`;
  }
  if (source === "naukri") {
    const slug = toKebabCase(company) || "jobs";
    return `https://www.naukri.com/${slug}-jobs?k=${encoded}`;
  }
  if (source === "instahyre") {
    return `https://www.instahyre.com/jobs/?search=${encoded}`;
  }
  if (source === "hiringcafe") {
    // Same junior + tech-department filter, keyed to the company as the search term.
    const state = JSON.stringify({
      searchQuery: company,
      dateFetchedPastNDays: 2,
      departments: ["Software Development", "Engineering", "Information Technology", "Data and Analytics"],
      roleYoeRange: [0, 1],
      sortBy: "date",
    });
    return `https://hiring.cafe/?searchState=${encodeURIComponent(state)}`;
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "JOBS_SCRAPED") {
    hasActiveSession()
      .then((active) => {
        if (!active) return sendResponse({ ok: false, error: "Session inactive" });
        return postToBackend("/api/jobs/batch", message.payload)
          .then(data => sendResponse({ ok: true, result: data }))
          .catch(err => sendResponse({ ok: false, error: err.message }));
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }

  if (message.type === "PEOPLE_SCRAPED") {
    hasActiveSession()
      .then((active) => {
        if (!active) return sendResponse({ ok: false, error: "Session inactive" });
        return postToBackend("/api/leads/batch", message.payload)
          .then(data => sendResponse({ ok: true, result: data }))
          .catch(err => sendResponse({ ok: false, error: err.message }));
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "TOKEN_SYNC") {
    const { token, email } = message;
    syncAuthSession(token, email)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "TRIGGER_CONNECT") {
    chrome.storage.local.set({ connect_running: message.running });
    sendResponse({ ok: true });
  }

  if (message.type === "TRIGGER_CONNECT_NOW") {
    // Dashboard clicked Start Queue / Retry — kick the loop immediately instead
    // of waiting for the 30s alarm.
    hasActiveSession()
      .then(async (active) => {
        if (!active) return sendResponse({ ok: false, error: "Session inactive" });
        await syncRunState();
        if (!_connectLoopRunning) {
          _connectLoopRunning = true;
          runConnectLoop().finally(() => { _connectLoopRunning = false; });
        }
        sendResponse({ ok: true });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }

  if (message.type === "FIND_LEADS") {
    const { company, job_id } = message.payload;
    hasActiveSession()
      .then((active) => {
        if (!active) return sendResponse({ ok: false, error: "Session inactive" });
        return openLinkedInPeopleSearch(company, job_id)
          .then(() => sendResponse({ ok: true }))
          .catch(err => sendResponse({ ok: false, error: err.message }));
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "GET_DAILY_STATS") {
    chrome.storage.local.get(["connections_today", "last_reset_date", "connect_daily_limit"], async (data) => {
      const today = new Date().toDateString();
      const daily_limit = sanitizeDailyLimit(data.connect_daily_limit);
      if (data.last_reset_date !== today) {
        chrome.storage.local.set({ connections_today: 0, last_reset_date: today });
        if (data.connect_daily_limit == null) {
          await chrome.storage.local.set({ connect_daily_limit: daily_limit });
        }
        sendResponse({ connections_today: 0, daily_limit });
      } else {
        if (data.connect_daily_limit == null) {
          await chrome.storage.local.set({ connect_daily_limit: daily_limit });
        }
        sendResponse({ connections_today: data.connections_today || 0, daily_limit });
      }
    });
    return true;
  }

  if (message.type === "SET_DAILY_LIMIT") {
    const nextLimit = sanitizeDailyLimit(message?.limit);
    chrome.storage.local.set({ connect_daily_limit: nextLimit }, async () => {
      await persistDailyLimitToBackend(nextLimit);
      sendResponse({ ok: true, daily_limit: nextLimit });
    });
    return true;
  }

  if (message.type === "TRIGGER_SCRAPE_NOW") {
    hasActiveSession()
      .then((active) => {
        if (!active) return sendResponse({ ok: false, error: "Session inactive" });
        processPendingScrapeTasks().catch(() => {});
        sendResponse({ ok: true });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// Alarm fires every 30s as a heartbeat — kicks off the loop if not already running
let _connectLoopRunning = false;

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "connect_tick") return;

  if (!(await hasActiveSession())) {
    await deactivateSession();
    return;
  }

  await syncRunState();
  await processPendingFindLeads();
  await processPendingScrapeTasks();

  if (!_connectLoopRunning) {
    _connectLoopRunning = true;
    runConnectLoop().finally(() => { _connectLoopRunning = false; });
  }
});

// Runs one LinkedIn connect attempt; returns "done", "no_item", "stopped", "limit_hit", or "captcha"
async function processOneConnection() {
  if (!(await hasActiveSession())) return "stopped";
  const connections_today = await ensureDailyReset();
  const { connect_running } = await chrome.storage.local.get("connect_running");
  const daily_limit = await getDailyLimit();

  if (!connect_running) return "stopped";
  if ((connections_today || 0) >= daily_limit) {
    chrome.storage.local.set({ connect_running: false });
    await postToBackend("/api/queue/stop", {}).catch(() => {});
    return "limit_hit";
  }

  const res = await fetchFromBackend("/api/queue/next");
  if (!res || !res.ok) return "no_item";
  const person = await res.json().catch(() => null);
  if (!person || !person.profile_url) return "no_item";

  const targetTab = await getOrCreateWorkerTab("linkedin_connect", person.profile_url);

  await waitForTabLoad(targetTab.id);
  await new Promise(r => setTimeout(r, 1200));

  if (!(await hasActiveSession())) return "stopped";

  // Belt-and-suspenders: confirm the tab is still actually showing the
  // profile we just navigated it to before sending the connect command.
  // Guards against this same tab getting re-navigated (a stray trigger, a
  // service-worker restart mid-loop, etc.) in the gap between navigating and
  // messaging it — the content script re-checks this too, right before its
  // own irreversible clicks, but catching it here means we never even ask.
  const targetPath = person.profile_url.replace(/^https?:\/\/[^/]+/, "").split("?")[0].replace(/\/$/, "");
  const checkTab = await chrome.tabs.get(targetTab.id).catch(() => null);
  const currentPath = checkTab?.url ? new URL(checkTab.url).pathname.replace(/\/$/, "") : "";
  if (targetPath && !currentPath.startsWith(targetPath)) {
    console.warn(`[bg] Tab drifted before DO_CONNECT: expected ${targetPath}, tab is on ${currentPath || "(unknown)"}`);
    await postToBackend("/api/queue/result", { queue_id: person.id, status: "failed", error_msg: "tab_url_mismatch" }).catch(() => {});
    return "done";
  }

  try {
    const response = await sendMessageToTabWithInjection(targetTab.id, {
      type: "DO_CONNECT",
      payload: { profile_url: person.profile_url, queue_id: person.id }
    }, 'content/linkedin_connect.js');

    if (!response) {
      console.warn('[bg] DO_CONNECT failed: content script unavailable even after inject');
      await postToBackend("/api/queue/result", { queue_id: person.id, status: "failed", error_msg: "content_script_unavailable" }).catch(() => {});
      return "done";
    }

    const status = response?.status || "failed";
    console.log(`[bg] DO_CONNECT result: ${status}`, response?.error || "");
    await postToBackend("/api/queue/result", { queue_id: person.id, status, error_msg: response?.error || null }).catch(() => {});

    if (status === "sent") {
      const d = await chrome.storage.local.get("connections_today");
      await chrome.storage.local.set({ connections_today: (d.connections_today || 0) + 1 });
    }

    if (response?.error === "captcha_checkpoint") {
      await chrome.storage.local.set({ connect_running: false });
      await postToBackend("/api/queue/stop", {}).catch(() => {});
      console.warn("[bg] Captcha/checkpoint detected — queue paused");
      return "captcha";
    }
  } catch (err) {
    console.error('[bg] DO_CONNECT unexpected error:', err?.message || err);
  }

  return "done";
}

// Continuous loop: process connections with 5s between each one.
// Storage pings keep the service worker alive during the delay.
async function runConnectLoop() {
  while (true) {
    const result = await processOneConnection();
    if (result !== "done") break;
    await keepAliveDelay(5000);
  }
}

function keepAliveDelay(ms) {
  return new Promise(resolve => {
    let elapsed = 0;
    const tick = setInterval(() => {
      elapsed += 1000;
      chrome.storage.local.get("connect_running"); // prevents SW termination
      if (elapsed >= ms) { clearInterval(tick); resolve(); }
    }, 1000);
  });
}

// Poll backend for pending find-leads requests (called every 30s from alarm)
async function processPendingFindLeads() {
  try {
    if (!(await hasActiveSession())) return;
    const res = await fetchFromBackend("/api/find-leads/pending");
    if (!res || !res.ok) return;
    const request = await res.json().catch(() => null);
    if (!request || !request.job_id) return;

    console.log(`[bg] Processing find-leads for job ${request.job_id} (${request.company})`);
    try {
      await openLinkedInPeopleSearch(request.company, request.job_id);
      await patchToBackend(`/api/find-leads/${request.id}/done`, { status: "done" }).catch(() => {});
    } catch (err) {
      console.error("[bg] Find leads failed:", err.message);
      await patchToBackend(`/api/find-leads/${request.id}/done`, { status: "failed" }).catch(() => {});
    }
  } catch (err) {
    console.error("[bg] processPendingFindLeads error:", err.message);
  }
}

async function processPendingScrapeTasks() {
  try {
    if (!(await hasActiveSession())) return;
    const res = await fetchFromBackend("/api/scrape/pending");
    if (!res || !res.ok) return;
    const task = await res.json().catch(() => null);
    if (!task || !task.id || !task.source) return;

    const result = await runScrapeTask(task);
    await postToBackend(`/api/scrape/${task.id}/result`, result).catch(() => {});
  } catch (err) {
    // Swallow; next alarm tick will retry processing.
  }
}

async function runScrapeTask(task) {
  if (!(await hasActiveSession())) {
    return { status: "failed", message: "Session inactive" };
  }
  const source = String(task.source || "").toLowerCase();
  const cfg = SCRAPE_SOURCES[source];
  if (!cfg) return { status: "failed", message: `Unknown source: ${source}` };

  // NEW: Targeted Company Search
  const companyQuery = normalizeCompanyQuery(task.company);
  const companyUrl = companyQuery ? buildCompanySearchUrl(source, companyQuery) : null;
  const targetUrl = companyUrl || cfg.url;

  const targetTab = await getOrCreateWorkerTab(`scrape_${source}`, targetUrl);

  await waitForTabLoad(targetTab.id);
  await new Promise(r => setTimeout(r, 1800));

  if (!(await hasActiveSession())) {
    return { status: "failed", message: "Session inactive" };
  }

  const loginRequired = await detectLoginRequired(targetTab.id, source);
  if (loginRequired) {
    return { status: "login_required", message: `Please login on ${source} and click Scrape again.` };
  }

  try {
    await new Promise((resolve) => {
      chrome.scripting.executeScript(
        { target: { tabId: targetTab.id }, files: ["content/job_match.js", cfg.injectFile] },
        () => resolve()
      );
    });
  } catch (err) {
    return { status: "failed", message: `Failed to start scraper on ${source}` };
  }

  await new Promise(r => setTimeout(r, 2500));
  return { status: "completed", message: `Scrape triggered for ${source}` };
}

async function detectLoginRequired(tabId, source) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (src) => {
        const href = (window.location.href || "").toLowerCase();
        const title = (document.title || "").toLowerCase();
        const bodyText = (document.body?.innerText || "").toLowerCase().slice(0, 5000);

        const hasLoginForm = !!document.querySelector(
          'form[action*="login" i], input[type="password"], input[name*="password" i], input[name*="session_key" i]'
        );

        if (src === "linkedin") {
          if (/linkedin\.com\/(login|checkpoint|authwall|signup)/.test(href)) return true;
          if (title.includes("sign in") || title.includes("security verification")) return true;
        }
        if (src === "naukri") {
          if (/naukri\.com\/(nlogin|login|mnjuser\/home)/.test(href)) return true;
        }
        if (src === "cutshort") {
          if (/cutshort\.io\/(login|signin)/.test(href)) return true;
        }
        if (src === "instahyre") {
          if (/instahyre\.com\/(login|signin)/.test(href)) return true;
        }

        if (hasLoginForm && /sign in|log in|login/.test(bodyText)) return true;
        return false;
      },
      args: [source],
    });

    return !!results?.[0]?.result;
  } catch (err) {
    return false;
  }
}

async function ensureCoreAlarm() {
  try {
    const alarm = await chrome.alarms.get("connect_tick");
    if (!alarm) {
      chrome.alarms.create("connect_tick", { periodInMinutes: 0.5 });
    }
  } catch {}
}

// Create/repair alarm on install and startup
chrome.runtime.onInstalled.addListener(() => {
  ensureCoreAlarm().catch(() => {});
  deactivateSession().catch(() => {});
  initializeDailyLimit().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureCoreAlarm().catch(() => {});
  deactivateSession().catch(() => {});
});

// Best-effort boot strap: make sure alarm exists.
ensureCoreAlarm().catch(() => {});

// ── Helpers ────────────────────────────────────────────────────────────────

async function hasActiveSession() {
  // The auth token (storage.sync) is the single source of truth and survives
  // extension reloads. We intentionally do NOT also require SESSION_ACTIVE_KEY —
  // that flag is cleared on every reload, which used to silently kill the queue
  // until the dashboard was refreshed. Signing out removes the token, which
  // correctly deactivates everything.
  const syncData = await chrome.storage.sync.get("jh_token");
  return Boolean(syncData.jh_token);
}

async function deactivateSession() {
  await chrome.storage.local.set({
    connect_running: false,
    [SESSION_ACTIVE_KEY]: false,
  });
}

async function invalidateSession() {
  await chrome.storage.sync.remove(["jh_token", "jh_email"]);
  await deactivateSession();
}

async function syncAuthSession(token, email) {
  if (token) {
    await chrome.storage.sync.set({ jh_token: token, jh_email: email || "" });
    await chrome.storage.local.set({ [SESSION_ACTIVE_KEY]: true });
    return;
  }
  await clearAuthSession();
}

async function clearAuthSession() {
  const { jh_token } = await chrome.storage.sync.get("jh_token");
  if (jh_token) {
    await cleanupBackendSession(jh_token).catch(() => {});
  }
  await invalidateSession();
}

async function cleanupBackendSession(token) {
  await postToBackendWithToken("/api/queue/stop", {}, token).catch(() => null);
  await postToBackendWithToken("/api/scrape/cancel", {}, token).catch(() => null);
  await postToBackendWithToken("/api/find-leads/cancel", {}, token).catch(() => null);
}

async function getAuthHeaders(includeContentType = true) {
  const data = await chrome.storage.sync.get("jh_token");
  const headers = {};
  if (includeContentType) headers["Content-Type"] = "application/json";
  if (data.jh_token) headers["Authorization"] = `Bearer ${data.jh_token}`;
  return headers;
}

async function postToBackendWithToken(path, data, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BACKEND}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Backend error: ${res.status}`);
  return res.json();
}

async function postToBackend(path, data) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BACKEND}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  if (res.status === 401) {
    await invalidateSession();
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error(`Backend error: ${res.status}`);
  return res.json();
}

async function patchToBackend(path, data) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BACKEND}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(data),
  });
  if (res.status === 401) {
    await invalidateSession();
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error(`Backend error: ${res.status}`);
  return res.json();
}

async function fetchFromBackend(path) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BACKEND}${path}`, { headers }).catch(() => null);
  if (res?.status === 401) {
    await invalidateSession();
    return null;
  }
  return res;
}

// Sync backend run-state → chrome.storage so alarm reads the right value
async function syncRunState() {
  try {
    const res = await fetchFromBackend("/api/queue/run-state");
    if (!res?.ok) return;
    const data = await res.json().catch(() => null);
    if (data && typeof data.running === "boolean") {
      await chrome.storage.local.set({ connect_running: data.running });
    }
  } catch {}
  await syncDailyLimitFromBackend();
  await syncConnectionsTodayFromBackend();
}

// The backend's daily_stats is the source of truth for today's sent count. Mirror
// it locally so the limit check can't drift (and so resetting it server-side
// actually clears the local cap).
async function syncConnectionsTodayFromBackend() {
  try {
    const res = await fetchFromBackend("/api/stats/today");
    if (!res?.ok) return;
    const data = await res.json().catch(() => null);
    if (!data) return;
    const sent = parseInt(data.connections_sent || 0, 10);
    if (Number.isFinite(sent)) {
      await chrome.storage.local.set({
        connections_today: sent,
        last_reset_date: new Date().toDateString(),
      });
    }
  } catch {}
}

async function ensureDailyReset() {
  const today = new Date().toDateString();
  const data = await chrome.storage.local.get(["connections_today", "last_reset_date"]);
  if (data.last_reset_date !== today) {
    await chrome.storage.local.set({ connections_today: 0, last_reset_date: today });
    return 0;
  }
  return data.connections_today || 0;
}

function sanitizeDailyLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DAILY_LIMIT;
  return Math.min(MAX_DAILY_LIMIT, Math.max(MIN_DAILY_LIMIT, parsed));
}

async function initializeDailyLimit() {
  const data = await chrome.storage.local.get("connect_daily_limit");
  if (data.connect_daily_limit == null) {
    await chrome.storage.local.set({ connect_daily_limit: DEFAULT_DAILY_LIMIT });
    return DEFAULT_DAILY_LIMIT;
  }
  const sanitized = sanitizeDailyLimit(data.connect_daily_limit);
  if (sanitized !== data.connect_daily_limit) {
    await chrome.storage.local.set({ connect_daily_limit: sanitized });
  }
  return sanitized;
}

async function getDailyLimit() {
  const data = await chrome.storage.local.get("connect_daily_limit");
  if (data.connect_daily_limit == null) {
    return initializeDailyLimit();
  }
  const sanitized = sanitizeDailyLimit(data.connect_daily_limit);
  if (sanitized !== data.connect_daily_limit) {
    await chrome.storage.local.set({ connect_daily_limit: sanitized });
  }
  return sanitized;
}

async function syncDailyLimitFromBackend() {
  try {
    const res = await fetchFromBackend("/api/stats/daily-limit");
    if (!res?.ok) return;
    const data = await res.json().catch(() => null);
    if (!data) return;
    const backendLimit = sanitizeDailyLimit(data.daily_limit);
    await chrome.storage.local.set({ connect_daily_limit: backendLimit });
  } catch {}
}

async function persistDailyLimitToBackend(limit) {
  try {
    await postToBackend("/api/stats/daily-limit", { daily_limit: sanitizeDailyLimit(limit) }).catch(() => null);
  } catch {}
}

// Send a message to a tab; if the content script is not present, try injecting it and retry once.
async function sendMessageToTabWithInjection(tabId, message, injectFile) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, async (response) => {
      if (!chrome.runtime.lastError) return resolve(response);
      console.warn('[bg] sendMessage error:', chrome.runtime.lastError.message, '— attempting to inject', injectFile);

      // Try to inject the requested content script file into the tab, then retry once
      try {
        chrome.scripting.executeScript({ target: { tabId }, files: [injectFile] }, async () => {
          // small delay to let the script initialize
          await new Promise(r => setTimeout(r, 500));
          chrome.tabs.sendMessage(tabId, message, (resp2) => {
            if (chrome.runtime.lastError) {
              console.warn('[bg] sendMessage after inject failed:', chrome.runtime.lastError.message);
              return resolve(null);
            }
            resolve(resp2);
          });
        });
      } catch (err) {
        console.error('[bg] scripting.executeScript failed:', err?.message || err);
        return resolve(null);
      }
    });
  });
}

// Resolves when a tab reaches status=complete (or after 15s timeout)
function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(finish, 15000);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") finish();
    }
    chrome.tabs.onUpdated.addListener(listener);
    // Already loaded?
    chrome.tabs.get(tabId, tab => { if (tab?.status === "complete") finish(); });
  });
}

async function fetchJob(job_id) {
  if (!job_id) return null;
  const res = await fetchFromBackend(`/api/jobs/${job_id}`);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function buildRoleTokens(title) {
  const lower = normalizeText(title).toLowerCase();
  const tokens = new Set();

  if (/(front[-\s]?end|frontend|ui|react)/.test(lower)) {
    ["frontend engineer", "frontend developer", "react developer"].forEach(t => tokens.add(t));
  }
  if (/(back[-\s]?end|backend|api|server|node)/.test(lower)) {
    ["backend engineer", "backend developer", "api engineer", "node.js developer"].forEach(t => tokens.add(t));
  }
  if (/(full\s*stack|fullstack)/.test(lower)) {
    ["full stack engineer", "full stack developer"].forEach(t => tokens.add(t));
  }
  if (/(data|machine learning|ml|ai)/.test(lower)) {
    ["data engineer", "machine learning engineer", "ai engineer"].forEach(t => tokens.add(t));
  }
  if (/(devops|sre)/.test(lower)) {
    ["devops engineer", "site reliability engineer"].forEach(t => tokens.add(t));
  }
  if (/(mobile|android|ios)/.test(lower)) {
    ["mobile engineer", "android engineer", "ios engineer"].forEach(t => tokens.add(t));
  }
  if (/(blockchain|web3|solidity)/.test(lower)) {
    ["blockchain engineer", "web3 engineer", "solidity developer"].forEach(t => tokens.add(t));
  }

  if (tokens.size === 0) {
    ["software engineer", "software developer"].forEach(t => tokens.add(t));
  }

  return Array.from(tokens).slice(0, 8);
}

function buildLeadQueries(company, jobTitle) {
  const cleanCompany = normalizeText(company);
  const roleTokens = buildRoleTokens(jobTitle);
  const roleQuery = roleTokens.map(t => `"${t}"`).join(" OR ");

  const queries = [
    `${cleanCompany} ("talent acquisition" OR recruiter OR "human resources" OR HR OR "people operations")`,
    `${cleanCompany} ("engineering manager" OR "hiring manager" OR "tech lead" OR "lead engineer" OR "vp engineering" OR CTO)`,
    `${cleanCompany} (${roleQuery})`,
  ];

  return queries.filter(q => q.trim().length > 0);
}

async function runPeopleSearch(query, job_id, company) {
  if (!(await hasActiveSession())) return [];
  const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}&origin=GLOBAL_SEARCH_HEADER`;
  const tab = await chrome.tabs.create({ url, active: false });

  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);
    };

    const timeout = setTimeout(() => {
      cleanup();
      if (tab?.id) chrome.tabs.remove(tab.id);
      resolve([]);
    }, 18000);

    function listener(tabId, info) {
      if (tabId !== tab.id || info.status !== "complete") return;
      cleanup();

      setTimeout(async () => {
        if (!(await hasActiveSession())) {
          chrome.tabs.remove(tab.id);
          return resolve([]);
        }

        const response = await sendMessageToTabWithInjection(tab.id, {
          type: "SCRAPE_PEOPLE",
          payload: { company, job_id }
        }, 'content/linkedin_people.js');

        if (!response) {
          chrome.tabs.remove(tab.id);
          return resolve([]);
        }

        chrome.tabs.remove(tab.id);
        resolve(response?.profiles || []);
      }, 2200);
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function openLinkedInPeopleSearch(company, job_id) {
  if (!(await hasActiveSession())) return { profiles: [] };
  const job = await fetchJob(job_id);
  const jobTitle = job?.title || "";
  const cleanCompany = normalizeText(company || job?.company || "");
  const queries = buildLeadQueries(cleanCompany, jobTitle);

  const collected = [];
  const seen = new Set();

  for (const q of queries) {
    if (!(await hasActiveSession())) break;
    console.log("[bg] Lead search query:", q);
    const profiles = await runPeopleSearch(q, job_id, cleanCompany);
    profiles.forEach(p => {
      if (!p?.profile_url || seen.has(p.profile_url)) return;
      seen.add(p.profile_url);
      collected.push(p);
    });
    if (collected.length >= 15) break;
  }

  if (collected.length > 0) {
    try {
      await postToBackend("/api/leads/batch", {
        profiles: collected,
        job_id,
        company: cleanCompany,
      });
      console.log(`[bg] Sent ${collected.length} profiles to backend`);
    } catch (err) {
      console.error("[bg] Failed to post leads:", err.message);
    }
  }

  return { profiles: collected };
}
