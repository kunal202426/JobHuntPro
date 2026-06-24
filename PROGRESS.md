# JobHuntPro — Fix & Redeploy Progress Tracker

> Single source of truth for what's **done**, **in progress**, and **pending**.
> Update the Status column as work proceeds. Last updated: **2026-06-24**

**Status legend:** ✅ Done · 🔨 Working · ⏳ Pending · ⛔ Blocked (waiting on user/infra) · ➖ N/A

---

## Phase 0 — Infra decisions (RESOLVED ✅)

**Decisions (2026-06-24):** DB = **split: LinkedIn→Turso, Cold→Neon Postgres** (both 100% free + non-local; see 0.1) · Google OAuth = **reuse existing project/client ID** · Frontend = **Vercel subdomain** · OpenRouter = **user has a key** ✅

| # | Item | Status | Notes |
|---|------|--------|-------|
| 0.1 | DB choice | ✅ | **LinkedIn → Turso** (`@libsql/client`, pure JS, working). **Cold → Neon Postgres** (SQLAlchemy + psycopg2 already present; `sqlalchemy-libsql` needs a Rust wheel that fails to build → avoided). Backends are now fully independent DBs; auth stays stateless via shared JWT. |
| 0.2 | Google Cloud project | ✅ | **Reuse existing** — same OAuth Client ID across extension/frontend/backends |
| 0.3 | Frontend domain | ✅ | **Vercel subdomain** (e.g. jobhuntpro-frontend.vercel.app) |
| 0.4 | OpenRouter API key | ✅ | User has one — set `OPENROUTER_API_KEY` in cold backend env |
| 0.5 | Generate new `FIELD_ENCRYPTION_KEY` (Fernet) | ⏳ | `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| 0.6 | Generate new `JWT_SECRET` (64-char, shared both backends) | ⏳ | `openssl rand -hex 32` |
| 0.7 | Create 2 Render web services (cold-api, linkedin-api) | ⏳ | |
| 0.8 | Create / configure Vercel project | ⏳ | |
| 0.9 | Record all new URLs before editing configs | ⏳ | |

---

## Phase 1 — Cold backend fixes (`cold/backend/`)

| # | File | Change | Status | Notes |
|---|------|--------|--------|-------|
| 1.1 | `auth.py` | `SECRET_KEY = os.environ["JWT_SECRET"]` (fail-fast, no dev fallback) | ✅ | Sec S3 / bug #8 — verified raises on missing |
| 1.2 | `services/crypto.py` | `decrypt_field` returns `None` on `InvalidToken` (not raw blob) + log warning | ✅ | Bug #7 — also warns at import if key missing |
| 1.3 | `services/email_queue.py` | REWRITE → DB-backed (`email_tasks` table), resume pending on startup, store only user_id+lead_id | ✅ | Bug #4, Sec S5 — callers in leads.py updated, worker owns status+quota |
| 1.4 | `services/generation_queue.py` | REWRITE → DB-backed (`generation_tasks` table), resume on startup | ✅ | Bug #5 — bulk_submit caller updated |
| 1.5 | `routers/admin.py` | DELETE `POST /admin/seed-my-profile` entirely | ✅ | Bug #10, Sec S7 — endpoint + unused imports removed |
| 1.6 | startup | Validate `FIELD_ENCRYPTION_KEY` set — warn loudly / refuse start if missing | ✅ | Sec S2 — warns at import + startup (warn, doesn't hard-fail by design) |
| 1.7 | startup | Log which optional features enabled (GOOGLE_CLIENT_ID etc.) | ✅ | Sec S6 — `_log_feature_flags()` in lifespan |
| 1.8 | `routers/auth.py` | Real email validation on signup (`EmailStr`) | ✅ | Bug #17 — pydantic[email] already in requirements |
| 1.9 | CSV parser | Strip leading `= + - @` from cells (formula injection) | ✅ | Sec S8 — `_sanitize_cell()` applied to all CSV fields |
| 1.10 | `.env` | Update JWT_SECRET, FIELD_ENCRYPTION_KEY, CORS, GOOGLE creds, keep Gemini/Gmail | ⏳ | Deploy-time — set in Render dashboard |
| 1.11 | `.env.example` | Create with placeholders | ✅ | Created |
| 1.12 | `database.py` | Cold DB → **Neon Postgres** (existing psycopg2 path; `DATABASE_URL=postgresql://...neon.tech/...?sslmode=require`). Added defensive libsql branch too. | ✅ | Postgres path already existed in database.py; SQLAlchemy ORM is portable |

