'use client';

// app/components/DeliveryFlow.tsx
// Shown on an in-progress errand: the rider records what they spent, then enters the
// customer's 4-digit code to mark it delivered.

import { useState } from 'react';
import { Loader2, PackageCheck } from 'lucide-react';

interface Props {
  budget: number;
  savedCost: number | null;
  savedNote: string | null;
  busy: boolean;
  onSaveReceipt: (cost: number, note: string) => Promise<boolean>;
  onDeliver: (code: string) => Promise<boolean>;
}

const naira = (n: number) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const inputCls =
  'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500';

export default function DeliveryFlow({ budget, savedCost, savedNote, busy, onSaveReceipt, onDeliver }: Props) {
  const [cost, setCost] = useState(savedCost != null ? String(savedCost) : '');
  const [note, setNote] = useState(savedNote || '');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  const needsReceipt = budget > 0;
  const saved = savedCost != null;
  const costNum = Number(cost.replace(/,/g, ''));
  const canDeliver = code.length === 4 && (!needsReceipt || saved) && !busy;

  const save = async () => {
    if (!Number.isFinite(costNum) || cost.trim() === '' || costNum < 0) return;
    setSaving(true);
    await onSaveReceipt(costNum, note);
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      {needsReceipt && (
        <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 space-y-2.5">
          <p className="text-xs font-medium text-slate-300">
            What did you spend on the items? <span className="text-slate-500">(customer gave {naira(budget)})</span>
          </p>
          <input
            inputMode="numeric"
            value={cost}
            onChange={(e) => setCost(e.target.value.replace(/[^\d,]/g, ''))}
            placeholder="Amount spent (₦)"
            className={inputCls}
          />
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note, e.g. tomatoes were ₦500 more (optional)" className={inputCls} />
          <button
            onClick={save}
            disabled={saving || cost.trim() === ''}
            className="w-full py-2.5 rounded-lg text-xs font-bold border border-slate-600 hover:border-emerald-500/50 hover:text-emerald-400 text-slate-200 disabled:opacity-40 transition"
          >
            {saving ? 'Saving...' : saved ? 'Update receipt' : 'Save receipt'}
          </button>
          {saved && <p className="text-[11px] text-emerald-400">Saved: {naira(Number(savedCost))}. The customer can see this.</p>}
        </div>
      )}

      <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 space-y-2.5">
        <p className="text-xs font-medium text-slate-300">Ask the customer for their 4-digit delivery code</p>
        <input
          inputMode="numeric"
          maxLength={4}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="0000"
          className={`${inputCls} text-center text-lg tracking-[0.5em] font-bold`}
        />
        <button
          onClick={async () => {
            if (await onDeliver(code)) setCode('');
          }}
          disabled={!canDeliver}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 transition"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
          Mark as delivered
        </button>
        {needsReceipt && !saved && <p className="text-[11px] text-amber-400">Save your receipt first.</p>}
      </div>
    </div>
  );
}