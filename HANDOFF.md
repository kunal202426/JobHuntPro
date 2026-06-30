# JobHuntPro — Session Handoff

Read this top-to-bottom before doing anything. It's the context a fresh assistant
needs to work at full quality without prior conversation memory. After reading,
also open `PROGRESS.md`, `linkedin/extension/background.js`, and
`linkedin/extension/content/job_match.js` so you're oriented, then wait for the task.

Golden rule: **verify file facts (functions, flags, selectors, paths) by reading
the file before relying on them.** This doc can drift; the code is truth.

---

## 1. What this is

A multi-user job-hunt automation platform. The owner/primary user is **Kunal
Mathur** (India, early-career software profile — targets junior/entry software,
backend, full-stack, AI/ML roles). Repo root: `C:\Users\kunal\Desktop\JobHuntPro`.

Three deployed apps + a Chrome extension:

| Dir | What | Stack | Deployed |
|-----|------|-------|----------|
| `cold/backend` | Cold Email Hub API | Python / FastAPI | Render: `https://jobhuntpro-cold-api.onrender.com` |
| `linkedin/backend` | LinkedIn/Jobs Engine API | Node / Express (ESM) | Render: `https://jobhuntpro-linkedin-api.onrender.com` |
| `frontend` | Unified web app (login, settings, both hubs) | React / Vite | Vercel: `https://job-hunt-pro.vercel.app` |
| `linkedin/extension` | Chrome extension (MV3) | vanilla JS | distributed as a zip download from the frontend |
| `linkedin/src` | The LinkedIn-engine UI (panels/cards) imported by the frontend | React | (part of frontend build) |

Databases:
- **LinkedIn engine** → **Turso** (libsql / remote SQLite) via `@libsql/client`.
  `linkedin/backend/db/client.js` translates Postgres-style `$1` params to libsql
  and exposes `getRow / getRows / execute`. Schema in `db/schema.js`.
- **Cold engine** → **Neon Postgres** (psycopg2). (A local `cold_email.db`
  SQLite exists for dev; prod uses Neon via env.)
- Shared **JWT secret** between the two backends so one login works across both.

Secrets: only in Render/Vercel env vars and untracked `.env` files (gitignored).
Never hardcode keys. `.gitignore` excludes `.env`, `.claude/`, `.playwright-mcp/`,
`Kunal_Mathur.pdf`, `mailed_emails.csv`, `dist/`.

---

## 2. Environment & how I work

- **OS:** Windows 11. Primary shell is **PowerShell** (Windows PowerShell 5.1 —
  no `&&`/`||` chaining, no ternary; use `;` and `if ($?)`). A **Bash** tool is
  also available for POSIX one-liners. Pick the right syntax per tool.
- Prefer the dedicated Read/Edit/Glob/Grep tools over shelling out to
  cat/grep/sed.
- The user writes short, often **Hinglish** instructions and frequently pastes
  **DOM/HTML or screenshots**. When the task is a scraper change, that pasted HTML
  is gold — use it to write exact selectors / data paths instead of guessing.
- Match surrounding code style: comment density, naming, idioms. The existing
  files have terse top-of-file comments explaining intent — keep that.

## 3. Git rules — STRICT (from the user's global CLAUDE.md, never violate)

- **NEVER** add `Co-Authored-By` or any AI attribution/marker/tag to commits,
  code comments, or branch names.
- **NEVER** use AI-named branches (`claude/...`, `ai/...`). Work on `main`.
- Commit messages must read as **developer-written** (plain, factual, imperative).
- **Push directly to `main`.** Vercel + both Render services auto-deploy from
  `main`. There is no staging branch and no manual deploy step.
- Only commit/push when the user asks — but "lets go", "deploy it", "push",
  "ship it" all count as asking. When in doubt on a clearly-finished feature the
  user told you to build, committing+pushing is the expected close-out.

## 4. Deploy flow

`git push origin main` → Vercel rebuilds the frontend, Render rebuilds both APIs.
That's it. To sanity-check after: the two APIs expose `GET /health` (200 = up).

---

## 5. The Chrome extension (most requests touch this)

Files: `linkedin/extension/` — `background.js` (service worker / message hub),
`manifest.json` (MV3), `popup/`, `content/*.js`, `icons/`.

