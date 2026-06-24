// content/cutshort.js — Cutshort job card scraper

const TECH_KEYWORDS = [
  "Software", "developer", "engineer", "sde", "Backend", "Frontend",
  "Full stack", "Fullstack", "Python", "React", "node", "ML",
  "Machine learning", "AI", "data engineer", "fintech",
];

function isRelevant(title) {
  const lower = (title || "").toLowerCase();
  return TECH_KEYWORDS.some(kw => lower.includes(kw));
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
  return { raw: text, parsed: null };
}

function isFresh(parsedTs) {
  if (!parsedTs) return true;
  return (Math.floor(Date.now() / 1000) - parsedTs) < 86400;
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
    const companyEl =
      card.querySelector("[class*='company'] a") ||
      card.querySelector("[class*='company-name']") ||
      card.querySelector("[class*='companyName']") ||
      card.querySelector("a[href*='/company/']") ||
      card.querySelector("[class*='employer']");
    const company = companyEl?.textContent?.trim();
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
    console.log("[Cutshort] No job cards found with known selectors");
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