**Also fixed (bonus):** approve-all quota over-send bug — old code re-checked `can_send_today` each loop but quota only increments after async send, so it could enqueue past the daily cap. Now reserves a budget up front.

---

## Phase 2 — LinkedIn backend fixes (`linkedin/backend/`)

| # | File | Change | Status | Notes |
|---|------|--------|--------|-------|
| 2.1 | `services/auditor.js` | REPLACE Gemini scoring → hardcoded `scoreJob` / `auditJobs` / `auditLeads` | ✅ | Kept filename + export names so route imports unchanged; adapted to real job/lead fields |
| 2.2 | `services/gemini.js` | DELETE (only used by auditor) — verify no other importers | ✅ | Deleted; GEMINI_KEY_* env now unused |
| 2.3 | `middleware/auth.js` | `if (!JWT_SECRET) throw new Error(...)` | ✅ | Sec S3 — verified throws |
| 2.4 | `server.js` | CORS allowlist + `trust proxy` | ✅ | Sec S4 — local already had allowlist (not `*`); added trust proxy for Render |
| 2.5 | `.env` | JWT_SECRET (same as cold), ALLOWED_ORIGINS, LIBSQL_* | ⏳ | Deploy-time — set in Render dashboard |
| 2.6 | `.env.example` | Create with placeholders | ✅ | Created |
| 2.7 | `db/client.js` + `db/schema.js` + package.json | Swap better-sqlite3 → `@libsql/client` (async, file: local + Turso prod) | ✅ | Smoke-tested locally: schema init, params, PG-syntax translate, transactions all pass |

**Bonus:** removed 2 dead `SELECT ... FROM users` reads (jobs.js, leads.js) that only fed the old AI scorer. LinkedIn backend now touches NO `users` table → clean separate Turso DB per backend (auth stays stateless via shared JWT).

---

## Phase 3 — Frontend fixes (`frontend/`)

| # | File | Change | Status | Notes |
|---|------|--------|--------|-------|
| 3.1 | `.env` | Update VITE_COLD_API_URL, VITE_LINKEDIN_API_URL, VITE_GOOGLE_CLIENT_ID | ⏳ | Deploy-time — set in Vercel dashboard |
| 3.2 | `src/pages/SettingsPage.jsx` | Inline Gmail connect (`useGoogleLogin` auth-code flow), drop orphan component | ✅ | Bug #11 — also updated AI-keys copy (M.5) |
| 3.3 | `src/pages/LoginPage.jsx` | Remove GOOGLE_ENABLED conditional — always show Google button | ✅ | Bug #12 |
| 3.4 | `src/pages/GmailConnectButton.jsx` | DELETE file | ✅ | Deleted; no lingering imports |
| 3.5 | `vercel.json` | Add SPA routing + build config at project root | ✅ | Created |
| 3.6 | `.env.example` | Create with placeholders | ✅ | Created |

**Validated:** `vite build` succeeds (2197 modules, clean) — confirms inline hook, LoginPage edits, and component deletion all compile.

---

## Phase 4 — Chrome extension (`linkedin/extension/`) — URL updates only

| # | File | Change | Status | Notes |
|---|------|--------|--------|-------|
| 4.1 | `manifest.json` | host_permissions + content_scripts matches → new URLs | ✅ | Set to planned service names; valid JSON |
| 4.2 | `popup/popup.js` | Update BACKEND / FRONTEND / COLD_API / GOOGLE_CLIENT_ID constants | ✅ | URLs → planned names; GOOGLE_CLIENT_ID kept (reused project) — S10 acceptable |
| 4.3 | `background.js` | Update BACKEND constant | ✅ | |
| 4.4 | content scripts | NO changes (use background messaging) | ✅ | token_sync.js stale comment fixed |

**⚠ Deploy note:** extension URLs are set to the **planned** service names (`jobhuntpro-{cold-api,linkedin-api,frontend}`). If the actual Render/Vercel URLs differ, update `popup.js`, `background.js`, `manifest.json` (3 places) to match. No stale old URLs remain anywhere in the repo.

---

## Phase 5 — Deploy to new services

