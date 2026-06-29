import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import client from "../../api/client";
import { useJobs } from "../../hooks/useJobs";
import PanelShell from "../layout/PanelShell";
import JobCard from "../cards/JobCard";
import EmptyState from "../shared/EmptyState";

const SOURCES = ["all", "naukri", "linkedin", "cutshort", "instahyre"];

const DATE_FILTERS = [
  { value: "all",       label: "All Time"  },
  { value: "today",     label: "Today"     },
  { value: "yesterday", label: "Yesterday" },
  { value: "week",      label: "This Week" },
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

const SMART_FILTERS = [
  { id: "all",     label: "All quality"       },
  { id: "top",     label: "Top match (8+)"    },
  { id: "good",    label: "Strong match (6+)" },
  { id: "fresh24", label: "Posted < 24h"      },
  { id: "remote",  label: "Remote-first"      },
  { id: "startup", label: "Startup"           },
];

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
  if (filterId === "top") return (job.ai_score ?? 0) >= 8;
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

function ScrapingLoader({ scrapeState }) {
  const active = scrapeState.filter((s) => s.status === "processing" || s.status === "pending");
  return (
    <div className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-blue-50 p-4 mb-1">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-sky-900">Scanning for jobs…</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-sky-700">
            Chrome extension is browsing job portals in the background.
            New listings will appear here automatically.
          </p>
          {active.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {active.map((s) => (
                <span
                  key={s.source}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize ${
                    s.status === "processing"
                      ? "bg-sky-600 text-white"
                      : "bg-sky-100 text-sky-700"
                  }`}
                >
                  {s.status === "processing" ? "⟳ " : "· "}{s.source}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Indeterminate progress bar */}
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-sky-100">
        <div className="h-full w-2/5 animate-pulse rounded-full bg-sky-500" />
      </div>
    </div>
  );
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

export default function FreshJobsPortal() {
  const [activeTab,     setActiveTab]     = useState("fresh");
  const [sourceFilter,  setSourceFilter]  = useState("all");
  const [search,        setSearch]        = useState("");
  const [smartFilter,   setSmartFilter]   = useState("all");
  const [sortBy,        setSortBy]        = useState("newest");
  const [dateFilter,    setDateFilter]    = useState("all");

  const [showFilters,        setShowFilters]        = useState(false);
  const [scrapeSource,       setScrapeSource]       = useState("linkedin");
  const [scrapeBusy,         setScrapeBusy]         = useState(false);
  const [cleanupBusy,        setCleanupBusy]        = useState(false);
  const [scrapeState,        setScrapeState]        = useState([]);
  const [showStatusPanel,    setShowStatusPanel]    = useState(false);
  const [extDetected,        setExtDetected]        = useState(false);
  // NEW: Targeted Company Search
  const [companyQuery,       setCompanyQuery]       = useState("");
  const [companySource,      setCompanySource]      = useState("all");
  const [companyScrapeBusy,  setCompanyScrapeBusy]  = useState(false);
  const [applyBusy,          setApplyBusy]          = useState(false);
  const [applyCounts,        setApplyCounts]        = useState(null);

  const { jobs, loading, error, refetch, updateStatus, dismissJob } = useJobs();

  // Detect Chrome extension via data-jh-ext attribute injected by token_sync.js
  useEffect(() => {
    const check = () => setExtDetected(document.documentElement.hasAttribute("data-jh-ext"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-jh-ext"] });
    return () => observer.disconnect();
  }, []);

  // Poll scrape status every 3s; auto-refetch jobs when scraping finishes
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
      } catch {
        // ignore
      }
    };

    poll();
    const id = setInterval(poll, 3000);
    return () => { mounted = false; clearInterval(id); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isActivelyScraping = scrapeState.some((s) => s.status === "processing" || s.status === "pending");
  const hasLoginRequired   = scrapeState.some((s) => s.status === "login_required");

  // Auto-open status panel when login is needed
  useEffect(() => {
    if (hasLoginRequired) setShowStatusPanel(true);
  }, [hasLoginRequired]);

  async function triggerScrape() {
    if (!extDetected) {
      toast.error(
        "Extension not connected.\nInstall from Settings → Chrome Extension section.",
        { duration: 6000, style: { whiteSpace: "pre-line" } }
      );
      setShowStatusPanel(true);
      return;
    }
    setScrapeBusy(true);
    try {
      await client.post("/api/scrape/trigger", { source: scrapeSource, mode: "manual" });
      toast.success("Scrape queued — starting shortly…", { duration: 3000 });
      // Signal extension to bypass the 30s alarm and start immediately
      window.dispatchEvent(new CustomEvent("jh:trigger-scrape"));
      setShowStatusPanel(true);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to queue scrape.");
    } finally {
      setScrapeBusy(false);
    }
  }

  // NEW: Targeted Company Search
  async function triggerCompanyScrape() {
    const company = String(companyQuery || "").trim();
    if (!company) {
      toast.error("Enter a company name to search.");
      return;
    }
    if (!extDetected) {
      toast.error(
        "Extension not connected.\nInstall from Settings → Chrome Extension section.",
        { duration: 6000, style: { whiteSpace: "pre-line" } }
      );
      setShowStatusPanel(true);
      return;
    }
    setCompanyScrapeBusy(true);
    try {
      await client.post("/api/scrape/trigger-company", {
        source: companySource,
        mode: "manual",
        company,
      });
      toast.success("Company search queued — starting shortly…", { duration: 3000 });
      window.dispatchEvent(new CustomEvent("jh:trigger-scrape"));
      setShowStatusPanel(true);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to queue company search.");
    } finally {
      setCompanyScrapeBusy(false);
    }
  }

  // Poll Instahyre apply progress; refetch jobs when a run finishes.
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
      } catch {
        // ignore
      }
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => { mounted = false; clearInterval(id); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const instahyreToApply = jobs.filter(
    (j) => String(j.source || "").toLowerCase() === "instahyre" && j.status !== "applied"
  ).length;
  const applyActive = !!applyCounts && ((applyCounts.pending || 0) + (applyCounts.processing || 0) > 0);
  const applyLeft = applyCounts ? (applyCounts.pending || 0) + (applyCounts.processing || 0) : 0;

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
    if (!window.confirm(`Apply to ${instahyreToApply} Instahyre job(s)?\nThis submits real applications on your behalf.`)) {
      return;
    }
    setApplyBusy(true);
    try {
      const res = await client.post("/api/apply/instahyre");
      toast.success(`Queued ${res.data?.queued ?? 0} job(s) — applying in the background…`, { duration: 4000 });
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
    } catch {
      toast.error("Failed to cancel.");
    }
  }

  async function cleanupOldJobs() {
    setCleanupBusy(true);
    try {
      const res = await client.post("/api/jobs/cleanup-old", { hours: 24, include_active: false });
      toast.success(`Deleted ${res.data?.deleted || 0} old jobs.`);
      await refetch();
    } catch {
      toast.error("Failed to delete old jobs.");
    } finally {
      setCleanupBusy(false);
    }
  }

  if (error === "backend_offline") {
    return (
      <PanelShell title="Fresh Jobs Portal">
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-sm font-medium text-rose-700">Backend offline</div>
          <p className="max-w-xs text-xs text-slate-500">
            Start backend with <code className="rounded bg-stone-100 px-1">cd backend && node server.js</code>
          </p>
        </div>
      </PanelShell>
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

  const headerContent = (
    <div className="space-y-2.5 mt-1">

      {/* ── Status banners ─────────────────────────────── */}
      {hasLoginRequired && !isActivelyScraping && (
        <button
          onClick={() => setShowStatusPanel(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-left text-xs text-rose-700 transition hover:bg-rose-100"
        >
          <span>⚠️</span>
          Login required on some portals — see Scrape Status
        </button>
      )}

      {/* ── Tab switcher ───────────────────────────────── */}
      <div className="flex gap-1 rounded-lg bg-stone-100 p-1">
        {[
          { id: "fresh",        label: `Fresh Jobs (${freshJobs.length})` },
          { id: "applications", label: `My Applications (${myApps.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              activeTab === tab.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Filters toggle ─────────────────────────────── */}
      <button
        onClick={() => setShowFilters((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-stone-100"
      >
        <span>{showFilters ? "▾ Hide filters & search" : "▸ Filters & search"}</span>
        {!showFilters && (dateFilter !== "all" || sourceFilter !== "all" || smartFilter !== "all" || search.trim()) && (
          <span className="rounded-full bg-sky-600 px-1.5 py-0.5 text-[10px] text-white">active</span>
        )}
      </button>

      {showFilters && (<>
      {/* ── Date filter ────────────────────────────────── */}
      <div className="flex gap-1 flex-wrap">
        {DATE_FILTERS.map((df) => (
          <button
            key={df.value}
            onClick={() => setDateFilter(df.value)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
              dateFilter === df.value
                ? "bg-sky-600 text-white"
                : "bg-stone-100 text-slate-500 hover:bg-stone-200 hover:text-slate-700"
            }`}
          >
            {df.label}
          </button>
        ))}
      </div>

      {/* ── Source + smart filter ──────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-sky-400 focus:outline-none"
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All Sources" : s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        <select
          value={smartFilter}
          onChange={(e) => setSmartFilter(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-sky-400 focus:outline-none"
        >
          {SMART_FILTERS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* ── Search + sort ──────────────────────────────── */}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          type="text"
          placeholder="Search: title, company, skills…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-sky-400 focus:outline-none"
        >
          <option value="newest">Newest</option>
          <option value="score">Best Score</option>
          <option value="company">Company</option>
        </select>
      </div>
      </>)}

      {/* ── Scrape row — ALWAYS VISIBLE ────────────────── */}
      <div className="flex items-center gap-2">
        <select
          value={scrapeSource}
          onChange={(e) => setScrapeSource(e.target.value)}
          className="flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-sky-400 focus:outline-none"
        >
          <option value="linkedin">LinkedIn</option>
          <option value="naukri">Naukri</option>
          <option value="cutshort">Cutshort</option>
          <option value="instahyre">Instahyre</option>
          <option value="all">All portals</option>
        </select>
        <button
          onClick={triggerScrape}
          disabled={scrapeBusy || isActivelyScraping}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          {scrapeBusy ? "Queuing…" : isActivelyScraping ? "Running…" : "⚡ Scrape"}
        </button>
        <button
          onClick={() => setShowStatusPanel((v) => !v)}
          title="Scrape status & options"
          className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
            isActivelyScraping
              ? "animate-pulse border-sky-300 bg-sky-50 text-sky-700"
              : hasLoginRequired
              ? "border-rose-300 bg-rose-50 text-rose-700"
              : "border-stone-300 bg-white text-slate-600 hover:bg-stone-50"
          }`}
        >
          {isActivelyScraping ? "●" : "≡"} Status
        </button>
      </div>

      {/* ── Instahyre one-click bulk apply ─────────────── */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleEasyApplyInstahyre}
          disabled={applyBusy || applyActive || instahyreToApply === 0}
          title="Auto-apply to all your scraped Instahyre jobs in one click"
          className="flex-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
        >
          {applyActive
            ? `Applying on Instahyre… ${applyLeft} left`
            : applyBusy
            ? "Queuing…"
            : `⚡ Easy Apply Instahyre${instahyreToApply ? ` (${instahyreToApply})` : ""}`}
        </button>
        {applyActive && (
          <button
            onClick={cancelApply}
            title="Cancel applying"
            className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
          >
            ✕ Cancel
          </button>
        )}
      </div>

      {/* NEW: Targeted Company Search */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto]">
        <input
          type="text"
          placeholder="Search company: e.g., Google"
          value={companyQuery}
          onChange={(e) => setCompanyQuery(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
        />
        <select
          value={companySource}
          onChange={(e) => setCompanySource(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-sky-400 focus:outline-none"
        >
          <option value="all">All company portals</option>
          <option value="linkedin">LinkedIn</option>
          <option value="naukri">Naukri</option>
          <option value="instahyre">Instahyre</option>
        </select>
        <button
          onClick={triggerCompanyScrape}
          disabled={companyScrapeBusy || isActivelyScraping}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-500 disabled:opacity-60"
        >
          {companyScrapeBusy ? "Queuing…" : isActivelyScraping ? "Running…" : "Search by Company"}
        </button>
      </div>

      {/* ── Status panel (collapsible) ─────────────────── */}
      {showStatusPanel && (
        <div className="space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-2.5">

          {/* Extension not detected */}
          {!extDetected && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
              <span className="text-amber-600">⚠</span>
              <p className="text-[11px] leading-relaxed text-amber-800">
                Extension not detected. Without it, scraping won't start.
                Install from <strong>Settings → Chrome Extension</strong>.
              </p>
            </div>
          )}

          {/* Source status grid */}
          {scrapeState.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {scrapeState.map((state) => {
                const color =
                  state.status === "completed"     ? "text-emerald-700"
                  : state.status === "login_required" ? "text-rose-700"
                  : state.status === "processing"     ? "text-sky-700"
                  : "text-slate-500";
                return (
                  <div key={state.source} className="rounded-lg border border-stone-200 bg-white px-2 py-1.5">
                    <div className="text-[11px] capitalize font-medium text-slate-700">{state.source}</div>
                    <div className={`text-[11px] ${color}`}>{state.status}</div>
                    {state.status === "login_required" && (
                      <div className="mt-0.5 text-[10px] text-rose-600">Login, then click Scrape again.</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Cleanup button */}
          <button
            onClick={cleanupOldJobs}
            disabled={cleanupBusy}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-stone-100 disabled:opacity-60"
          >
            {cleanupBusy ? "Deleting…" : "Delete Old Jobs (>24h)"}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <PanelShell title="Fresh Jobs Portal" headerContent={headerContent}>
      {/* Prominent loader — shown in body while extension is scraping */}
      {isActivelyScraping && <ScrapingLoader scrapeState={scrapeState} />}

      {loading ? (
        <p className="py-8 text-center text-xs text-slate-500">Loading jobs...</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          message={
            activeTab === "fresh"
              ? "No jobs yet. Pick a source above and click ⚡ Scrape."
              : "No applications tracked yet. Change status to Applied on any job card."
          }
        />
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
    </PanelShell>
  );
}
