// content/naukri.js — Naukri job card scraper

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

const MAX_EXPERIENCE_YEARS = 2;

function normalizeText(text) {
  return (text || "").toLowerCase();
}

function matchesKeywords(text) {
  const keywords = RESUME_KEYWORDS.length > 0 ? RESUME_KEYWORDS : TECH_KEYWORDS;
  return keywords.some(kw => text.includes(kw));
}

function isSeniorTitle(title) {
  return EXCLUDE_TITLE_PATTERNS.some(re => re.test(title));
}

function isRelevant(title) {
  const lower = normalizeText(title);
  if (window.__jhJobFilter && window.__jhJobFilter.isExcludedTitle(title)) return false;
  if (isSeniorTitle(lower)) return false;
  return matchesKeywords(lower);
}

function parseMinExperienceYears(text) {
  if (!text) return null;
  const lower = normalizeText(text);
  if (lower.includes("fresher") || lower.includes("entry")) return 0;
  const rangeMatch = lower.match(/(\d+)\s*-\s*(\d+)/);
  if (rangeMatch) return parseInt(rangeMatch[1], 10);
  const plusMatch = lower.match(/(\d+)\s*\+/);
  if (plusMatch) return parseInt(plusMatch[1], 10);
  const yearMatch = lower.match(/(\d+)\s*year/);
  if (yearMatch) return parseInt(yearMatch[1], 10);
  return null;
}

function isExperienceAllowed(text) {
  if (window.__jhJobFilter) return !window.__jhJobFilter.tooMuchExperience(text);
  const minYears = parseMinExperienceYears(text);
  if (minYears === null) return true;
  return minYears <= MAX_EXPERIENCE_YEARS;
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

function extractJobCard(card) {
  try {
    // Title — try multiple selectors with fallbacks
    const titleEl =
      card.querySelector("a.title") ||
      card.querySelector(".title a") ||
      card.querySelector("a[class*='title']") ||
      card.querySelector("a[title]") ||
      card.querySelector("h2 a");
    const title = titleEl?.textContent?.trim() || titleEl?.getAttribute("title");
    if (!title) return null;

    // Job URL
    const jobUrl = titleEl?.href || card.querySelector("a")?.href;
    if (!jobUrl) return null;

    // Company
    const companyEl =
      card.querySelector("a.comp-name") ||
      card.querySelector(".companyInfo a") ||
      card.querySelector("[class*='company'] a") ||
      card.querySelector("[class*='comp-name']");
    const company = companyEl?.textContent?.trim();
    if (!company) return null;

    // Location
    const locationEl =
      card.querySelector(".locWdth") ||
      card.querySelector("[class*='location']") ||
      card.querySelector(".location span");
    const location = locationEl?.textContent?.trim() || null;

    // Posted at
    const postedEl =
      card.querySelector(".jobAge") ||
      card.querySelector(".job-post-day") ||
      card.querySelector("[class*='posted']") ||
      card.querySelector("[class*='age']");
    const { raw: posted_at, parsed: posted_at_parsed } = parsePostedAt(postedEl?.textContent?.trim());

    if (!isFresh(posted_at_parsed)) return null;

    // Experience
    const expEl =
      card.querySelector(".expwdth") ||
      card.querySelector("[class*='exp']") ||
      card.querySelector(".experience");
    const experience_required = expEl?.textContent?.trim() || null;

    // Salary
    const salaryEl =
      card.querySelector(".salary-snippet") ||
      card.querySelector("[class*='salary']") ||
      card.querySelector(".sal");
    const salary = salaryEl?.textContent?.trim() || null;

    // Skills tags
    const skillEls = card.querySelectorAll(
      ".tags li, .skill-tag, [class*='skill'] li, .tag-li, .tagsContainer span"
    );
    const skills = Array.from(skillEls)
      .map(el => el.textContent.trim())
      .filter(s => s && s.length < 40);

    const skillsText = skills.join(" ");
    if (!isRelevant(title) && !matchesKeywords(normalizeText(skillsText))) return null;
    if (!isExperienceAllowed(experience_required)) return null;

    return {
      title,
      company,
      location,
      source: "naukri",
      job_url: jobUrl.split("?")[0],
      posted_at,
      posted_at_parsed,
      experience_required,
      skills,
      salary,
      is_startup: false,
    };
  } catch (err) {
    console.warn("[Naukri] Card parse error:", err.message);
    return null;
  }
}

function scrapeAllCards() {
  // Try multiple container/card selectors — Naukri changes DOM periodically
  const cardSelectors = [
    "article.jobTuple",
    ".cust-job-tuple",
    ".srp-jobtuple-wrapper",
    "[data-job-id]",
    ".jobTuple",
  ];

  let cards = [];
  for (const sel of cardSelectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 0) { cards = Array.from(found); break; }
  }

  if (cards.length === 0) {
    console.log("[Naukri] No job cards found with known selectors");
    return [];
  }

  const jobs = cards.map(extractJobCard).filter(Boolean);
  console.log(`[Naukri] Extracted ${jobs.length} relevant fresh jobs from ${cards.length} cards`);
  return jobs;
}

