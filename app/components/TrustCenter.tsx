'use client';

// app/components/TrustCenter.tsx
// Dashboard section that closes the loop for ratings:
//   1. "Did these arrive?"   -> buyer confirms delivery (a completed transaction)
//   2. "How did it go?"      -> buyer rates the supplier (only for delivered orders)
//   3. "Jobs in progress"    -> buyer marks a professional's job completed and rates it
// Renders nothing when there is nothing to do. Safe to mount before the SQL is run.

import { useCallback, useEffect, useState } from 'react';
import { Truck, Star, HardHat, Check } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import RateSupplier from './RateSupplier';

interface PoRow {
  id: string;
  po_number: string | null;
  supplier_id: string | null;
  order_description: string | null;
  delivery_location: string | null;
  dispatched_at: string | null;
  delivery_confirmed_at: string | null;
}

interface JobRow {
  id: string;
  professional_id: string;
  description: string | null;
}

const poLabel = (po: PoRow) => po.po_number || String(po.id).slice(0, 8);

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => onChange(n)}
          className="p-0.5 transition hover:scale-110"
        >
          <Star className={`w-6 h-6 ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
        </button>
      ))}
    </div>
  );
}

function JobCard({
  job,
  name,
  trade,
  onChanged,
}: {
  job: JobRow;
  name: string;
  trade: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [onTime, setOnTime] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (rating < 1) return setErr('Tap a star to rate the work.');
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc('complete_professional_job', {
      p_job: job.id,
      p_rating: rating,
      p_on_time: onTime,
      p_comment: comment.trim() || null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    onChanged();
  };

  const cancel = async () => {
    setBusy(true);
    await supabase.rpc('cancel_professional_job', { p_job: job.id });
    setBusy(false);
    onChanged();
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">
            {name} <span className="text-slate-500 font-normal capitalize">· {trade}</span>
          </p>
          {job.description && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{job.description}</p>}
        </div>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="shrink-0 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg px-3.5 py-2 transition"
          >
            Mark completed
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 pt-4 border-t border-slate-800 space-y-3">
          <p className="text-xs text-slate-400">How was the work?</p>
          <Stars value={rating} onChange={setRating} />

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400">Finished on time?</span>
            {[
              { label: 'Yes', v: true },
              { label: 'No', v: false },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => setOnTime(o.v)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                  onTime === o.v
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
                    : 'text-slate-300 border-slate-700 hover:border-slate-500'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Add a short comment (optional)"
            className="w-full resize-none bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
          />
          {err && <p className="text-xs text-red-300">{err}</p>}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={submit}
              disabled={busy}
              className="text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 rounded-lg px-4 py-2 transition"
            >
              {busy ? 'Saving...' : 'Submit rating'}
            </button>
            <button
              onClick={() => setOpen(false)}
              disabled={busy}
              className="text-xs text-slate-400 hover:text-slate-200 px-2 py-2 transition"
            >
              Back
            </button>
            <button
              onClick={cancel}
              disabled={busy}
              className="ml-auto text-xs text-slate-500 hover:text-red-300 px-2 py-2 transition"
            >
              Job didn’t go ahead
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TrustCenter({ buyerId }: { buyerId: string }) {
  const [awaiting, setAwaiting] = useState<PoRow[]>([]);
  const [toRate, setToRate] = useState<PoRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [pros, setPros] = useState<Record<string, { name: string; trade: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [posRes, revRes, jobsRes] = await Promise.all([
      supabase
        .from('purchase_orders')
        .select('id, po_number, supplier_id, order_description, delivery_location, dispatched_at, delivery_confirmed_at')
        .eq('buyer_id', buyerId)
        .eq('supplier_status', 'accepted')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('supplier_reviews').select('po_id').eq('buyer_id', buyerId),
      supabase
        .from('professional_jobs')
        .select('id, professional_id, description')
        .eq('buyer_id', buyerId)
        .eq('status', 'hired')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    // Before the SQL has been run these tables/columns do not exist: show nothing.
    if (posRes.error) console.warn('TrustCenter orders:', posRes.error.message);
    if (jobsRes.error) console.warn('TrustCenter jobs:', jobsRes.error.message);

    const pos = ((posRes.data as PoRow[]) || []).filter((p) => p.supplier_id);
    const reviewed = new Set(((revRes.data as { po_id: string }[]) || []).map((r) => r.po_id));

    setAwaiting(pos.filter((p) => !p.delivery_confirmed_at).slice(0, 3));
    setToRate(pos.filter((p) => p.delivery_confirmed_at && !reviewed.has(p.id)).slice(0, 3));
    const jobRows = (jobsRes.data as JobRow[]) || [];
    setJobs(jobRows);

    const supIds = [...new Set(pos.map((p) => p.supplier_id as string))];
    if (supIds.length) {
      const { data } = await supabase.from('suppliers').select('id, company_name').in('id', supIds);
      setSuppliers(Object.fromEntries((data || []).map((s: any) => [s.id, s.company_name])));
    }
    const proIds = [...new Set(jobRows.map((j) => j.professional_id))];
    if (proIds.length) {
      const { data } = await supabase.from('professionals').select('id, full_name, trade').in('id', proIds);
      setPros(Object.fromEntries((data || []).map((p: any) => [p.id, { name: p.full_name, trade: p.trade }])));
    }
  }, [buyerId]);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel(`trust-center-${buyerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_orders' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'professional_jobs' }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [buyerId, refresh]);

  const confirm = async (poId: string) => {
    setBusyId(poId);
    setError(null);
    const { error: err } = await supabase.rpc('confirm_delivery', { p_po: poId });
    setBusyId(null);
    if (err) return setError(err.message);
    refresh();
  };

  if (awaiting.length === 0 && toRate.length === 0 && jobs.length === 0) return null;

  return (
    <div className="mb-6 space-y-6">
      {awaiting.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Truck className="w-4 h-4 text-emerald-400" /> Did these orders arrive?
            </h2>
            <p className="text-[11px] text-slate-500 mt-1">
              Confirm once the goods are delivered. Confirmed deliveries build your supplier’s track record.
            </p>
          </div>
          {awaiting.map((po) => (
            <div
              key={po.id}
              className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {po.order_description || `Order ${poLabel(po)}`}
                </p>
                <p className="text-xs text-slate-500 mt-1 truncate">
                  {suppliers[po.supplier_id as string] || 'Supplier'} · {poLabel(po)}
                  {po.dispatched_at && <span className="text-emerald-400/90"> · Marked as dispatched</span>}
                </p>
              </div>
              <button
                onClick={() => confirm(po.id)}
                disabled={busyId === po.id}
                className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 rounded-lg px-3.5 py-2 transition"
              >
                <Check className="w-3.5 h-3.5" /> {busyId === po.id ? 'Saving...' : 'I received it'}
              </button>
            </div>
          ))}
          {error && <p className="text-xs text-red-300">{error}</p>}
        </section>
      )}

      {toRate.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-400" /> How did your orders go?
          </h2>
          {toRate.map((po) => (
            <RateSupplier
              key={po.id}
              poId={po.id}
              supplierName={suppliers[po.supplier_id as string] || 'this supplier'}
              poLabel={poLabel(po)}
              onDone={() => setToRate((prev) => prev.filter((x) => x.id !== po.id))}
            />
          ))}
        </section>
      )}

      {jobs.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <HardHat className="w-4 h-4 text-sky-300" /> Jobs in progress
            </h2>
            <p className="text-[11px] text-slate-500 mt-1">
              When the work is finished, mark it completed and rate the professional.
            </p>
          </div>
          {jobs.map((j) => (
            <JobCard
              key={j.id}
              job={j}
              name={pros[j.professional_id]?.name || 'Professional'}
              trade={pros[j.professional_id]?.trade || ''}
              onChanged={refresh}
            />
          ))}
        </section>
      )}
    </div>
  );
}
