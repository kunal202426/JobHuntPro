import { ExternalLink, RefreshCw, X } from "lucide-react";
import ScoreBadge from "../shared/ScoreBadge";

const STATUS_INFO = {
  pending: { pill: "bg-slate-100 text-slate-700", label: "Pending" },
  processing: { pill: "bg-sky-100 text-sky-700", label: "Connecting" },
  sent: { pill: "bg-emerald-100 text-emerald-700", label: "Sent" },
  accepted: { pill: "bg-emerald-100 text-emerald-700", label: "Accepted" },
  failed: { pill: "bg-rose-100 text-rose-700", label: "Failed" },
  already_connected: { pill: "bg-sky-100 text-sky-700", label: "Already connected" },
  already_pending: { pill: "bg-emerald-100 text-emerald-700", label: "Sent (pending acceptance)" },
  no_button: { pill: "bg-stone-100 text-stone-700", label: "No connect button" },
  skipped: { pill: "bg-stone-100 text-stone-500", label: "Skipped" },
};

const TERMINAL = new Set(["sent", "accepted", "already_connected", "already_pending"]);

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

export default function QueuePersonCard({ person, onSkip, onRetry }) {
  const info = STATUS_INFO[person.status] ?? STATUS_INFO.pending;
  const canSkip = person.status === "pending";
  // Allow retry on any settled status — including "Sent" — so a false positive
  // can be re-verified. Only in-flight states (pending/processing) can't retry.
  const canRetry = !["pending", "processing"].includes(person.status);

  return (
    <article className="space-y-2 rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
          {getInitials(person.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-slate-900">{person.name || "Unknown"}</p>
            {person.ai_score != null && <ScoreBadge score={person.ai_score} />}
          </div>
          <p className="truncate text-xs text-slate-500">
            {person.title ?? ""}
            {person.title && person.company ? " | " : ""}
            {person.company ?? ""}
          </p>
          {person.source && person.source !== "manual" && <p className="text-xs text-slate-400">via {person.source}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${info.pill}`}>{info.label}</span>
        {person.error_msg && !TERMINAL.has(person.status) && (
          <span className="max-w-[180px] truncate text-xs text-rose-700">{person.error_msg}</span>
        )}
      </div>

      <div className="flex gap-2 pt-0.5">
        <a
          href={person.profile_url}
          target="_blank"
          rel="noreferrer"
          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-stone-200 bg-stone-50 py-1.5 text-xs text-slate-700 transition hover:bg-stone-100"
        >
          <ExternalLink size={10} /> Profile
        </a>
        {canSkip && (
          <button
            onClick={() => onSkip(person.id)}
            className="flex items-center justify-center gap-1 rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
          >
            <X size={10} /> Skip
          </button>
        )}
        {canRetry && (
          <button
            onClick={() => onRetry(person.id)}
            className="flex items-center justify-center gap-1 rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-slate-600 transition hover:bg-stone-100"
          >
            <RefreshCw size={10} /> Retry
          </button>
        )}
      </div>
    </article>
  );
}
