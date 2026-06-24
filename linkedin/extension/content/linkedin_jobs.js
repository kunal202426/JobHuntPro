// content/linkedin_jobs.js — LinkedIn Jobs scraper with MutationObserver

(() => {
  if (window.__jobHuntLinkedInJobsInitialized) {
    console.log("[LinkedIn Jobs] Scraper already initialized; skipping duplicate injection");
    return;
  }
  window.__jobHuntLinkedInJobsInitialized = true;

const TECH_KEYWORDS = [
  "software", "developer", "engineer", "sde", "backend", "frontend",
  "full stack", "fullstack", "python", "react", "node", "ml",
  "machine learning", "ai", "data engineer", "fintech",
];

// Add your resume keywords to tighten matching (falls back to TECH_KEYWORDS if empty)
const RESUME_KEYWORDS = [
  "software engineer",
  "software developer",
  "full stack",
  "backend",
  "frontend",
  "react",
  "node",
  "express",
  "fastapi",
  "python",
  "javascript",
  "postgresql",
  "mongodb",
  "firebase",
  "rest",
  "rest api",
  "microservices",
  "websocket",
  "aws",
  "ci/cd",
  "distributed systems",
  "system design",
  "machine learning",
  "ml",
  "tensorflow",
  "scikit-learn",
  "computer vision",
  "nlp",
  "etl",
  "lstm",
  "lightgbm",
  "blockchain",
  "solidity",
  "web3",
  "ethereum",
  "dapp",
  "hyperledger",
  "three.js",
  "reactflow",
];

const EXCLUDE_TITLE_PATTERNS = [
  /\bsenior\b/i,
  /\bsr\.?\b/i,
  /\blead\b/i,
  /\bprincipal\b/i,
  /\bstaff\b/i,
  /\barchitect\b/i,
  /\bmanager\b/i,
  /\bdirector\b/i,
  /\bhead\b/i,
  /\bvp\b/i,
  /vice president/i,
  /\bchief\b/i,
  /\bcto\b/i,
  /\bcio\b/i,
  /\bcpo\b/i,
  /\bfounder\b/i,
  /\bco[-\s]?founder\b/i,
];

function normalizeText(text) {
  return (text || "").toLowerCase();
}

function matchesKeywords(text) {
  return [...RESUME_KEYWORDS, ...TECH_KEYWORDS].some(kw => text.includes(kw));
}

function isSeniorTitle(title) {
  return EXCLUDE_TITLE_PATTERNS.some(re => re.test(title));
}

function isRelevant(title) {
  const lower = normalizeText(title);
  if (isSeniorTitle(lower)) return false;
  return matchesKeywords(lower);
}

function parsePostedAt(text) {
  if (!text) return { raw: null, parsed: null };
  const lower = text.toLowerCase().trim();
  const now = Date.now();

  if (lower.includes("just now") || lower.includes("few minute") || lower.includes("second")) {
    return { raw: text, parsed: Math.floor(now / 1000) };
  }
  const minutesMatch = lower.match(/(\d+)\s*minute/);
  if (minutesMatch) {
    return { raw: text, parsed: Math.floor((now - parseInt(minutesMatch[1]) * 60000) / 1000) };
  }
  const hoursMatch = lower.match(/(\d+)\s*hour/);
  if (hoursMatch) {
    return { raw: text, parsed: Math.floor((now - parseInt(hoursMatch[1]) * 3600000) / 1000) };
  }
  if (lower === "today" || lower.includes("1 day ago")) {
    return { raw: text, parsed: Math.floor(now / 1000) };
  }
  if (lower.includes("yesterday")) {
    return { raw: text, parsed: Math.floor((now - 86400000) / 1000) };
  }
  const daysMatch = lower.match(/(\d+)\s*day/);
  if (daysMatch) {
    return { raw: text, parsed: Math.floor((now - parseInt(daysMatch[1]) * 86400000) / 1000) };
  }
  const weeksMatch = lower.match(/(\d+)\s*week/);
  if (weeksMatch) {
    return { raw: text, parsed: Math.floor((now - parseInt(weeksMatch[1]) * 7 * 86400000) / 1000) };
  }
  // Try ISO datetime from <time datetime="...">
  if (text.match(/^\d{4}-\d{2}-\d{2}/)) {
    const ts = Math.floor(new Date(text).getTime() / 1000);
    if (!isNaN(ts)) return { raw: text, parsed: ts };
  }
  return { raw: text, parsed: null };
}

function isFresh(parsedTs) {
  if (!parsedTs) return true;
  return (Math.floor(Date.now() / 1000) - parsedTs) < 86400;
}

function extractJobCard(card) {
  try {
    // Title — multiple fallback selectors for LinkedIn's shifting DOM
    const titleEl =
      card.querySelector("a.job-card-list__title--link") ||
      card.querySelector("a[class*='job-card-list__title']") ||
      card.querySelector(".job-card-list__title") ||
      card.querySelector("a[href*='/jobs/view/']") ||
      card.querySelector("a.base-card__full-link") ||
      card.querySelector("h3 a") ||
      card.querySelector("h3");

    const title =
      titleEl?.textContent?.trim() ||
      titleEl?.getAttribute("aria-label") ||
      card.querySelector("h3")?.textContent?.trim();

    if (!title || !isRelevant(title)) return null;

    // Job URL
    let jobUrl =
      titleEl?.href ||
      card.querySelector("a[href*='/jobs/view/']")?.href ||
      card.querySelector("a.job-card-list__title--link")?.href;
    if (!jobUrl) return null;
    if (!jobUrl.startsWith("http")) jobUrl = "https://www.linkedin.com" + jobUrl;
    // Strip query params and tracking suffixes
    jobUrl = jobUrl.split("?")[0].replace(/\/$/, "");

    // Company
    const companyEl =
      card.querySelector(".job-card-container__company-name") ||
      card.querySelector("a[class*='company-name']") ||
      card.querySelector("[class*='company-name']") ||
      card.querySelector(".job-card-container__primary-description") ||
      card.querySelector(".artdeco-entity-lockup__subtitle") ||
      card.querySelector(".base-search-card__subtitle") ||
      card.querySelector("h4");
    const company =
      companyEl?.querySelector("span[dir='ltr']")?.textContent?.trim() ||
      companyEl?.textContent?.trim();
    if (!company) return null;

    // Location
    const locationEl =
      card.querySelector(".job-card-container__metadata-item") ||
      card.querySelector(".job-card-container__metadata-wrapper li") ||
      card.querySelector("[class*='workplace-type']") ||
      card.querySelector(".job-search-card__location") ||
      card.querySelector("[class*='location']");
    const location = locationEl?.textContent?.trim() || null;

    // Posted at — LinkedIn uses <time datetime="ISO"> or text like "2 hours ago"
    const timeEl =
      card.querySelector("time.job-card-container__listdate") ||
      card.querySelector("time[class*='listdate']") ||
      card.querySelector("time");
    const postedText =
      timeEl?.getAttribute("datetime") ||
      timeEl?.textContent?.trim() ||
      card.querySelector("[class*='date']")?.textContent?.trim() ||
      card.querySelector("[class*='time']")?.textContent?.trim();

    const { raw: posted_at, parsed: posted_at_parsed } = parsePostedAt(postedText);
    if (!isFresh(posted_at_parsed)) return null;

    return {
      title,
      company,
      location,
      source: "linkedin",
      job_url: jobUrl,
      posted_at,
      posted_at_parsed,
      experience_required: null,
      skills: [],
      salary: null,
      is_startup: false,
    };
  } catch (err) {
    console.warn("[LinkedIn Jobs] Card parse error:", err.message);
    return null;
  }
}

// --- Batch collection & sending ---

const seenUrls = new Set();
const pendingJobs = [];
let debounceTimer;

function debouncedSend() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (pendingJobs.length === 0) return;
    const batch = [...pendingJobs];
    pendingJobs.length = 0;
    console.log(`[LinkedIn Jobs] Sending ${batch.length} jobs to backend`);
    chrome.runtime.sendMessage({ type: "JOBS_SCRAPED", payload: batch }, (res) => {
      if (chrome.runtime.lastError) {
        console.warn("[LinkedIn Jobs] Message error:", chrome.runtime.lastError.message);
      } else {
        console.log("[LinkedIn Jobs] Backend response:", res);
      }
    });
  }, 2000);
}

