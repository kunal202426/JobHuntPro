export default function ScoreBadge({ score }) {
  if (score == null) return null;

  const color =
    score >= 8
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : score >= 6
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : "border-rose-200 bg-rose-50 text-rose-700";

  return (
    <span className={`rounded border px-1.5 py-0.5 text-xs font-bold ${color}`}>
      {score}/10
    </span>
  );
}
