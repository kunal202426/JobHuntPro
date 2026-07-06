import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import toast from "react-hot-toast";
import client from "../../api/client";
import { useLeads } from "../../hooks/useLeads";
import PanelShell from "../layout/PanelShell";
import LeadCard from "../cards/LeadCard";
import EmptyState from "../shared/EmptyState";

// Direct "find leads by company" requests have no job attached (job_id is ''
// on the backend), so every lead's own `group key` falls back to its company
// name instead — otherwise every company searched this way would collapse
// into one shared "no job" group.
function groupKeyFor(lead) {
  return lead.job_id || `company:${lead.company || "unknown"}`;
}

const CATEGORY_ORDER = ["hiring_manager", "senior_engineer", "recruiter", "peer"];

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

const CATEGORY_OPTIONS = [
  { value: "all", label: "All Categories" },
  { value: "hiring_manager", label: "Hiring Managers" },
  { value: "senior_engineer", label: "Senior Engineers" },
  { value: "recruiter", label: "Recruiters" },
  { value: "peer", label: "Peers" },
];

function sortLeads(leads) {
  return [...leads].sort((a, b) => {
    const catA = CATEGORY_ORDER.indexOf(a.category ?? "peer");
    const catB = CATEGORY_ORDER.indexOf(b.category ?? "peer");
    if (catA !== catB) return catA - catB;
    return (b.ai_score ?? 0) - (a.ai_score ?? 0);
  });
}

function GroupHeader({ company, jobTitle, total, queued, isOpen, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-left transition hover:bg-stone-50"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {isOpen ? <ChevronDown size={12} className="shrink-0 text-slate-400" /> : <ChevronRight size={12} className="shrink-0 text-slate-400" />}
        <span className="truncate text-xs font-medium text-slate-800">{company} | {jobTitle}</span>
      </div>
      <span className="ml-2 shrink-0 text-xs text-slate-500">
        {total} lead{total !== 1 ? "s" : ""}
        {queued > 0 && <span className="text-violet-700"> | {queued} queued</span>}
      </span>
    </button>
  );
}