### 5a. Scraper architecture
`background.js` holds `SCRAPE_SOURCES`, one entry per portal:
```
{ url, hostPrefix, injectFile }   // keys: linkedin, naukri, cutshort, instahyre, hiringcafe
```
`runScrapeTask(task)` opens/reuses a tab at the source URL (or a company-search
URL from `buildCompanySearchUrl`), waits for load, runs `detectLoginRequired`,
then injects **`content/job_match.js` first, then the source's `injectFile`** via
`chrome.scripting.executeScript({ files: [...] })`.

Each scraper builds job objects and sends:
```js
chrome.runtime.sendMessage({ type: "JOBS_SCRAPED", payload: batch });
```
`background.js`'s `JOBS_SCRAPED` handler POSTs the batch to the LinkedIn backend
`/api/jobs/batch` (people scrapers use `PEOPLE_SCRAPED` → `/api/leads/batch`).

### 5b. Standard job object (every scraper emits this exact shape)
```js
{
  title, company, location,
  source,            // "linkedin" | "naukri" | "cutshort" | "instahyre" | "hiringcafe"
  job_url,           // canonical/apply URL, used as dedup key
  posted_at,         // human/ISO string
  posted_at_parsed,  // unix seconds (or null)
  experience_required, // e.g. "1-3 Years" / "2+ Years" / null
  skills,            // string[]
  salary,            // string | null
  is_startup,        // bool
}
```
The backend `/api/jobs/batch` ingest (`routes/jobs.js`) inserts `job.source`
verbatim — **no source whitelist**, so adding a new portal needs no ingest change.

### 5c. Shared filter — `content/job_match.js` (read it; it's the policy hub)
Injected before every scraper, exposes `window.__jhJobFilter`:
- `isExcludedTitle(title)` — drops **senior** (Senior/Sr./Lead/Principal/Staff/
  Architect/Manager/Director/Head/VP/Chief/Founder), **numbered levels** (III, IV,
  L2-9, SDE/SWE 2/3, "Engineer 2", etc.), and **off-target domains** (cloud,
  validation, silicon, hardware, embedded, firmware, VLSI, RTL, support/network/
  systems engineer, QA/SDET, test/automation engineer).
- `tooMuchExperience(expText)` — parses numbers; **drops if max year > 2** (so
  "1-4 Years" → drop). `"2+"`-style also drops at ≥2.
- `parsePostedAt(text)` — robust relative-time → `{raw, parsed(unix s)}`
  (seconds…years, "N+" forms, "yesterday", ISO `YYYY-MM-DD`).
- `isFreshWithin(parsedTs)` — **~24-30h window** (`< FRESH_DAYS*86400 + 21600`,
  FRESH_DAYS=1). Unknown date → kept.
- `looksReposted(text)` — `/reposted/i`, treated as stale.

**The user's filtering policy (enforce everywhere):** only **very fresh** jobs
(~24h, never reposted), **≤2 years** experience, **no senior/numbered** titles,
**no off-target domains**, keep **software/backend/full-stack/AI-ML** roles.
He has said the keyword/relevance logic is "good, ~80% are good jobs" — tighten
freshness/experience/domain, don't rip out relevance.

### 5d. Per-source notes
- **linkedin** (`content/linkedin_jobs.js`): URL pre-filters server-side —
  `f_TPR=r86400` (24h), `f_E=1,2,3` (Internship/Entry/Associate), `geoId=102713980`
  (India), `sortBy=DD`. Card scraper skips closed + reposted.
- **naukri** (`content/naukri.js`): clicks the site's "Freshness: Last 1 day"
  filter (`a[data-id="filter-freshness-1"]`) before scraping.
- **cutshort** (`content/cutshort.js`): keyword relevance lowercases both sides
  (past bug: capitalized keywords never matched).
- **instahyre** (`content/instahyre.js`): list cards lack experience; the
  experience gate runs at **apply** time (see 5e).
