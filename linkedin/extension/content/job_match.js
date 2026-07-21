// content/job_match.js — shared job filters injected BEFORE each portal scraper.
// One place to tune: title exclusions, experience cap, and freshness window.
// Scrapers read window.__jhJobFilter.* and keep their own keyword matching.
//
// background.js injects window.__jhProfile (the logged-in user's own profile:
// skills, target_keywords, experience_years) immediately before this file, so
// every threshold below adapts to whoever is actually using the extension
// instead of assuming one fixed resume/experience level. A user with no
// profile filled in gets the original fresh-grad-SWE defaults.

window.__jhJobFilter = (function () {
  const FRESH_DAYS = 1; // only keep very fresh jobs (~last 24h)

  function getProfile() {
    return window.__jhProfile || {};
  }

  function getExperienceYears() {
    const y = getProfile().experienceYears;
    return Number.isFinite(y) ? y : 1;
  }

  function hasOwnKeywords() {
    const p = getProfile();
    return (p.skills && p.skills.length > 0) || (p.targetKeywords && p.targetKeywords.length > 0);
  }

  // Seniority wording — only excluded for someone whose own profile says
  // they're junior (< 3 YOE). A more experienced user should see these, not
  // have them silently filtered out.
  const SENIORITY_TITLE = [
    /\bsenior\b/i, /\bsr\.?\b/i, /\blead\b/i, /\bprincipal\b/i, /\bstaff\b/i,
    /\barchitect\b/i, /\bmanager\b/i, /\bdirector\b/i, /\bhead\b/i, /\bvp\b/i,
    /vice president/i, /\bchief\b/i, /\bcto\b/i, /\bcio\b/i, /\bcpo\b/i,
    /\bfounder\b/i, /\bco[-\s]?founder\b/i,
  ];
  // Numbered seniority levels always excluded regardless of profile — "SDE 2",
  // "Engineer III" etc. are a specific, more-senior track, not just wording.
  const NUMBERED_LEVEL_TITLE = [
    /\biii\b/i, /\biv\b/i, /\bl[2-9]\b/i, /\blevel[-\s]?(2|3|4|5)\b/i,
    /\b(sde|swe|sse|mts)[-\s]?(2|3|4|5|ii|iii|iv|v)\b/i,
    /\b(software\s+|backend\s+|frontend\s+|full[-\s]?stack\s+)?(engineer|developer|programmer)[-\s]+(2|3|4|5|ii|iii|iv|v)\b/i,
  ];
  // Off-target domains (cloud/validation/hardware/QA/support/network/systems,
  // etc.) — only excluded when the user hasn't scoped their own target
  // keywords/skills, since a scoped search is trusted to have already
  // excluded domains the user doesn't want.
  const OFF_TARGET_DOMAIN_TITLE = [
    /\bcloud\b/i, /\bvalidation\b/i, /\bsilicon\b/i, /\bhardware\b/i,
    /\bembedded\b/i, /\bfirmware\b/i, /\bvlsi\b/i, /\brtl\b/i,
    /\bsupport engineer\b/i, /\bnetwork engineer\b/i, /\bsystems? engineer\b/i,
    /\b(qa|sdet)\b/i, /\btest(ing)? engineer\b/i, /\bautomation engineer\b/i,
  ];

  function isExcludedTitle(title) {
    const t = title || "";
    if (getExperienceYears() < 3 && SENIORITY_TITLE.some((re) => re.test(t))) return true;
    if (NUMBERED_LEVEL_TITLE.some((re) => re.test(t))) return true;
    if (!hasOwnKeywords() && OFF_TARGET_DOMAIN_TITLE.some((re) => re.test(t))) return true;
    return false;
  }

  // Drop only if the role's LOWER bound is already above what the user's own
  // experience supports (e.g. "2-4 years" when the user has 1 YOE). Real
  // postings almost always list a wide range even when open to less-
  // experienced candidates ("0-3 years", "1-2 years") — checking the max
  // would reject nearly everything, since the ceiling of a range says nothing
  // about whether the floor still includes the user's own level.
  function tooMuchExperience(expText) {
    if (!expText) return false;
    const lower = String(expText).toLowerCase();
    const nums = (lower.match(/\d+/g) || []).map(Number);
    if (nums.length === 0) return false;
    const minYear = Math.min(...nums);
    return minYear > getExperienceYears();
  }

  // Resume/target keywords sourced from the user's own profile; falls back to
  // whatever default list the calling scraper passes in (its own tech-keyword
  // list) when the user hasn't filled in skills/target keywords.
  function getResumeKeywords(defaultKeywords) {
    const p = getProfile();
    const combined = [...(p.skills || []), ...(p.targetKeywords || [])]
      .map((s) => String(s).toLowerCase().trim())
      .filter(Boolean);
    return combined.length ? combined : (defaultKeywords || []);
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

  // LinkedIn's job-card title/company links often contain a visible label AND
  // a visually-hidden accessibility span with the identical text (for screen
  // readers) — .textContent on the anchor picks up both, concatenated with no
  // separator ("Nest.js back-end developerNest.js back-end developer"). Collapse
  // that back down to a single copy. No-op for any text that isn't doubled.
  function collapseDoubledText(text) {
    if (!text) return text;
    const trimmed = String(text).trim();
    const len = trimmed.length;
    if (len > 1 && len % 2 === 0) {
      const half = len / 2;
      if (trimmed.slice(0, half) === trimmed.slice(half)) {
        return trimmed.slice(0, half);
      }
    }
    return trimmed;
  }

  return { FRESH_DAYS, isExcludedTitle, tooMuchExperience, parsePostedAt, isFreshWithin, looksReposted, getResumeKeywords, collapseDoubledText };
})();
