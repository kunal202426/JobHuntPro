import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getRow, getRows, execute } from "../db/client.js";

const router = Router();

const SOURCES = ["linkedin", "naukri", "cutshort", "instahyre", "hiringcafe"];
// NEW: Targeted Company Search
const COMPANY_SOURCES = ["linkedin", "naukri", "instahyre", "hiringcafe"];

function normalizeSource(source) {
  const s = String(source || "").trim().toLowerCase();
  if (s === "all") return "all";
  return SOURCES.includes(s) ? s : null;
}

function normalizeMode(mode) {
  const m = String(mode || "manual").trim().toLowerCase();
  return m === "auto" ? "auto" : "manual";
}

// NEW: Targeted Company Search
function normalizeCompany(value) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 80);
}

// NEW: Targeted Company Search
function normalizeCompanySource(source) {
  const s = String(source || "").trim().toLowerCase();
  if (s === "all") return "all";
  return COMPANY_SOURCES.includes(s) ? s : null;
}

async function latestStatusBySource(userId) {
  const rows = await getRows(`
    SELECT t1.source, t1.status, t1.message, t1.mode, t1.created_at, t1.updated_at
    FROM scrape_tasks t1
    JOIN (
      SELECT source, MAX(created_at) AS max_created_at
      FROM scrape_tasks WHERE user_id = $1
      GROUP BY source
    ) latest ON latest.source = t1.source AND latest.max_created_at = t1.created_at
    WHERE t1.user_id = $1
    ORDER BY t1.source
  `, [userId]);

  const map = Object.fromEntries(SOURCES.map(s => [s, {
    source: s, status: "idle", message: null, mode: null, created_at: null, updated_at: null,
  }]));
  rows.forEach((row) => { map[row.source] = row; });
  return SOURCES.map(s => map[s]);
}

async function enqueueSource(source, mode, userId) {
  const inFlight = await getRow(
    "SELECT id FROM scrape_tasks WHERE source = $1 AND user_id = $2 AND status IN ('pending', 'processing') LIMIT 1",
    [source, userId]
  );
  if (inFlight) return { queued: false, reason: "already_queued" };

  const id = uuidv4();
  await execute(
    `INSERT INTO scrape_tasks (id, user_id, source, mode, status, message) VALUES ($1,$2,$3,$4,'pending',$5)`,
    [id, userId, source, mode, mode === "auto" ? "Scheduled daily scrape" : "Queued from dashboard"]
  );
  return { queued: true, id };
}

// NEW: Targeted Company Search
async function enqueueSourceWithCompany(source, mode, userId, company) {
  const inFlight = await getRow(
    "SELECT id FROM scrape_tasks WHERE source = $1 AND user_id = $2 AND status IN ('pending', 'processing') LIMIT 1",
    [source, userId]
  );
  if (inFlight) return { queued: false, reason: "already_queued" };

  const id = uuidv4();
  await execute(
    `INSERT INTO scrape_tasks (id, user_id, source, mode, status, message, company) VALUES ($1,$2,$3,$4,'pending',$5,$6)`,
    [id, userId, source, mode, `Queued company search: ${company}`, company]
  );
  return { queued: true, id };
}

// GET /api/scrape/status
router.get("/status", async (req, res) => {
  try {
    const statuses = await latestStatusBySource(req.userId);
    res.json({ sources: statuses });
  } catch (err) {
    console.error("[Scrape/GET /status] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scrape/trigger
router.post("/trigger", async (req, res) => {
  try {
    const source = normalizeSource(req.body?.source);
    const mode = normalizeMode(req.body?.mode);
    if (!source) return res.status(400).json({ error: "Invalid source" });

    const targets = source === "all" ? SOURCES : [source];
    const results = await Promise.all(targets.map(async (s) => ({ source: s, ...(await enqueueSource(s, mode, req.userId)) })));
    res.json({ ok: true, results });
  } catch (err) {
    console.error("[Scrape/POST /trigger] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// NEW: Targeted Company Search
// POST /api/scrape/trigger-company
router.post("/trigger-company", async (req, res) => {
  try {
    const source = normalizeCompanySource(req.body?.source);
    const mode = normalizeMode(req.body?.mode);
    const company = normalizeCompany(req.body?.company);
    if (!source) return res.status(400).json({ error: "Invalid source" });
    if (!company) return res.status(400).json({ error: "Company is required" });

    const targets = source === "all" ? COMPANY_SOURCES : [source];
    const results = await Promise.all(targets.map(async (s) => (
      { source: s, ...(await enqueueSourceWithCompany(s, mode, req.userId, company)) }
    )));
    res.json({ ok: true, results });
  } catch (err) {
    console.error("[Scrape/POST /trigger-company] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scrape/pending — extension polls this
router.get("/pending", async (req, res) => {
  try {
    await execute(
      `UPDATE scrape_tasks
       SET status = 'pending', updated_at = NOW(), message = 'Scrape timed out and was re-queued'
       WHERE status = 'processing' AND user_id = $1 AND updated_at < NOW() - INTERVAL '15 minutes'`,
      [req.userId]
    );

    const task = await getRow(
      "SELECT * FROM scrape_tasks WHERE status = 'pending' AND user_id = $1 ORDER BY created_at ASC LIMIT 1",
      [req.userId]
    );
    if (!task) return res.json(null);

    await execute(
      "UPDATE scrape_tasks SET status = 'processing', updated_at = NOW(), message = 'Scrape started in extension' WHERE id = $1",
      [task.id]
    );
    res.json(task);
  } catch (err) {
    console.error("[Scrape/GET /pending] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scrape/:id/result
router.post("/:id/result", async (req, res) => {
  try {
    const status = String(req.body?.status || "failed").trim().toLowerCase();
    const valid = ["completed", "failed", "login_required"];
    if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status" });

    const message = req.body?.message ? String(req.body.message).slice(0, 300) : null;
    await execute(
      "UPDATE scrape_tasks SET status = $1, message = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4",
      [status, message, req.params.id, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("[Scrape/POST /:id/result] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scrape/cancel
router.post("/cancel", async (req, res) => {
  try {
    const cancelled = await execute(
      `UPDATE scrape_tasks
       SET status = 'cancelled', message = 'Cancelled after session ended', updated_at = NOW()
       WHERE user_id = $1 AND status IN ('pending', 'processing')`,
      [req.userId]
    );
    res.json({ ok: true, cancelled });
  } catch (err) {
    console.error("[Scrape/POST /cancel] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
