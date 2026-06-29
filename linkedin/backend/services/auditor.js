// services/auditor.js — Hardcoded, rule-based scoring (no AI, no API calls).
//
// Replaces the old Gemini-backed auditor. Scoring is now synchronous, instant,
// deterministic, and costs zero tokens — so there are no 429s and no quota
// burn from job/lead ingestion. The cold-email AI generation (Python backend)
// is untouched; only LinkedIn job/lead scoring is rule-based.
//
// Export names + signatures are unchanged so routes/jobs.js and routes/leads.js
// need no edits (extra userProfile arg is accepted and ignored).

const REJECT_TITLES = [
  "sales", "marketing", "finance", "legal", "content writer", "hr recruiter",
  "operations manager", "accountant", "business development",
];
const SENIOR_TITLES = [
  "senior", "lead", "staff", "principal", "architect", "vp ", "director",
  "head of", "engineering manager",
];
const GOOD_TITLES = [
  "software", "developer", "engineer", "sde", "swe", "backend", "frontend",
  "fullstack", "full stack", "python", "react", "node", "golang", "typescript",
  "java", "data engineer", "devops", "ml engineer", "platform", "cloud",
];

export function scoreJob(job) {
  const title = (job.title || "").toLowerCase();
  // Scan whatever free-text fields the scraper provided for experience signals.
  const text = [
    job.description,
    job.experience_required,
    Array.isArray(job.skills) ? job.skills.join(" ") : job.skills,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Hard reject — wrong domain
  if (REJECT_TITLES.some(k => title.includes(k)))
    return { score: 0, reason: "non-tech role", keep: false };

  // Hard reject — numbered senior levels (SDE 2/3, Engineer II/III, Level 3, …).
  // SDE 1 / SDE I / unnumbered titles are kept.
  if (/\b(sde|swe|sse|mts)[-\s]?(2|3|4|5|ii|iii|iv|v)\b/.test(title)
      || /\b(engineer|developer|programmer)[-\s]+(2|3|4|5|ii|iii|iv|v)\b/.test(title)
      || /\blevel[-\s]?(2|3|4|5)\b/.test(title)) {
    return { score: 1, reason: "too senior (numbered level)", keep: false };
  }

  let score = 5;

  // Title signals
  if (GOOD_TITLES.some(k => title.includes(k))) score += 2;
  if (SENIOR_TITLES.some(k => title.includes(k))) score -= 3; // too senior for new grad

  // Experience requirement
  const expMatch = text.match(/(\d+)\+?\s*(?:[-–to]+\s*\d+)?\s*years?\s+(?:of\s+)?(?:experience|exp)/i);
  if (expMatch) {
    const yrs = parseInt(expMatch[1], 10);
    if (yrs >= 5) return { score: 1, reason: `${yrs}+ yrs required`, keep: false };
    if (yrs >= 3) score -= 3;
    else if (yrs <= 1) score += 1;
  }

  // Bonuses
  if (job.is_remote) score += 1;
  if (job.is_startup) score += 1;

  score = Math.max(0, Math.min(10, score));
  return { score, reason: score >= 6 ? "good match" : "low score", keep: score >= 6 };
}

export async function auditJobs(jobs /*, userProfile */) {
  if (!jobs || jobs.length === 0) return [];
  // Synchronous, instant, zero API calls.
  return jobs.map(j => ({ temp_id: j.temp_id, ...scoreJob(j) }));
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
