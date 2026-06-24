import { Briefcase, ExternalLink, Target, User, UserPlus, Wrench, Check } from "lucide-react";
import ScoreBadge from "../shared/ScoreBadge";

const CATEGORY_META = {
  hiring_manager: { label: "Hiring Manager", Icon: Target },
  senior_engineer: { label: "Senior Engineer", Icon: Wrench },
  recruiter: { label: "Recruiter", Icon: Briefcase },
  peer: { label: "Peer", Icon: User },
};

const CONNECT_STATUS_STYLE = {
  not_queued: "text-slate-500",
  queued: "text-violet-700",
  sent: "text-emerald-700",
  accepted: "text-emerald-700",
  failed: "text-rose-700",
};

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

export default function LeadCard({ lead, onQueue }) {
  const isQueued = lead.connect_status !== "not_queued";
  const meta = CATEGORY_META[lead.category] ?? CATEGORY_META.peer;
  const statusStyle = CONNECT_STATUS_STYLE[lead.connect_status] ?? "text-slate-500";
  const statusLabel = (lead.connect_status ?? "not_queued").replace(/_/g, " ");
  const Icon = meta.Icon;

  return (
    <article className="space-y-2 rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
          {getInitials(lead.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-slate-900">{lead.name}</p>
            <ScoreBadge score={lead.ai_score} />
          </div>
          <p className="truncate text-xs text-slate-500">
            {lead.title ? `${lead.title}` : ""}
            {lead.title && lead.company ? " | " : ""}
            {lead.company ?? ""}
          </p>
        </div>
      </div>

      <div className="space-y-0.5 text-xs text-slate-600">
        <p className="inline-flex items-center gap-1.5"><Icon size={12} /> {meta.label}</p>
        {lead.ai_reason && <p className="italic text-slate-500">{lead.ai_reason}</p>}
      </div>

      <div className="flex gap-2 pt-0.5">
        <a
          href={lead.profile_url}
          target="_blank"
          rel="noreferrer"
          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-stone-200 bg-stone-50 py-1.5 text-xs text-slate-700 transition hover:bg-stone-100"
        >
          <ExternalLink size={10} /> Profile
        </a>
        <button
          onClick={() => onQueue(lead.id)}
          disabled={isQueued}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-900 py-1.5 text-xs text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isQueued ? <><Check size={10} /> In Queue</> : <><UserPlus size={10} /> Connect</>}
        </button>
      </div>

      <p className={`text-xs capitalize ${statusStyle}`}>Status: {statusLabel}</p>
    </article>
  );
}
