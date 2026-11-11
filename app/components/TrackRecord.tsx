// app/components/TrackRecord.tsx
// Small "track record" row for supplier and professional cards:
// tier badge + completed orders/jobs + reviews + on-time rate.
// Every number is calculated by the database from confirmed deliveries and completed jobs.

import { ShieldCheck, CheckCircle2, Timer, MessageSquareText } from 'lucide-react';

export interface Track {
  id: string;
  completed: number | null;
  review_count: number | null;
  on_time_rate: number | string | null;
  tier: string | null;
}

const TIERS: Record<string, { label: string; cls: string }> = {
  new: { label: 'New on Velrenta', cls: 'bg-slate-800 text-slate-300 border-slate-700' },
  rising: { label: 'Rising', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  established: { label: 'Established', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  top: { label: 'Top rated', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
};

const num = (v: unknown) =>
  v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);

export default function TrackRecord({ track, noun }: { track?: Track; noun: 'orders' | 'jobs' }) {
  if (!track) return null;

  const tier = TIERS[track.tier || 'new'] || TIERS.new;
  const done = num(track.completed) ?? 0;
  const reviews = num(track.review_count) ?? 0;
  const onTime = num(track.on_time_rate);
  const one = noun === 'orders' ? 'order' : 'job';

  return (
    <div
      className="flex items-center gap-x-3 gap-y-1.5 flex-wrap text-[11px] text-slate-400 mt-3"
      title="Calculated from deliveries and jobs confirmed by buyers on Velrenta"
    >
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold border ${tier.cls}`}>
        <ShieldCheck className="w-3 h-3" /> {tier.label}
      </span>
      <span className="inline-flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3 text-slate-500" />
        {done > 0 ? `${done} ${done === 1 ? one : noun} completed` : `No ${noun} completed yet`}
      </span>
      {reviews > 0 && (
        <span className="inline-flex items-center gap-1">
          <MessageSquareText className="w-3 h-3 text-slate-500" />
          {reviews} {reviews === 1 ? 'review' : 'reviews'}
        </span>
      )}
      {onTime !== null && (
        <span className="inline-flex items-center gap-1">
          <Timer className="w-3 h-3 text-slate-500" />
          {Math.round(onTime)}% on time
        </span>
      )}
    </div>
  );
}
