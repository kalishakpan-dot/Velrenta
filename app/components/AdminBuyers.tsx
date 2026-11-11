'use client';

// app/components/AdminBuyers.tsx  (the "Buyers" view of the admin console)
import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';

interface B {
  id: string; contact_name: string | null; company_name: string | null; email: string | null; phone: string | null;
  city: string | null; country: string | null; verification_status: string | null; created_at: string;
  roles: string[]; orders: number; order_value: number; rfqs: number; errands: number; last_sign_in: string | null; banned: boolean;
}

type Kind = 'buyer' | 'rider' | 'supplier' | 'admin' | 'all';
const naira = (n: number) => '₦' + Number(n || 0).toLocaleString('en-NG');
const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const ago = (iso?: string | null) => {
  if (!iso) return 'Never';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return m + ' min ago';
  if (m < 1440) return Math.floor(m / 60) + ' hr ago';
  return date(iso);
};
const STATUS: Record<string, string> = {
  verified: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  unverified: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  suspended: 'bg-red-500/10 text-red-400 border-red-500/30',
};
const ROLE: Record<string, string> = {
  rider: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  supplier: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  admin: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
};
const inputCls = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500';
const btn = 'text-xs font-bold rounded-lg px-3 py-1.5 border border-slate-700 text-slate-300 transition disabled:opacity-50';