function tryAddCard(card) {
  const job = extractJobCard(card);
  if (!job) return;
  // Deduplicate within this page session
  if (seenUrls.has(job.job_url)) return;
  seenUrls.add(job.job_url);
  pendingJobs.push(job);
}

function scrapeVisible(label = "Initial scrape") {
  const cardSelectors = [
    "li.jobs-search-results__list-item",
    ".job-card-container",
    "[data-job-id]",
    ".jobs-search__results-list > li",
    ".scaffold-layout__list-item",
  ];

  let cards = [];
  for (const sel of cardSelectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 0) { cards = Array.from(found); break; }
  }

  if (cards.length === 0) {
    console.log("[LinkedIn Jobs] No job cards found with known selectors");
    return 0;
  }

  const before = pendingJobs.length;
  cards.forEach(tryAddCard);
  const added = pendingJobs.length - before;
  if (added === 0) {
    console.log(`[LinkedIn Jobs] ${label}: 0 relevant jobs after filters`);
  }
  if (pendingJobs.length > 0) debouncedSend();
  console.log(`[LinkedIn Jobs] ${label}: found ${cards.length} cards`);
  return cards.length;
}

// Initial pass after page is idle
const initialCount = scrapeVisible();

// LinkedIn often renders cards a bit later; retry a few times if none were found
if (initialCount === 0) {
  [1500, 4000, 8000].forEach(ms => {
    setTimeout(() => scrapeVisible(`Retry scrape (+${ms}ms)`), ms);
  });
}

