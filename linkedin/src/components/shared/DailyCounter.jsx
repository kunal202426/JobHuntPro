export default function DailyCounter({ sent = 0, limit = 14 }) {
  const usage = limit > 0 ? sent / limit : 0;
  const color = usage >= 0.9 ? "text-rose-700" : usage >= 0.6 ? "text-indigo-700" : "text-emerald-700";

  return (
    <span className={`text-sm font-mono font-semibold ${color}`}>
      {sent} / {limit} today
    </span>
  );
}