| # | Target | Action | Status | Notes |
|---|--------|--------|--------|-------|
| 5.0 | GitHub | Push code to private repo (prereq for Render+Vercel) | ✅ | github.com/kunal202426/JobHuntPro (private) |
| 5.1 | Neon Postgres | DB created + tables initialized (tested live) | ✅ | neondb @ ep-aged-salad-aixcl77t us-east-1 |
| 5.2 | Turso | DB created + tables initialized (tested live) | ✅ | jobhunt-kunal202426 ap-south-1 |
| 5.3 | Cold API (Render) | LIVE — /health 200 | ✅ | https://jobhuntpro-cold-api.onrender.com |
| 5.4 | LinkedIn API (Render) | LIVE — /health 200 | ✅ | https://jobhuntpro-linkedin-api.onrender.com |
| 5.5 | Frontend (Vercel) | import repo, set VITE_* env vars | 🔨 | uses vercel.json; planned URL confirmed |
| 5.6 | Extension | load unpacked, verify popup login + URLs | ⏳ | popup.js updated to NEW Google client ID |

**New Google OAuth client (2026-06-24):** `423029767273-arma4d61l5ktli5gutmdgdee5krqpqm9.apps.googleusercontent.com` — used in frontend env, cold env, extension popup.js.

**Generated secrets (2026-06-24)** — given to user in chat; NOT stored here.

---

## Phase 6 — Post-deploy verification (7 user journeys)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 6.1 | `GET /health` cold + linkedin → 200 | ⏳ | |
| 6.2 | CP1: First-time setup (register → settings → gmail → gemini → setup_complete) | ⏳ | |
| 6.3 | CP2: Add lead → draft → edit → approve → real email sent → quota +1 | ⏳ | |
| 6.4 | CP3: CSV bulk import → preview → queue → drafts → approve all | ⏳ | |
| 6.5 | CP4: LinkedIn job scraping via extension (4 sources) + scores | ⏳ | |
| 6.6 | CP5: Find leads → li_leads scored → connection queue → daily cap | ⏳ | |
| 6.7 | CP6: Google sign-in from extension → token syncs to frontend | ⏳ | |
| 6.8 | CP7: Admin panel (non-admin 403, admin sees all users) | ⏳ | |
| 6.9 | Set `is_admin=1` for mathurkunal000@gmail.com via Render shell | ⏳ | |
| 6.10 | Delete old Render services once confirmed | ⏳ | |

---

## Housekeeping / repo hygiene

| # | Item | Status | Notes |
|---|------|--------|-------|
| H.1 | Harden `.gitignore` (.env.*, *.db/-shm/-wal, .venv, *.log, personal files) | ✅ | Rewrote — was minimal |
| H.2 | Remove `Kunal_Mathur.pdf` from project root | ✅ | Deleted |
| H.3 | Remove `mailed_emails.csv` from root if present | ✅ | Removed (also gitignored) |
| H.4 | Remove committed log files (startup.log, pip_*.log, uvicorn.log) | ✅ | Removed + gitignored |
| H.5 | Ensure no real secrets remain in any tracked `.env` | ⏳ | Sec S1 |
| H.6 | DELETE `C:\Users\kunal\Desktop\JobHuntProLive` after everything verified | ⏳ | LAST step |

---

## Multi-user requirements (verify intact, don't break)

| # | Item | Status | Notes |
|---|------|--------|-------|
| M.1 | All leads/jobs/li_leads/quota queries filter `WHERE user_id` | ✅ | Verified intact; queue worker sends with task.user_id's own creds + quota |
| M.2 | No hardcoded personal data anywhere in server code | ✅ | seed endpoint removed; grep-clean |
| M.3 | Open registration (no invite flow) | ✅ | `/auth/signup` has no invite gate |
| M.4 | Per-user Gmail + API keys, shared Gemini pool fallback only | ✅ | Preserved through queue rewrite (creds re-fetched per-user at send) |
| M.5 | Settings UI documents "own Gemini key = priority, falls back to pool" | ✅ | Copy updated |

---

## Open blockers (need user input before Phase 1 can finish cleanly)
1. DB choice (0.1)
2. Google Cloud project reuse vs new (0.2)
3. Frontend domain (0.3)
4. OpenRouter key availability (0.4)

_These don't block code edits in Phases 1–4, but DO block final `.env` values and deploy (Phase 5)._
