// services/auditor.js — Hardcoded, rule-based scoring (no AI, no API calls).
//
// Scoring is synchronous, instant, deterministic, and costs zero tokens.
// Every threshold below is derived from the calling user's own profile
// (routes/jobs.js fetches it and passes it in) so someone with 5 years of
// experience or targeting a non-SWE role isn't scored against a fresh-grad
// SWE profile — falls back to that same fresh-grad-SWE default when a user
// hasn't filled in a profile yet, so existing behavior is unchanged for them.

const DEFAULT_REJECT_TITLES = [
  "sales", "marketing", "finance", "legal", "content writer", "hr recruiter",
  "operations manager", "accountant", "business development",
];
const SENIOR_TITLES = [
  "senior", "lead", "staff", "principal", "architect", "vp ", "director",
  "head of", "engineering manager",
];
const DEFAULT_GOOD_TITLES = [
  "software", "developer", "engineer", "sde", "swe", "backend", "frontend",
  "fullstack", "full stack", "python", "react", "node", "golang", "typescript",
  "java", "data engineer", "devops", "ml engineer", "platform", "cloud",
];
const OFF_TARGET_DOMAIN_RE = /\bvalidation\b|\bsilicon\b|\bhardware\b|\bembedded\b|\bfirmware\b|\bvlsi\b|\brtl\b|\b(qa|sdet)\b|\btest(ing)? engineer\b|\bsupport engineer\b|\bnetwork engineer\b|\bsystems? engineer\b|\bautomation engineer\b/;
const NUMBERED_SENIOR_RE = /\bsr\.?\b|\b(iii|iv)\b|\b(sde|swe|sse|mts)[-\s]?(2|3|4|5|ii|iii|iv|v)\b|\b(engineer|developer|programmer)[-\s]+(2|3|4|5|ii|iii|iv|v)\b|\blevel[-\s]?(2|3|4|5)\b/;

function parseKeywordList(csv) {
  if (Array.isArray(csv)) return csv.map(s => String(s).toLowerCase().trim()).filter(Boolean);
  return String(csv || "").split(/[,;\n]/).map(s => s.toLowerCase().trim()).filter(Boolean);
}

export function scoreJob(job, profile = {}) {
  const title = (job.title || "").toLowerCase();
  const text = [
    job.description,
    job.experience_required,
    Array.isArray(job.skills) ? job.skills.join(" ") : job.skills,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const userKeywords = [...parseKeywordList(profile.target_keywords), ...parseKeywordList(profile.skills)];
  const hasOwnKeywords = userKeywords.length > 0;
  const goodTitles = hasOwnKeywords ? userKeywords : DEFAULT_GOOD_TITLES;
  const userExperience = Number.isFinite(profile.experience_years) ? profile.experience_years : 1;

  // Hard reject — wrong domain. Only applied with the default (fresh-grad SWE)
  // keyword set; a user who's scoped their own target keywords is trusted to
  // have already excluded domains they don't want.
  if (!hasOwnKeywords && DEFAULT_REJECT_TITLES.some(k => title.includes(k)))
    return { score: 0, reason: "non-tech role", keep: false };

  // Hard reject — numbered seniority levels (Sr., III, SDE 2/3, Engineer II,
  // Level 3) unless the user's own experience actually supports that level.
  if (NUMBERED_SENIOR_RE.test(title) && userExperience < 3) {
    return { score: 1, reason: "too senior", keep: false };
  }

  if (!hasOwnKeywords && OFF_TARGET_DOMAIN_RE.test(title)) {
    return { score: 0, reason: "off-target domain", keep: false };
  }

  // Hard reject — role wants noticeably more experience than the user has
  // (small +1yr buffer so borderline postings aren't dropped).
  const expField = (job.experience_required || "").toLowerCase();
  if (expField) {
    const nums = (expField.match(/\d+/g) || []).map(Number);
    if (nums.length) {
      const maxY = Math.max(...nums);
      const plus = /\d+\s*\+/.test(expField);
      const ceiling = userExperience + 1;
      if (maxY > ceiling || (plus && maxY >= ceiling)) {
        return { score: 1, reason: `needs more experience than you have (${job.experience_required})`, keep: false };
      }
    }
  }

  let score = 5;

  if (goodTitles.some(k => title.includes(k))) score += 2;
  const isSeniorTitle = SENIOR_TITLES.some(k => title.includes(k));
  if (isSeniorTitle) score += userExperience >= 3 ? 1 : -3;

  const expMatch = text.match(/(\d+)\+?\s*(?:[-–to]+\s*\d+)?\s*years?\s+(?:of\s+)?(?:experience|exp)/i);
  if (expMatch) {
    const yrs = parseInt(expMatch[1], 10);
    if (yrs > userExperience + 3) return { score: 1, reason: `${yrs}+ yrs required`, keep: false };
    if (yrs > userExperience + 1) score -= 3;
    else if (yrs <= userExperience) score += 1;
  }

  if (job.is_remote) score += 1;
  if (job.is_startup) score += 1;

  score = Math.max(0, Math.min(10, score));
  return { score, reason: score >= 6 ? "good match" : "low score", keep: score >= 6 };
}

export async function auditJobs(jobs, profile = {}) {
  if (!jobs || jobs.length === 0) return [];
  return jobs.map(j => ({ temp_id: j.temp_id, ...scoreJob(j, profile) }));
}

export async function auditLeads(people, targetCompany, jobTitle /*, userProfile */) {
  if (!people || people.length === 0) return [];
  return people.map(p => {
    // Scraper stores the role text under `headline` or `title`.
    const h = (p.headline || p.title || "").toLowerCase();
    let score = 5, category = "peer";

    if (/recruiter|talent acquisition|talent partner|hiring|hr |human resources|people ops/i.test(h)) {
      score = 9; category = "recruiter";
    } else if (/engineering manager|em |tech lead|team lead|vp of eng|director of eng|head of eng|cto|vp eng/i.test(h)) {
      score = 8; category = "hiring_manager";
    } else if (/senior|staff|principal|lead engineer/i.test(h)) {
      score = 7; category = "senior_peer";
    } else if (/engineer|developer|sde|swe|programmer/i.test(h)) {
      score = 6; category = "peer";
    } else {
      score = 3; category = "other";
    }

    return { temp_id: p.temp_id, score, reason: category, keep: score >= 6, category };
  });
}
