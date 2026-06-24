import { useState, useEffect, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink, Loader2, Users, X } from "lucide-react";
import toast from "react-hot-toast";
import ScoreBadge from "../shared/ScoreBadge";
import client from "../../api/client";

const STATUSES = [
  { value: "unseen", label: "Not Applied" },
  { value: "applied", label: "Applied" },
  { value: "interviewing", label: "Interviewing" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "ghosted", label: "Ghosted" },
];

const SOURCE_LABELS = {
  naukri: "Naukri",
  linkedin: "LinkedIn",
  cutshort: "Cutshort",
  instahyre: "Instahyre",
};

const STATUS_ACCENT = {
  applied: "border-l-2 border-l-sky-500",
  interviewing: "border-l-2 border-l-indigo-500",
  offer: "border-l-2 border-l-emerald-500",
  rejected: "border-l-2 border-l-rose-400 opacity-80",
  ghosted: "border-l-2 border-l-stone-300 opacity-80",
};

function formatPostedAt(postedAtParsed, postedAtRaw) {
  if (postedAtParsed) {
    try {
      return formatDistanceToNow(new Date(postedAtParsed * 1000), { addSuffix: true });
    } catch {
      // fall through
    }
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

  const isNew = job.status === "unseen";
  const accent = STATUS_ACCENT[job.status] ?? "";
  const postedStr = formatPostedAt(job.posted_at_parsed, job.posted_at);

  return (
    <article className={`space-y-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm ${accent}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold leading-snug text-slate-900">{job.title}</p>
            {isNew && (
              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                NEW
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {job.company}
            {job.location ? ` | ${job.location}` : ""}
            {job.source ? ` | via ${SOURCE_LABELS[job.source] ?? job.source}` : ""}
          </p>
        </div>
        <ScoreBadge score={job.ai_score} />
      </div>

      <div className="space-y-0.5 text-xs text-slate-600">
        {postedStr && <p>Posted: {postedStr}</p>}
        {job.experience_required && <p>Experience: {job.experience_required}</p>}
        {job.salary && <p>Salary: {job.salary}</p>}
        {job.ai_reason && <p className="italic text-slate-500">{job.ai_reason}</p>}
        {showAppliedDate && job.applied_at && (
          <p className="text-sky-700">
            Applied:{" "}
            {new Date(job.applied_at).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        )}
      </div>

      {job.skills?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {job.skills.slice(0, 5).map((skill, idx) => (
            <span
              key={idx}
              className="rounded-md border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-xs text-slate-600"
            >
              {skill}
            </span>
          ))}
          {job.skills.length > 5 && <span className="text-xs text-slate-400">+{job.skills.length - 5}</span>}
        </div>
      )}

      <div className="border-t border-stone-200" />

      <select
        value={job.status === "seen" ? "unseen" : job.status}
        onChange={(e) => onStatusChange(job.id, e.target.value)}
        className="w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-sky-400 focus:outline-none"
      >
        {STATUSES.map((status) => (
          <option key={status.value} value={status.value}>
            {status.label}
          </option>
        ))}
      </select>

      <div className="flex gap-2">
        <a
          href={job.job_url}
          target="_blank"
          rel="noreferrer"
          onClick={() => isNew && onStatusChange(job.id, "seen")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
        >
          <ExternalLink size={11} /> Apply
        </a>

        <button
          onClick={handleFindLeads}
          disabled={findLeadsState !== "idle"}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-100 py-1.5 text-xs font-medium text-sky-800 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {findLeadsState !== "idle" ? <Loader2 size={11} className="animate-spin" /> : <Users size={11} />}
          {findLeadsState === "loading"
            ? "Queuing..."
            : findLeadsState === "processing"
              ? "Finding..."
              : "Find Leads"}
        </button>

        <button
          onClick={() => onDismiss(job.id)}
          title="Dismiss"
          className="rounded-lg border border-stone-200 px-2 text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
        >
          <X size={12} />
        </button>
      </div>
    </article>
  );
}
