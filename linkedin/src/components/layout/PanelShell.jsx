export default function PanelShell({ title, headerContent, children }) {
  return (
    <section className="flex h-full flex-col overflow-hidden border-r border-stone-200 bg-stone-100/80">
      <div className="shrink-0 border-b border-stone-200 bg-white/90 px-4 py-3 backdrop-blur">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
          {title}
        </h2>
        {headerContent && <div className="mt-2">{headerContent}</div>}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">{children}</div>
    </section>
  );
}
