import { Router } from "express";
import { getRows } from "../db/client.js";

const router = Router();

// requireAuth already verifies the JWT and sets req.userEmail (see middleware/auth.js).
// No hardcoded fallback: an unset ADMIN_EMAIL means these routes are closed to
// everyone, not silently granted to one specific person's address regardless
// of who's actually running this deployment.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || null;

function isAdmin(req) {
  return Boolean(ADMIN_EMAIL) && req.userEmail === ADMIN_EMAIL;
}

// GET /admin/users — summary of all users who have data in the LinkedIn DB
router.get("/users", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  try {
    const users = await getRows(`
      SELECT u.user_id,
        COUNT(DISTINCT j.id)  AS jobs_count,
        COUNT(DISTINCT l.id)  AS li_leads_count
      FROM (SELECT DISTINCT user_id FROM jobs UNION SELECT DISTINCT user_id FROM li_leads) u
      LEFT JOIN jobs     j ON j.user_id = u.user_id
      LEFT JOIN li_leads l ON l.user_id = u.user_id
      GROUP BY u.user_id
    `);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/users/:userId/jobs
router.get("/users/:userId/jobs", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  try {
    const jobs = await getRows(
      "SELECT * FROM jobs WHERE user_id = $1 ORDER BY created_at DESC",
      [req.params.userId]
    );
    res.json(jobs.map(j => ({
      ...j,
      skills:     j.skills ? JSON.parse(j.skills) : [],
      is_startup: Boolean(j.is_startup),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/users/:userId/li_leads
router.get("/users/:userId/li_leads", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  try {
    const li_leads = await getRows(`
      SELECT l.*, j.title AS job_title, j.company AS job_company
      FROM li_leads l
      LEFT JOIN jobs j ON l.job_id = j.id
      WHERE l.user_id = $1
      ORDER BY l.created_at DESC
    `, [req.params.userId]);
    res.json(li_leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