export default function CompanyLeadsList() {
  const { leads, loading, refetch, queueLead } = useLeads();
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [jobFilter, setJobFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  // Find Leads by company name directly — no job needed.
  const [companyQuery, setCompanyQuery] = useState("");
  const [desiredCount, setDesiredCount] = useState(10);
  const [findBusy, setFindBusy] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  async function handleFindByCompany() {
    const company = companyQuery.trim();
    if (!company) { toast.error("Enter a company name."); return; }

    setFindBusy(true);
    try {
      const res = await client.post("/api/find-leads/company", { company, count: desiredCount });
      const requestId = res.data?.request_id;
      if (!requestId) { setFindBusy(false); return; }

      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await client.get(`/api/find-leads/${requestId}/status`);
          const { status, requested_count, found_count } = statusRes.data;
          if (status === "done" || status === "failed" || status === "cancelled") {
            clearInterval(pollRef.current);
            setFindBusy(false);
            if (status === "done") {
              refetch();
              const found = found_count ?? 0;
              const wanted = requested_count ?? desiredCount;
              if (found < wanted) {
                toast(`Only found ${found} of ${wanted} leads for ${company}.`, { icon: "⚠️" });
              } else {
                toast.success(`Found ${found} lead${found === 1 ? "" : "s"} for ${company}!`);
              }
            } else {
              toast.error(`Find leads failed for ${company}.`);
            }
          }
        } catch {
          clearInterval(pollRef.current);
          setFindBusy(false);
        }
      }, 4000);
    } catch (err) {
      setFindBusy(false);
      if (err.response?.status === 501) {
        toast("Install the extension to use Find Leads", { icon: "*" });
      } else {
        toast.error(err.response?.data?.error || "Failed to queue leads search.");
      }
    }
  }

  const jobOptions = useMemo(() => {
    const seen = new Map();
    leads.forEach((lead) => {
      const key = groupKeyFor(lead);
      if (!seen.has(key)) {
        seen.set(key, {
          job_id: key,
          job_title: lead.job_title ?? "Direct company search",
          job_company: lead.job_company ?? lead.company ?? "Unknown Company",
        });
      }
    });
    return [{ job_id: "all", job_title: "All Jobs", job_company: "" }, ...seen.values()];
  }, [leads]);

  const filtered = useMemo(() => {
    return leads.filter((lead) => {
      if (categoryFilter !== "all" && lead.category !== categoryFilter) return false;
      if (jobFilter !== "all" && groupKeyFor(lead) !== jobFilter) return false;
      if (!matchesDate(lead.created_at, dateFilter)) return false;
      return true;
    });
  }, [leads, categoryFilter, jobFilter, dateFilter]);

  const groups = useMemo(() => {
    const grouped = new Map();
    filtered.forEach((lead) => {
      const key = groupKeyFor(lead);
      if (!grouped.has(key)) {
        grouped.set(key, {
          job_id: key,
          job_title: lead.job_title ?? "Direct company search",
          job_company: lead.job_company ?? lead.company ?? "Unknown Company",
          leads: [],
        });
      }
      grouped.get(key).leads.push(lead);
    });

    grouped.forEach((group) => {
      group.leads = sortLeads(group.leads);
    });

    return [...grouped.values()];
  }, [filtered]);

  const totalLeads = filtered.length;
  const totalCompanies = new Set(filtered.map((lead) => lead.job_company ?? lead.company)).size;

  function toggleGroup(jobId) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(jobId) ? next.delete(jobId) : next.add(jobId);
      return next;
    });
  }

  const headerContent = (
    <div className="space-y-2 mt-1">
      {/* Find Leads by company name — no job needed */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          placeholder="Company: e.g. Rupeek"
          value={companyQuery}
          onChange={(e) => setCompanyQuery(e.target.value)}
          disabled={findBusy}
          className="flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-sky-400 focus:outline-none disabled:opacity-60"
        />
        <select
          value={desiredCount}
          onChange={(e) => setDesiredCount(Number(e.target.value))}
          disabled={findBusy}
          className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-sky-400 focus:outline-none disabled:opacity-60"
        >
          {[5, 10, 15, 20, 30, 50].map((n) => (
            <option key={n} value={n}>{n} leads</option>
          ))}
        </select>
        <button
          onClick={handleFindByCompany}
          disabled={findBusy}
          className="shrink-0 rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-60"
        >
          {findBusy ? "Searching…" : "Find Leads"}
        </button>
      </div>

      {/* Date filter */}
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

      <div className="flex gap-2">
        <select
          value={jobFilter}
          onChange={(e) => setJobFilter(e.target.value)}
          className="flex-1 truncate rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-sky-400 focus:outline-none"
        >
          {jobOptions.map((option) => (
            <option key={option.job_id} value={option.job_id}>
              {option.job_id === "all" ? "All Jobs" : `${option.job_company} | ${option.job_title}`}
            </option>
          ))}
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-sky-400 focus:outline-none"
        >
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      {totalLeads > 0 && (
        <p className="text-xs text-slate-500">
          {totalLeads} lead{totalLeads !== 1 ? "s" : ""} across {totalCompanies} {totalCompanies !== 1 ? "companies" : "company"}
        </p>
      )}
    </div>
  );

  return (
    <PanelShell title="Company Leads" headerContent={headerContent}>
      {loading ? (
        <p className="py-8 text-center text-xs text-slate-500">Loading leads...</p>
      ) : groups.length === 0 ? (
        <EmptyState message="No leads yet. Search a company above, or click Find Leads on jobs in Fresh Jobs Portal." />
      ) : (
        groups.map((group) => {
          const isOpen = expandedGroups.has(group.job_id);
          const queued = group.leads.filter((lead) => lead.connect_status !== "not_queued").length;

          return (
            <div key={group.job_id} className="space-y-2">
              <GroupHeader
                company={group.job_company}
                jobTitle={group.job_title}
                total={group.leads.length}
                queued={queued}
                isOpen={isOpen}
                onToggle={() => toggleGroup(group.job_id)}
              />
              {isOpen && group.leads.map((lead) => <LeadCard key={lead.id} lead={lead} onQueue={queueLead} />)}
            </div>
          );
        })
      )}
    </PanelShell>
  );
}
