import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useLeads } from "../../hooks/useLeads";
import PanelShell from "../layout/PanelShell";
import LeadCard from "../cards/LeadCard";
import EmptyState from "../shared/EmptyState";

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
  const { leads, loading, queueLead } = useLeads();
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [jobFilter, setJobFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  const jobOptions = useMemo(() => {
    const seen = new Map();
    leads.forEach((lead) => {
      if (!seen.has(lead.job_id)) {
        seen.set(lead.job_id, {
          job_id: lead.job_id,
          job_title: lead.job_title,
          job_company: lead.job_company,
        });
      }
    });
    return [{ job_id: "all", job_title: "All Jobs", job_company: "" }, ...seen.values()];
  }, [leads]);

  const filtered = useMemo(() => {
    return leads.filter((lead) => {
      if (categoryFilter !== "all" && lead.category !== categoryFilter) return false;
      if (jobFilter !== "all" && lead.job_id !== jobFilter) return false;
      if (!matchesDate(lead.created_at, dateFilter)) return false;
      return true;
    });
  }, [leads, categoryFilter, jobFilter, dateFilter]);

  const groups = useMemo(() => {
    const grouped = new Map();
    filtered.forEach((lead) => {
      if (!grouped.has(lead.job_id)) {
        grouped.set(lead.job_id, {
          job_id: lead.job_id,
          job_title: lead.job_title ?? "Unknown Role",
          job_company: lead.job_company ?? "Unknown Company",
          leads: [],
        });
      }
      grouped.get(lead.job_id).leads.push(lead);
    });

    grouped.forEach((group) => {
      group.leads = sortLeads(group.leads);
    });

    return [...grouped.values()];
  }, [filtered]);

  const totalLeads = filtered.length;
  const totalCompanies = new Set(filtered.map((lead) => lead.job_company)).size;

  function toggleGroup(jobId) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(jobId) ? next.delete(jobId) : next.add(jobId);
      return next;
    });
  }

  const headerContent = (
    <div className="space-y-2 mt-1">
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
        <EmptyState message="No leads yet. Click Find Leads on jobs in Fresh Jobs Portal." />
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
