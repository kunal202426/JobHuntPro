export default function EmptyState({ message = "Nothing here yet" }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-sm text-slate-500">
      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-300 text-stone-400">
        o
      </div>
      <p className="max-w-xs leading-relaxed">{message}</p>
    </div>
  );
}
