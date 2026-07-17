// content/instahyre.js — Instahyre job card scraper

(() => {
  if (window.__jobHuntInstahyreInitialized) {
    console.log("[Instahyre] Scraper already initialized; skipping duplicate injection");
    return;
  }
  window.__jobHuntInstahyreInitialized = true;

  // Fallback keyword list used only when the user hasn't set their own
  // skills/target-keywords in Settings — see job_match.js's getResumeKeywords.
  const DEFAULT_TECH_KEYWORDS = [
    "software", "developer", "engineer", "sde", "backend", "frontend",
    "full stack", "fullstack", "python", "react", "node", "ml",
    "machine learning", "ai", "data engineer", "fintech",
  ];

  const seenUrls = new Set();
  const pendingJobs = [];
  let debounceTimer = null;
  let autoScrollTimer = null;
  let observer = null;

  function cleanText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function splitHeaderText(text) {
    const normalized = cleanText(text);
    if (!normalized) return { company: null, title: null };

    const separators = [" - ", " – ", " — "];
    for (const separator of separators) {
      const idx = normalized.indexOf(separator);
      if (idx > 0) {
        return {
          company: cleanText(normalized.slice(0, idx)),
          title: cleanText(normalized.slice(idx + separator.length)),
        };
      }
    }

    return { company: null, title: normalized };
  }

  function isRelevant(title) {
    const lower = (title || "").toLowerCase();
    if (window.__jhJobFilter && window.__jhJobFilter.isExcludedTitle(title)) return false;
    const keywords = window.__jhJobFilter
      ? window.__jhJobFilter.getResumeKeywords(DEFAULT_TECH_KEYWORDS)
      : DEFAULT_TECH_KEYWORDS;
    return keywords.some((kw) => lower.includes(kw));
  }

  function parsePostedAt(text) {
    if (window.__jhJobFilter) return window.__jhJobFilter.parsePostedAt(text);
    return { raw: text || null, parsed: null };
  }

  function isFresh(parsedTs) {
    if (window.__jhJobFilter) return window.__jhJobFilter.isFreshWithin(parsedTs);
    if (!parsedTs) return true;
    return (Math.floor(Date.now() / 1000) - parsedTs) < (2 * 86400);
  }

  function getCompanyAndTitle(card) {
    const desktopHeader =
      cleanText(card.querySelector(".employer-details .employer-job-name .company-name")?.textContent) ||
      cleanText(card.querySelector(".employer-job-name .company-name")?.textContent) ||
      cleanText(card.querySelector(".employer-job-name")?.getAttribute("title"));

    const mobileTitle = cleanText(card.querySelector(".employer-details-mobile .employer-job-name .company-name")?.textContent);
    const mobileCompany = cleanText(card.querySelector(".employer-details-mobile .employer-company-name .company-name")?.textContent);

    const parsedDesktop = splitHeaderText(desktopHeader);
    const company = parsedDesktop.company || mobileCompany || null;
    const title = parsedDesktop.title || mobileTitle || null;

    return { company, title };
  }

  // On /candidate/opportunities/, cards have no href — the "View" trigger is an
  // ng-click that opens an in-page modal. The only stable per-job identifier on
  // the card itself is the numeric id embedded in the skills list's DOM id
  // (e.g. id="job-skills-431345").
  function extractJobId(card) {
    const skillsList = card.querySelector('ul[id^="job-skills-"]');
    if (!skillsList) return null;
    const m = skillsList.id.match(/job-skills-(\d+)/);
    return m ? m[1] : null;
  }

  function extractJobCard(card) {
    try {
      let jobUrl =
        card.querySelector("a.text-link[href*='/job-']")?.href ||
        card.querySelector("a[href*='/job-']")?.href ||
        card.querySelector("a[href*='/job/']")?.href ||
        card.querySelector("a[href*='/jobs/']")?.href;

      if (!jobUrl) {
        const parentLink = card.closest("a[href]");
        jobUrl = parentLink?.href;
      }

      const jobId = extractJobId(card);
      if (!jobUrl && jobId) {
        jobUrl = `https://www.instahyre.com/candidate/opportunities/?jid=${jobId}`;
      }
      if (!jobUrl) return null;
      if (!jobUrl.startsWith("http")) jobUrl = "https://www.instahyre.com" + jobUrl;
      if (!jobId) jobUrl = jobUrl.split("?")[0];

      const { company, title } = getCompanyAndTitle(card);
      if (!title || !company || !isRelevant(title)) return null;

      const locationEl =
        card.querySelector(".employer-locations .info .ng-binding") ||
        card.querySelector(".employer-locations .info") ||
        card.querySelector(".employer-details-mobile .employer-locations .ng-binding") ||
        card.querySelector(".employer-locations .ng-binding") ||
        card.querySelector("[class*='location']") ||
        card.querySelector("[class*='city']") ||
        card.querySelector("[class*='place']");
      const location = cleanText(locationEl?.textContent).replace(/^job available in\s*/i, "") || null;

      const postedEl =
        card.querySelector("[class*='active']") ||
        card.querySelector("[class*='posted']") ||
        card.querySelector("[class*='time']") ||
        card.querySelector("time") ||
        card.querySelector("[class*='date']");
      const { raw: posted_at, parsed: posted_at_parsed } = parsePostedAt(cleanText(postedEl?.textContent));
      if (!isFresh(posted_at_parsed)) return null;

      const expEl =
        card.querySelector("[class*='experience']") ||
        card.querySelector("[class*='exp']") ||
        card.querySelector("[class*='yrs']");
      const experience_required = cleanText(expEl?.textContent) || null;
      // Trust Instahyre's own search filter (years=0) instead of re-parsing
      // this text ourselves — don't reject based on it.

      const salaryEl =
        card.querySelector("[class*='salary']") ||
        card.querySelector("[class*='ctc']") ||
        card.querySelector("[class*='pay']");
      const salary = cleanText(salaryEl?.textContent) || null;

      const skillEls = card.querySelectorAll(
        ".job-skills li, .candidate-opp-keywords li, " +
        "[class*='skill'] span, [class*='tag'] span, " +
        "[class*='skill-tag'], [class*='skillTag'], [class*='technology'] span, " +
        "[class*='tag'] li"
      );
      const skills = Array.from(skillEls)
        .map((el) => cleanText(el.textContent))
        .filter((s) => s && s.length > 1 && s.length < 40 && !/^\+\d+$/.test(s));

      return {
        title,
        company,
        location,
        source: "instahyre",
        job_url: jobUrl,
        posted_at,
        posted_at_parsed,
        experience_required,
        skills,
        salary,
        is_startup: false,
      };
    } catch (err) {
      console.warn("[Instahyre] Card parse error:", err.message);
      return null;
    }
  }

  function getCardNodes() {
    const selectors = [
      ".opp-list-container .employer-block",
      ".candidate-opportunities .employer-block",
      ".opp-list-container .employer-row",
      ".candidate-opportunities .employer-row",
      "a.text-link[href*='/job-']",
      "[class*='job-card']",
      "[class*='jobCard']",
      "[class*='JobCard']",
      "[class*='job-listing']",
      "[class*='jobListing']",
      "[class*='job-item']",
      "article[class*='job']",
      "[data-job-id]",
    ];

    for (const selector of selectors) {
      const found = Array.from(document.querySelectorAll(selector));
      if (found.length > 0) return found;
    }
    return [];
  }

  function sendPendingJobs() {
    if (pendingJobs.length === 0) return;
    const batch = pendingJobs.splice(0, pendingJobs.length);
    console.log(`[Instahyre] Sending ${batch.length} jobs to backend`);
    chrome.runtime.sendMessage({ type: "JOBS_SCRAPED", payload: batch }, (res) => {
      if (chrome.runtime.lastError) {
        console.warn("[Instahyre] Message error:", chrome.runtime.lastError.message);
      } else {
        console.log("[Instahyre] Backend response:", res);
      }
    });
  }

  function debouncedSend() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sendPendingJobs, 1500);
  }

  // --- Merged apply: since there's no standalone job page, the only way to
  // apply is to click a card's "View" while it's still rendered on the feed —
  // exactly where we already are during scraping. Doing this as a separate
  // pass afterward meant reopening the feed, re-finding each card by id, and
  // running its own scroll/page loop — slower and less reliable than just
  // applying inline, one card at a time, the moment we find it here.
  const APPLIED_TEXT_RE = /you have applied|application sent|applied on|already applied|view application|you applied/i;

  function isVisible(el) {
    if (!el) return false;
    try {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
      return el.getClientRects().length > 0;
    } catch { return true; }
  }

  function alreadyAppliedText(root) {
    return APPLIED_TEXT_RE.test(cleanText((root || document.body).innerText));
  }

  function findApplyButtonInModal(root) {
    const candidates = Array.from((root || document).querySelectorAll("button, a.btn, .btn"));
    for (const b of candidates) {
      if (!isVisible(b)) continue;
      const txt = cleanText(b.textContent).toLowerCase();
      if (txt !== "apply" && txt !== "apply now") continue;
      if (b.disabled || b.getAttribute("disabled") !== null) continue;
      return b;
    }
    return null;
  }

  function findModalRoot() {
    return document.querySelector(".candidate-apply-modal");
  }

  function findModalCloseControl(root) {
    if (!root) return null;
    return (
      root.querySelector(".application-modal-close") ||
      root.querySelector('[ng-click*="close"]') ||
      root.querySelector(".application-modal-backdrop")
    );
  }

  function closeModal() {
    const root = findModalRoot();
    const close = findModalCloseControl(root);
    if (close) { close.click(); return; }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }

  function findViewTrigger(card) {
    return card.querySelector("a.text-link") || card.querySelector("#interested-btn");
  }

  async function attemptApply(card) {
    const trigger = findViewTrigger(card);
    if (!trigger) return { status: "failed", error: "view_trigger_not_found" };

    trigger.click();

    let root = null;
    for (let i = 0; i < 30; i++) {
      root = findModalRoot();
      if (root && root.querySelector("button, a.btn, .btn") && cleanText(root.textContent).length > 20) break;
      await sleep(150);
      root = null;
    }
    if (!root) return { status: "failed", error: "apply_modal_did_not_open" };

    await sleep(150); // let Angular finish rendering job details

    if (alreadyAppliedText(root)) {
      closeModal();
      return { status: "already_applied" };
    }

    // Trust Instahyre's own search filter (years=0 + job functions) instead of
    // re-parsing the experience text ourselves — that was rejecting jobs it
    // shouldn't have (see job_match.js history for why).
    const btn = findApplyButtonInModal(root);
    if (!btn) {
      closeModal();
      return { status: "failed", error: "apply_button_not_found" };
    }

    btn.click();

    let result = { status: "failed", error: "apply_unconfirmed" };
    for (let i = 0; i < 24; i++) {
      await sleep(200);
      const stillRoot = findModalRoot();
      if (!stillRoot || alreadyAppliedText(stillRoot) || !findApplyButtonInModal(stillRoot)) {
        result = { status: "applied" };
        break;
      }
    }

    closeModal();
    return result;
  }

  const applyQueue = [];
  let applyQueueRunning = false;
  let appliedCount = 0;

  function enqueueForApply(card, job) {
    applyQueue.push({ card, job });
    runApplyQueue();
  }

  // Sent one job at a time, bypassing the scrape batch debounce, so each
  // apply shows up on the dashboard immediately instead of waiting to be
  // batched with whatever else the scroller finds next.
  function sendJobImmediately(job) {
    chrome.runtime.sendMessage({ type: "JOBS_SCRAPED", payload: [job] }, (res) => {
      if (chrome.runtime.lastError) console.warn("[Instahyre]", chrome.runtime.lastError.message);
    });
  }

  async function runApplyQueue() {
    if (applyQueueRunning) return;
    applyQueueRunning = true;
    try {
      while (applyQueue.length > 0) {
        const { card, job } = applyQueue.shift();
        try {
          const outcome = await attemptApply(card);
          if (outcome.status === "applied" || outcome.status === "already_applied") {
            job.status = "applied";
            appliedCount++;
            sendJobImmediately(job);
            console.log(`[Instahyre] Applied (${appliedCount}): ${job.title} @ ${job.company}`);
          } else if (outcome.status === "discarded") {
            console.log(`[Instahyre] Skipped (too experienced, ${outcome.error}): ${job.title} @ ${job.company}`);
            // Not saved — matches the old separate-apply flow's discard behavior.
          } else {
            // Apply failed for a technical reason (button missing, timeout,
            // modal never opened) — still save it as a normal unseen job so
            // it isn't lost. To retry: use "Delete Scraped Jobs (not applied)"
            // then scrape again — the fresh row will go through the apply
            // attempt once more (a duplicate row would just be skipped).
            console.warn(`[Instahyre] Apply failed (${outcome.error}) — saved as unseen: ${job.title} @ ${job.company}`);
            sendJobImmediately(job);
          }
        } catch (err) {
          console.warn("[Instahyre] Apply queue error:", err.message);
          closeModal();
          sendJobImmediately(job);
        }
        await sleep(150); // just enough for the modal-close animation to finish
      }
    } finally {
      applyQueueRunning = false;
    }
  }

  function tryAddCard(node) {
    const card = node.matches?.(".employer-block, .employer-row, a.text-link[href*='/job-']") ? node : node.closest?.(".employer-block, .employer-row");
    const target = card || node;
    const job = extractJobCard(target);
    if (!job || seenUrls.has(job.job_url)) return false;
    seenUrls.add(job.job_url);
    enqueueForApply(target, job);
    return true;
  }

  function scrapeAllCards(label = "Scrape") {
    const cards = getCardNodes();
    if (cards.length === 0) {
      console.log("[Instahyre] No job cards found with known selectors");
      return 0;
    }

    let added = 0;
    cards.forEach((card) => {
      if (tryAddCard(card)) added++;
    });

    if (added > 0) debouncedSend();
    console.log(`[Instahyre] ${label}: ${added} jobs from ${cards.length} cards`);
    return cards.length;
  }

  function getScrollContainer() {
    const candidates = [
      document.querySelector(".opp-list-container"),
      document.querySelector(".candidate-opportunities"),
      document.querySelector(".facets-main"),
      document.scrollingElement,
      document.documentElement,
      document.body,
    ].filter(Boolean);

    for (const el of candidates) {
      if (el.scrollHeight > el.clientHeight) return el;
    }
    return document.scrollingElement || document.documentElement;
  }

  function clickNextPage() {
    const candidates = Array.from(document.querySelectorAll(".pagination li, .pagination a, .pagination span"));
    const next = candidates.find((el) => /next/i.test(cleanText(el.textContent)) && !el.classList.contains("hidden"));
    if (!next) return false;
    next.click();
    return true;
  }

  function startAutoScroll() {
    if (autoScrollTimer) return;

    const container = getScrollContainer();
    let cycles = 0;
    let idleCycles = 0;
    let pageClicks = 0;
    let lastSeenCount = seenUrls.size;
    const MAX_CYCLES = 24;
    const MAX_IDLE = 5;
    const MAX_PAGES = 20; // 76+ jobs at ~30/page needs more than the old cap of 6

    console.log("[Instahyre] Auto-scroll started");
    autoScrollTimer = setInterval(() => {
      // Pagination REPLACES the whole card list — if we advance while jobs are
      // still sitting in the apply queue, their DOM references go stale and
      // silently fail to apply. Never scroll/paginate while there's apply work
      // outstanding; just wait for the queue to drain, then continue.
      if (applyQueue.length > 0 || applyQueueRunning) return;

      container.scrollBy({ top: 900, left: 0, behavior: "smooth" });
      cycles++;

      setTimeout(() => {
        if (applyQueue.length > 0 || applyQueueRunning) return; // queue filled during the scroll itself

        scrapeAllCards(`Auto-scroll cycle ${cycles}`);
        if (seenUrls.size > lastSeenCount) {
          lastSeenCount = seenUrls.size;
          idleCycles = 0;
          return;
        }

        idleCycles++;
        const atBottom = Math.ceil(container.scrollTop + container.clientHeight) >= (container.scrollHeight - 10);
        if ((idleCycles >= MAX_IDLE || atBottom) && pageClicks < MAX_PAGES) {
          if (applyQueue.length > 0 || applyQueueRunning) return; // don't paginate mid-apply
          const moved = clickNextPage();
          if (moved) {
            pageClicks++;
            idleCycles = 0;
            cycles = 0;
            console.log(`[Instahyre] Moving to next page (${pageClicks + 1})`);
            setTimeout(() => scrapeAllCards("After pagination"), 2200);
            return;
          }
        }

        if (cycles >= MAX_CYCLES || (idleCycles >= MAX_IDLE && !atBottom) || (atBottom && pageClicks >= MAX_PAGES)) {
          clearInterval(autoScrollTimer);
          autoScrollTimer = null;
          console.log(`[Instahyre] Auto-scroll stopped (idle=${idleCycles}, pages=${pageClicks + 1})`);
        }
      }, 700);
    }, 1500);
  }

  // --- Search-form automation -----------------------------------------------
  // Instahyre's Angular app never reads search filters from the URL — they only
  // apply once the sidebar "Search other jobs" form is filled and "Show results"
  // is clicked (confirmed: submitting produces a plain ?matching=true URL, no
  // query params at all). So we drive the form directly: select "All - Software
  // Engineering" + "All - Data Science and Analysis" job functions, set
  // Experience (years) = 0, then click Show results.
  const JOB_FUNCTION_VALUES = ["/api/v1/job_category/1", "/api/v1/job_category/8"];
  // Instahyre's "Experience (years)" field expects the CANDIDATE'S OWN years
  // of experience, not a cap on the job — sourced from the user's profile so
  // it isn't hardcoded to a fresh grad (defaults to 0 if no profile is set).
  function getTargetYears() {
    const y = window.__jhProfile?.experienceYears;
    return Number.isFinite(y) ? String(Math.max(0, Math.round(y))) : "0";
  }

  // "Software Engineering" (job_category/1) has no clickable "All -" .option row
  // of its own in the dropdown — unlike every other group (Data Science, IT Ops,
  // etc.), which DO render a normal "All - X" option. For Software Engineering,
  // selecting the whole category only works by clicking its .optgroup-header.
  const CATEGORY_HEADER_FALLBACK = {
    "/api/v1/job_category/1": "Software Engineering",
  };

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // The sidebar has several Selectize widgets (Skills, Job Functions,
  // Industries, Locations, Companies) — each renders its own
  // ".selectize-control > .selectize-input + .selectize-dropdown" pair. A bare
  // document.querySelector(".selectize-dropdown.multi") returns whichever one
  // happens to be first in DOM order, NOT necessarily the one we just opened.
  // Everything below is scoped through the #job-functions-selectized input's
  // own .selectize-control wrapper so we never touch another widget by mistake.
  function getJobFunctionsControl() {
    const input = document.getElementById("job-functions-selectized");
    return input ? input.closest(".selectize-control") : null;
  }

  function isJobFunctionSelected(value) {
    const control = getJobFunctionsControl();
    if (!control) return false;
    return Array.from(control.querySelectorAll(".item"))
      .some((el) => el.getAttribute("data-value") === value);
  }

  async function openJobFunctionsDropdown() {
    const control = getJobFunctionsControl();
    const input = document.getElementById("job-functions-selectized");
    if (!control || !input) return null;

    const inputWrap = control.querySelector(".selectize-input");
    (inputWrap || input).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    input.focus();

    for (let i = 0; i < 10; i++) {
      const dropdown = control.querySelector(".selectize-dropdown");
      if (dropdown && dropdown.style.display !== "none") return dropdown;
      await sleep(200);
    }
    return null;
  }

  async function selectJobFunction(value) {
    if (isJobFunctionSelected(value)) return true;

    const dropdown = await openJobFunctionsDropdown();
    if (!dropdown) {
      console.warn("[Instahyre] Job-functions dropdown did not open for", value);
      return false;
    }

    let target = Array.from(dropdown.querySelectorAll(".option"))
      .find((o) => o.getAttribute("data-value") === value);

    // Fall back to clicking the optgroup header for categories with no direct
    // "All -" option row.
    if (!target && CATEGORY_HEADER_FALLBACK[value]) {
      const label = CATEGORY_HEADER_FALLBACK[value];
      target = Array.from(dropdown.querySelectorAll(".optgroup-header"))
        .find((h) => cleanText(h.textContent) === label);
    }

    if (!target) {
      console.warn("[Instahyre] Option not found in job-functions dropdown for", value);
      return false;
    }

    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    target.click();
    await sleep(400);

    const selected = isJobFunctionSelected(value);
    console.log(`[Instahyre] selectJobFunction(${value}) ->`, selected);
    return selected;
  }

  function setYearsInput(years) {
    const input = document.getElementById("years");
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, years);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  async function applyInstahyreFilters() {
    try {
      let ready = false;
      for (let i = 0; i < 20; i++) {
        if (document.getElementById("job-functions-selectized") &&
            document.getElementById("years") &&
            document.getElementById("show-results")) {
          ready = true;
          break;
        }
        await sleep(300);
      }
      if (!ready) {
        console.log("[Instahyre] Search form not found — scraping the default recommended feed");
        return false;
      }

      for (const value of JOB_FUNCTION_VALUES) {
        await selectJobFunction(value);
      }

      // Verify both selections actually stuck before submitting — if we click
      // Show Results with a partially-cleared or empty job_functions field,
      // Instahyre just runs an unfiltered search and we'd never know.
      const stillMissing = JOB_FUNCTION_VALUES.filter((v) => !isJobFunctionSelected(v));
      if (stillMissing.length > 0) {
        console.warn("[Instahyre] Job functions did not stick:", stillMissing, "— aborting filtered search, scraping default feed instead");
        return false;
      }

      const targetYears = getTargetYears();
      setYearsInput(targetYears);
      await sleep(300);

      const showBtn = document.getElementById("show-results");
      if (!showBtn || showBtn.disabled || showBtn.getAttribute("disabled") !== null) {
        console.log("[Instahyre] Show results button disabled — filters may not have registered");
        return false;
      }

      showBtn.click();
      console.log(`[Instahyre] Search filters applied: Software Engineering + Data Science, ${targetYears} years`);
      await sleep(2500); // let the search results render
      return true;
    } catch (err) {
      console.warn("[Instahyre] applyInstahyreFilters error:", err.message);
      return false;
    }
  }

  function observeResults() {
    const listTarget =
      document.querySelector(".opp-list-container") ||
      document.querySelector(".candidate-opportunities") ||
      document.querySelector(".facets-main") ||
      document.querySelector("main") ||
      document.body;

    observer = new MutationObserver((mutations) => {
      let foundNewNode = false;
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          const added = tryAddCard(node);
          if (node.querySelectorAll) {
            node.querySelectorAll(".employer-block, .employer-row, a.text-link[href*='/job-']").forEach((child) => {
              if (tryAddCard(child)) foundNewNode = true;
            });
          }
          if (added) foundNewNode = true;
        });
      });
      if (foundNewNode) debouncedSend();
    });

    observer.observe(listTarget, { childList: true, subtree: true });
  }

  (async () => {
    await applyInstahyreFilters();

    const initialCount = scrapeAllCards("Initial scrape");
    if (initialCount === 0) {
      [1200, 3000, 6000].forEach((delay) => {
        setTimeout(() => scrapeAllCards(`Retry +${delay}ms`), delay);
      });
    }

    observeResults();
    setTimeout(startAutoScroll, 1800);
  })();
})();