export default function AdminBuyers({ getToken, toast }: { getToken: () => Promise<string>; toast: (t: string, tone?: 'ok' | 'err') => void }) {
  const [rows, setRows] = useState<B[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>('buyer');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<(B & { email: string }) | null>(null);
  const [del, setDel] = useState<B | null>(null);
  const [alsoLogin, setAlsoLogin] = useState(false);

  const call = useCallback(async (method: 'GET' | 'POST', body?: object) => {
    const res = await fetch('/api/admin/buyers', {
      method, cache: 'no-store', body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: 'Bearer ' + (await getToken()), 'Content-Type': 'application/json' },
    });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  }, [getToken]);

  const load = useCallback(async () => {
    const { ok, json } = await call('GET');
    if (ok) setRows(json.buyers); else toast(json.error || 'Could not load buyers.', 'err');
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

  const st = (b: B) => b.verification_status || 'unverified';
  const inKind = (b: B, k: Kind) => (k === 'all' ? true : k === 'buyer' ? b.roles.length === 0 : b.roles.includes(k));
  const kindCount = (k: Kind) => rows.filter((b) => inKind(b, k)).length;
  const customers = rows.filter((b) => b.roles.length === 0);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((b) => inKind(b, kind) && (status === 'all' || st(b) === status) &&
      (!t || [b.contact_name, b.company_name, b.email, b.phone, b.city].some((v) => (v || '').toLowerCase().includes(t))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, kind, status, q]);

  const strip: [string, number, string][] = [
    ['Buyers', customers.length, 'text-white'],
    ['Verified', customers.filter((b) => st(b) === 'verified').length, 'text-emerald-400'],
    ['Unverified', customers.filter((b) => st(b) === 'unverified').length, 'text-amber-400'],
    ['Suspended', customers.filter((b) => st(b) === 'suspended').length, 'text-red-400'],
  ];

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Buyers</h1>
          <p className="text-slate-400 text-sm mt-1">Customers who order on Velrenta. Riders, suppliers and admins are labelled and kept out of the default list.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 border border-slate-700 text-slate-300 px-3 py-2 rounded-lg text-xs font-semibold"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 rounded-xl border border-slate-800 bg-slate-900 mb-5 overflow-hidden">
        {strip.map(([l, v, c], i) => (
          <div key={l} className={'px-4 py-4 md:px-5 border-slate-800 ' + (i % 2 ? 'border-l ' : '') + (i > 1 ? 'border-t lg:border-t-0 ' : '') + (i > 0 ? 'lg:border-l' : '')}>
            <p className="text-xs text-slate-400">{l}</p>
            <p className={'text-xl md:text-2xl font-bold mt-1.5 ' + c}>{loading ? '–' : v}</p>
          </div>
        ))}
      </section>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="relative w-full lg:max-w-xs">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, email, phone or city" aria-label="Search buyers"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
        </div>
        <div className="flex gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto lg:ml-auto">
          {(['buyer', 'rider', 'supplier', 'admin', 'all'] as Kind[]).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={'px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ' + (kind === k ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-200')}>
              {k === 'buyer' ? 'Buyers' : k === 'all' ? 'Everyone' : k[0].toUpperCase() + k.slice(1) + 's'} <span className="opacity-60">{kindCount(k)}</span>
            </button>
          ))}
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-300 focus:outline-none">
          <option value="all">Any status</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="suspended">Suspended</option>
        </select>
      </div>

      {loading ? <div className="h-28 rounded-xl bg-slate-900 animate-pulse" /> : list.length === 0 ? (
        <div className="bg-slate-900 rounded-xl border border-dashed border-slate-800 p-10 text-center"><p className="text-sm text-slate-300">No accounts found</p><p className="text-xs text-slate-500 mt-1">Try a different search or filter.</p></div>
      ) : (
        <div className="space-y-3">
          {list.map((b) => {
            const s = st(b);
            const key = b.id;
            return (
              <article key={b.id} className="rounded-xl border border-slate-800 bg-slate-900">
                <div className="flex items-start gap-3 px-5 pt-4">
                  <div className="h-10 w-10 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center font-bold text-sm text-emerald-400 shrink-0">{(b.contact_name || b.email || 'B')[0].toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-white truncate">{b.contact_name || 'Unnamed buyer'}</p>
                      <span className={'px-2.5 py-0.5 rounded-full text-[11px] font-semibold border capitalize ' + (STATUS[s] || STATUS.unverified)}>{s}</span>
                      {b.roles.map((r) => <span key={r} className={'px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ' + ROLE[r]}>{r}</span>)}
                      {b.banned && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-red-500/10 text-red-400 border-red-500/30">Login blocked</span>}
                    </div>
                    <p className="text-xs text-slate-400 truncate mt-0.5">{b.email || 'No email'} · {b.phone || 'No phone'}</p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-5 gap-y-3 px-5 py-4 text-xs">
                  {([['Company', b.company_name || '—'], ['City', [b.city, b.country].filter(Boolean).join(', ') || '—'], ['Orders', b.orders + ' · ' + naira(b.order_value)],
                    ['RFQs', String(b.rfqs)], ['Rider errands', String(b.errands)], ['Last sign-in', ago(b.last_sign_in)], ['Joined', date(b.created_at)]] as [string, string][]).map(([l, v]) => (
                    <div key={l} className="min-w-0"><dt className="text-[11px] text-slate-500">{l}</dt><dd className="text-slate-300 mt-0.5 truncate">{v}</dd></div>
                  ))}
                </dl>

                {b.roles.length > 0 && (
                  <p className="mx-5 mb-4 text-[11px] text-slate-400 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
                    This login is also {b.roles.map((r) => 'a ' + r).join(' and ')}. It signed in to the buyer app once, which created this profile. You can remove the buyer profile without touching the {b.roles[0]} account.
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-slate-800 bg-slate-950/20">
                  <label className="flex items-center gap-2 text-xs text-slate-500">Status
                    <select value={s} disabled={busy === key} onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'suspended' && !window.confirm('Suspend this buyer? ' + (b.roles.length ? 'Their other logins keep working.' : 'They will be signed out and blocked.'))) return;
                      act(key, { action: 'set_status', id: b.id, status: v }, 'Status set to ' + v);
                    }} className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 capitalize focus:outline-none">
                      <option value="verified">verified</option><option value="unverified">unverified</option><option value="suspended">suspended</option>
                    </select>
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    <button className={btn} onClick={() => setEdit({ ...b, email: b.email || '' })}>Edit</button>
                    <button className={btn} disabled={busy === key} onClick={() => { const p = window.prompt('New password for ' + (b.email || 'this buyer') + ' (min 8 characters)'); if (p) act(key, { action: 'set_password', id: b.id, password: p }, 'Password updated'); }}>Reset password</button>
                    <button className={btn + ' hover:text-red-400 hover:border-red-500/40'} onClick={() => { setAlsoLogin(false); setDel(b); }}>Delete</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEdit(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between"><h2 className="text-base font-bold text-white">Edit buyer</h2><button onClick={() => setEdit(null)} aria-label="Close" className="text-slate-500 p-1"><X className="w-4 h-4" /></button></div>
            <div className="space-y-3 mt-4">
              {([['contact_name', 'Contact name'], ['company_name', 'Company'], ['email', 'Email (also their login)'], ['phone', 'Phone, e.g. 0803 123 4567'], ['city', 'City'], ['country', 'Country']] as [keyof B, string][]).map(([f, ph]) => (
                <input key={f} className={inputCls} placeholder={ph} value={(edit[f] as string) || ''} onChange={(e) => setEdit({ ...edit, [f]: e.target.value })} />
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEdit(null)} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancel</button>
              <button disabled={busy === edit.id} onClick={async () => { if (await act(edit.id, { action: 'update', ...edit }, 'Buyer updated')) setEdit(null); }} className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950">{busy === edit.id ? 'Saving...' : 'Save changes'}</button>
            </div>
          </div>
        </div>
      )}

      {del && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDel(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-white">Delete {del.contact_name || del.email}?</h2>
            <p className="text-xs text-slate-400 mt-2">
              {del.roles.length ? 'Only the buyer profile is removed. Their ' + del.roles.join(' and ') + ' login stays and keeps working.' : 'This removes the buyer profile. It cannot be undone.'}
              {' '}If they have orders, requests or errands on record, deleting is blocked: suspend them instead.
            </p>
            {del.roles.length === 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-300 mt-3"><input type="checkbox" checked={alsoLogin} onChange={(e) => setAlsoLogin(e.target.checked)} /> Also delete their login (they can no longer sign in)</label>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setDel(null)} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancel</button>
              <button disabled={busy === del.id} onClick={async () => { if (await act(del.id, { action: 'delete', id: del.id, delete_login: alsoLogin }, 'Buyer deleted')) setDel(null); }} className="px-4 py-2 rounded-lg text-xs font-bold bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white">{busy === del.id ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}