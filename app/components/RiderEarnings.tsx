'use client';

// app/components/RiderEarnings.tsx
// Earnings summary for the rider: last 7 days, this month, all time, plus a 7-day bar chart.
// Based on the delivery fee shown on each delivered errand.

import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface Earnings {
  week_jobs: number;
  week_earned: number;
  month_jobs: number;
  month_earned: number;
  all_jobs: number;
  all_earned: number;
  days: { day: string; jobs: number; earned: number }[];
}

const naira = (n: number | null | undefined) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(n));

export default function RiderEarnings({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: res, error: err } = await supabase.rpc('rider_earnings');
      if (!alive) return;
      if (err || !res) {
        console.error('Earnings error:', err);
        setError(true);
        return;
      }
      setError(false);
      setData(res as Earnings);
    })();
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (error) {
    return (
      <div className="bg-slate-900 rounded-xl border border-dashed border-red-500/30 p-8 text-center">
        <p className="text-sm text-slate-300">We could not load your earnings</p>
        <p className="text-xs text-slate-500 mt-1">Check your connection and open this tab again.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-24 rounded-xl bg-slate-900 border border-slate-800" />
        <div className="h-44 rounded-xl bg-slate-900 border border-slate-800" />
      </div>
    );
  }

  const days = data.days || [];
  const max = Math.max(1, ...days.map((d) => Number(d.earned)));
  const cards = [
    { label: 'Last 7 days', earned: data.week_earned, jobs: data.week_jobs },
    { label: 'This month', earned: data.month_earned, jobs: data.month_jobs },
    { label: 'All time', earned: data.all_earned, jobs: data.all_jobs },
  ];

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-3 gap-2.5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
            <p className="text-[11px] text-slate-400">{c.label}</p>
            <p className="text-lg font-bold text-emerald-400 mt-1 leading-tight">{naira(c.earned)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {c.jobs} {Number(c.jobs) === 1 ? 'errand' : 'errands'}
            </p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-bold text-white">Last 7 days</h2>
        {Number(data.week_jobs) === 0 ? (
          <div className="py-8 text-center">
            <Wallet className="w-6 h-6 text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-300">No earnings yet this week</p>
            <p className="text-xs text-slate-500 mt-1">Finish an errand and it shows up here.</p>
          </div>
        ) : (
          <div className="flex items-end gap-2 h-36 mt-4">
            {days.map((d) => {
              const earned = Number(d.earned);
              const label = new Date(`${d.day}T00:00:00`).toLocaleDateString('en-NG', { weekday: 'short' });
              return (
                <div key={d.day} className="flex-1 h-full flex flex-col items-center justify-end gap-1.5" title={`${d.day}: ${naira(earned)}`}>
                  <span className="text-[10px] text-slate-400 h-3">{earned > 0 ? short(earned) : ''}</span>
                  <div
                    className={`w-full rounded-t-md ${earned > 0 ? 'bg-emerald-500' : 'bg-slate-800'}`}
                    style={{ height: earned > 0 ? `${Math.max(8, (earned / max) * 100)}%` : '4px' }}
                  />
                  <span className="text-[10px] text-slate-500">{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-[11px] text-slate-500 px-1">
        Based on the fee shown on each delivered errand. The final fee is agreed with the customer before you start.
      </p>
    </div>
  );
}