import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import rateLimit from "express-rate-limit";
import { initDB } from "./db/schema.js";
import { getRow, execute } from "./db/client.js";
import jobsRouter from "./routes/jobs.js";
import leadsRouter from "./routes/leads.js";
import queueRouter from "./routes/queue.js";
import statsRouter from "./routes/stats.js";
import scrapeRouter from "./routes/scrape.js";
import adminRouter from "./routes/admin.js";
import accountRouter from "./routes/account.js";
import { requireAuth } from "./middleware/auth.js";

dotenv.config();
const app = express();

// Behind Render's proxy — needed so express-rate-limit sees the real client IP.
app.set("trust proxy", 1);

// Allow localhost (any port), chrome-extension, and optional extra origins via env
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(o => o.trim()).filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (/^chrome-extension:\/\//.test(origin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return allowedOrigins.includes(origin);
}

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error("CORS: origin not allowed"));
  }
}));
app.use(express.json({ limit: "2mb" }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use("/api", apiLimiter);
app.use("/admin", apiLimiter);

app.use("/api/jobs",  requireAuth, jobsRouter);
app.use("/api/leads", requireAuth, leadsRouter);
app.use("/api/queue", requireAuth, queueRouter);
app.use("/api/stats", requireAuth, statsRouter);
app.use("/api/scrape", requireAuth, scrapeRouter);
app.use("/api/account", requireAuth, accountRouter);
app.use("/admin", requireAuth, adminRouter);

app.get("/health", (req, res) => res.json({ status: "ok", service: "linkedin-api" }));

// POST /api/find-leads
app.post("/api/find-leads", requireAuth, async (req, res) => {
  try {
    const { job_id } = req.body;
    if (!job_id) return res.status(400).json({ error: "job_id required" });
    const job = await getRow("SELECT company FROM jobs WHERE id = $1 AND user_id = $2", [job_id, req.userId]);
    if (!job) return res.status(404).json({ error: "Job not found" });
    const id = uuidv4();
    await execute(
      "INSERT INTO find_leads_queue (id, user_id, job_id, company) VALUES ($1,$2,$3,$4)",
      [id, req.userId, job_id, job.company]
    );
    res.status(202).json({ ok: true, request_id: id });
  } catch (err) {
    console.error("[find-leads/POST] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/find-leads/cancel
app.post("/api/find-leads/cancel", requireAuth, async (req, res) => {
  try {
    const cancelled = await execute(
      `UPDATE find_leads_queue
       SET status = 'cancelled', processed_at = NOW()
       WHERE user_id = $1 AND status IN ('pending', 'processing')`,
      [req.userId]
    );
    res.json({ ok: true, cancelled });
  } catch (err) {
    console.error("[find-leads/POST cancel] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/find-leads/pending — extension polls
app.get("/api/find-leads/pending", requireAuth, async (req, res) => {
  try {
    // Reset stuck processing items
    await execute(
      `UPDATE find_leads_queue SET status = 'pending'
       WHERE status = 'processing' AND user_id = $1 AND processed_at < NOW() - INTERVAL '15 minutes'`,
      [req.userId]
    );

    const pending = await getRow(
      "SELECT * FROM find_leads_queue WHERE status = 'pending' AND user_id = $1 ORDER BY created_at ASC LIMIT 1",
      [req.userId]
    );
    if (!pending) return res.json(null);
    await execute(
      "UPDATE find_leads_queue SET status = 'processing', processed_at = NOW() WHERE id = $1",
      [pending.id]
    );
    res.json(pending);
  } catch (err) {
    console.error("[find-leads/GET pending] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/find-leads/:id/done
app.patch("/api/find-leads/:id/done", requireAuth, async (req, res) => {
  try {
    const { status = "done" } = req.body;
    await execute(
      "UPDATE find_leads_queue SET status = $1, processed_at = NOW() WHERE id = $2 AND user_id = $3",
      [status, req.params.id, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("[find-leads/PATCH done] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/find-leads/:id/status — frontend polls while extension is working
app.get("/api/find-leads/:id/status", requireAuth, async (req, res) => {
  try {
    const row = await getRow(
      "SELECT status FROM find_leads_queue WHERE id = $1 AND user_id = $2",
      [req.params.id, req.userId]
    );
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ status: row.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3001;

initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`[Backend] Running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("[DB] Failed to initialize:", err.message);
    process.exit(1);
  });
