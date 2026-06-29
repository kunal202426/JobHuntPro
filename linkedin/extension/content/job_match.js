// content/job_match.js — shared job filters injected BEFORE each portal scraper.
// One place to tune: title exclusions, experience cap, and freshness window.
// Scrapers read window.__jhJobFilter.* and keep their own keyword matching.

window.__jhJobFilter = (function () {
  const FRESH_DAYS = 1; // only keep very fresh jobs (~last 24h)

  // Titles to drop: too senior, numbered levels, and off-target domains
  // (cloud / validation / hardware / QA / support / network / systems, etc.).
  const EXCLUDE_TITLE = [
    // senior / leadership
    /\bsenior\b/i, /\bsr\.?\b/i, /\blead\b/i, /\bprincipal\b/i, /\bstaff\b/i,
    /\barchitect\b/i, /\bmanager\b/i, /\bdirector\b/i, /\bhead\b/i, /\bvp\b/i,
    /vice president/i, /\bchief\b/i, /\bcto\b/i, /\bcio\b/i, /\bcpo\b/i,
    /\bfounder\b/i, /\bco[-\s]?founder\b/i,
    // numbered seniority levels
    /\biii\b/i, /\biv\b/i, /\bl[2-9]\b/i, /\blevel[-\s]?(2|3|4|5)\b/i,
    /\b(sde|swe|sse|mts)[-\s]?(2|3|4|5|ii|iii|iv|v)\b/i,
    /\b(software\s+|backend\s+|frontend\s+|full[-\s]?stack\s+)?(engineer|developer|programmer)[-\s]+(2|3|4|5|ii|iii|iv|v)\b/i,
    // off-target domains (don't match the user's profile)
    /\bcloud\b/i, /\bvalidation\b/i, /\bsilicon\b/i, /\bhardware\b/i,
    /\bembedded\b/i, /\bfirmware\b/i, /\bvlsi\b/i, /\brtl\b/i,
    /\bsupport engineer\b/i, /\bnetwork engineer\b/i, /\bsystems? engineer\b/i,
    /\b(qa|sdet)\b/i, /\btest(ing)? engineer\b/i, /\bautomation engineer\b/i,
  ];

  function isExcludedTitle(title) {
    return EXCLUDE_TITLE.some((re) => re.test(title || ""));
  }

  // Drop if the role wants MORE than 2 years (e.g. "1-4 Years" → max 4 → drop).
  function tooMuchExperience(expText) {
    if (!expText) return false;
    const lower = String(expText).toLowerCase();
    const nums = (lower.match(/\d+/g) || []).map(Number);
    if (nums.length === 0) return false;
    const maxYear = Math.max(...nums);
    const hasPlus = /\d+\s*\+/.test(lower);
    return maxYear > 2 || (hasPlus && maxYear >= 2);
  }

  // Robust relative-time parser. Handles seconds…years and "N+ unit" forms.
  function parsePostedAt(text) {
    if (!text) return { raw: null, parsed: null };
    const lower = String(text).toLowerCase().trim();
    const now = Date.now();
    const D = 86400000;
    let m;

    if (/just now|moments? ago|few (second|minute)/.test(lower)) return { raw: text, parsed: Math.floor(now / 1000) };
    if ((m = lower.match(/(\d+)\s*\+?\s*(?:second|sec)\b/))) return { raw: text, parsed: Math.floor((now - +m[1] * 1000) / 1000) };
    if ((m = lower.match(/(\d+)\s*\+?\s*(?:minute|min)\b/))) return { raw: text, parsed: Math.floor((now - +m[1] * 60000) / 1000) };
    if ((m = lower.match(/(\d+)\s*\+?\s*hour/))) return { raw: text, parsed: Math.floor((now - +m[1] * 3600000) / 1000) };
    if (/^today\b|posted today|\b1 day ago\b/.test(lower)) return { raw: text, parsed: Math.floor(now / 1000) };
    if (/yesterday/.test(lower)) return { raw: text, parsed: Math.floor((now - D) / 1000) };
    if ((m = lower.match(/(\d+)\s*\+?\s*day/))) return { raw: text, parsed: Math.floor((now - +m[1] * D) / 1000) };
    if (/\ba week ago\b/.test(lower)) return { raw: text, parsed: Math.floor((now - 7 * D) / 1000) };
    if ((m = lower.match(/(\d+)\s*\+?\s*week/))) return { raw: text, parsed: Math.floor((now - +m[1] * 7 * D) / 1000) };
    if ((m = lower.match(/(\d+)\s*\+?\s*month/))) return { raw: text, parsed: Math.floor((now - +m[1] * 30 * D) / 1000) };
    if (/\ba month ago\b|month/.test(lower)) return { raw: text, parsed: Math.floor((now - 30 * D) / 1000) };
    if (/year/.test(lower)) return { raw: text, parsed: Math.floor((now - 365 * D) / 1000) };
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
      const ts = Math.floor(new Date(text).getTime() / 1000);
      if (!isNaN(ts)) return { raw: text, parsed: ts };
    }
    return { raw: text, parsed: null };
  }

  function isFreshWithin(parsedTs) {
    if (parsedTs == null) return true; // unknown date — keep (most old jobs now parse)
    // ~30h window: keeps "today", "X hours ago", "yesterday"/"1 day ago";
    // drops anything 2+ days old.
    return (Math.floor(Date.now() / 1000) - parsedTs) < (FRESH_DAYS * 86400 + 21600);
  }

  // LinkedIn "Reposted …" = a recycled/stale listing — treat as not fresh.
  function looksReposted(text) {
    return /reposted/i.test(text || "");
  }

  return { FRESH_DAYS, isExcludedTitle, tooMuchExperience, parsePostedAt, isFreshWithin, looksReposted };
})();