// Watch for lazy-loaded cards as user scrolls
const listContainer =
  document.querySelector(".jobs-search__results-list") ||
  document.querySelector(".scaffold-layout__list") ||
  document.querySelector(".jobs-search-results-grid") ||
  document.body;

const observer = new MutationObserver((mutations) => {
  let added = false;
  mutations.forEach(mutation => {
    mutation.addedNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      // The node itself might be a card
      tryAddCard(node);
      // Or the node might contain cards (e.g. a <ul> was inserted)
      if (node.querySelectorAll) {
        node.querySelectorAll("[data-job-id], .job-card-container, li.jobs-search-results__list-item")
          .forEach(tryAddCard);
      }
      added = true;
    });
  });
  if (added && pendingJobs.length > 0) debouncedSend();
});

observer.observe(listContainer, { childList: true, subtree: true });

// Auto-scroll to load more cards
const AUTO_SCROLL = true;
const AUTO_SCROLL_INTERVAL_MS = 1500;
const AUTO_SCROLL_STEP_PX = 700;
const AUTO_SCROLL_MAX_CYCLES = 80;
const AUTO_SCROLL_MAX_IDLE = 6;
const AUTO_SCROLL_MAX_PAGES = 4;

function getCardCount() {
  const selectors = [
    "li.jobs-search-results__list-item",
    ".job-card-container",
    "[data-job-id]",
    ".jobs-search__results-list > li",
    ".scaffold-layout__list-item",
  ];
  for (const sel of selectors) {
    const count = document.querySelectorAll(sel).length;
    if (count > 0) return count;
  }
  return 0;
}