- **hiringcafe** (`content/hiringcafe.js`): **scrape-only** (links out, no native
  apply). It does NOT scrape DOM cards — it reads the Next.js SSR blob
  `document.getElementById("__NEXT_DATA__")` → `props.pageProps.ssrHits` (40
  structured jobs/page), and same-origin `fetch()`es `?page=1..4` (each page is
  server-rendered so `__NEXT_DATA__` comes back in the HTML — no reload, the
  content script stays alive). Filters on **structured fields**:
  `v5_processed_job_data.min_industry_and_role_yoe ≤ 2`, drop `seniority_level ===
  "Senior Level"`, keep `job_category` Software Development / Data and Analytics
  (or a strong software keyword), freshness via exact `estimated_publish_date_millis`,
  plus `__jhJobFilter.isExcludedTitle`. `job_url = hit.apply_url`. SCRAPE_SOURCES
  url is `searchState={"dateFetchedPastNDays":1,"sortBy":"date"}`; India comes from
  Hiring Cafe's IP geo default (same as their own pagination links).

### 5e. Instahyre one-click bulk auto-apply (the only auto-apply)
- Frontend: "⚡ Easy Apply Instahyre" button + "✕ Cancel" in `FreshJobsPortal.jsx`,
  polls `/api/apply/status`.
- Backend `routes/apply.js`: `POST /instahyre` enqueues the user's un-applied
  Instahyre jobs into `apply_queue`; `GET /next` pops one; `POST /result` records
  outcome; `POST /stop` cancels. Valid statuses: applied, already_applied, failed,
  skipped, **discarded** (→ deletes the job). `app_settings.apply_running` flag.
