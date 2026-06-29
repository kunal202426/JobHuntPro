import { useStats } from "../../hooks/useStats";

export default function TopBar() {
  const { stats } = useStats();

  const sent = stats?.connections_sent ?? 0;
  const limit = stats?.daily_limit ?? 14;
  const running = stats?.running ?? false;
  const jobsScraped = stats?.jobs_scraped ?? 0;

  const usage = limit > 0 ? sent / limit : 0;
  const counterColor = usage >= 0.9 ? "text-rose-700" : usage >= 0.6 ? "text-indigo-700" : "text-emerald-700";

  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-y-1 border-b border-stone-200 bg-white px-4 py-2 md:px-6 md:py-3">
      <div>
        <p className="text-base font-semibold tracking-wide text-slate-900 md:text-lg">JobHunt Engine</p>
        <p className="hidden text-xs text-slate-500 md:block">Fresh Jobs | Company Leads | Lead Connector</p>
      </div>

      <div className="flex items-center gap-3 text-sm md:gap-5">
        <span className={`font-mono text-xs font-semibold md:text-sm ${counterColor}`}>{sent} / {limit} today</span>
        <span className="hidden font-mono text-slate-500 md:inline">jobs scraped: {jobsScraped}</span>
        <span
          title="Queue status — start/pause it from the Lead Connector panel"
          className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs text-slate-600"
        >
          <span className={`inline-block h-2 w-2 rounded-full ${running ? "bg-emerald-500" : "bg-slate-400"}`} />
          <span className="hidden sm:inline">{running ? "Queue Running" : "Queue Paused"}</span>
          <span className="sm:hidden">{running ? "Running" : "Paused"}</span>
        </span>
      </div>
    </header>
  );
}
