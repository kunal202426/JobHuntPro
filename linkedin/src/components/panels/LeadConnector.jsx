import { useEffect, useState } from "react";
import { Pause, Play, UserPlus } from "lucide-react";
import client from "../../api/client";
import { useQueue } from "../../hooks/useQueue";
import { useStats } from "../../hooks/useStats";
import PanelShell from "../layout/PanelShell";
import QueuePersonCard from "../cards/QueuePersonCard";
import EmptyState from "../shared/EmptyState";

const STATUS_TABS = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "sent", label: "Sent" },
  { id: "failed", label: "Failed" },
];

function useCountdown(running) {
  const [seconds, setSeconds] = useState(5);

  useEffect(() => {
    if (!running) {
      setSeconds(5);
      return;
    }

    const id = setInterval(() => {
      setSeconds((value) => (value <= 1 ? 5 : value - 1));
    }, 1000);

    return () => clearInterval(id);
  }, [running]);

  return seconds;
}

export default function LeadConnector() {
  const { queue, loading, running, fetchQueue, skipPerson, retryPerson, manualAdd, startQueue, stopQueue } = useQueue();
  const { stats, refetch } = useStats();

  const [activeTab, setActiveTab] = useState("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addName, setAddName] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [dailyLimitInput, setDailyLimitInput] = useState("");
  const [savingLimit, setSavingLimit] = useState(false);

  const countdown = useCountdown(running);
  const sentToday = stats?.connections_sent ?? 0;
  const dailyLimit = stats?.daily_limit ?? 14;
  const limitHit = sentToday >= dailyLimit;
  const pendingCount = queue.filter((person) => person.status === "pending").length;

  useEffect(() => {
    setDailyLimitInput(String(dailyLimit));
  }, [dailyLimit]);

  const filtered = queue.filter((person) => {
    if (activeTab === "all") return true;
    if (activeTab === "sent") return ["sent", "accepted", "already_pending"].includes(person.status);
    if (activeTab === "failed") return ["failed", "no_button", "skipped"].includes(person.status);
    return person.status === activeTab;
  });

  async function handleManualAdd(e) {
    e.preventDefault();
    if (!addUrl.includes("/in/")) return;

    setAddLoading(true);
    await manualAdd(addName.trim() || null, addUrl.trim());
    setAddUrl("");
    setAddName("");
    setShowAddForm(false);
    setAddLoading(false);
  }

  async function saveDailyLimit() {
    const parsed = Number.parseInt(dailyLimitInput, 10);
    if (!Number.isFinite(parsed)) return;

    const nextLimit = Math.min(100, Math.max(1, parsed));
    setSavingLimit(true);
    try {
      await client.post("/api/stats/daily-limit", { daily_limit: nextLimit });
      if (!running && sentToday < nextLimit) {
        await client.post("/api/queue/start");
      }
      await fetchQueue();
      await refetch();
    } catch {
      // silent
    } finally {
      setSavingLimit(false);
    }
  }

  const usage = dailyLimit > 0 ? sentToday / dailyLimit : 0;
  const counterColor = usage >= 0.9 ? "text-rose-700" : usage >= 0.6 ? "text-indigo-700" : "text-emerald-700";

  const headerContent = (
    <div className="space-y-2.5 mt-1">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={running ? stopQueue : startQueue}
          disabled={limitHit}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
            running ? "bg-indigo-600 hover:bg-indigo-500" : "bg-emerald-600 hover:bg-emerald-500"
          }`}
        >
          {running ? <><Pause size={10} /> Pause Queue</> : <><Play size={10} /> Start Queue</>}
        </button>

        <span className={`text-xs font-mono font-semibold ${counterColor}`}>
          {sentToday} / {dailyLimit} today
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-500">Daily cap</span>
        <input
          type="number"
          min="1"
          max="100"
          value={dailyLimitInput}
          onChange={(e) => setDailyLimitInput(e.target.value)}
          className="w-16 rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-sky-400 focus:outline-none"
        />
        <button
          onClick={saveDailyLimit}
          disabled={savingLimit}
          className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs text-slate-700 transition hover:bg-stone-100 disabled:opacity-60"
        >
          {savingLimit ? "Saving..." : "Save"}
        </button>
      </div>

      {limitHit ? (
        <p className="text-xs text-rose-700">Daily limit reached. Resets at midnight.</p>
      ) : running && pendingCount > 0 ? (
        <p className="text-xs text-slate-500">Next connect in: {countdown}s</p>
      ) : running ? (
        <p className="text-xs text-slate-500">Waiting for leads in queue...</p>
      ) : null}

      <div className="flex items-center gap-1 rounded-lg bg-stone-100 p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              activeTab === tab.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </button>
        ))}

        <button
          onClick={() => setShowAddForm((value) => !value)}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-slate-700 transition hover:bg-stone-100"
        >
          <UserPlus size={10} /> Add
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleManualAdd} className="space-y-1.5">
          <input
            type="text"
            placeholder="linkedin.com/in/profile-url"
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            required
            className="w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Name (optional)"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            className="w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={addLoading || !addUrl.includes("/in/")}
            className="w-full rounded-lg bg-slate-900 py-1.5 text-xs text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {addLoading ? "Adding..." : "Add to Queue"}
          </button>
        </form>
      )}
    </div>
  );

  return (
    <PanelShell title="Lead Connector" headerContent={headerContent}>
      {loading ? (
        <p className="py-8 text-center text-xs text-slate-500">Loading queue...</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          message={
            activeTab === "all" ? "Queue empty. Add leads from Company Leads to get started." : `No ${activeTab} items`
          }
        />
      ) : (
        filtered.map((person) => (
          <QueuePersonCard key={person.id} person={person} onSkip={skipPerson} onRetry={retryPerson} />
        ))
      )}
    </PanelShell>
  );
}
