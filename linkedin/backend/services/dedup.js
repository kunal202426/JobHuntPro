import { getRow } from "../db/client.js";

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeJobUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const keepParams = ["currentJobId", "jobId", "jk", "id"];
    const kept = [];
    for (const key of keepParams) {
      const value = parsed.searchParams.get(key);
      if (value) kept.push(`${key}=${value}`);
    }
    const query = kept.length ? `?${kept.join("&")}` : "";
    return `${parsed.origin}${parsed.pathname}${query}`.replace(/\/+$/, "");
  } catch {
    return String(url).replace(/\/+$/, "").trim();
  }
}

function buildFingerprint(job) {
  return {
    source: normalizeText(job.source),
    title: normalizeText(job.title),
    company: normalizeText(job.company),
    jobUrl: normalizeJobUrl(job.job_url),
  };
}

export async function filterDuplicates(jobs, userId) {
  const newJobs = [];
  for (const job of jobs) {
    const fp = buildFingerprint(job);
    if (!fp.source || !fp.title || !fp.company || !fp.jobUrl) {
      newJobs.push(job);
      continue;
    }
    const existing = await getRow(
      `SELECT id FROM jobs
       WHERE lower(source) = $1 AND lower(title) = $2 AND lower(company) = $3
         AND lower(trim(job_url)) = $4 AND user_id = $5
       LIMIT 1`,
      [fp.source, fp.title, fp.company, fp.jobUrl.toLowerCase(), userId]
    );
    if (!existing) newJobs.push(job);
  }
  return newJobs;
}
