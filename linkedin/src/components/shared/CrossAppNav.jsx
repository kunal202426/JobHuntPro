import { Mail } from "lucide-react";

export default function CrossAppNav() {
  return (
    <a
      href="http://localhost:5173"
      target="_blank"
      rel="noreferrer"
      title="Open Cold Outreach Hub"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-md transition-all hover:bg-stone-50 hover:shadow-lg"
    >
      <Mail size={13} className="text-orange-500" />
      Cold Outreach
      <span className="text-slate-400">→</span>
    </a>
  );
}
