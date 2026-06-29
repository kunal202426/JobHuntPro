// Runs on the frontend domain (see manifest content_scripts match) — reads the
// logged-in JWT from localStorage and pushes it to the background service worker.
(function () {
  // Mark DOM so the web app can detect that the extension is installed
  document.documentElement.setAttribute('data-jh-ext', '1');

  function deriveEmail(token) {
    if (!token) return "";
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      return payload.email || "";
    } catch {
      return "";
    }
  }

  function syncTokenState(tokenOverride) {
    const token = typeof tokenOverride === "undefined" ? localStorage.getItem("jh_token") : tokenOverride;
    chrome.runtime.sendMessage({
      type: "TOKEN_SYNC",
      token: token || null,
      email: deriveEmail(token),
    });
  }

  syncTokenState();

  // When the web app triggers a scrape, signal background to process immediately
  // (bypasses the 30s alarm cycle so scraping starts right away)
  window.addEventListener('jh:trigger-scrape', () => {
    chrome.runtime.sendMessage({ type: "TRIGGER_SCRAPE_NOW" });
  });

  // Same for the connect queue (Start Queue / Retry) — start without waiting.
  window.addEventListener('jh:trigger-connect', () => {
    chrome.runtime.sendMessage({ type: "TRIGGER_CONNECT_NOW" });
  });

  // Instahyre bulk auto-apply.
  window.addEventListener('jh:trigger-apply', () => {
    chrome.runtime.sendMessage({ type: "TRIGGER_APPLY_NOW" });
  });

  window.addEventListener("jh:auth-sync", (event) => {
    syncTokenState(event.detail?.token ?? null);
  });

  window.addEventListener("storage", (event) => {
    if (event.key === "jh_token") syncTokenState(event.newValue);
  });
})();
