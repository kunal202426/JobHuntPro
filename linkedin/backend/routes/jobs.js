import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getRow, getRows, execute, withTransaction } from "../db/client.js";
import { auditJobs } from "../services/auditor.js";
import { filterDuplicates } from "../services/dedup.js";

const router = Router();

const TECH_KEYWORDS = [
  "software", "developer", "engineer", "sde", "backend", "frontend",
  "full stack", "fullstack", "python", "react", "node", "ml",
  "machine learning", "ai", "data engineer", "data scientist",
  "devops", "sre", "cloud", "platform", "security", "golang",
  "typescript", "java", "rust", "fintech",
];

function isRelevantTitle(title) {
  const lower = (title || "").toLowerCase();
  return TECH_KEYWORDS.some(kw => lower.includes(kw));
}

function safeInt(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// GET /api/jobs
router.get("/", async (req, res) => {
  try {
    const uid = req.userId;
    const { status, source, since_hours, fresh_hours, min_score, remote_only, startup_only, q } = req.query;

    const params = [uid];
    let query = "SELECT * FROM jobs WHERE status != 'dismissed' AND user_id = $1";

    const addParam = (val) => { params.push(val); return `$${params.length}`; };

    if (status) {
      const statuses = status.split(",").map(s => s.trim());
      const placeholders = statuses.map(s => addParam(s)).join(",");
      query += ` AND status IN (${placeholders})`;
    }
    if (source) query += ` AND source = ${addParam(source)}`;

    const sinceHours = safeInt(since_hours);
    if (sinceHours != null) {
      const cutoff = new Date(Date.now() - sinceHours * 3600000).toISOString();
      query += ` AND created_at >= ${addParam(cutoff)}`;
    }

    const freshHours = safeInt(fresh_hours);
    if (freshHours != null) {
      const freshCutoff = Math.floor((Date.now() - freshHours * 3600000) / 1000);
      query += ` AND posted_at_parsed IS NOT NULL AND posted_at_parsed >= ${addParam(freshCutoff)}`;
    }

    const minScore = safeInt(min_score);
    if (minScore != null) query += ` AND ai_score IS NOT NULL AND ai_score >= ${addParam(minScore)}`;

    if (startup_only === "true") query += " AND is_startup = 1";
    if (remote_only === "true") query += " AND lower(COALESCE(location, '')) LIKE '%remote%'";

    if (q) {
      const term = `%${String(q).toLowerCase().trim()}%`;
      const t = addParam(term);
      query += ` AND (lower(title) LIKE ${t} OR lower(company) LIKE ${t} OR lower(COALESCE(location, '')) LIKE ${t} OR lower(COALESCE(skills, '')) LIKE ${t} OR lower(COALESCE(ai_reason, '')) LIKE ${t})`;
    }

    query += " ORDER BY CASE WHEN posted_at_parsed IS NULL THEN 1 ELSE 0 END, posted_at_parsed DESC, created_at DESC";

    const jobs = await getRows(query, params);
    res.json(jobs.map(j => ({ ...j, skills: j.skills ? JSON.parse(j.skills) : [], is_startup: Boolean(j.is_startup) })));
  } catch (err) {
    console.error("[Jobs/GET /] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id
router.get("/:id", async (req, res) => {
  try {
    const job = await getRow("SELECT * FROM jobs WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json({ ...job, skills: job.skills ? JSON.parse(job.skills) : [], is_startup: Boolean(job.is_startup) });
  } catch (err) {
    console.error("[Jobs/GET /:id] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/batch — receives raw scraped jobs from extension
router.post("/batch", async (req, res) => {
  const uid = req.userId;
  const rawJobs = req.body;

  if (!Array.isArray(rawJobs) || rawJobs.length === 0) {
    return res.json({ saved: 0, rejected: 0, duplicates: 0 });
  }

  const relevant = rawJobs.filter(j => isRelevantTitle(j.title));
  const withIds = relevant.map((j, i) => ({ ...j, temp_id: `tmp_${i}` }));
  const newJobs = await filterDuplicates(withIds, uid);
  const duplicates = rawJobs.length - newJobs.length;

  if (newJobs.length === 0) return res.json({ saved: 0, rejected: 0, duplicates });

  let scoredMap = {};
  try {
    // Rule-based scoring — synchronous, no AI, no user profile needed.
    const scored = await auditJobs(newJobs);
    scored.forEach(s => { scoredMap[s.temp_id] = s; });
  } catch (err) {
    console.error("[Jobs/batch] Auditor error:", err.message);
    newJobs.forEach(j => { scoredMap[j.temp_id] = { score: null, reason: "auditor_error", keep: true }; });
  }

  const threshold = parseInt(process.env.JOB_SCORE_THRESHOLD || "6");
  let saved = 0, rejected = 0;

  await withTransaction(async (client) => {
    for (const job of newJobs) {
      const s = scoredMap[job.temp_id];
      // A job the extension already auto-applied to (e.g. Instahyre's merged
      // scrape+apply flow) is a real, already-submitted application — it must
      // be recorded regardless of score, or we'd lose all visibility into what
      // was actually applied to.
      const isAlreadyApplied = job.status === "applied";
      if (!isAlreadyApplied && s && s.score !== null && s.score < threshold) { rejected++; continue; }

      const initialStatus = isAlreadyApplied ? "applied" : "unseen";
      const appliedAt = isAlreadyApplied ? new Date().toISOString() : null;

      await client.query(
        `INSERT INTO jobs
          (id, user_id, title, company, location, source, job_url, posted_at, posted_at_parsed,
           experience_required, skills, salary, is_startup, ai_score, ai_reason, status, applied_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT DO NOTHING`,
        [
          uuidv4(), uid,
          job.title, job.company, job.location || null,
          job.source, job.job_url, job.posted_at || null,
          job.posted_at_parsed || null, job.experience_required || null,
          job.skills?.length ? JSON.stringify(job.skills) : null, job.salary || null,
          job.is_startup ? 1 : 0, s?.score ?? null, s?.reason ?? null,
          initialStatus, appliedAt,
        ]
      );
      saved++;
    }
  });

  const today = new Date().toISOString().split("T")[0];
  await execute(
    `INSERT INTO daily_stats (date, user_id, jobs_scraped) VALUES ($1, $2, $3)
     ON CONFLICT (date, user_id) DO UPDATE SET jobs_scraped = daily_stats.jobs_scraped + EXCLUDED.jobs_scraped`,
    [today, uid, saved]
  );

  console.log(`[Jobs/batch] uid=${uid} saved=${saved} rejected=${rejected} duplicates=${duplicates}`);
  res.json({ saved, rejected, duplicates });
});

// PATCH /api/jobs/:id/status
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ["unseen", "seen", "applied", "interviewing", "rejected", "ghosted", "offer", "dismissed"];
    if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status" });

    if (status === "applied") {
      await execute(
        "UPDATE jobs SET status = $1, applied_at = $2 WHERE id = $3 AND user_id = $4",
        [status, new Date().toISOString(), req.params.id, req.userId]
      );
    } else {
      await execute("UPDATE jobs SET status = $1 WHERE id = $2 AND user_id = $3", [status, req.params.id, req.userId]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[Jobs/PATCH /:id/status] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/jobs/:id/notes
router.patch("/:id/notes", async (req, res) => {
  try {
    await execute("UPDATE jobs SET notes = $1 WHERE id = $2 AND user_id = $3", [req.body.notes, req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("[Jobs/PATCH /:id/notes] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/jobs/:id
router.delete("/:id", async (req, res) => {
  try {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE connection_queue SET lead_id = NULL WHERE lead_id IN (SELECT id FROM li_leads WHERE job_id = $1 AND user_id = $2)`,
        [req.params.id, req.userId]
      );
      await client.query("DELETE FROM li_leads WHERE job_id = $1 AND user_id = $2", [req.params.id, req.userId]);
      await client.query("DELETE FROM jobs WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[Jobs/DELETE /:id] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/clear-unapplied — wipe every scraped job that hasn't been
// applied to (any age, regardless of linked li_leads). Applied/interviewing/
// offer jobs are NEVER touched here.
router.post("/clear-unapplied", async (req, res) => {
  const uid = req.userId;
  try {
    const deleted = await withTransaction(async (client) => {
      await client.query(
        `UPDATE connection_queue SET lead_id = NULL
         WHERE lead_id IN (
           SELECT l.id FROM li_leads l
           JOIN jobs j ON j.id = l.job_id
           WHERE l.user_id = $1 AND j.status NOT IN ('applied', 'interviewing', 'offer', 'rejected', 'ghosted')
         )`,
        [uid]
      );
      await client.query(
        `DELETE FROM li_leads WHERE user_id = $1 AND job_id IN (
           SELECT id FROM jobs WHERE user_id = $1 AND status NOT IN ('applied', 'interviewing', 'offer', 'rejected', 'ghosted')
         )`,
        [uid]
      );
      const result = await client.query(
        `DELETE FROM jobs WHERE user_id = $1 AND status NOT IN ('applied', 'interviewing', 'offer', 'rejected', 'ghosted')`,
        [uid]
      );
      return result.rowCount ?? 0;
    });
    res.json({ ok: true, deleted });
  } catch (err) {
    console.error("[Jobs/clear-unapplied] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/cleanup-old
router.post("/cleanup-old", async (req, res) => {
  const uid = req.userId;
  const hoursRaw = Number.parseInt(req.body?.hours, 10);
  const hours = Number.isFinite(hoursRaw) ? Math.min(24 * 365, Math.max(1, hoursRaw)) : 24;
  const includeActive = !!req.body?.include_active;

  const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
  const params = [uid, cutoff, uid];
  let query = `DELETE FROM jobs WHERE user_id = $1 AND created_at < $2 AND NOT EXISTS (SELECT 1 FROM li_leads WHERE li_leads.job_id = jobs.id AND li_leads.user_id = $3)`;

  if (!includeActive) query += " AND status NOT IN ('applied', 'interviewing', 'offer', 'rejected', 'ghosted')";

  try {
    const deleted = await execute(query, params);
    res.json({ ok: true, deleted, hours, include_active: includeActive });
  } catch (err) {
    console.error("[Jobs/cleanup-old] DB error:", err.message);
    res.status(500).json({ error: "Failed to cleanup jobs", detail: err.message });
  }
});

export default router;
