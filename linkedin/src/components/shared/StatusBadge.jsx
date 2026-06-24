const STATUS_STYLES = {
  pending: "bg-slate-100 text-slate-700",
  sent: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  already_connected: "bg-sky-100 text-sky-700",
  no_button: "bg-stone-100 text-stone-700",
  skipped: "bg-stone-100 text-stone-500",
  unseen: "bg-slate-100 text-slate-700",
  applied: "bg-sky-100 text-sky-700",
  interviewing: "bg-indigo-100 text-indigo-700",
  offer: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  ghosted: "bg-stone-100 text-stone-500 italic",
  queued: "bg-violet-100 text-violet-700",
  not_queued: "bg-stone-100 text-stone-500",
};

export default function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] ?? "bg-stone-100 text-slate-600";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {status?.replace(/_/g, " ")}
    </span>
  );
}
