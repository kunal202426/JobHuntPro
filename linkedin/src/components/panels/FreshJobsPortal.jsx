import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import client from "../../api/client";
import { useJobs } from "../../hooks/useJobs";
import JobCard from "../cards/JobCard";
import EmptyState from "../shared/EmptyState";

const SOURCES = ["all", "naukri", "linkedin", "cutshort", "instahyre", "hiringcafe", "wellfound"];

const DATE_FILTERS = [
  { value: "all",       label: "All Time"  },
  { value: "today",     label: "Today"     },
  { value: "yesterday", label: "Yesterday" },
  { value: "week",      label: "This Week" },
];

const SMART_FILTERS = [
  { id: "all",     label: "All quality"       },
  { id: "top",     label: "Top match (8+)"    },
  { id: "good",    label: "Strong match (6+)" },
  { id: "fresh24", label: "Posted < 24h"      },
  { id: "remote",  label: "Remote-first"      },
  { id: "startup", label: "Startup"           },
];

function matchesDate(dateStr, filter) {
  if (filter === "all") return true;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(todayStart.getDate() - 1);
  const weekStart = new Date(todayStart); weekStart.setDate(todayStart.getDate() - 7);
  if (filter === "today")     return d >= todayStart;
  if (filter === "yesterday") return d >= yesterdayStart && d < todayStart;
  if (filter === "week")      return d >= weekStart;
  return true;
}

const FRESH_STATUSES = new Set(["unseen", "seen"]);
const APP_STATUSES   = new Set(["applied", "interviewing", "offer", "rejected", "ghosted"]);

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function containsNeedle(job, needle) {
  if (!needle) return true;
  const bag = [
    job.title, job.company, job.location, job.source, job.ai_reason,
    ...(Array.isArray(job.skills) ? job.skills : []),
  ].filter(Boolean).join(" ").toLowerCase();
  return bag.includes(needle);
}

function matchesSmartFilter(job, filterId) {
  if (filterId === "top")  return (job.ai_score ?? 0) >= 8;
  if (filterId === "good") return (job.ai_score ?? 0) >= 6;
  if (filterId === "fresh24") {
    if (!job.posted_at_parsed) return false;
    return Math.floor(Date.now() / 1000) - job.posted_at_parsed <= 24 * 3600;
  }
  if (filterId === "remote") {
    const loc = normalizeText(job.location);
    return loc.includes("remote") || loc.includes("work from home") || loc.includes("hybrid");
  }
  if (filterId === "startup") return Boolean(job.is_startup);
  return true;
}

