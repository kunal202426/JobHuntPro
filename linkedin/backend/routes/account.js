import { Router } from "express";
import { getRow, execute, withTransaction } from "../db/client.js";

const router = Router();

const PROFILE_FIELDS = [
  "full_name", "current_role", "target_role", "background_text",
  "college", "location", "skills", "experience_years", "target_keywords",
];

function parseProfileRow(row) {
  if (!row) return { experience_years: null, skills: [], target_keywords: [] };
  return {
    full_name: row.full_name || "",
    current_role: row.current_role || "",
    target_role: row.target_role || "",
    background_text: row.background_text || "",
    college: row.college || "",
    location: row.location || "",
    experience_years: Number.isFinite(row.experience_years) ? row.experience_years : null,
    skills: (row.skills || "").split(",").map(s => s.trim()).filter(Boolean),
    target_keywords: (row.target_keywords || "").split(",").map(s => s.trim()).filter(Boolean),
  };
}

// GET /api/account/profile — used by both the Settings page and the extension
// (to build search URLs / keyword filters tailored to this user instead of
// one hardcoded resume/role/location).
router.get("/profile", async (req, res) => {
  try {
    const row = await getRow("SELECT * FROM users WHERE id = $1", [req.userId]);
    res.json(parseProfileRow(row));
  } catch (err) {
    console.error("[Account/profile GET] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/account/profile — upsert. Only touches the fields this backend
// owns (job-matching profile); Gmail/AI-key/email-draft fields live on the
// cold backend's own /auth/profile and are untouched here.
router.put("/profile", async (req, res) => {
  try {
    const body = req.body || {};
    const values = {};
    for (const field of PROFILE_FIELDS) {
      if (field === "experience_years") {
        const parsed = Number.parseInt(body.experience_years, 10);
        values.experience_years = Number.isFinite(parsed) ? Math.max(0, Math.min(60, parsed)) : null;
      } else if (field === "skills" || field === "target_keywords") {
        values[field] = Array.isArray(body[field])
          ? body[field].map(s => String(s).trim()).filter(Boolean).join(",")
          : String(body[field] || "").trim();
      } else {
        values[field] = String(body[field] || "").trim();
      }
    }

    const existing = await getRow("SELECT id FROM users WHERE id = $1", [req.userId]);
    if (existing) {
      const setClauses = PROFILE_FIELDS.map((f, i) => `${f} = $${i + 2}`).join(", ");
      await execute(
        `UPDATE users SET ${setClauses} WHERE id = $1`,
        [req.userId, ...PROFILE_FIELDS.map(f => values[f])]
      );
    } else {
      const columns = ["id", "email", ...PROFILE_FIELDS];
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      await execute(
        `INSERT INTO users (${columns.join(", ")}) VALUES (${placeholders})`,
        [req.userId, req.userEmail || "", ...PROFILE_FIELDS.map(f => values[f])]
      );
    }

    const row = await getRow("SELECT * FROM users WHERE id = $1", [req.userId]);
    res.json(parseProfileRow(row));
  } catch (err) {
    console.error("[Account/profile PUT] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

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
