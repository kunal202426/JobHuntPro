import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getRow, getRows, execute } from "../db/client.js";

const router = Router();

// GET /api/queue
router.get("/", async (req, res) => {
  try {
    const uid = req.userId;
    const { status } = req.query;
    const params = [uid];
    let query = "SELECT * FROM connection_queue WHERE user_id = $1";
    if (status && status !== "all") {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }
    query += " ORDER BY queued_at DESC";
    res.json(await getRows(query, params));
  } catch (err) {
    console.error("[Queue/GET /] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/queue — manually add a person
router.post("/", async (req, res) => {
  try {
    const { name, profile_url, title, company } = req.body;
    if (!profile_url || !profile_url.includes("/in/")) {
      return res.status(400).json({ error: "Valid LinkedIn profile URL required (must contain /in/)" });
    }
    const url = profile_url.trim();

    const existing = await getRow(
      "SELECT id FROM connection_queue WHERE profile_url = $1 AND user_id = $2 AND status IN ('pending', 'processing')",
      [url, req.userId]
    );
    if (existing) return res.json({ ok: true, id: existing.id, already_queued: true });

    const id = uuidv4();
    await execute(
      `INSERT INTO connection_queue (id, user_id, profile_url, name, title, company, source, status)
       VALUES ($1,$2,$3,$4,$5,$6,'manual','pending')`,
      [id, req.userId, url, name || null, title || null, company || null]
    );
    res.json({ ok: true, id });
  } catch (err) {
    console.error("[Queue/POST /] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/queue/next — pop next pending item for extension alarm
router.get("/next", async (req, res) => {
  try {
    // Requeue stuck processing items (older than 15 minutes)
    await execute(
      `UPDATE connection_queue SET status = 'pending', attempted_at = NULL
       WHERE status = 'processing' AND user_id = $1 AND attempted_at < NOW() - INTERVAL '15 minutes'`,
      [req.userId]
    );

    const next = await getRow(
      "SELECT * FROM connection_queue WHERE status = 'pending' AND user_id = $1 ORDER BY queued_at ASC LIMIT 1",
      [req.userId]
    );
    if (!next) return res.json(null);

    await execute(
      "UPDATE connection_queue SET status = 'processing', attempted_at = NOW() WHERE id = $1",
      [next.id]
    );
    res.json(next);
  } catch (err) {
    console.error("[Queue/GET /next] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/queue/result — extension reports connect attempt result
router.post("/result", async (req, res) => {
  try {
    const { queue_id, status, error_msg } = req.body;
    if (!queue_id) return res.status(400).json({ error: "queue_id required" });
    const valid = ["sent", "failed", "already_connected", "no_button", "already_pending", "skipped"];
    if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status" });

    const normalizedStatus = status === "already_connected" ? "failed" : status;
    const normalizedError = status === "already_connected" ? "verify_connection" : (error_msg || null);

    await execute(
      "UPDATE connection_queue SET status = $1, result_at = NOW(), error_msg = $2 WHERE id = $3 AND user_id = $4",
      [normalizedStatus, normalizedError, queue_id, req.userId]
    );

    const item = await getRow("SELECT lead_id FROM connection_queue WHERE id = $1 AND user_id = $2", [queue_id, req.userId]);
    if (item?.lead_id) {
      const leadStatus =
        normalizedStatus === "sent"   ? "sent"   :
        normalizedStatus === "failed" ? "failed" :
        status === "no_button"         ? "failed" :
        status === "already_pending"   ? "sent" :
        status === "skipped"           ? "not_queued" : "queued";
      await execute("UPDATE li_leads SET connect_status = $1 WHERE id = $2", [leadStatus, item.lead_id]);
    }

    if (normalizedStatus === "sent") {
      const today = new Date().toISOString().split("T")[0];
      await execute(
        `INSERT INTO daily_stats (date, user_id, connections_sent) VALUES ($1, $2, 1)
         ON CONFLICT (date, user_id) DO UPDATE SET connections_sent = daily_stats.connections_sent + 1`,
        [today, req.userId]
      );

      const qItem = await getRow("SELECT * FROM connection_queue WHERE id = $1 AND user_id = $2", [queue_id, req.userId]);
      if (qItem) {
        const alreadyLogged = await getRow(
          "SELECT id FROM connections_log WHERE profile_url = $1 AND user_id = $2",
          [qItem.profile_url, req.userId]
        );
        if (!alreadyLogged) {
          await execute(
            `INSERT INTO connections_log (id, user_id, profile_url, name, company, source)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [uuidv4(), req.userId, qItem.profile_url, qItem.name, qItem.company, qItem.source]
          );
        }
      }
    }

    if (normalizedStatus === "failed" || status === "no_button") {
      const today = new Date().toISOString().split("T")[0];
      await execute(
        `INSERT INTO daily_stats (date, user_id, connections_failed) VALUES ($1, $2, 1)
         ON CONFLICT (date, user_id) DO UPDATE SET connections_failed = daily_stats.connections_failed + 1`,
        [today, req.userId]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[Queue/POST /result] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/queue/run-state
router.get("/run-state", async (req, res) => {
  try {
    const row = await getRow(
      "SELECT value FROM app_settings WHERE key = 'queue_running' AND user_id = $1",
      [req.userId]
    );
    res.json({ running: row?.value === "true" });
  } catch (err) {
    res.json({ running: false });
  }
});

// POST /api/queue/start
router.post("/start", async (req, res) => {
  try {
    await execute(
      `INSERT INTO app_settings (key, user_id, value) VALUES ('queue_running', $1, 'true')
       ON CONFLICT (key, user_id) DO UPDATE SET value = 'true'`,
      [req.userId]
    );
    res.json({ ok: true, running: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/queue/stop
router.post("/stop", async (req, res) => {
  try {
    await execute(
      `INSERT INTO app_settings (key, user_id, value) VALUES ('queue_running', $1, 'false')
       ON CONFLICT (key, user_id) DO UPDATE SET value = 'false'`,
      [req.userId]
    );
    res.json({ ok: true, running: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/queue/:id/status
router.patch("/:id/status", async (req, res) => {
  try {
    const { status, error_msg } = req.body;
    const valid = ["pending", "processing", "sent", "accepted", "failed", "skipped"];
    if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status" });

    const hasResultAt = ["sent", "accepted", "failed", "skipped"].includes(status);
    if (hasResultAt) {
      await execute(
        "UPDATE connection_queue SET status = $1, result_at = NOW(), error_msg = $2 WHERE id = $3 AND user_id = $4",
        [status, error_msg || null, req.params.id, req.userId]
      );
    } else {
      await execute(
        "UPDATE connection_queue SET status = $1, error_msg = $2 WHERE id = $3 AND user_id = $4",
        [status, error_msg || null, req.params.id, req.userId]
      );
    }

    const item = await getRow(
      "SELECT lead_id FROM connection_queue WHERE id = $1 AND user_id = $2",
      [req.params.id, req.userId]
    );
    if (item?.lead_id) {
      const leadStatus =
        status === "sent"     ? "sent" :
        status === "accepted" ? "accepted" :
        status === "failed"   ? "failed" :
        status === "skipped"  ? "not_queued" : "queued";
      await execute("UPDATE li_leads SET connect_status = $1 WHERE id = $2", [leadStatus, item.lead_id]);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[Queue/PATCH /:id/status] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
