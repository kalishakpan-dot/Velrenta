'use client';

// app/components/DeliveryControls.tsx
// Shown on a supplier's order card once the order is accepted.
// - Accepted but unpaid: locked panel explaining that payment must be confirmed first.
// - Accepted AND payment confirmed (upfront or full): Dispatched -> Delivered.
// Everything here is what the buyer sees on their /tracking page.

import { useState } from 'react';
import { Truck, PackageCheck, Lock } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export interface DeliveryPO {
  id: string;
  po_number: string;
  supplier_status: string;
  payment_status?: string | null;
  dispatched_at?: string | null;
  delivery_confirmed_at?: string | null;
  dispatch_note?: string | null;
}

interface Props {
  po: DeliveryPO;
  supplierId: string;
  onUpdated: (message: string) => void;
  onError: (message: string) => void;
  onGoToPayments?: () => void;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) +
  ', ' +
  new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });

export default function DeliveryControls({ po, supplierId, onUpdated, onError, onGoToPayments }: Props) {
  const [open, setOpen] = useState<null | 'dispatch' | 'deliver'>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (po.supplier_status !== 'accepted') return null;

  const paid = po.payment_status === 'paid' || po.payment_status === 'deposit_paid';

  // Accepted, but payment not confirmed yet: explain why dispatch is not available.
  if (!paid) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-slate-400">
          <Lock className="w-3.5 h-3.5 shrink-0 text-slate-500" />
          Delivery unlocks once you confirm the buyer&apos;s payment (upfront or full).
        </p>
        {onGoToPayments && (
          <button
            onClick={onGoToPayments}
            className="shrink-0 text-xs font-bold border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 text-slate-300 rounded-lg px-3 py-1.5 transition"
          >
            Go to Payments
          </button>
        )}
      </div>
    );
  }

  const dispatch = async () => {
    setBusy(true);
    const { data, error } = await supabase
      .from('purchase_orders')
      .update({ dispatched_at: new Date().toISOString(), dispatch_note: note.trim() || null })
      .eq('id', po.id)
      .eq('supplier_id', supplierId)
      .is('dispatched_at', null)
      .select('id');
    setBusy(false);
    if (error || !data || data.length === 0) {
      console.error('Dispatch error:', error);
      onError('Could not update delivery. Try again.');
      return;
    }
    setOpen(null);
    setNote('');
    onUpdated(`${po.po_number} marked as dispatched`);
  };

  const deliver = async () => {
    setBusy(true);
    const { data, error } = await supabase
      .from('purchase_orders')
      .update({ delivery_confirmed_at: new Date().toISOString() })
      .eq('id', po.id)
      .eq('supplier_id', supplierId)
      .not('dispatched_at', 'is', null)
      .is('delivery_confirmed_at', null)
      .select('id');
    setBusy(false);
    if (error || !data || data.length === 0) {
      console.error('Delivered error:', error);
      onError('Could not update delivery. Try again.');
      return;
    }
    setOpen(null);
    onUpdated(`${po.po_number} marked as delivered`);
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-800">
      {/* 1. Delivered: nothing left to do */}
      {po.delivery_confirmed_at ? (
        <div className="flex items-center gap-2 text-xs text-emerald-400">
          <PackageCheck className="w-4 h-4" />
          Delivered on {fmt(po.delivery_confirmed_at)}. The buyer can see this.
        </div>
      ) : /* 2. Dispatched: waiting for delivery */ po.dispatched_at ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs text-sky-300">
              <Truck className="w-4 h-4" /> Dispatched on {fmt(po.dispatched_at)}
            </p>
            {po.dispatch_note && <p className="text-xs text-slate-400 mt-1 break-words">{po.dispatch_note}</p>}
          </div>
          {open === 'deliver' ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-slate-400">Has the buyer received it?</span>
              <button
                onClick={() => setOpen(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
              >
                Not yet
              </button>
              <button
                onClick={deliver}
                disabled={busy}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 transition"
              >
                {busy ? 'Saving...' : 'Yes, delivered'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setOpen('deliver')}
              className="shrink-0 flex items-center justify-center gap-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg px-4 py-2 transition"
            >
              <PackageCheck className="w-3.5 h-3.5" /> Mark as delivered
            </button>
          )}
        </div>
      ) : /* 3. Not dispatched yet */ open === 'dispatch' ? (
        <div>
          <label htmlFor={`dn-${po.id}`} className="block text-xs text-slate-300 mb-1.5">
            Delivery details for the buyer (optional)
          </label>
          <textarea
            id={`dn-${po.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            rows={2}
            placeholder="e.g. Driver: Emeka, 0801 234 5678, white Hilux, plate ABC-123XY"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
          />
          <div className="flex justify-end gap-2 mt-2.5">
            <button
              onClick={() => setOpen(null)}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              onClick={dispatch}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 transition"
            >
              {busy ? 'Saving...' : 'Confirm dispatch'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-xs text-slate-400">Payment received. Let the buyer know when the goods leave your site.</p>
          <button
            onClick={() => setOpen('dispatch')}
            className="shrink-0 flex items-center justify-center gap-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg px-4 py-2 transition"
          >
            <Truck className="w-3.5 h-3.5" /> Mark as dispatched
          </button>
        </div>
      )}
    </div>
  );
}