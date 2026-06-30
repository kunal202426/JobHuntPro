import { useState, useEffect, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink, Loader2, Users, X } from "lucide-react";
import toast from "react-hot-toast";
import ScoreBadge from "../shared/ScoreBadge";
import client from "../../api/client";

const STATUSES = [
  { value: "unseen",       label: "Not Applied"  },
  { value: "applied",      label: "Applied"      },
  { value: "interviewing", label: "Interviewing" },
  { value: "offer",        label: "Offer"        },
  { value: "rejected",     label: "Rejected"     },
  { value: "ghosted",      label: "Ghosted"      },
];

const SOURCE_LABELS = {
  naukri:     "Naukri",
  linkedin:   "LinkedIn",
  cutshort:   "Cutshort",
  instahyre:  "Instahyre",
  hiringcafe: "HiringCafe",
  wellfound:  "Wellfound",
};

const STATUS_ACCENT = {
  applied:      "border-l-[3px] border-l-sky-400",
  interviewing: "border-l-[3px] border-l-indigo-400",
  offer:        "border-l-[3px] border-l-emerald-400",
  rejected:     "border-l-[3px] border-l-rose-300 opacity-75",
  ghosted:      "border-l-[3px] border-l-stone-300 opacity-75",
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

  const isNew     = job.status === "unseen";
  const accent    = STATUS_ACCENT[job.status] ?? "";
  const postedStr = formatPostedAt(job.posted_at_parsed, job.posted_at);

  // Line 1: who + where
  const line1 = [job.company, job.location].filter(Boolean).join(" · ");
  // Line 2: source + time + exp + salary + applied date
  const line2 = [
    SOURCE_LABELS[job.source] ?? job.source,
    postedStr,
    job.experience_required,
    job.salary,
    showAppliedDate && job.applied_at
      ? `Applied ${new Date(job.applied_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
      : null,
  ].filter(Boolean).join(" · ");

  return (
    <article className={`flex flex-col rounded-xl border border-stone-200 bg-white shadow-sm transition hover:shadow-md hover:-translate-y-0.5 ${accent}`}>

      {/* Header — title + score + dismiss */}
      <div className="flex items-start gap-2 px-3.5 pt-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-[13px] font-semibold leading-snug text-slate-900">{job.title}</p>
            {isNew && (
              <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                New
              </span>
            )}
          </div>
          {line1 && <p className="mt-0.5 text-[11px] font-medium text-slate-600">{line1}</p>}
          {line2 && <p className="text-[11px] text-slate-400">{line2}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ScoreBadge score={job.ai_score} />
          <button
            onClick={() => onDismiss(job.id)}
            title="Dismiss"
            className="rounded p-0.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-400"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* AI reason */}
      {job.ai_reason && (
        <p className="mt-1 px-3.5 text-[10px] italic text-slate-400">{job.ai_reason}</p>
      )}

      {/* Skills */}
      {job.skills?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 px-3.5">
          {job.skills.slice(0, 5).map((skill, idx) => (
            <span key={idx} className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] text-slate-600">
              {skill}
            </span>
          ))}
          {job.skills.length > 5 && (
            <span className="self-center text-[10px] text-slate-400">+{job.skills.length - 5}</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto border-t border-stone-100 px-3.5 py-2.5 flex items-center gap-1.5 flex-wrap">
        <select
          value={job.status === "seen" ? "unseen" : job.status}
          onChange={(e) => onStatusChange(job.id, e.target.value)}
          className="rounded-md border border-stone-300 bg-white px-1.5 py-1 text-[11px] text-slate-600 focus:border-sky-400 focus:outline-none"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1.5">
          <a
            href={job.job_url}
            target="_blank"
            rel="noreferrer"
            onClick={() => isNew && onStatusChange(job.id, "seen")}
            className="flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-slate-700"
          >
            <ExternalLink size={10} /> Apply
          </a>
          <button
            onClick={handleFindLeads}
            disabled={findLeadsState !== "idle"}
            className="flex items-center gap-1 rounded-md bg-sky-50 border border-sky-200 px-2.5 py-1 text-[11px] font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
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
