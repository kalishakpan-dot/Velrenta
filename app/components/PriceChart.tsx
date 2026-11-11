// app/components/PriceChart.tsx
// Dependency-free SVG line chart. Renders on the server, so it is visible to Google and loads instantly.

import { fmtNaira } from '../lib/market';

export default function PriceChart({ points }: { points: { date: string; value: number }[] }) {
  if (points.length < 2) {
    return <p className="text-sm text-slate-500">Not enough history yet to draw a trend.</p>;
  }

  const W = 640, H = 200, PX = 8, PY = 20;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;

  const x = (i: number) => PX + (i / (points.length - 1)) * (W - PX * 2);
  const y = (v: number) => H - PY - ((v - min) / span) * (H - PY * 2);

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const last = points[points.length - 1];
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });

  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Price trend from ${fmt(points[0].date)} to ${fmt(last.date)}, between ${fmtNaira(min)} and ${fmtNaira(max)}`}
      >
        <defs>
          <linearGradient id="pc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1={PX} x2={W - PX} y1={PY + t * (H - PY * 2)} y2={PY + t * (H - PY * 2)} stroke="#1e293b" strokeWidth="1" />
        ))}
        <path d={area} fill="url(#pc-fill)" />
        <path d={line} fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r="4.5" fill="#34d399" />
      </svg>
      <figcaption className="flex justify-between text-[11px] text-slate-500 mt-1 px-1">
        <span>{fmt(points[0].date)}</span>
        <span>Low {fmtNaira(min)} · High {fmtNaira(max)}</span>
        <span>{fmt(last.date)}</span>
      </figcaption>
    </figure>
  );
}