function sortJobs(list, sortBy) {
  const cloned = [...list];
  if (sortBy === "score")   return cloned.sort((a, b) => (b.ai_score ?? -1) - (a.ai_score ?? -1));
  if (sortBy === "company") return cloned.sort((a, b) => String(a.company || "").localeCompare(String(b.company || "")));
  return cloned.sort((a, b) => {
    const pa = a.posted_at_parsed ?? -1;
    const pb = b.posted_at_parsed ?? -1;
    if (pb !== pa) return pb - pa;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
}

function ScrapingLoader({ scrapeState }) {
  const active = scrapeState.filter((s) => s.status === "processing" || s.status === "pending");
  return (
    <div className="col-span-full rounded-xl border border-sky-200 bg-sky-50 p-3">
      <div className="flex items-center gap-2.5">
        <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-sky-900">Scanning job portals…</p>
          {active.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {active.map((s) => (
                <span key={s.source} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                  s.status === "processing" ? "bg-sky-600 text-white" : "bg-sky-100 text-sky-700"
                }`}>
                  {s.status === "processing" ? "⟳ " : "· "}{s.source}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-sky-100">
        <div className="h-full w-2/5 animate-pulse rounded-full bg-sky-500" />
      </div>
    </div>
  );
}

const SEL = "rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-sky-400 focus:outline-none";
const BTN = "rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-60";

export default function FreshJobsPortal() {
  const [activeTab,    setActiveTab]    = useState("fresh");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [search,       setSearch]       = useState("");
  const [smartFilter,  setSmartFilter]  = useState("all");
  const [sortBy,       setSortBy]       = useState("newest");
  const [dateFilter,   setDateFilter]   = useState("all");

  const [showFilters,       setShowFilters]       = useState(false);
  const [showScrape,        setShowScrape]        = useState(false);
  const [scrapeSource,      setScrapeSource]      = useState("linkedin");
  const [scrapeBusy,        setScrapeBusy]        = useState(false);
  const [cleanupBusy,       setCleanupBusy]       = useState(false);
  const [clearAllBusy,      setClearAllBusy]      = useState(false);
  const [scrapeState,       setScrapeState]       = useState([]);
  const [showStatusPanel,   setShowStatusPanel]   = useState(false);
  const [extDetected,       setExtDetected]       = useState(false);
  const [companyQuery,      setCompanyQuery]      = useState("");
  const [companySource,     setCompanySource]     = useState("all");
  const [companyScrapeBusy, setCompanyScrapeBusy] = useState(false);
  const [applyBusy,         setApplyBusy]         = useState(false);
  const [applyCounts,       setApplyCounts]       = useState(null);

  const { jobs, loading, error, refetch, updateStatus, dismissJob } = useJobs();

  useEffect(() => {
    const check = () => setExtDetected(document.documentElement.hasAttribute("data-jh-ext"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-jh-ext"] });
    return () => observer.disconnect();
  }, []);

  const prevActiveRef = useRef(false);
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const res = await client.get("/api/scrape/status");
        if (!mounted) return;
        const sources = res.data?.sources || [];
        const isActive = sources.some((s) => s.status === "processing" || s.status === "pending");
        if (prevActiveRef.current && !isActive) refetch();
        prevActiveRef.current = isActive;
        setScrapeState(sources);
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => { mounted = false; clearInterval(id); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isActivelyScraping = scrapeState.some((s) => s.status === "processing" || s.status === "pending");
  const hasLoginRequired   = scrapeState.some((s) => s.status === "login_required");

  useEffect(() => {
    if (hasLoginRequired) { setShowStatusPanel(true); setShowScrape(true); }
  }, [hasLoginRequired]);

  // Auto-open scrape panel while scraping
  useEffect(() => {
    if (isActivelyScraping) setShowScrape(true);
  }, [isActivelyScraping]);

  async function triggerScrape() {
    if (!extDetected) {
      toast.error("Extension not connected.\nInstall from Settings → Chrome Extension section.", {
        duration: 6000, style: { whiteSpace: "pre-line" },
      });
      setShowStatusPanel(true);
      return;
    }
    setScrapeBusy(true);
    try {
      await client.post("/api/scrape/trigger", { source: scrapeSource, mode: "manual" });
      toast.success("Scrape queued — starting shortly…", { duration: 3000 });
      window.dispatchEvent(new CustomEvent("jh:trigger-scrape"));
      setShowStatusPanel(true);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to queue scrape.");
    } finally {
      setScrapeBusy(false);
    }
  }

  async function triggerCompanyScrape() {
    const company = String(companyQuery || "").trim();
    if (!company) { toast.error("Enter a company name to search."); return; }
    if (!extDetected) {
      toast.error("Extension not connected.\nInstall from Settings → Chrome Extension section.", {
        duration: 6000, style: { whiteSpace: "pre-line" },
      });
      setShowStatusPanel(true);
      return;
    }
    setCompanyScrapeBusy(true);
    try {
      await client.post("/api/scrape/trigger-company", { source: companySource, mode: "manual", company });
      toast.success("Company search queued — starting shortly…", { duration: 3000 });
      window.dispatchEvent(new CustomEvent("jh:trigger-scrape"));
      setShowStatusPanel(true);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to queue company search.");
    } finally {
      setCompanyScrapeBusy(false);
    }
  }

  const applyPrevActiveRef = useRef(false);
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const res = await client.get("/api/apply/status");
        if (!mounted) return;
        const counts = res.data?.counts || {};
        setApplyCounts(counts);
        const active = (counts.pending || 0) + (counts.processing || 0) > 0;
        if (applyPrevActiveRef.current && !active) refetch();
        applyPrevActiveRef.current = active;
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => { mounted = false; clearInterval(id); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const instahyreToApply = jobs.filter(
    (j) => String(j.source || "").toLowerCase() === "instahyre" && j.status !== "applied"
  ).length;
  const applyActive = !!applyCounts && ((applyCounts.pending || 0) + (applyCounts.processing || 0) > 0);
  const applyLeft   = applyCounts ? (applyCounts.pending || 0) + (applyCounts.processing || 0) : 0;

  async function handleEasyApplyInstahyre() {
    if (!extDetected) {
      toast.error("Extension not connected.\nInstall from Settings → Chrome Extension section.", {
        duration: 6000, style: { whiteSpace: "pre-line" },
      });
      setShowStatusPanel(true);
      return;
    }
    if (instahyreToApply === 0) {
      toast.error("No Instahyre jobs to apply to. Scrape Instahyre first.");
      return;
    }
    if (!window.confirm(`Apply to ${instahyreToApply} Instahyre job(s)?\nThis submits real applications on your behalf.`)) return;
    setApplyBusy(true);
    try {
      const res = await client.post("/api/apply/instahyre");
      toast.success(`Queued ${res.data?.queued ?? 0} job(s) — applying in background…`, { duration: 4000 });
      window.dispatchEvent(new CustomEvent("jh:trigger-apply"));
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to queue applications.");
    } finally {
      setApplyBusy(false);
    }
  }

  async function cancelApply() {
    try {
      await client.post("/api/apply/stop");
      setApplyCounts((c) => ({ ...(c || {}), pending: 0, processing: 0 }));
      toast.success("Apply run cancelled.");
    } catch { toast.error("Failed to cancel."); }
  }

  async function cleanupOldJobs() {
    setCleanupBusy(true);
    try {
      const res = await client.post("/api/jobs/cleanup-old", { hours: 24, include_active: false });
      toast.success(`Deleted ${res.data?.deleted || 0} old jobs.`);
      await refetch();
    } catch { toast.error("Failed to delete old jobs."); } finally { setCleanupBusy(false); }
  }

  async function clearUnappliedJobs() {
    const count = jobs.filter((j) => !APP_STATUSES.has(j.status)).length;
    if (!window.confirm(`Delete ${count} scraped-but-not-applied job(s)? Applied jobs are never touched. This can't be undone.`)) return;
    setClearAllBusy(true);
    try {
      const res = await client.post("/api/jobs/clear-unapplied");
      toast.success(`Deleted ${res.data?.deleted || 0} jobs.`);
      await refetch();
    } catch { toast.error("Failed to clear jobs."); } finally { setClearAllBusy(false); }
  }

  if (error === "backend_offline") {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-3 bg-stone-50 text-center">
        <div className="text-sm font-medium text-rose-700">Backend offline</div>
        <p className="max-w-xs text-xs text-slate-500">
          Start backend with <code className="rounded bg-stone-100 px-1">cd backend && node server.js</code>
        </p>
      </section>
    );
  }

  const freshJobs = jobs.filter((job) => FRESH_STATUSES.has(job.status));
  const myApps    = jobs.filter((job) => APP_STATUSES.has(job.status));
  const baseList  = activeTab === "fresh" ? freshJobs : myApps;

  const filtered = useMemo(() => {
    const needle = normalizeText(search);
    const list = baseList
      .filter((job) => sourceFilter === "all" || job.source === sourceFilter)
      .filter((job) => matchesSmartFilter(job, smartFilter))
      .filter((job) => containsNeedle(job, needle))
      .filter((job) => matchesDate(job.created_at, dateFilter));
    return sortJobs(list, sortBy);
  }, [baseList, sourceFilter, smartFilter, search, sortBy, dateFilter]);

  const hasActiveFilter = dateFilter !== "all" || sourceFilter !== "all" || smartFilter !== "all" || search.trim();

  return (
    <section className="flex h-full flex-col overflow-hidden bg-stone-50">

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-stone-200 bg-white/95 px-3 py-2.5 backdrop-blur space-y-2">

        {/* Row 1: Tabs (left) + Filter & Scrape toggles (right) */}
        <div className="flex items-center justify-between gap-2">
          {/* Tab switcher — natural width, not stretched */}
          <div className="flex gap-0.5 rounded-lg bg-stone-100 p-1">
            {[
              { id: "fresh",        label: `Fresh Jobs (${freshJobs.length})`   },
              { id: "applications", label: `Applications (${myApps.length})`    },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  activeTab === tab.id
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Right-side toggles */}
          <div className="flex items-center gap-1.5">
            {/* Filters toggle */}
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                showFilters
                  ? "border-sky-300 bg-sky-50 text-sky-700"
                  : "border-stone-200 bg-stone-50 text-slate-600 hover:bg-stone-100"
              }`}
            >
              {showFilters ? "▾" : "▸"} Filters
              {!showFilters && hasActiveFilter && (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-600" />
              )}
            </button>

            {/* Scrape toggle */}
            <button
              onClick={() => setShowScrape((v) => !v)}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                showScrape
                  ? "border-slate-500 bg-slate-900 text-white"
                  : isActivelyScraping
                  ? "animate-pulse border-sky-300 bg-sky-50 text-sky-700"
                  : "border-stone-200 bg-stone-50 text-slate-600 hover:bg-stone-100"
              }`}
            >
              {showScrape ? "▾" : "▸"}
              {isActivelyScraping ? " Running…" : " Scrape"}
            </button>
          </div>
        </div>

        {/* ── Filters panel (collapsible) ──────────────────── */}
        {showFilters && (
          <div className="space-y-1.5 rounded-lg border border-stone-200 bg-stone-50 p-2">
            <div className="flex flex-wrap gap-1">
              {DATE_FILTERS.map((df) => (
                <button
                  key={df.value}
                  onClick={() => setDateFilter(df.value)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                    dateFilter === df.value ? "bg-sky-600 text-white" : "bg-stone-100 text-slate-500 hover:bg-stone-200"
                  }`}
                >
                  {df.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={SEL}>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>{s === "all" ? "All Sources" : s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
              <select value={smartFilter} onChange={(e) => setSmartFilter(e.target.value)} className={SEL}>
                {SMART_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-1.5">
              <input
                type="text"
                placeholder="Search title, company, skills…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={SEL + " w-full"}
              />
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={SEL}>
                <option value="newest">Newest</option>
                <option value="score">Best Score</option>
                <option value="company">Company</option>
              </select>
            </div>
          </div>
        )}

        {/* ── Scrape panel (collapsible) ──────────────────── */}
        {showScrape && (
          <div className="space-y-1.5 rounded-lg border border-stone-200 bg-stone-50 p-2">

            {/* Login warning */}
            {hasLoginRequired && !isActivelyScraping && (
              <div className="flex items-center gap-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1.5">
                <span className="text-xs">⚠️</span>
                <p className="text-[11px] text-rose-700">Login required on some portals — see Status below.</p>
              </div>
            )}

            {/* Row A: Portal scrape + Instahyre apply */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <select value={scrapeSource} onChange={(e) => setScrapeSource(e.target.value)} className={SEL + " w-28"}>
                <option value="linkedin">LinkedIn</option>
                <option value="naukri">Naukri</option>
                <option value="cutshort">Cutshort</option>
                <option value="instahyre">Instahyre</option>
                <option value="hiringcafe">Hiring Cafe</option>
                <option value="wellfound">Wellfound</option>
                <option value="all">All portals</option>
              </select>

              <button
                onClick={triggerScrape}
                disabled={scrapeBusy || isActivelyScraping}
                className={`${BTN} bg-slate-900 text-white hover:bg-slate-700`}
              >
                {scrapeBusy ? "Queuing…" : isActivelyScraping ? "Running…" : "⚡ Scrape"}
              </button>

              <button
                onClick={() => setShowStatusPanel((v) => !v)}
                className={`${BTN} border ${
                  isActivelyScraping
                    ? "border-sky-300 bg-sky-50 text-sky-700"
                    : hasLoginRequired
                    ? "border-rose-300 bg-rose-50 text-rose-700"
                    : "border-stone-300 bg-white text-slate-600 hover:bg-stone-100"
                }`}
              >
                {isActivelyScraping ? "● Status" : "≡ Status"}
              </button>

              <div className="mx-0.5 h-4 w-px shrink-0 bg-stone-300" />

              {/* Instahyre easy apply — compact, not full-width */}
              <button
                onClick={handleEasyApplyInstahyre}
                disabled={applyBusy || applyActive || instahyreToApply === 0}
                title="Auto-apply to all Instahyre jobs"
                className={`${BTN} ${
                  applyActive
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                    : "bg-emerald-600 text-white hover:bg-emerald-500"
                }`}
              >
                {applyActive
                  ? `Applying… ${applyLeft} left`
                  : applyBusy
                  ? "Queuing…"
                  : `⚡ IH Apply${instahyreToApply ? ` (${instahyreToApply})` : ""}`}
              </button>

              {applyActive && (
                <button
                  onClick={cancelApply}
                  className={`${BTN} border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100`}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Row B: Company search */}
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="Company: e.g. Google"
                value={companyQuery}
                onChange={(e) => setCompanyQuery(e.target.value)}
                className={SEL + " flex-1"}
              />
              <select value={companySource} onChange={(e) => setCompanySource(e.target.value)} className={SEL + " w-28"}>
                <option value="all">All portals</option>
                <option value="linkedin">LinkedIn</option>
                <option value="naukri">Naukri</option>
                <option value="instahyre">Instahyre</option>
                <option value="hiringcafe">Hiring Cafe</option>
                <option value="wellfound">Wellfound</option>
              </select>
              <button
                onClick={triggerCompanyScrape}
                disabled={companyScrapeBusy || isActivelyScraping}
                className={`${BTN} bg-sky-600 text-white hover:bg-sky-500`}
              >
                {companyScrapeBusy ? "Queuing…" : "Search"}
              </button>
            </div>

            {/* Status detail panel */}
            {showStatusPanel && (
              <div className="space-y-1.5">
                {!extDetected && (
                  <div className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
                    <span className="text-amber-600 text-xs">⚠</span>
                    <p className="text-[11px] leading-relaxed text-amber-800">
                      Extension not detected. Install from <strong>Settings → Chrome Extension</strong>.
                    </p>
                  </div>
                )}
                {scrapeState.length > 0 && (
                  <div className="grid grid-cols-3 gap-1">
                    {scrapeState.map((state) => {
                      const color =
                        state.status === "completed"      ? "text-emerald-700"
                        : state.status === "login_required" ? "text-rose-700"
                        : state.status === "failed"          ? "text-rose-600"
                        : state.status === "processing"     ? "text-sky-700"
                        : "text-slate-500";
                      return (
                        <div key={state.source} className="rounded-md border border-stone-200 bg-white px-2 py-1">
                          <div className="text-[10px] capitalize font-medium text-slate-700">{state.source}</div>
                          <div className={`text-[10px] ${color}`}>{state.status}</div>
                          {state.status === "login_required" && (
                            <div className="text-[9px] text-rose-600">Login then Scrape again.</div>
                          )}
                          {state.status === "failed" && state.message && (
                            <div className="text-[9px] text-rose-500 break-words">{state.message}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <button
                  onClick={cleanupOldJobs}
                  disabled={cleanupBusy}
                  className={`${BTN} w-full border border-stone-300 bg-white text-slate-600 hover:bg-stone-100`}
                >
                  {cleanupBusy ? "Deleting…" : "Delete Old Jobs (>24h)"}
                </button>
                <button
                  onClick={clearUnappliedJobs}
                  disabled={clearAllBusy}
                  className={`${BTN} w-full border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100`}
                >
                  {clearAllBusy ? "Deleting…" : `Delete Scraped Jobs (not applied) (${jobs.filter((j) => !APP_STATUSES.has(j.status)).length})`}
                </button>
                <p className="text-[9px] text-slate-400">
                  For a full account reset (jobs, leads, cold-email mails) go to Settings.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Job grid ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {isActivelyScraping && <ScrapingLoader scrapeState={scrapeState} />}

          {loading ? (
            <p className="col-span-full py-8 text-center text-xs text-slate-500">Loading jobs...</p>
          ) : filtered.length === 0 ? (
            <div className="col-span-full">
              <EmptyState
                message={
                  activeTab === "fresh"
                    ? "No jobs yet. Click ▸ Scrape above to fetch fresh listings."
                    : "No applications tracked yet. Change status to Applied on any job card."
                }
              />
            </div>
          ) : (
            filtered.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onStatusChange={updateStatus}
                onDismiss={dismissJob}
                showAppliedDate={activeTab === "applications"}
              />
            ))
          )}
        </div>
      </div>

    </section>
  );
}
