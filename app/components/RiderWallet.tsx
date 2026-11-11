'use client';

// app/components/RiderWallet.tsx  (shown under the Earnings tab)
import { useEffect, useState, useCallback } from 'react';
import { Landmark } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface Wallet {
  earned: number; paid: number; pending: number; available: number;
  bank: { bank_name: string | null; account_name: string | null; account_number: string | null };
  payouts: { id: string; amount: number; status: string; requested_at: string; note: string | null }[];
}

const naira = (n: number) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const inputCls = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500';
const BADGE: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  paid: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  rejected: 'bg-slate-800 text-slate-400 border-slate-700',
};
const MSG: Record<string, string> = {
  no_bank: 'Save your bank details first.',
  too_small: 'The minimum withdrawal is ₦1,000.',
  pending_exists: 'You already have a withdrawal waiting to be paid.',
  insufficient: 'That is more than your available balance.',
};

export default function RiderWallet({ toast, refreshKey }: { toast: (t: string, ok?: boolean) => void; refreshKey: number }) {
  const [w, setW] = useState<Wallet | null>(null);
  const [bank, setBank] = useState({ bank_name: '', account_name: '', account_number: '' });
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('rider_wallet');
    if (!data) return;
    setW(data as Wallet);
    setBank((b) => (b.bank_name || b.account_number ? b : {
      bank_name: data.bank?.bank_name || '', account_name: data.bank?.account_name || '', account_number: data.bank?.account_number || '',
    }));
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const saveBank = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('rider_save_bank', { p_bank: bank.bank_name, p_name: bank.account_name, p_number: bank.account_number });
    setBusy(false);
    if (error) return toast(error.message.replace(/^.*?:\s*/, '') || 'Could not save bank details.', false);
    toast('Bank details saved');
    load();
  };

  const withdraw = async () => {
    const n = Number(amount.replace(/,/g, ''));
    if (!n) return toast('Enter an amount.', false);
    setBusy(true);
    const { data, error } = await supabase.rpc('rider_request_payout', { p_amount: n });
    setBusy(false);
    if (error || data !== 'requested') return toast(MSG[data as string] || 'Could not request the withdrawal.', false);
    setAmount('');
    toast('Withdrawal requested. Velrenta will pay it to your account.');
    load();
  };

  if (!w) return <div className="h-32 rounded-xl bg-slate-900 border border-slate-800 animate-pulse" />;
  const hasBank = !!w.bank?.account_number;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4">
      <div className="flex items-center gap-2"><Landmark className="w-4 h-4 text-emerald-400" /><h2 className="text-sm font-bold text-white">Wallet</h2></div>

      <div className="grid grid-cols-3 gap-2.5">
        {[['Available', w.available, 'text-emerald-400'], ['Pending', w.pending, 'text-amber-400'], ['Paid out', w.paid, 'text-white']].map(([l, v, c]) => (
          <div key={l as string} className="rounded-lg bg-slate-950/50 border border-slate-800 px-3 py-2.5">
            <p className="text-[11px] text-slate-500">{l}</p>
            <p className={`text-base font-bold mt-0.5 ${c}`}>{naira(v as number)}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d,]/g, ''))} placeholder="Amount (min ₦1,000)" className={inputCls} />
        <button onClick={withdraw} disabled={busy || !hasBank} className="shrink-0 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold px-4 rounded-lg text-xs transition">Withdraw</button>
      </div>
      {!hasBank && <p className="text-[11px] text-amber-400 -mt-2">Add your bank details below to withdraw.</p>}

      <div className="space-y-2.5 pt-3 border-t border-slate-800">
        <p className="text-xs font-medium text-slate-300">Bank account</p>
        <input value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} placeholder="Bank name, e.g. GTBank" className={inputCls} />
        <input value={bank.account_name} onChange={(e) => setBank({ ...bank, account_name: e.target.value })} placeholder="Account name" className={inputCls} />
        <input inputMode="numeric" maxLength={10} value={bank.account_number} onChange={(e) => setBank({ ...bank, account_number: e.target.value.replace(/\D/g, '') })} placeholder="10-digit account number" className={inputCls} />
        <button onClick={saveBank} disabled={busy} className="w-full py-2.5 rounded-lg text-xs font-bold border border-slate-600 hover:border-emerald-500/50 hover:text-emerald-400 text-slate-200 disabled:opacity-40 transition">Save bank details</button>
      </div>

      {w.payouts.length > 0 && (
        <ul className="divide-y divide-slate-800/70 pt-1">
          {w.payouts.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2.5 text-xs">
              <span className="text-slate-300">{naira(p.amount)} <span className="text-slate-500">· {new Date(p.requested_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</span></span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border capitalize ${BADGE[p.status] || BADGE.pending}`}>{p.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}