- Extension: `content/instahyre_apply.js` handles `DO_APPLY`, clicks Apply, and
  **gates at apply time** via `unsuitableReason()` reading the detail page's
  experience (`.experience` / `i.fa-briefcase`) + title — `>2yr` or senior →
  returns `{status:"discarded"}` so the backend deletes it (don't apply to it).
  ~1s gap between applies, cancellable.

### 5f. LinkedIn auto-connect (`content/linkedin_connect.js`) — fragile, be careful
Heavily iterated. Key pieces: `robustClick` (pointer+mouse+native events),
`withNavigationGuard`, `findDirectConnectButton` with `labelMatchesProfile` (avoid
carousel/"People also viewed" Connect buttons grabbing the wrong person),
`tryMoreActionsConnect` (iterate "More" menus, verify a real custom-invite Connect,
detect "Withdraw invitation" → already pending), `handleConnectModal`
(send-without-note, confirm via modal-close + strict `isAlreadyInvited()` that
matches "Withdraw invitation" near top — NOT a loose global "Pending" scan, which
caused false "Sent"). If you touch this, test against the exact DOM the user pastes.
Connection queue lives in `routes/queue.js` + `useQueue.js`; `QueuePersonCard.jsx`
has a **Retry** button on non-pending items.

### 5g. Rebuilding the extension zip — DO THIS AFTER ANY `linkedin/extension/` CHANGE
- Source of truth: `linkedin/extension/`. Distributed copy: **`frontend/public/extension.zip`**
  (the `frontend/dist/extension.zip` copy is gitignored and regenerated by Vercel —
  leave it).
- **Chrome rejects backslash zip entries** — rebuild with **forward-slash** entry
  names. Working PowerShell recipe (System.IO.Compression, manual entries):
  open `frontend/public/extension.zip` for Create, for each file under
  `linkedin/extension` do `CreateEntry(rel.Replace('\','/'))` and stream the bytes.
  (A prior good build was ~46 KB with `content/hiringcafe.js` present.)
- An **installed** extension does NOT auto-update from the website. After a change
  the user must re-download the zip, reload it in `chrome://extensions`, and
  **re-accept any new host permission**. This is per-machine. Tell them when a
  change requires this (especially new files or new `host_permissions`).
- `manifest.json` `host_permissions` must list every scraped domain (currently
  linkedin, naukri, cutshort, instahyre x2, hiring.cafe, both Render APIs, the
  Vercel app, localhost).

### 5h. Adding a NEW scrape source — checklist
1. `content/<source>.js` — emit the standard job object via `JOBS_SCRAPED`, use
   `window.__jhJobFilter` for exclude/experience/freshness.
2. `background.js` — add to `SCRAPE_SOURCES`; add a branch in `buildCompanySearchUrl`
   if it supports company search; add to `detectLoginRequired` if it needs login.
3. `manifest.json` — add the host to `host_permissions`.
4. `linkedin/backend/routes/scrape.js` — add to `SOURCES` (and `COMPANY_SOURCES`
   if company search) so "all portals" includes it.
5. `linkedin/src/components/panels/FreshJobsPortal.jsx` — add to the `SOURCES`
   array + the scrape-source `<select>` (and company-source `<select>`).
6. Rebuild `frontend/public/extension.zip` (5g).

---

## 6. Backends — route map (verified)

**LinkedIn (`linkedin/backend/server.js`, all `requireAuth`):**
`/api/jobs` (jobs.js — incl `POST /batch` ingest, status updates, freshness purge),
`/api/leads` (leads.js — incl `POST /batch`), `/api/queue` (queue.js — connect
queue pop/result/start/stop), `/api/stats`, `/api/scrape` (scrape.js —
`POST /trigger {source, mode, company?}`, enqueues scrape_tasks; `SOURCES` /
`COMPANY_SOURCES` lists), `/api/apply` (apply.js — Instahyre apply queue),
`/admin` (adminRouter). `GET /health`.
- `services/auditor.js` — hardcoded `scoreJob` (rejects senior/numbered/off-target
  domains + `>2 yrs`); `auditJobs` / `auditLeads`.
- `services/dedup.js`, `services/queue_manager.js`. `db/{client,queries,schema}.js`.

**Cold (`cold/backend/main.py`, FastAPI):**
routers `auth`, `admin`, `leads`, `quota`; `GET /health`.
- `services/`: `gemini_service.py` (cold-email generation), `email_service.py`
  (Gmail send), `email_queue.py` + `generation_queue.py` (DB-backed task queues),
  `crypto.py` (Fernet; decrypt returns None on InvalidToken), `quota_service.py`,
  `leads_service.py`, `time_utils.py`. `auth.py` (JWT, fail-fast on missing secret),
  `database.py`, `models.py` (incl `EmailTask`, `GenerationTask`).

---

## 7. Cold-email tone (when editing generation)
Warm, concise, **~70–110 words**. Simple **"Thanks!"** signature with **name +
phone + portfolio only** (NO LinkedIn, no `~` flourish). Logic lives in
`cold/backend/services/gemini_service.py` (`_build_cold_signal`,
`_cold_outreach_prompt`).

---

## 8. Multi-user invariants (don't break)
- Every jobs/leads/queue/quota query filters `WHERE user_id`.
- No hardcoded personal data in server code (a seed endpoint was removed).
- Open registration (`/auth/signup`, no invite gate).
- Per-user Gmail + API keys; a shared Gemini pool is **fallback only** (user's own
  Gemini key = priority). Settings UI documents this.

---

## 9. Current state / recently shipped
- Full stack deployed and working (both `/health` 200, Vercel live, Turso + Neon
  initialized).
- LinkedIn connect pipeline working (most connects succeed after long debugging).
- Instahyre one-click bulk apply working (with apply-time experience/seniority gate).
- Job filtering tightened: titles, ≤2yr experience, ~24h freshness, no reposted,
  off-target domains (cloud/validation/etc.).
- Cold-email tone updated (warm/concise + "Thanks!" signature).
- LinkedIn scrape adds `f_E` experience-level + India `geoId`; Naukri uses its
  "Last 1 day" filter.
- **Hiring Cafe scraper just added** (commit "Add Hiring Cafe scraper module …"),
  see 5d. Scrape-only.

## 10. Known open / unverified
- **Gmail API enablement** in the Google Cloud project for cold-email send was
  never confirmed working end-to-end ("Gmail API access denied" earlier). Verify
  before claiming cold send works.
- Hiring Cafe **company search** uses a best-effort `searchQuery` searchState key;
  if wrong, it gracefully falls back to the date feed (client filter still applies).
- There may be a stale `JobHuntProLive` folder somewhere the user once mentioned
  deleting — confirm before touching.

---

## 11. Working agreements
- Don't re-derive things already settled; act when you have enough to act.
- When you finish a meaningful feature the user asked for, you may update
  `PROGRESS.md` and commit+push to `main` (developer-style message, no AI traces).
- For risky/outward actions (sending real emails/connects on the user's behalf,
  deleting data), confirm first unless clearly authorized.
- Quality bar: this project was built carefully across many iterations — match
  that. Read before you edit, test/`node --check` your JS, and tell the user
  exactly what manual step (e.g. extension reinstall) a change requires.
