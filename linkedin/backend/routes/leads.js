import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getRow, getRows, execute, withTransaction } from "../db/client.js";
import { auditLeads } from "../services/auditor.js";

const router = Router();

// GET /api/leads
router.get("/", async (req, res) => {
  try {
    const uid = req.userId;
    const { job_id, category, connect_status } = req.query;

    const params = [uid];
    const addParam = (val) => { params.push(val); return `$${params.length}`; };

    let query = `
      SELECT l.*, j.title AS job_title, j.company AS job_company
      FROM li_leads l LEFT JOIN jobs j ON l.job_id = j.id
      WHERE l.user_id = $1
    `;

    if (job_id)         query += ` AND l.job_id = ${addParam(job_id)}`;
    if (category)       query += ` AND l.category = ${addParam(category)}`;
    if (connect_status) query += ` AND l.connect_status = ${addParam(connect_status)}`;

    query += " ORDER BY l.ai_score DESC, l.created_at DESC";
    res.json(await getRows(query, params));
  } catch (err) {
    console.error("[Leads/GET /] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/:id
router.get("/:id", async (req, res) => {
  try {
    const lead = await getRow(`
      SELECT l.*, j.title AS job_title, j.company AS job_company
      FROM li_leads l LEFT JOIN jobs j ON l.job_id = j.id
      WHERE l.id = $1 AND l.user_id = $2
    `, [req.params.id, req.userId]);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json(lead);
  } catch (err) {
    console.error("[Leads/GET /:id] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/batch — extension sends raw LinkedIn profiles after Find Leads
router.post("/batch", async (req, res) => {
  const uid = req.userId;
  const { profiles, job_id, company } = req.body;

  if (!Array.isArray(profiles) || profiles.length === 0 || !job_id) {
    return res.json({ saved: 0, rejected: 0, duplicates: 0 });
  }

  const job = await getRow("SELECT title, company FROM jobs WHERE id = $1 AND user_id = $2", [job_id, uid]);
  if (!job) return res.status(404).json({ error: "Job not found" });

  const targetCompany = company || job.company;
  const jobTitle = job.title;

  const newProfiles = [];
  for (const p of profiles) {
    const existing = await getRow(
      "SELECT id FROM li_leads WHERE profile_url = $1 AND job_id = $2 AND user_id = $3",
      [p.profile_url, job_id, uid]
    );
    if (!existing) newProfiles.push(p);
  }
  const duplicates = profiles.length - newProfiles.length;

  if (newProfiles.length === 0) return res.json({ saved: 0, rejected: 0, duplicates });

  const withIds = newProfiles.map((p, i) => ({ ...p, temp_id: p.temp_id || p.profile_url || `tmp_${i}` }));

  let scoredMap = {};
  try {
    // Rule-based scoring — synchronous, no AI, no user profile needed.
    const scored = await auditLeads(withIds, targetCompany, jobTitle);
    scored.forEach(s => { scoredMap[s.temp_id] = s; });
  } catch (err) {
    console.error("[Leads/batch] Auditor error:", err.message);
    withIds.forEach(p => { scoredMap[p.temp_id] = { score: null, reason: "auditor_unavailable", keep: true, category: "peer" }; });
  }

  const threshold = parseInt(process.env.LEAD_SCORE_THRESHOLD || "7");
  let saved = 0, rejected = 0;

  await withTransaction(async (client) => {
    for (const p of withIds) {
      const s = scoredMap[p.temp_id];
      if (s && s.score !== null && s.score < threshold) { rejected++; continue; }
      await client.query(
        `INSERT INTO li_leads
          (id, user_id, job_id, name, title, company, profile_url, ai_score, ai_reason, category, connect_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'not_queued')
         ON CONFLICT DO NOTHING`,
        [
          uuidv4(), uid, job_id,
          p.name, p.title || null, p.company || targetCompany,
          p.profile_url, s?.score ?? null, s?.reason ?? null, s?.category ?? "peer",
        ]
      );
      saved++;
    }
  });

  if (saved > 0) {
    const today = new Date().toISOString().split("T")[0];
    await execute(
      `INSERT INTO daily_stats (date, user_id, leads_found) VALUES ($1, $2, $3)
       ON CONFLICT (date, user_id) DO UPDATE SET leads_found = daily_stats.leads_found + EXCLUDED.leads_found`,
      [today, uid, saved]
    );
  }

  console.log(`[Leads/batch] uid=${uid} saved=${saved} rejected=${rejected} duplicates=${duplicates}`);
  res.json({ saved, rejected, duplicates });
});

// POST /api/leads/:id/queue
router.post("/:id/queue", async (req, res) => {
  try {
    const uid = req.userId;
    const lead = await getRow("SELECT * FROM li_leads WHERE id = $1 AND user_id = $2", [req.params.id, uid]);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const existing = await getRow(
      "SELECT id FROM connection_queue WHERE lead_id = $1 AND status IN ('pending', 'processing')",
      [lead.id]
    );
    if (existing) return res.json({ ok: true, already_queued: true });

    await execute(
      `INSERT INTO connection_queue (id, user_id, lead_id, profile_url, name, title, company, source, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'panel3','pending')`,
      [uuidv4(), uid, lead.id, lead.profile_url, lead.name, lead.title, lead.company]
    );
    await execute("UPDATE li_leads SET connect_status = 'queued' WHERE id = $1", [lead.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("[Leads/POST /:id/queue] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id/connect_status
router.patch("/:id/connect_status", async (req, res) => {
  try {
    const valid = ["not_queued", "queued", "sent", "accepted", "failed"];
    const { connect_status } = req.body;
    if (!valid.includes(connect_status)) return res.status(400).json({ error: "Invalid connect_status" });
    await execute("UPDATE li_leads SET connect_status = $1 WHERE id = $2 AND user_id = $3", [connect_status, req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("[Leads/PATCH /:id/connect_status] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
