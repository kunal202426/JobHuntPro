import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getRow, getRows, execute } from "../db/client.js";

const router = Router();

// POST /api/apply/instahyre — enqueue all of the user's Instahyre jobs that
// aren't already applied or queued.
router.post("/instahyre", async (req, res) => {
  try {
    const uid = req.userId;
    const jobs = await getRows(
      `SELECT id, job_url, title, company FROM jobs
       WHERE user_id = $1 AND lower(source) = 'instahyre'
         AND job_url IS NOT NULL AND job_url <> ''
         AND status <> 'applied'
         AND id NOT IN (
           SELECT job_id FROM apply_queue WHERE user_id = $1 AND status IN ('pending','processing','done')
         )`,
      [uid]
    );

    let queued = 0;
    for (const j of jobs) {
      await execute(
        `INSERT INTO apply_queue (id, user_id, job_id, source, job_url, title, company, status)
         VALUES ($1,$2,$3,'instahyre',$4,$5,$6,'pending')`,
        [uuidv4(), uid, j.id, j.job_url, j.title || null, j.company || null]
      );
      queued++;
    }

    await execute(
      `INSERT INTO app_settings (key, user_id, value) VALUES ('apply_running', $1, 'true')
       ON CONFLICT (key, user_id) DO UPDATE SET value = 'true'`,
      [uid]
    );

    res.json({ ok: true, queued });
  } catch (err) {
    console.error("[Apply/instahyre] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/apply/next — extension pops the next pending apply task.
router.get("/next", async (req, res) => {
  try {
    const uid = req.userId;
    // Requeue stuck 'processing' items (tab crashed / closed mid-apply).
    await execute(
      `UPDATE apply_queue SET status='pending', processed_at=NULL
       WHERE status='processing' AND user_id=$1 AND processed_at < NOW() - INTERVAL '10 minutes'`,
      [uid]
    );

    const running = await getRow(
      "SELECT value FROM app_settings WHERE key='apply_running' AND user_id=$1",
      [uid]
    );
    if (running?.value !== "true") return res.json(null);

    const next = await getRow(
      "SELECT * FROM apply_queue WHERE status='pending' AND user_id=$1 ORDER BY created_at ASC LIMIT 1",
      [uid]
    );
    if (!next) {
      // Nothing left — stop so the extension doesn't keep polling every tick.
      await execute(
        `INSERT INTO app_settings (key, user_id, value) VALUES ('apply_running', $1, 'false')
         ON CONFLICT (key, user_id) DO UPDATE SET value='false'`,
        [uid]
      );
      return res.json(null);
    }

    await execute("UPDATE apply_queue SET status='processing', processed_at=NOW() WHERE id=$1", [next.id]);
    res.json(next);
  } catch (err) {
    console.error("[Apply/next] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/apply/result — extension reports the outcome of one apply.
router.post("/result", async (req, res) => {
  try {
    const { id, job_id, status, error_msg } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });
    const valid = ["applied", "already_applied", "failed", "skipped", "discarded"];
    if (!valid.includes(status)) return res.status(400).json({ error: "invalid status" });

    const norm = (status === "applied" || status === "already_applied") ? "done" : status;
    await execute(
      "UPDATE apply_queue SET status=$1, error_msg=$2, processed_at=NOW() WHERE id=$3 AND user_id=$4",
      [norm, error_msg || null, id, req.userId]
    );
    if ((status === "applied" || status === "already_applied") && job_id) {
      await execute("UPDATE jobs SET status='applied' WHERE id=$1 AND user_id=$2", [job_id, req.userId]);
    }
    // Unfit (too senior / >2 yrs experience, detected on the detail page) — delete it.
    if (status === "discarded" && job_id) {
      await execute("DELETE FROM jobs WHERE id=$1 AND user_id=$2", [job_id, req.userId]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[Apply/result] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/apply/status — counts for the UI to poll progress.
router.get("/status", async (req, res) => {
  try {
    const rows = await getRows(
      "SELECT status, COUNT(*) AS n FROM apply_queue WHERE user_id=$1 GROUP BY status",
      [req.userId]
    );
    const counts = {};
    rows.forEach((r) => { counts[r.status] = parseInt(r.n); });
    const running = await getRow("SELECT value FROM app_settings WHERE key='apply_running' AND user_id=$1", [req.userId]);
    res.json({ counts, running: running?.value === "true" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/apply/stop — cancel the run and clear anything still queued.
router.post("/stop", async (req, res) => {
  try {
    await execute(
      `INSERT INTO app_settings (key, user_id, value) VALUES ('apply_running', $1, 'false')
       ON CONFLICT (key, user_id) DO UPDATE SET value='false'`,
      [req.userId]
    );
    const cancelled = await execute(
      "UPDATE apply_queue SET status='cancelled', processed_at=NOW() WHERE status IN ('pending','processing') AND user_id=$1",
      [req.userId]
    );
    res.json({ ok: true, cancelled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
