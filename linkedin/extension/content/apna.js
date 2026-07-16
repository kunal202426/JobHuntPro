// content/apna.js — Apna (apna.co) job scraper.
// Apna's "Date posted" filter is pure client-side React state (confirmed: the
// URL never changes when applying it), so unlike LinkedIn/Indeed we can't just
// build a filtered URL — the content script has to drive the filter itself:
// click the "Last 24 hours" radio, wait for the list to re-render, then scrape.
// Apna has no experience-level filter at all, so job_match.js's experience
// gate does real work here (not just a safety net).

(() => {
  if (window.__jobHuntApnaInitialized) {
    console.log("[Apna] Already initialized; skipping");
    return;
  }
  window.__jobHuntApnaInitialized = true;

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function cleanText(value) { return (value || "").replace(/\s+/g, " ").trim(); }

  function isRelevant(title) {
    if (window.__jhJobFilter) return !window.__jhJobFilter.isExcludedTitle(title);
    return true;
  }

  function tooMuchExperience(text) {
    if (window.__jhJobFilter) return window.__jhJobFilter.tooMuchExperience(text);
    return false;
  }

  // --- Date-posted filter automation -----------------------------------
  async function applyLast24hFilter() {
    let radio = null;
    for (let i = 0; i < 20; i++) {
      radio = Array.from(document.querySelectorAll('input[type="radio"]'))
        .find((r) => r.value === "Last 24 hours");
      if (radio) break;
      await sleep(300);
    }
    if (!radio) {
      console.log("[Apna] Date-posted filter not found — scraping unfiltered feed");
      return false;
    }
    if (radio.checked) return true;

    radio.click();
    await sleep(1200);

    const nowChecked = Array.from(document.querySelectorAll('input[type="radio"]'))
      .find((r) => r.value === "Last 24 hours")?.checked;
    if (!nowChecked) {
      console.warn("[Apna] Last 24 hours filter click didn't register");
      return false;
    }
    console.log("[Apna] Last 24 hours filter applied");
    return true;
  }

  // --- Card extraction ----------------------------------------------------
  function nearestSpanAfterIcon(card, testId) {
    const icon = card.querySelector(`[data-testid="${testId}"]`);
    if (!icon) return null;
    const row = icon.closest("div");
    return row ? row.querySelector("span") : null;
  }

  function getTagTexts(card) {
    const row = card.querySelector(".flex.w-full.flex-nowrap");
    if (!row) return [];
    return Array.from(row.querySelectorAll("span"))
      .map((s) => cleanText(s.textContent))
      .filter(Boolean);
  }

  function extractJob(card) {
    try {
      const job_url = card.href;
      if (!job_url) return null;

      const title = cleanText(card.querySelector("h2")?.textContent);
      if (!title || !isRelevant(title)) return null;

      // Company name sits right after the title in its own span, before the
      // location/salary rows — grab the first plain span in that top block.
      const nameBlock = card.querySelector("h2")?.parentElement;
      const company = cleanText(nameBlock?.querySelector("span")?.textContent) || null;

      const location = cleanText(nearestSpanAfterIcon(card, "LocationOnIcon")?.textContent) || null;
      const salary = cleanText(nearestSpanAfterIcon(card, "PaymentsIcon")?.textContent) || null;

      const tags = getTagTexts(card);
      const experience_required = tags.find((t) => /\byears?\b/i.test(t) || /any experience/i.test(t)) || null;
      if (tooMuchExperience(experience_required)) return null;

      const skills = tags.filter((t) => t !== experience_required && t !== "Full Time" && t !== "Part Time");

      return {
        title,
        company,
        location,
        source: "apna",
        job_url,
        posted_at: null,
        posted_at_parsed: null,
        experience_required,
        skills,
        salary,
        is_startup: false,
      };
    } catch (e) {
      console.warn("[Apna] extractJob:", e.message);
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

  function getCardNodes() {
    return Array.from(document.querySelectorAll('a[data-testid="job-card"]'));
  }

  function scrapeAll(label) {
    const cards = getCardNodes();
    let added = 0;
    cards.forEach((c) => { if (tryAdd(c)) added++; });
    console.log(`[Apna] ${label}: ${cards.length} cards, ${added} new/relevant`);
    return added;
  }

  function flush() {
    if (!pending.length) return;
    const batch = pending.splice(0);
    console.log(`[Apna] Sending ${batch.length} jobs`);
    chrome.runtime.sendMessage({ type: "JOBS_SCRAPED", payload: batch }, () => {
      if (chrome.runtime.lastError) console.warn("[Apna]", chrome.runtime.lastError.message);
    });
  }

  function clickNextPage() {
    const links = Array.from(document.querySelectorAll("a, button"));
    const next = links.find((el) => /^next$/i.test(cleanText(el.textContent)));
    if (!next) return false;
    next.click();
    return true;
  }

  async function run() {
    await applyLast24hFilter();

    let cards = getCardNodes();
    for (let i = 0; i < 8 && cards.length === 0; i++) {
      await sleep(400);
      cards = getCardNodes();
    }

    scrapeAll("Initial");
    flush();

    // A handful of pages is plenty — Apna's "Last 24 hours" + a specific
    // category rarely runs past a couple dozen results.
    for (let page = 0; page < 5; page++) {
      const moved = clickNextPage();
      if (!moved) break;
      await sleep(2000);
      scrapeAll(`Page ${page + 2}`);
      flush();
    }

    console.log(`[Apna] Done — ${seen.size} jobs total`);
  }

  run();
})();
