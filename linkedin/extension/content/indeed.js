// content/indeed.js — Indeed (in.indeed.com) job scraper.
// Server-rendered results, one page per load (no infinite scroll) — the
// freshness (fromage) and experience-level (explvl) filters are already baked
// into the search URL by background.js, one URL per keyword iteration. This
// script just extracts whatever's on the page and moves on; background.js
// handles navigating to the next keyword.

(() => {
  if (window.__jobHuntIndeedInitialized) {
    console.log("[Indeed] Already initialized; skipping");
    return;
  }
  window.__jobHuntIndeedInitialized = true;

  function cleanText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function isRelevant(title) {
    if (window.__jhJobFilter) return !window.__jhJobFilter.isExcludedTitle(title);
    return true;
  }

  function tooMuchExperience(text) {
    if (window.__jhJobFilter) return window.__jhJobFilter.tooMuchExperience(text);
    return false;
  }

  function extractJob(card) {
    try {
      const titleEl = card.querySelector("h3.jobTitle span[title]") || card.querySelector("h3.jobTitle a");
      const title = cleanText(titleEl?.getAttribute?.("title") || titleEl?.textContent);
      if (!title || !isRelevant(title)) return null;

      // Indeed's own job key (data-jk) gives a clean, stable permalink —
      // much better than the tracking-redirect href on the title link.
      const jkEl = card.querySelector("[data-jk]");
      const jk = jkEl?.getAttribute("data-jk");
      if (!jk) return null;
      const job_url = `https://in.indeed.com/viewjob?jk=${jk}`;

      const company = cleanText(card.querySelector('[data-testid="company-name"]')?.textContent) || null;
      const location = cleanText(card.querySelector('[data-testid="text-location"]')?.textContent) || null;

      const metaItems = Array.from(card.querySelectorAll(".jobMetaDataGroup li, .metadataContainer li"))
        .map((li) => cleanText(li.textContent))
        .filter(Boolean);

      const salary = metaItems.find((t) => /[₹$]/.test(t)) || null;
      const experience_required = metaItems.find((t) => /\byears?\b/i.test(t) && /\d/.test(t)) || null;
      if (tooMuchExperience(experience_required)) return null;

      const skills = metaItems.filter((t) => t !== salary && t !== experience_required).slice(0, 6);

      return {
        title,
        company,
        location,
        source: "indeed",
        job_url,
        posted_at: null,
        posted_at_parsed: null,
        experience_required,
        skills,
        salary,
        is_startup: false,
      };
    } catch (e) {
      console.warn("[Indeed] extractJob:", e.message);
      return null;
    }
  }

  const seen = new Set();
  const pending = [];

  function tryAdd(card) {
    const job = extractJob(card);
    if (!job || seen.has(job.job_url)) return false;
    seen.add(job.job_url);
    pending.push(job);
    return true;
  }

  function flush() {
    if (!pending.length) return;
    const batch = pending.splice(0);
    console.log(`[Indeed] Sending ${batch.length} jobs`);
    chrome.runtime.sendMessage({ type: "JOBS_SCRAPED", payload: batch }, () => {
      if (chrome.runtime.lastError) console.warn("[Indeed]", chrome.runtime.lastError.message);
    });
  }

  function getCardNodes() {
    return Array.from(document.querySelectorAll(".job_seen_beacon"));
  }

  async function run() {
    // SSR page — cards may not be present for the first instant on a fresh
    // navigation; a short retry loop covers that without needing a scroll loop.
    let cards = getCardNodes();
    for (let i = 0; i < 6 && cards.length === 0; i++) {
      await sleep(500);
      cards = getCardNodes();
    }

    let added = 0;
    cards.forEach((c) => { if (tryAdd(c)) added++; });
    console.log(`[Indeed] Found ${cards.length} cards, ${added} new/relevant`);
    flush();
  }

  run();
})();
