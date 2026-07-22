// content/cutshort.js — Cutshort job card scraper

const TECH_KEYWORDS = [
  "Software", "developer", "engineer", "sde", "Backend", "Frontend",
  "Full stack", "Fullstack", "Python", "React", "node", "ML",
  "Machine learning", "AI", "data engineer", "fintech",
];

function isRelevant(title) {
  const lower = (title || "").toLowerCase();
  if (window.__jhJobFilter && window.__jhJobFilter.isExcludedTitle(title)) return false;
  return TECH_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
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

// Detect startup signals from card text/metadata
function detectIsStartup(card) {
  const text = card.textContent || "";
  const lower = text.toLowerCase();
  // Startup indicators: small team size, funding stage mentions
  if (lower.match(/\b([1-9]|[1-9]\d|1\d{2})\s+employee/)) return true;
  if (lower.match(/seed|series\s+[ab]|early.stage|pre-series/)) return true;
  if (lower.match(/\bstartup\b/)) return true;
  return false;
}

// Preferred: explicit company link/class hooks (works whenever Cutshort's markup
// includes them). Falls back to the plain-text "at <Company>" row Cutshort renders for
// agency/anonymous postings ("via HyrHub", "Leading provider of...") — these have no
// link and no distinguishing class, so the selectors above never catch them, and a job
// with no company was previously dropped outright.
function extractCompanyName(card, titleEl) {
  const el =
    card.querySelector("[class*='company'] a") ||
    card.querySelector("[class*='company-name']") ||
    card.querySelector("[class*='companyName']") ||
    card.querySelector("a[href*='/company/']") ||
    card.querySelector("[class*='employer']");
  const linked = el?.textContent?.trim();
  if (linked) return linked;

  const titleRow = titleEl?.closest("h2, h3")?.parentElement;
  const companyRow = titleRow?.nextElementSibling;
  const raw = companyRow?.querySelector("span")?.textContent || companyRow?.textContent;
  const name = raw?.replace(/^\s*at\s+/i, "").trim();
  return name || null;
}

// Cutshort's current build gives job cards styled-components hash classes (e.g.
// "sc-61a153a7-0 jEsvIv") with no "job" substring anywhere, so the class-based
// selectors in scrapeAllCards() can legitimately match zero cards on a live page. This
// finds the repeated card structure directly from the job title links instead, which
// survives styling/class-hash changes since it doesn't depend on class names at all.
function findCardsByStructure() {
  const anchors = Array.from(document.querySelectorAll("a[href*='/job/']"));
  if (anchors.length === 0) return [];

  function ancestors(el) {
    const chain = [];
    let cur = el;
    while (cur && cur !== document.body) {
      chain.push(cur);
      cur = cur.parentElement;
    }
    return chain;
  }

  if (anchors.length === 1) {
    const card = anchors[0].closest("article") || anchors[0].parentElement?.parentElement;
    return card ? [card] : [];
  }

  const chainA = ancestors(anchors[0]);
  const chainB = new Set(ancestors(anchors[1]));
  const listContainer = chainA.find((el) => chainB.has(el));
  if (!listContainer) return [];

  return Array.from(listContainer.children).filter((child) =>
    child.querySelector("a[href*='/job/']")
  );
}

function extractJobCard(card) {
  try {
    // Title
    const titleEl =
      card.querySelector("h2 a") ||
      card.querySelector("h3 a") ||
      card.querySelector("[class*='role'] a") ||
      card.querySelector("[class*='title'] a") ||
      card.querySelector("a[href*='/job/']") ||
      card.querySelector("a[href*='/jobs/']");

    const title =
      titleEl?.textContent?.trim() ||
      card.querySelector("h2")?.textContent?.trim() ||
      card.querySelector("h3")?.textContent?.trim();

    if (!title || !isRelevant(title)) return null;

    // Job URL
    let jobUrl = titleEl?.href;
    if (!jobUrl) {
      const linkEl = card.querySelector("a[href*='/job/'], a[href*='/jobs/']");
      jobUrl = linkEl?.href;
    }
    if (!jobUrl) return null;
    if (!jobUrl.startsWith("http")) jobUrl = "https://cutshort.io" + jobUrl;
    jobUrl = jobUrl.split("?")[0];

    // Company
    const company = extractCompanyName(card, titleEl);
    if (!company) return null;

    // Location
    const locationEl =
      card.querySelector("[class*='location']") ||
      card.querySelector("[class*='city']") ||
      card.querySelector("[class*='place']");
    const location = locationEl?.textContent?.trim()?.replace(/\s+/g, " ") || null;

    // Posted at
    const postedEl =
      card.querySelector("[class*='posted']") ||
      card.querySelector("[class*='time']") ||
      card.querySelector("time") ||
      card.querySelector("[class*='date']");
    const { raw: posted_at, parsed: posted_at_parsed } = parsePostedAt(postedEl?.textContent?.trim());

    if (!isFresh(posted_at_parsed)) return null;

    // Experience required
    const expEl =
      card.querySelector("[class*='experience']") ||
      card.querySelector("[class*='exp']");
    const experience_required = expEl?.textContent?.trim() || null;

    // Salary
    const salaryEl =
      card.querySelector("[class*='salary']") ||
      card.querySelector("[class*='ctc']") ||
      card.querySelector("[class*='pay']");
    const salary = salaryEl?.textContent?.trim() || null;

    // Skills — Cutshort shows skill tags prominently
    const skillEls = card.querySelectorAll(
      "[class*='skill'] span, [class*='tag'] span, [class*='technology'] span, " +
      "[class*='skill-tag'], [class*='skillTag'], span[class*='tag']"
    );
    const skills = Array.from(skillEls)
      .map(el => el.textContent.trim())
      .filter(s => s && s.length > 1 && s.length < 40);

    const is_startup = detectIsStartup(card);

    return {
      title,
      company,
      location,
      source: "cutshort",
      job_url: jobUrl,
      posted_at,
      posted_at_parsed,
      experience_required,
      skills,
      salary,
      is_startup,
    };
  } catch (err) {
    console.warn("[Cutshort] Card parse error:", err.message);
    return null;
  }
}

function scrapeAllCards() {
  const cardSelectors = [
    "[class*='jobCard']",
    "[class*='job-card']",
    "[class*='JobCard']",
    "[data-job-id]",
    "article[class*='job']",
    "[class*='job-listing']",
    "[class*='jobListing']",
  ];

  let cards = [];
  for (const sel of cardSelectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 0) { cards = Array.from(found); break; }
  }

  if (cards.length === 0) {
    cards = findCardsByStructure();
  }

  if (cards.length === 0) {
    console.log("[Cutshort] No job cards found with known selectors or structural fallback");
    return [];
  }

  const jobs = cards.map(extractJobCard).filter(Boolean);
  console.log(`[Cutshort] Extracted ${jobs.length} relevant fresh jobs from ${cards.length} cards`);
  return jobs;
}

function sendJobs(jobs) {
  if (jobs.length === 0) return;
  chrome.runtime.sendMessage({ type: "JOBS_SCRAPED", payload: jobs }, (res) => {
    if (chrome.runtime.lastError) {
      console.warn("[Cutshort] Message error:", chrome.runtime.lastError.message);
    } else {
      console.log("[Cutshort] Backend response:", res);
    }
  });
}

// Debounced scrape — waits 2s after last DOM mutation
let debounceTimer;
function debouncedScrape() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => sendJobs(scrapeAllCards()), 2000);
}

// Initial scrape
debouncedScrape();

// Watch for dynamically loaded cards
const listTarget =
  document.querySelector("[class*='jobList']") ||
  document.querySelector("[class*='job-list']") ||
  document.querySelector("[class*='jobs-container']") ||
  document.querySelector("main") ||
  document.body;

const observer = new MutationObserver(debouncedScrape);
observer.observe(listTarget, { childList: true, subtree: true });