function sendJobs(jobs) {
  if (jobs.length === 0) return;
  if (!chrome?.runtime?.id) {
    console.warn("[Naukri] Extension context invalidated; skipping send");
    return;
  }
  try {
    chrome.runtime.sendMessage({ type: "JOBS_SCRAPED", payload: jobs }, (res) => {
      if (chrome.runtime.lastError) {
        console.warn("[Naukri] Message error:", chrome.runtime.lastError.message);
      } else {
        console.log("[Naukri] Backend response:", res);
      }
    });
  } catch (err) {
    console.warn("[Naukri] Message send failed:", err.message);
  }
}

// Debounced scrape — waits 2s after last DOM mutation before sending
let debounceTimer;
function debouncedScrape() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => sendJobs(scrapeAllCards()), 2000);
}

// Initial scrape after page idle
debouncedScrape();

// Watch for lazy-loaded cards
const listTarget =
  document.querySelector("#listContainer") ||
  document.querySelector(".list-container") ||
  document.querySelector(".search-result-list") ||
  document.body;

if (listTarget) {
  const observer = new MutationObserver(debouncedScrape);
  observer.observe(listTarget, { childList: true, subtree: true });
}

// Auto-scroll and pagination
const AUTO_SCROLL = true;
const AUTO_SCROLL_INTERVAL_MS = 1500;
const AUTO_SCROLL_STEP_PX = 800;
const AUTO_SCROLL_MAX_CYCLES = 70;
const AUTO_SCROLL_MAX_IDLE = 6;
const AUTO_SCROLL_MAX_PAGES = 8;

function getCardCount() {
  const selectors = [
    "article.jobTuple",
    ".cust-job-tuple",
    ".srp-jobtuple-wrapper",
    "[data-job-id]",
    ".jobTuple",
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
  if (listTarget) {
    const root = findScrollableRoot(listTarget);
    if (root) return root;
  }
  return document.scrollingElement || document.documentElement;
}

function getPaginationState() {
  const nextBtn =
    document.querySelector("a[aria-label*='Next']") ||
    document.querySelector("a[title*='Next']") ||
    document.querySelector("a[rel='next']") ||
    document.querySelector("button[aria-label*='Next']") ||
    document.querySelector(".pagination a.next");

  const currentEl =
    document.querySelector(".pagination .active") ||
    document.querySelector(".pagination li.active") ||
    document.querySelector(".pagination li.selected") ||
    document.querySelector("a[aria-current='page']") ||
    document.querySelector("button[aria-current='page']");

  const currentPage = parseInt(currentEl?.textContent?.trim(), 10);

  const pageButtons = Array.from(
    document.querySelectorAll(
      ".pagination a, .pagination li a, a[aria-label^='Page '], button[aria-label^='Page ']"
    )
  )
    .map(el => {
      const label = el.getAttribute("aria-label") || el.textContent || "";
      const num = parseInt((label.match(/\d+/) || [])[0], 10);
      return { el, num: isNaN(num) ? null : num };
    })
    .filter(b => b.num !== null);

  return { currentPage: isNaN(currentPage) ? null : currentPage, pageButtons, nextBtn };
}

function clickNextPage() {
  const { currentPage, pageButtons, nextBtn } = getPaginationState();

  const nextEnabled = nextBtn &&
    !nextBtn.disabled &&
    nextBtn.getAttribute("aria-disabled") !== "true";

  if (nextEnabled) {
    nextBtn.click();
    return true;
  }

  if (pageButtons.length > 0) {
    const sorted = pageButtons.slice().sort((a, b) => a.num - b.num);
    const currentNum = currentPage ?? sorted[0].num;
    const next = sorted.find(b => b.num === currentNum + 1) || sorted.find(b => b.num > currentNum);
    if (next && next.el) {
      next.el.click();
      return true;
    }
  }

  return false;
}

function startAutoScroll() {
  if (!AUTO_SCROLL) return;
  let cycles = 0;
  let idle = 0;
  let lastCount = getCardCount();
  let pageClicks = 0;

  console.log("[Naukri] Auto-scroll started");
  autoScrollTimer = setInterval(() => {
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
        if (clickNextPage()) {
          pageClicks++;
          idle = 0;
          cycles = 0;
          lastCount = 0;
          console.log(`[Naukri] Pagination: moving to page ${pageClicks + 1}`);
          setTimeout(debouncedScrape, 2000);
          return;
        }
      }

      if (cycles >= AUTO_SCROLL_MAX_CYCLES || idle >= AUTO_SCROLL_MAX_IDLE || (atBottom && idle >= 2)) {
        stopAutoScroll("limits reached");
        console.log(`[Naukri] Auto-scroll stopped (idle=${idle}, cycles=${cycles}, pages=${pageClicks + 1})`);
      }
    }, 600);
  }, AUTO_SCROLL_INTERVAL_MS);
}

setTimeout(startAutoScroll, 2000);

let autoScrollTimer = null;
function stopAutoScroll(reason) {
  if (autoScrollTimer) {
    clearInterval(autoScrollTimer);
    autoScrollTimer = null;
    if (reason) console.log(`[Naukri] Auto-scroll stopped (${reason})`);
  }
}

window.addEventListener("pagehide", () => {
  clearTimeout(debounceTimer);
  stopAutoScroll("pagehide");
});
