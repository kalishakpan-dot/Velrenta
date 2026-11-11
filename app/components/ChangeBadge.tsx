// app/components/ChangeBadge.tsx
export default function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const flat = Math.abs(value) < 0.5;
  const up = value > 0;
  const cls = flat
    ? 'bg-slate-800 text-slate-300 border-slate-700'
    : up
    ? 'bg-red-500/10 text-red-300 border-red-500/30'
    : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
  const label = flat ? 'Stable' : `${up ? '▲' : '▼'} ${Math.abs(value).toFixed(1)}%`;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${cls}`}>
      {label}
      <span className="sr-only"> over the last 30 days</span>
    </span>
  );
}