function findScrollableRoot(el) {
  let current = el;
  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    const scrollable = (style.overflowY === "auto" || style.overflowY === "scroll");
    if (scrollable && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return null;
}

function getScrollContainer() {
  const cardEl = document.querySelector(".job-card-container, [data-job-id]");
  if (cardEl) {
    const scrollable = findScrollableRoot(cardEl);
    if (scrollable) return scrollable;
  }

  const candidates = [
    document.querySelector(".jobs-search-results-list"),
    document.querySelector(".jobs-search-results__list"),
    document.querySelector(".scaffold-layout__list"),
    document.querySelector(".jobs-search-results-list__list"),
    document.querySelector(".jobs-search-results"),
  ].filter(Boolean);

  for (const el of candidates) {
    const scrollable = findScrollableRoot(el);
    if (scrollable) return scrollable;
  }
  return document.scrollingElement || document.documentElement;
}

function getPaginationState() {
  const buttonSelectors = [
    "button[aria-label^='Page ']",
    "button[data-test-pagination-page-btn]",
    "li.artdeco-pagination__indicator button",
    "a[aria-label^='Page ']",
  ];
  const buttons = [];
  buttonSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => buttons.push(el));
  });

  const normalized = buttons
    .map(el => {
      const label = el.getAttribute("aria-label") || el.textContent || "";
      const num = parseInt((label.match(/\d+/) || [])[0], 10);
      const isCurrent = el.getAttribute("aria-current") === "true" ||
        el.getAttribute("aria-current") === "page" ||
        el.classList.contains("active") ||
        el.classList.contains("selected");
      return { el, num: isNaN(num) ? null : num, isCurrent };
    })
    .filter(b => b.num !== null);

  const current = normalized.find(b => b.isCurrent) || null;
  const nextBtn = document.querySelector(
    "button[aria-label*='Next'], button[aria-label='Next'], button[aria-label*='next']"
  );

  return { currentPage: current?.num ?? null, pageButtons: normalized, nextBtn };
}

function clickNextPage(pageClicks) {
  const { currentPage, pageButtons, nextBtn } = getPaginationState();

  const nextEnabled = nextBtn &&
    !nextBtn.disabled &&
    nextBtn.getAttribute("aria-disabled") !== "true";

  if (nextEnabled) {
    nextBtn.click();
    return { clicked: true, targetPage: (currentPage ?? pageClicks + 1) + 1 };
  }

  if (pageButtons.length > 0) {
    const sorted = pageButtons.slice().sort((a, b) => a.num - b.num);
    const currentNum = currentPage ?? sorted[0].num;
    const next = sorted.find(b => b.num === currentNum + 1) || sorted.find(b => b.num > currentNum);
    if (next && next.el) {
      next.el.click();
      return { clicked: true, targetPage: next.num };
    }
  }

  return { clicked: false, targetPage: null };
}

function startAutoScroll() {
  if (!AUTO_SCROLL) return;
  let cycles = 0;
  let idle = 0;
  let lastCount = getCardCount();
  let pageClicks = 0;

  console.log("[LinkedIn Jobs] Auto-scroll started");
  const timer = setInterval(() => {
    const container = getScrollContainer();
    if (!container) return;

    container.scrollBy({ top: AUTO_SCROLL_STEP_PX, left: 0, behavior: "smooth" });
    cycles++;

    setTimeout(() => {
      const count = getCardCount();
      if (count > lastCount) {
        lastCount = count;
        idle = 0;
      } else {
        idle++;
      }

      const atBottom = Math.ceil(container.scrollTop + container.clientHeight) >= container.scrollHeight;
      const shouldPaginate = (idle >= AUTO_SCROLL_MAX_IDLE || (atBottom && idle >= 2));
      if (shouldPaginate && pageClicks < (AUTO_SCROLL_MAX_PAGES - 1)) {
        const { clicked, targetPage } = clickNextPage(pageClicks);
        if (clicked) {
          pageClicks++;
          idle = 0;
          cycles = 0;
          lastCount = 0;
          console.log(`[LinkedIn Jobs] Pagination: moving to page ${targetPage ?? (pageClicks + 1)}`);
          setTimeout(() => scrapeVisible("Page change scrape"), 2000);
          return;
        }
      }

      if (cycles >= AUTO_SCROLL_MAX_CYCLES || idle >= AUTO_SCROLL_MAX_IDLE || (atBottom && idle >= 2)) {
        clearInterval(timer);
        console.log(`[LinkedIn Jobs] Auto-scroll stopped (idle=${idle}, cycles=${cycles}, pages=${pageClicks + 1})`);
      }
    }, 600);
  }, AUTO_SCROLL_INTERVAL_MS);
}

setTimeout(startAutoScroll, 2000);
})();
