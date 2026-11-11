'use client';

// app/components/AdminRiders.tsx  (the "Riders" view of the admin console)
import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';

interface R {
  id: string; user_id: string | null; full_name: string; phone: string | null; email: string | null;
  vehicle_type: string; plate_number: string | null; area: string | null; is_online: boolean;
  is_verified: boolean; suspended: boolean; rating: number; review_count: number; total_errands: number;
  bank_name: string | null; account_number: string | null;
}
interface P { id: string; rider_id: string; amount: number; status: string; bank_name: string | null; account_name: string | null; account_number: string | null; requested_at: string }

const naira = (n: number) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const inputCls = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500';
const btn = 'text-xs font-bold rounded-lg px-3 py-1.5 transition disabled:opacity-50';
const EMPTY = { full_name: '', email: '', phone: '', password: '', vehicle_type: 'bike', plate_number: '', area: '' };

export default function AdminRiders({ getToken, toast }: { getToken: () => Promise<string>; toast: (t: string, tone?: 'ok' | 'err') => void }) {
  const [riders, setRiders] = useState<R[]>([]);
  const [payouts, setPayouts] = useState<P[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [del, setDel] = useState<R | null>(null);
  const [alsoLogin, setAlsoLogin] = useState(true);

  const call = useCallback(async (method: 'GET' | 'POST', body?: object) => {
    const res = await fetch('/api/admin/riders', {
      method, cache: 'no-store', body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: 'Bearer ' + (await getToken()), 'Content-Type': 'application/json' },
    });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  }, [getToken]);

  const load = useCallback(async () => {
    const { ok, json } = await call('GET');
    if (ok) { setRiders(json.riders); setPayouts(json.payouts); } else toast(json.error || 'Could not load riders.', 'err');
    setLoading(false);
  }, [call, toast]);
  useEffect(() => { load(); }, [load]);

  const act = async (key: string, body: object, msg: string) => {
    setBusy(key);
    const { ok, json } = await call('POST', body);
    setBusy(null);
    if (!ok) { toast(json.error || 'That did not work.', 'err'); return false; }
    toast(msg); load(); return true;
  };

  const remove = async (force = false): Promise<void> => {
    if (!del) return;
    setBusy('del');
    const { ok, json } = await call('POST', { action: 'delete', id: del.id, delete_login: alsoLogin, force });
    setBusy(null);
    if (!ok && json.needs_force) {
      if (window.confirm(json.error + '\n\nDelete anyway?')) return remove(true);
      return;
    }
    if (!ok) return toast(json.error || 'Could not delete the rider.', 'err');
    toast(json.login_kept ? 'Rider deleted. Their login was kept because it is used elsewhere.' : 'Rider deleted');
    setDel(null);
    load();
  };

  const name = (id: string) => riders.find((r) => r.id === id)?.full_name || 'Rider';
  const pending = payouts.filter((p) => p.status === 'pending');

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Riders</h1>
          <p className="text-slate-400 text-sm mt-1">Add riders, verify or suspend them, and pay out withdrawals.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setForm(EMPTY); setOpen(true); }} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-3.5 py-2 rounded-lg text-xs transition"><Plus className="w-3.5 h-3.5" /> Add rider</button>
          <button onClick={load} aria-label="Refresh" className="flex items-center gap-2 border border-slate-700 text-slate-300 px-3 py-2 rounded-lg text-xs font-semibold"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
        </div>
      </header>

      {pending.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 mb-5">
          <h2 className="px-4 py-3 text-sm font-bold text-amber-300 border-b border-amber-500/20">Withdrawals to pay ({pending.length})</h2>
          <ul className="divide-y divide-slate-800/70">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 flex-wrap px-4 py-3">
                <div className="min-w-0 text-xs">
                  <p className="text-sm text-white"><b>{naira(p.amount)}</b> to {name(p.rider_id)}</p>
                  <p className="text-slate-400 mt-0.5">{p.bank_name} · {p.account_name} · <span className="font-mono text-slate-200">{p.account_number}</span></p>
                </div>
                <div className="flex gap-2">
                  <button disabled={!!busy} onClick={() => act('p' + p.id, { action: 'payout', id: p.id, status: 'rejected' }, 'Withdrawal rejected')} className={`${btn} border border-slate-700 text-slate-300 hover:text-red-400`}>Reject</button>
                  <button disabled={!!busy} onClick={() => window.confirm('Confirm you have transferred ' + naira(p.amount) + ' to this account?') && act('p' + p.id, { action: 'payout', id: p.id, status: 'paid' }, 'Marked as paid')} className={`${btn} bg-emerald-500 hover:bg-emerald-400 text-slate-950`}>Mark paid</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading ? <div className="h-24 rounded-xl bg-slate-900 animate-pulse" /> : riders.length === 0 ? (
        <div className="bg-slate-900 rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-300">No riders yet. Use Add rider.</div>
      ) : (
        <div className="space-y-3">
          {riders.map((r) => {
            const state = r.suspended ? ['Suspended', 'bg-red-500/10 text-red-400 border-red-500/30'] : r.is_verified ? ['Verified', 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'] : ['Unverified', 'bg-amber-500/10 text-amber-400 border-amber-500/30'];
            return (
              <article key={r.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-white">{r.full_name}</p>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${state[1]}`}>{state[0]}</span>
                  {r.is_online && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-sky-500/10 text-sky-300 border-sky-500/30">Online</span>}
                  {!r.user_id && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-slate-800 text-slate-400 border-slate-700">No login</span>}
                </div>
                <p className="text-xs text-slate-400 mt-1">{r.email || 'No email'} · {r.phone || 'No phone'}</p>
                <p className="text-xs text-slate-500 mt-1">{r.vehicle_type} · {r.plate_number || 'no plate'} · {r.area || 'no area'} · ★ {Number(r.rating).toFixed(1)} ({r.review_count} reviews) · {r.total_errands} errands · {r.account_number ? 'bank saved' : 'no bank'}</p>
                <div className="flex gap-2 flex-wrap mt-3">
                  {!r.suspended && <button disabled={!!busy} onClick={() => act(r.id, { action: 'set_verified', id: r.id, verified: !r.is_verified }, r.is_verified ? 'Rider unverified' : 'Rider verified')} className={`${btn} ${r.is_verified ? 'border border-slate-700 text-slate-300' : 'bg-emerald-500 text-slate-950'}`}>{r.is_verified ? 'Unverify' : 'Verify'}</button>}
                  <button disabled={!!busy} onClick={() => (r.suspended || window.confirm('Suspend ' + r.full_name + '? They are signed out and removed from dispatch.')) && act(r.id, { action: 'set_suspended', id: r.id, suspended: !r.suspended }, r.suspended ? 'Rider reinstated' : 'Rider suspended')} className={`${btn} border border-slate-700 text-slate-300 hover:text-red-400`}>{r.suspended ? 'Reinstate' : 'Suspend'}</button>
                  {r.user_id && <button disabled={!!busy} onClick={() => { const p = window.prompt('New password for ' + r.full_name + ' (min 8 characters)'); if (p) act(r.id, { action: 'set_password', id: r.id, password: p }, 'Password updated'); }} className={`${btn} border border-slate-700 text-slate-300`}>Reset password</button>}
                  <button disabled={!!busy} onClick={() => { setAlsoLogin(!!r.user_id); setDel(r); }} className={`${btn} border border-slate-700 text-slate-300 hover:text-red-400 hover:border-red-500/40`}>Delete</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {del && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDel(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-white">Delete {del.full_name}?</h2>
            <p className="text-xs text-slate-400 mt-2">The rider is removed from dispatch and can no longer receive errands. This cannot be undone. A rider with an errand in progress or a pending withdrawal cannot be deleted.</p>
            {del.user_id && (
              <label className="flex items-center gap-2 text-xs text-slate-300 mt-3"><input type="checkbox" checked={alsoLogin} onChange={(e) => setAlsoLogin(e.target.checked)} /> Also delete their login</label>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setDel(null)} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancel</button>
              <button disabled={busy === 'del'} onClick={() => remove()} className="px-4 py-2 rounded-lg text-xs font-bold bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white">{busy === 'del' ? 'Deleting...' : 'Delete rider'}</button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between"><h2 className="text-base font-bold text-white">Add rider</h2><button onClick={() => setOpen(false)} aria-label="Close" className="text-slate-500 p-1"><X className="w-4 h-4" /></button></div>
            <p className="text-xs text-slate-400 mt-1">Creates the login and verifies the rider. Give them these details to sign in at /rider/login.</p>
            <div className="space-y-3 mt-4">
              <input className={inputCls} placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              <input className={inputCls} placeholder="Email (their login)" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className={inputCls} placeholder="Phone, e.g. 0803 123 4567" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input className={inputCls} placeholder="Temporary password (min 8 characters)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <select className={inputCls} value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}>
                <option value="bike">Motorbike</option><option value="tricycle">Keke</option><option value="car">Car</option><option value="van">Van</option>
              </select>
              <input className={inputCls} placeholder="Plate number" value={form.plate_number} onChange={(e) => setForm({ ...form, plate_number: e.target.value })} />
              <input className={inputCls} placeholder="Area, e.g. Rumuola" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancel</button>
              <button disabled={busy === 'create'} onClick={async () => { if (await act('create', { action: 'create', ...form }, 'Rider created and verified')) setOpen(false); }} className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950">{busy === 'create' ? 'Creating...' : 'Create rider'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}