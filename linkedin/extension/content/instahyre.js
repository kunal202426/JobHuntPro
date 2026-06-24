// content/instahyre.js — Instahyre job card scraper

(() => {
  if (window.__jobHuntInstahyreInitialized) {
    console.log("[Instahyre] Scraper already initialized; skipping duplicate injection");
    return;
  }
  window.__jobHuntInstahyreInitialized = true;

  const TECH_KEYWORDS = [
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
    return TECH_KEYWORDS.some((kw) => lower.includes(kw));
  }

  function parsePostedAt(text) {
    if (!text) return { raw: null, parsed: null };
    const lower = text.toLowerCase().trim();
    const now = Date.now();

    if (lower.includes("just now") || lower.includes("few minute")) {
      return { raw: text, parsed: Math.floor(now / 1000) };
    }
    const minutesMatch = lower.match(/(\d+)\s*minute/);
    if (minutesMatch) {
      return { raw: text, parsed: Math.floor((now - parseInt(minutesMatch[1], 10) * 60000) / 1000) };
    }
    const hoursMatch = lower.match(/(\d+)\s*hour/);
    if (hoursMatch) {
      return { raw: text, parsed: Math.floor((now - parseInt(hoursMatch[1], 10) * 3600000) / 1000) };
    }
    if (lower === "today" || lower.includes("1 day ago")) {
      return { raw: text, parsed: Math.floor(now / 1000) };
    }
    if (lower.includes("yesterday")) {
      return { raw: text, parsed: Math.floor((now - 86400000) / 1000) };
    }
    const daysMatch = lower.match(/(\d+)\s*day/);
    if (daysMatch) {
      return { raw: text, parsed: Math.floor((now - parseInt(daysMatch[1], 10) * 86400000) / 1000) };
    }
    const weeksMatch = lower.match(/(\d+)\s*week/);
    if (weeksMatch) {
      return { raw: text, parsed: Math.floor((now - parseInt(weeksMatch[1], 10) * 7 * 86400000) / 1000) };
    }
    return { raw: text, parsed: null };
  }

  function isFresh(parsedTs) {
    if (!parsedTs) return true;
    return (Math.floor(Date.now() / 1000) - parsedTs) < (7 * 86400);
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
      if (!jobUrl) return null;
      if (!jobUrl.startsWith("http")) jobUrl = "https://www.instahyre.com" + jobUrl;
      jobUrl = jobUrl.split("?")[0];

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

  function tryAddCard(node) {
    const card = node.matches?.(".employer-block, .employer-row, a.text-link[href*='/job-']") ? node : node.closest?.(".employer-block, .employer-row");
    const target = card || node;
    const job = extractJobCard(target);
    if (!job || seenUrls.has(job.job_url)) return false;
    seenUrls.add(job.job_url);
    pendingJobs.push(job);
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
    const MAX_PAGES = 6;

    console.log("[Instahyre] Auto-scroll started");
    autoScrollTimer = setInterval(() => {
      container.scrollBy({ top: 900, left: 0, behavior: "smooth" });
      cycles++;

      setTimeout(() => {
        scrapeAllCards(`Auto-scroll cycle ${cycles}`);
        if (seenUrls.size > lastSeenCount) {
          lastSeenCount = seenUrls.size;
          idleCycles = 0;
          return;
        }

        idleCycles++;
        const atBottom = Math.ceil(container.scrollTop + container.clientHeight) >= (container.scrollHeight - 10);
        if ((idleCycles >= MAX_IDLE || atBottom) && pageClicks < MAX_PAGES) {
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

  const initialCount = scrapeAllCards("Initial scrape");
  if (initialCount === 0) {
    [1200, 3000, 6000].forEach((delay) => {
      setTimeout(() => scrapeAllCards(`Retry +${delay}ms`), delay);
    });
  }

  observeResults();
  setTimeout(startAutoScroll, 1800);
})();
