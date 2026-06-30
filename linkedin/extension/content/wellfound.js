// content/wellfound.js — Wellfound job scraper.
// Wellfound is a Next.js SSR app that also fetches more jobs client-side via
// Apollo/GraphQL as the user scrolls. We scrape the initial DOM (SSR-rendered),
// then trigger scroll to load extra pages. Job links have the form /jobs/<id>-<slug>.

(() => {
  if (window.__jobHuntWellfoundInitialized) {
    console.log("[Wellfound] Already initialized; skipping");
    return;
  }
  window.__jobHuntWellfoundInitialized = true;

  const SOURCE = "wellfound";
  const HOST = "https://wellfound.com";

  // --- Freshness -----------------------------------------------------------
  // Wellfound shows "Posted today", "Posted yesterday", "Posted N days ago".
  // We include today + yesterday + 2 days ago (≤48h in practice).
  function postedToEpoch(text) {
    const t = (text || "").toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    if (!t || t.includes("today"))     return now;
    if (t.includes("yesterday"))       return now - 86400;
    const dm = t.match(/(\d+)\s*day/);  if (dm) return now - parseInt(dm[1]) * 86400;
    const hm = t.match(/(\d+)\s*hour/); if (hm) return now - parseInt(hm[1]) * 3600;
    return null;
  }

  function isFresh(text) {
    const t = (text || "").toLowerCase();
    if (!t || t.includes("today") || t.includes("yesterday")) return true;
    const dm = t.match(/(\d+)\s*day/);
    if (dm) return parseInt(dm[1]) <= 2;
    return true; // unknown → include
  }

  // Use the shared filter if injected (same isFreshWithin logic).
  function checkFreshEpoch(epoch) {
    if (window.__jhJobFilter && epoch) return window.__jhJobFilter.isFreshWithin(epoch);
    if (!epoch) return true;
    return (Math.floor(Date.now() / 1000) - epoch) < 2 * 86400;
  }

  // --- DOM helpers ---------------------------------------------------------
  const clean = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();

  function getPostedText(link) {
    for (const span of link.querySelectorAll("span")) {
      const t = clean(span);
      if (/^posted\b/i.test(t)) return t;
    }
    return null;
  }

  function getCompanyName(link) {
    const block = link.closest('[data-test="StartupResult"]');
    if (!block) return null;
    // Company name is in an h2 with Tailwind classes inside the header area
    const h2 = block.querySelector('h2.inline, h2[class*="font-semibold"]');
    return clean(h2) || null;
  }

  function extractJob(link) {
    try {
      const href = link.getAttribute("href") || "";
      // Job hrefs look like /jobs/1234567-some-title (digit after /jobs/)
      if (!/^\/jobs\/\d/.test(href)) return null;

      const job_url = HOST + href;
      const title = clean(link.querySelector('[class*="title"]'));
      if (!title) return null;

      // Skip obviously senior/lead titles if the shared filter is available
      if (window.__jhJobFilter && window.__jhJobFilter.isExcludedTitle(title)) return null;

      const company = getCompanyName(link);

      // Locations — take first two, skip "More"
      const locs = Array.from(link.querySelectorAll('[class*="location"]'))
        .map(el => clean(el))
        .filter(t => t && t !== "More")
        .slice(0, 2);
      const location = locs.join(", ") || null;

      // Salary — strip equity info ("• No equity", "• 0.01% equity", …)
      const salary = clean(link.querySelector('[class*="compensation"]'))
        .split("•")[0].trim() || null;

      const postedText = getPostedText(link);
      if (!isFresh(postedText)) return null;
      const posted_at_parsed = postedToEpoch(postedText);
      if (!checkFreshEpoch(posted_at_parsed)) return null;

      return {
        title,
        company,
        location,
        source: SOURCE,
        job_url,
        posted_at: postedText || null,
        posted_at_parsed,
        experience_required: null,
        skills: [],
        salary,
        is_startup: true,
      };
    } catch (e) {
      console.warn("[Wellfound] extractJob:", e.message);
      return null;
    }
  }

  // --- Batching ------------------------------------------------------------
  const seen = new Set();
  const pending = [];
  let debounce = null;

  function tryAdd(link) {
    const job = extractJob(link);
    if (!job || seen.has(job.job_url)) return false;
    seen.add(job.job_url);
    pending.push(job);
    return true;
  }

  function flush() {
    if (!pending.length) return;
    const batch = pending.splice(0);
    console.log(`[Wellfound] Sending ${batch.length} jobs (total seen: ${seen.size})`);
    chrome.runtime.sendMessage({ type: "JOBS_SCRAPED", payload: batch }, () => {
      if (chrome.runtime.lastError) console.warn("[Wellfound]", chrome.runtime.lastError.message);
    });
  }

  function debouncedFlush() {
    clearTimeout(debounce);
    debounce = setTimeout(flush, 1500);
  }

  function scrapeAll(label) {
    let added = 0;
    document.querySelectorAll('a[href^="/jobs/"]').forEach(link => {
      if (tryAdd(link)) added++;
    });
    if (added) debouncedFlush();
    if (added || label === "Initial") console.log(`[Wellfound] ${label}: +${added}`);
    return added;
  }

  // --- Mutation observer for dynamic loads ---------------------------------
  const observer = new MutationObserver(() => {
    let added = 0;
    document.querySelectorAll('a[href^="/jobs/"]').forEach(link => {
      if (tryAdd(link)) added++;
    });
    if (added) debouncedFlush();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // --- Scroll to load more pages -------------------------------------------
  let scrollInterval = null;
  function startScroll() {
    let cycles = 0;
    scrollInterval = setInterval(() => {
      cycles++;
      window.scrollBy({ top: 900, behavior: "smooth" });
      const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 150;
      if (atBottom || cycles >= 20) {
        clearInterval(scrollInterval);
        setTimeout(() => {
          scrapeAll("Final sweep");
          flush();
          console.log(`[Wellfound] Done — ${seen.size} jobs`);
        }, 1000);
      }
    }, 1800);
  }

  // --- Boot ----------------------------------------------------------------
  const initial = scrapeAll("Initial");
  if (initial === 0) {
    [1000, 2500, 5000].forEach(d => setTimeout(() => scrapeAll(`Retry +${d}ms`), d));
  }
  setTimeout(startScroll, 2200);
})();
