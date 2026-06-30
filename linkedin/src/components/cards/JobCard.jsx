import { useState, useEffect, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink, Loader2, Users, X } from "lucide-react";
import toast from "react-hot-toast";
import ScoreBadge from "../shared/ScoreBadge";
import client from "../../api/client";

const STATUSES = [
  { value: "unseen",      label: "Not Applied"  },
  { value: "applied",     label: "Applied"      },
  { value: "interviewing",label: "Interviewing" },
  { value: "offer",       label: "Offer"        },
  { value: "rejected",    label: "Rejected"     },
  { value: "ghosted",     label: "Ghosted"      },
];

const SOURCE_LABELS = {
  naukri:     "Naukri",
  linkedin:   "LinkedIn",
  cutshort:   "Cutshort",
  instahyre:  "Instahyre",
  hiringcafe: "HiringCafe",
};

const STATUS_ACCENT = {
  applied:     "border-l-2 border-l-sky-500",
  interviewing:"border-l-2 border-l-indigo-500",
  offer:       "border-l-2 border-l-emerald-500",
  rejected:    "border-l-2 border-l-rose-400 opacity-75",
  ghosted:     "border-l-2 border-l-stone-300 opacity-75",
};

function formatPostedAt(postedAtParsed, postedAtRaw) {
  if (postedAtParsed) {
    try {
      return formatDistanceToNow(new Date(postedAtParsed * 1000), { addSuffix: true });
    } catch { /* fall through */ }
  }
  return postedAtRaw || null;
}

export default function JobCard({ job, onStatusChange, onDismiss, showAppliedDate }) {
  const [findLeadsState, setFindLeadsState] = useState("idle");
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  async function handleFindLeads() {
    setFindLeadsState("loading");
    try {
      const res = await client.post("/api/find-leads", { job_id: job.id });
      const requestId = res.data?.request_id;
      setFindLeadsState("processing");
      if (!requestId) { setFindLeadsState("idle"); return; }

      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await client.get(`/api/find-leads/${requestId}/status`);
          const { status } = statusRes.data;
          if (status === "done" || status === "failed" || status === "cancelled") {
            clearInterval(pollRef.current);
            setFindLeadsState("idle");
            if (status === "done") toast.success("Leads found! Check Company Leads.");
          }
        } catch {
          clearInterval(pollRef.current);
          setFindLeadsState("idle");
        }
      }, 5000);
    } catch (err) {
      setFindLeadsState("idle");
      if (err.response?.status === 501) {
        toast("Install the extension to use Find Leads", { icon: "*" });
      } else {
        toast.error("Find Leads unavailable");
      }
    }
  }

  const isNew    = job.status === "unseen";
  const accent   = STATUS_ACCENT[job.status] ?? "";
  const postedStr = formatPostedAt(job.posted_at_parsed, job.posted_at);

  // Single-line meta: company · location · source · time · exp · salary · reason
  const metaParts = [
    job.company,
    job.location,
    SOURCE_LABELS[job.source] ?? job.source,
    postedStr,
    job.experience_required,
    job.salary,
    job.ai_reason,
    showAppliedDate && job.applied_at
      ? `Applied ${new Date(job.applied_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
      : null,
  ].filter(Boolean);

  return (
    <article className={`rounded-lg border border-stone-200 bg-white shadow-sm transition hover:shadow-md ${accent}`}>

      {/* Row 1 — title + NEW + score + dismiss */}
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <p className="flex-1 truncate text-[13px] font-semibold leading-snug text-slate-900">
          {job.title}
        </p>
        {isNew && (
          <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
            NEW
          </span>
        )}
        <ScoreBadge score={job.ai_score} />
        <button
          onClick={() => onDismiss(job.id)}
          title="Dismiss"
          className="shrink-0 rounded p-0.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
        >
          <X size={12} />
        </button>
      </div>

      {/* Row 2 — single-line meta */}
      <p className="mt-0.5 truncate px-3 text-[11px] leading-relaxed text-slate-500">
        {metaParts.join(" · ")}
      </p>

      {/* Row 3 — skills + inline actions */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
        {job.skills?.slice(0, 4).map((skill, idx) => (
          <span
            key={idx}
            className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-slate-600"
          >
            {skill}
          </span>
        ))}
        {job.skills?.length > 4 && (
          <span className="text-[10px] text-slate-400">+{job.skills.length - 4}</span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <select
            value={job.status === "seen" ? "unseen" : job.status}
            onChange={(e) => onStatusChange(job.id, e.target.value)}
            className="rounded border border-stone-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 focus:border-sky-400 focus:outline-none"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          <a
            href={job.job_url}
            target="_blank"
            rel="noreferrer"
            onClick={() => isNew && onStatusChange(job.id, "seen")}
            className="flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-slate-700"
          >
            <ExternalLink size={10} /> Apply
          </a>

          <button
            onClick={handleFindLeads}
            disabled={findLeadsState !== "idle"}
            className="flex items-center gap-1 rounded bg-sky-100 px-2.5 py-1 text-[11px] font-medium text-sky-800 transition hover:bg-sky-200 disabled:opacity-60"
          >
            {findLeadsState !== "idle"
              ? <Loader2 size={10} className="animate-spin" />
              : <Users size={10} />}
            {findLeadsState === "loading"
              ? "Queuing…"
              : findLeadsState === "processing"
              ? "Finding…"
              : "Leads"}
          </button>
        </div>
      </div>

    </article>
  );
}
