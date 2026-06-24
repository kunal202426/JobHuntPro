import { Router } from "express";
import { getRow, getRows, execute } from "../db/client.js";

const router = Router();
const DEFAULT_DAILY_LIMIT = 14;
const MIN_DAILY_LIMIT = 1;
const MAX_DAILY_LIMIT = 100;

function sanitizeDailyLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DAILY_LIMIT;
  return Math.min(MAX_DAILY_LIMIT, Math.max(MIN_DAILY_LIMIT, parsed));
}

async function getDailyLimit(userId) {
  const row = await getRow("SELECT value FROM app_settings WHERE key = 'daily_limit' AND user_id = $1", [userId]);
  const limit = sanitizeDailyLimit(row?.value);
  if (!row) {
    await execute(
      `INSERT INTO app_settings (key, user_id, value) VALUES ('daily_limit', $1, $2) ON CONFLICT DO NOTHING`,
      [userId, String(limit)]
    );
  }
  return limit;
}

async function setDailyLimit(userId, value) {
  const limit = sanitizeDailyLimit(value);
  await execute(
    `INSERT INTO app_settings (key, user_id, value) VALUES ('daily_limit', $1, $2)
     ON CONFLICT (key, user_id) DO UPDATE SET value = EXCLUDED.value`,
    [userId, String(limit)]
  );
  return limit;
}

// GET /api/stats/today
router.get("/today", async (req, res) => {
  try {
    const uid = req.userId;
    const today = new Date().toISOString().split("T")[0];
    const dailyLimit = await getDailyLimit(uid);

    const row = await getRow("SELECT * FROM daily_stats WHERE date = $1 AND user_id = $2", [today, uid]) || {
      date: today, connections_sent: 0, connections_failed: 0, jobs_scraped: 0, leads_found: 0,
    };

    const qPending = await getRow(
      "SELECT COUNT(*) AS count FROM connection_queue WHERE status = 'pending' AND user_id = $1",
      [uid]
    );
    const qSentToday = await getRow(
      "SELECT COUNT(*) AS count FROM connection_queue WHERE status = 'sent' AND user_id = $1 AND result_at::date = $2",
      [uid, today]
    );

    const runRow = await getRow(
      "SELECT value FROM app_settings WHERE key = 'queue_running' AND user_id = $1",
      [uid]
    );

    res.json({
      ...row,
      daily_limit: dailyLimit,
      queue_pending: parseInt(qPending?.count || 0),
      queue_sent_today: parseInt(qSentToday?.count || 0),
      running: runRow?.value === "true",
    });
  } catch (err) {
    console.error("[Stats/GET /today] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/daily-limit", async (req, res) => {
  try {
    res.json({ daily_limit: await getDailyLimit(req.userId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/daily-limit", async (req, res) => {
  try {
    const dailyLimit = await setDailyLimit(req.userId, req.body?.daily_limit);
    res.json({ ok: true, daily_limit: dailyLimit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/history
router.get("/history", async (req, res) => {
  try {
    const rows = await getRows("SELECT * FROM daily_stats WHERE user_id = $1 ORDER BY date DESC LIMIT 30", [req.userId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
