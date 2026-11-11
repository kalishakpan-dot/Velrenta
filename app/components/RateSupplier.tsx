'use client';

// app/components/RateSupplier.tsx
// Reusable rating card. Used on the dashboard and inside the /pos order cards.

import { useState } from 'react';
import { Star, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface RateSupplierProps {
  poId: string;
  supplierName: string;
  poLabel?: string;
  // Called about 1.5s after a successful save, with the rating the buyer gave.
  onDone?: (rating: number) => void;
}

const ERROR_TEXT: Record<string, string> = {
  not_authenticated: 'Please sign in again.',
  invalid_rating: 'Pick a star rating first.',
  not_your_order: 'This order is not on your account.',
  not_eligible: 'You can rate an order once the supplier has accepted it and it is fully paid.',
};

export default function RateSupplier({ poId, supplierName, poLabel, onDone }: RateSupplierProps) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [onTime, setOnTime] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (rating === 0) {
      setError(ERROR_TEXT.invalid_rating);
      return;
    }
    setBusy(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('submit_supplier_review', {
      p_po_id: poId,
      p_rating: rating,
      p_on_time: onTime,
      p_comment: comment.trim() || null,
    });
    setBusy(false);

    const payload = data as { success?: boolean; error?: string } | null;
    if (rpcError || !payload) {
      console.error('Review submit error:', rpcError);
      setError('Could not save your review. Please try again.');
      return;
    }
    if (payload.error && payload.error !== 'already_reviewed') {
      setError(ERROR_TEXT[payload.error] || 'Could not save your review.');
      return;
    }

    setDone(true);
    setTimeout(() => onDone?.(rating), 1500);
  };

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-2.5 text-sm text-emerald-300">
        <CheckCircle className="w-4 h-4 shrink-0" /> Thanks. Your review of {supplierName} is saved.
      </div>
    );
  }

  const shown = hover || rating;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 min-w-0">
      <p className="text-sm font-semibold text-white truncate">Rate {supplierName}</p>
      {poLabel && <p className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">{poLabel}</p>}

      <div className="flex items-center gap-1 mt-3" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => setRating(n)}
            className="p-0.5 transition"
          >
            <Star
              className={`w-6 h-6 ${n <= shown ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`}
            />
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400">Delivered on time?</span>
        {[
          { label: 'Yes', value: true },
          { label: 'No', value: false },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => setOnTime(onTime === opt.value ? null : opt.value)}
            className={`text-xs font-medium rounded-lg px-3 py-1.5 border transition ${
              onTime === opt.value
                ? 'bg-emerald-500 text-slate-950 border-emerald-500'
                : 'text-slate-300 border-slate-700 hover:border-emerald-500/50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Anything other buyers should know? (optional)"
        className="mt-3 w-full resize-none bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
      />

      {error && <p className="text-xs text-red-300 mt-2">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="mt-3 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 rounded-lg px-4 py-2 transition"
      >
        {busy ? 'Saving...' : 'Submit review'}
      </button>
    </div>
  );
}