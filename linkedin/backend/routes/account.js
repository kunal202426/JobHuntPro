import { Router } from "express";
import { withTransaction } from "../db/client.js";

const router = Router();

// POST /api/account/reset — wipe every table tied to this user (jobs, leads,
// connect/apply/scrape/find-leads queues, logs, daily stats). Does not touch
// the cold-email backend's data (leads/mails there are cleared separately).
router.post("/reset", async (req, res) => {
  const uid = req.userId;
  try {
    const deleted = await withTransaction(async (client) => {
      const counts = {};
      const tables = [
        "connections_log",
        "connection_queue",
        "apply_queue",
        "find_leads_queue",
        "scrape_tasks",
        "li_leads",
        "jobs",
        "daily_stats",
        "app_settings",
      ];
      for (const table of tables) {
        const result = await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [uid]);
        counts[table] = result.rowCount ?? 0;
      }
      return counts;
    });
    res.json({ ok: true, deleted });
  } catch (err) {
    console.error("[Account/reset] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
