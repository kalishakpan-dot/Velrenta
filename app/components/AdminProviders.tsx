'use client';

// app/components/AdminProviders.tsx  (the "My Plug" / Sharp Sharp view of the admin console)
// Providers: add, edit, verify, suspend, delete, manage their services, reset password, message them.
// Requests: see every request and cancel or release it.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, RefreshCw, X, Search, MessageSquare, Send, Trash2 } from 'lucide-react';

/* ---------- Types ---------- */

interface Prov {
  id: string;
  user_id: string | null;
  email: string | null;
  display_name: string;
  provider_type: string;
  phone: string | null;
  city: string;
  area: string | null;
  bio: string | null;
  is_online: boolean;
  is_verified: boolean;
  suspended?: boolean | null;
  rating: number | string | null;
  review_count: number | null;
  completed_jobs: number | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  service_areas: string[] | null;
  typical_arrival_minutes: number | null;
  offers_emergency: boolean | null;
  years_experience: number | null;
}

interface Svc {
  id: string;
  provider_id: string;
  category_id: string;
  title: string;
  price_from: number | null;
  price_unit: string | null;
  active: boolean;
}

interface Cat {
  id: string;
  name: string;
}

interface Contact {
  contact_name: string | null;
  contact_phone: string | null;
}

interface Req {
  id: string;
  category_id: string;
  provider_id: string | null;
  buyer_name: string | null;
  description: string;
  city: string;
  address: string | null;
  budget: number | null;
  status: string;
  created_at: string;
  service_categories: { name: string } | null;
  service_request_contacts: Contact | Contact[] | null;
}

interface Thread {
  last: string;
  last_at: string;
  last_role: string;
  unread: number;
}

interface Msg {
  id: string;
  sender_role: 'admin' | 'provider';
  body: string;
  created_at: string;
}

type Call = (method: 'GET' | 'POST', body?: object, query?: string) => Promise<{ ok: boolean; json: any }>;
type Act = (key: string, body: object, msg: string) => Promise<boolean>;

/* ---------- Constants and helpers ---------- */

const CITIES = ['Uyo', 'Port Harcourt', 'Lagos', 'Abuja', 'Calabar', 'Enugu'];
const ARRIVAL: [string, string][] = [
  ['', 'Not sure'],
  ['15', '15 minutes'],
  ['30', '30 minutes'],
  ['45', '45 minutes'],
  ['60', '1 hour'],
  ['120', '2 hours'],
  ['240', '4 hours'],
  ['1440', 'Same day'],
];

const EMPTY_FORM = {
  display_name: '',
  provider_type: 'individual',
  phone: '',
  city: 'Uyo',
  area: '',
  bio: '',
  service_areas: '',
  typical_arrival_minutes: '',
  offers_emergency: false,
  years_experience: '',
  bank_name: '',
  account_name: '',
  account_number: '',
  email: '',
  password: '',
  category_id: '',
  service_title: '',
  price_from: '',
  price_unit: 'job',
};
type Form = typeof EMPTY_FORM;

const naira = (n: number | null | undefined) => (n == null ? '' : `\u20A6${Number(n).toLocaleString('en-NG')}`);
const inputCls =
  'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500';
const btn = 'text-xs font-bold rounded-lg px-3 py-1.5 transition disabled:opacity-50';
const ghost = `${btn} border border-slate-700 text-slate-300 hover:border-slate-500`;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const stateOf = (p: Prov) => (p.suspended ? 'suspended' : p.is_verified ? 'verified' : 'unverified');
const STATE_BADGE: Record<string, string> = {
  verified: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  unverified: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  suspended: 'bg-red-500/10 text-red-400 border-red-500/30',
};
const STATE_EDGE: Record<string, string> = {
  verified: 'before:bg-emerald-500/60',
  unverified: 'before:bg-amber-400',
  suspended: 'before:bg-red-500/60',
};

const REQ_BADGE: Record<string, string> = {
  open: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  requested: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  accepted: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  in_progress: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  cancelled: 'bg-slate-800 text-slate-400 border-slate-700',
  declined: 'bg-slate-800 text-slate-400 border-slate-700',
};
const ACTIVE_REQ = ['open', 'requested', 'accepted', 'in_progress'];

function Pill<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (k: T) => void;
}) {
  return (
    <div className="flex gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto min-w-0">
      {items.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
            value === t.key ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          {t.label}
          {t.count !== undefined && <span className={`ml-1.5 ${value === t.key ? 'text-slate-600' : 'text-slate-500'}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Main view ---------- */

export default function AdminProviders({
  getToken,
  toast,
}: {
  getToken: () => Promise<string>;
  toast: (t: string, tone?: 'ok' | 'err') => void;
}) {
  const [provs, setProvs] = useState<Prov[]>([]);
  const [svcs, setSvcs] = useState<Svc[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [msgsReady, setMsgsReady] = useState(true);
  const [suspendReady, setSuspendReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [view, setView] = useState<'providers' | 'requests'>('providers');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [reqFilter, setReqFilter] = useState('active');
  const [openSvc, setOpenSvc] = useState<string | null>(null);

  const [formFor, setFormFor] = useState<'create' | Prov | null>(null);
  const [loginFor, setLoginFor] = useState<{ p: Prov; mode: 'create' | 'password' } | null>(null);
  const [delFor, setDelFor] = useState<Prov | null>(null);
  const [alsoLogin, setAlsoLogin] = useState(true);
  const [chatFor, setChatFor] = useState<Prov | null>(null);

  // The parent re-creates getToken on every render, so keep the latest one in a ref.
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;

  const call: Call = useCallback(async (method, body, query = '') => {
    const res = await fetch('/api/admin/providers' + query, {
      method,
      cache: 'no-store',
      body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: 'Bearer ' + (await tokenRef.current()), 'Content-Type': 'application/json' },
    });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  }, []);

  const load = useCallback(async () => {
    const { ok, json } = await call('GET');
    if (ok) {
      setProvs(json.providers || []);
      setSvcs(json.services || []);
      setCats(json.categories || []);
      setReqs(json.requests || []);
      setThreads(json.threads || {});
      setMsgsReady(json.messagesReady !== false);
      setSuspendReady(json.suspendReady !== false);
    } else toast(json.error || 'Could not load providers.', 'err');
    setLoading(false);
  }, [call, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const act: Act = async (key, body, msg) => {
    setBusy(key);
    const { ok, json } = await call('POST', body);
    setBusy(null);
    if (!ok) {
      toast(json.error || 'That did not work.', 'err');
      return false;
    }
    toast(json.warning || msg, json.warning ? 'err' : 'ok');
    load();
    return true;
  };

  const remove = async (force = false): Promise<void> => {
    if (!delFor) return;
    setBusy('del');
    const { ok, json } = await call('POST', { action: 'delete', id: delFor.id, delete_login: alsoLogin, force });
    setBusy(null);
    if (!ok && json.needs_force) {
      if (window.confirm(json.error + '\n\nDelete anyway?')) return remove(true);
      return;
    }
    if (!ok) return toast(json.error || 'Could not delete the provider.', 'err');
    toast(json.login_kept ? 'Provider deleted. Their login was kept because it is used elsewhere.' : 'Provider deleted');
    setDelFor(null);
    load();
  };

  const svcBy = useMemo(() => {
    const m: Record<string, Svc[]> = {};
    svcs.forEach((s) => (m[s.provider_id] ||= []).push(s));
    return m;
  }, [svcs]);
  const provName = (id: string | null) => (id ? provs.find((p) => p.id === id)?.display_name : null) || null;
  const catName = (id: string) => cats.find((c) => c.id === id)?.name || id;

  const count = (k: string) => (k === 'all' ? provs.length : provs.filter((p) => stateOf(p) === k).length);
  const q = search.trim().toLowerCase();
  const shown = provs.filter(
    (p) =>
      (filter === 'all' || stateOf(p) === filter) &&
      (!q || [p.display_name, p.email, p.phone, p.city, p.area].some((v) => (v || '').toLowerCase().includes(q)))
  );

  const activeReqs = reqs.filter((r) => ACTIVE_REQ.includes(r.status));
  const shownReqs = reqs.filter((r) => {
    if (reqFilter === 'active') return ACTIVE_REQ.includes(r.status);
    if (reqFilter === 'all') return true;
    if (reqFilter === 'closed') return ['cancelled', 'declined'].includes(r.status);
    return r.status === reqFilter;
  });
  const unreadTotal = Object.values(threads).reduce((t, x) => t + x.unread, 0);

  const summary = [
    { label: 'Providers', value: String(provs.length), tone: 'text-white' },
    { label: 'Online now', value: String(provs.filter((p) => p.is_online).length), tone: 'text-emerald-400' },
    { label: 'Awaiting verification', value: String(count('unverified')), tone: count('unverified') ? 'text-amber-400' : 'text-white' },
    { label: 'Active requests', value: String(activeReqs.length), tone: activeReqs.length ? 'text-sky-300' : 'text-white' },
  ];

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">My Plug</h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage Sharp Sharp providers, their services and requests, and message them directly.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => setFormFor('create')}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-3.5 py-2 rounded-lg text-xs transition"
          >
            <Plus className="w-3.5 h-3.5" /> Add provider
          </button>
          <button
            onClick={load}
            aria-label="Refresh"
            className="flex items-center gap-2 border border-slate-700 hover:border-slate-500 text-slate-300 px-3 py-2 rounded-lg text-xs font-semibold transition"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </header>

      {(!msgsReady || !suspendReady) && (
        <div className="mb-5 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs rounded-xl px-4 py-3">
          {!msgsReady && 'Messaging is not set up yet. '}
          {!suspendReady && 'Suspending providers is not set up yet. '}
          Run <span className="font-mono">admin-providers-setup.sql</span> in the Supabase SQL Editor, then refresh.
        </div>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 rounded-xl border border-slate-800 bg-slate-900 mb-5 overflow-hidden">
        {summary.map((it, i) => (
          <div
            key={it.label}
            className={`px-4 py-4 md:px-5 min-w-0 border-slate-800 ${i % 2 === 1 ? 'border-l' : ''} ${i > 1 ? 'border-t lg:border-t-0' : ''} ${i > 0 ? 'lg:border-l' : ''}`}
          >
            <p className="text-xs text-slate-400 truncate">{it.label}</p>
            {loading ? (
              <div className="h-7 w-14 mt-2 rounded-md bg-slate-800 animate-pulse" />
            ) : (
              <p className={`text-xl md:text-2xl font-bold mt-1.5 truncate ${it.tone}`}>{it.value}</p>
            )}
          </div>
        ))}
      </section>

      <div className="mb-4">
        <Pill
          items={[
            { key: 'providers', label: 'Providers', count: provs.length },
            { key: 'requests', label: 'Requests', count: activeReqs.length },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      {/* ───────────── Providers ───────────── */}
      {view === 'providers' && (
        <>
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
            <div className="relative w-full lg:max-w-xs shrink-0">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                aria-label="Search providers"
                placeholder="Search name, email, phone or city"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-10 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
              />
              {search && (
                <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-200">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="lg:ml-auto min-w-0">
              <Pill
                items={[
                  { key: 'all', label: 'All', count: count('all') },
                  { key: 'unverified', label: 'Unverified', count: count('unverified') },
                  { key: 'verified', label: 'Verified', count: count('verified') },
                  { key: 'suspended', label: 'Suspended', count: count('suspended') },
                ]}
                value={filter}
                onChange={setFilter}
              />
            </div>
          </div>

          {loading ? (
            <div className="h-24 rounded-xl bg-slate-900 animate-pulse" />
          ) : shown.length === 0 ? (
            <div className="bg-slate-900 rounded-xl border border-dashed border-slate-800 p-10 text-center">
              <p className="text-sm text-slate-300">{provs.length === 0 ? 'No providers yet' : 'No providers found'}</p>
              <p className="text-xs text-slate-500 mt-1">{provs.length === 0 ? 'Use Add provider to create the first one.' : 'Try a different search or filter.'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {shown.map((p) => {
                const st = stateOf(p);
                const mine = svcBy[p.id] || [];
                const th = threads[p.id];
                const jobs = reqs.filter((r) => r.provider_id === p.id && ACTIVE_REQ.includes(r.status)).length;
                return (
                  <article
                    key={p.id}
                    className={`relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${STATE_EDGE[st]}`}
                  >
                    <div className="flex items-start gap-3 px-5 md:px-6 pt-4 md:pt-5">
                      <div className="h-10 w-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center font-bold text-sm text-emerald-400 shrink-0">
                        {(p.display_name || 'P')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-white truncate">{p.display_name}</p>
                          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${STATE_BADGE[st]}`}>{cap(st)}</span>
                          {p.is_online && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-sky-500/10 text-sky-300 border-sky-500/30">Online</span>}
                          {!p.user_id && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-slate-800 text-slate-400 border-slate-700">No login</span>}
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-slate-800 text-slate-400 border-slate-700">
                            {p.provider_type === 'shop' ? 'Shop' : 'Individual'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate mt-0.5">
                          {p.email || 'No email'} · {p.phone || 'No phone'}
                        </p>
                      </div>
                      <button
                        onClick={() => setChatFor(p)}
                        className={`relative shrink-0 inline-flex items-center gap-1.5 ${btn} border ${
                          th?.unread ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' : 'border-slate-700 text-slate-300 hover:border-emerald-500/50 hover:text-emerald-400'
                        }`}
                      >
                        <MessageSquare className="w-3.5 h-3.5" /> Message
                        {!!th?.unread && (
                          <span className="ml-0.5 bg-amber-500 text-slate-950 text-[10px] font-bold rounded-full h-4 min-w-4 px-1 flex items-center justify-center">{th.unread}</span>
                        )}
                      </button>
                    </div>

                    <dl className="grid grid-cols-2 sm:grid-cols-5 gap-x-6 gap-y-3 px-5 md:px-6 py-4 text-xs">
                      <div className="min-w-0"><dt className="text-[11px] text-slate-500">Location</dt><dd className="text-slate-300 mt-0.5 truncate">{[p.area, p.city].filter(Boolean).join(', ')}</dd></div>
                      <div className="min-w-0"><dt className="text-[11px] text-slate-500">Rating</dt><dd className="text-slate-300 mt-0.5">{(p.review_count || 0) > 0 ? `\u2605 ${Number(p.rating).toFixed(1)} (${p.review_count})` : 'New'}</dd></div>
                      <div className="min-w-0"><dt className="text-[11px] text-slate-500">Jobs done</dt><dd className="text-slate-300 mt-0.5">{p.completed_jobs || 0}</dd></div>
                      <div className="min-w-0"><dt className="text-[11px] text-slate-500">Active jobs</dt><dd className="text-slate-300 mt-0.5">{jobs}</dd></div>
                      <div className="min-w-0"><dt className="text-[11px] text-slate-500">Payout account</dt><dd className="text-slate-300 mt-0.5">{p.account_number ? 'Saved' : 'Not added'}</dd></div>
                    </dl>

                    {th && (
                      <p className="mx-5 md:mx-6 mb-3 text-[11px] text-slate-500 truncate">
                        {th.last_role === 'admin' ? 'You' : 'Provider'}: <span className="text-slate-400">{th.last}</span> · {when(th.last_at)}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 px-5 md:px-6 py-3 border-t border-slate-800 bg-slate-950/20">
                      {st !== 'suspended' && (
                        <button
                          disabled={!!busy}
                          onClick={() => act(p.id, { action: 'set_verified', id: p.id, verified: !p.is_verified }, p.is_verified ? 'Provider unverified' : 'Provider verified')}
                          className={`${btn} ${p.is_verified ? 'border border-slate-700 text-slate-300 hover:border-slate-500' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'}`}
                        >
                          {p.is_verified ? 'Unverify' : 'Verify'}
                        </button>
                      )}
                      <button
                        disabled={!!busy}
                        onClick={() =>
                          (st === 'suspended' || window.confirm(`Suspend ${p.display_name}? They are signed out, hidden from buyers and cannot log in until reinstated.`)) &&
                          act(p.id, { action: 'set_suspended', id: p.id, suspended: st !== 'suspended' }, st === 'suspended' ? 'Provider reinstated' : 'Provider suspended')
                        }
                        className={`${btn} border border-slate-700 text-slate-300 hover:text-red-400 hover:border-red-500/40`}
                      >
                        {st === 'suspended' ? 'Reinstate' : 'Suspend'}
                      </button>
                      <button onClick={() => setFormFor(p)} className={ghost}>Edit</button>
                      <button onClick={() => setOpenSvc(openSvc === p.id ? null : p.id)} className={ghost}>
                        Services ({mine.length}) {openSvc === p.id ? '\u25B4' : '\u25BE'}
                      </button>
                      {p.user_id ? (
                        <button onClick={() => setLoginFor({ p, mode: 'password' })} className={ghost}>Reset password</button>
                      ) : (
                        <button onClick={() => setLoginFor({ p, mode: 'create' })} className={`${btn} bg-sky-500/90 hover:bg-sky-400 text-slate-950`}>Create login</button>
                      )}
                      <button
                        disabled={!!busy}
                        onClick={() => { setAlsoLogin(!!p.user_id); setDelFor(p); }}
                        className={`${btn} ml-auto border border-slate-700 text-slate-300 hover:text-red-400 hover:border-red-500/40`}
                      >
                        Delete
                      </button>
                    </div>

                    {openSvc === p.id && <ServicesPanel provider={p} services={mine} cats={cats} act={act} busy={busy} catName={catName} />}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ───────────── Requests ───────────── */}
      {view === 'requests' && (
        <>
          <div className="mb-4 min-w-0">
            <Pill
              items={[
                { key: 'active', label: 'Active', count: activeReqs.length },
                { key: 'completed', label: 'Completed', count: reqs.filter((r) => r.status === 'completed').length },
                { key: 'closed', label: 'Cancelled or declined', count: reqs.filter((r) => ['cancelled', 'declined'].includes(r.status)).length },
                { key: 'all', label: 'All', count: reqs.length },
              ]}
              value={reqFilter}
              onChange={setReqFilter}
            />
          </div>

          {loading ? (
            <div className="h-24 rounded-xl bg-slate-900 animate-pulse" />
          ) : shownReqs.length === 0 ? (
            <div className="bg-slate-900 rounded-xl border border-dashed border-slate-800 p-10 text-center">
              <p className="text-sm text-slate-300">No requests here</p>
              <p className="text-xs text-slate-500 mt-1">Requests buyers send from My Plug show up here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {shownReqs.map((r) => {
                const c = Array.isArray(r.service_request_contacts) ? r.service_request_contacts[0] : r.service_request_contacts;
                const prov = provName(r.provider_id);
                return (
                  <article key={r.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 md:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{r.service_categories?.name || catName(r.category_id)}</p>
                        <p className="text-xs text-slate-300 mt-1 break-words whitespace-pre-line">{r.description}</p>
                      </div>
                      <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${REQ_BADGE[r.status] || REQ_BADGE.cancelled}`}>
                        {cap(r.status)}
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 mt-3 text-xs">
                      <div className="min-w-0"><dt className="text-[11px] text-slate-500">Buyer</dt><dd className="text-slate-300 mt-0.5 truncate">{c?.contact_name || r.buyer_name || '\u2014'}{c?.contact_phone ? ` \u00B7 ${c.contact_phone}` : ''}</dd></div>
                      <div className="min-w-0"><dt className="text-[11px] text-slate-500">Provider</dt><dd className="text-slate-300 mt-0.5 truncate">{prov || (r.status === 'open' ? 'Open to all' : '\u2014')}</dd></div>
                      <div className="min-w-0"><dt className="text-[11px] text-slate-500">Where</dt><dd className="text-slate-300 mt-0.5 truncate">{[r.address, r.city].filter(Boolean).join(', ')}</dd></div>
                      <div className="min-w-0"><dt className="text-[11px] text-slate-500">Sent</dt><dd className="text-slate-300 mt-0.5">{when(r.created_at)}{r.budget != null ? ` \u00B7 ${naira(r.budget)}` : ''}</dd></div>
                    </dl>
                    {ACTIVE_REQ.includes(r.status) && (
                      <div className="flex gap-2 flex-wrap mt-4 pt-3 border-t border-slate-800">
                        {['requested', 'accepted'].includes(r.status) && r.provider_id && (
                          <button
                            disabled={!!busy}
                            onClick={() => window.confirm('Take this request away from the provider and put it back on the open board?') && act('r' + r.id, { action: 'release_request', request_id: r.id }, 'Request released to the open board')}
                            className={ghost}
                          >
                            Release to open board
                          </button>
                        )}
                        <button
                          disabled={!!busy}
                          onClick={() => window.confirm('Cancel this request? The buyer will see it as cancelled.') && act('r' + r.id, { action: 'cancel_request', request_id: r.id }, 'Request cancelled')}
                          className={`${btn} border border-slate-700 text-slate-300 hover:text-red-400 hover:border-red-500/40`}
                        >
                          Cancel request
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {unreadTotal > 0 && view !== 'providers' && (
        <button onClick={() => setView('providers')} className="fixed bottom-20 md:bottom-5 right-5 z-40 inline-flex items-center gap-2 bg-slate-900 border border-emerald-500/50 text-emerald-400 text-xs font-bold rounded-full px-4 py-2.5 shadow-lg">
          <MessageSquare className="w-3.5 h-3.5" /> {unreadTotal} unread {unreadTotal === 1 ? 'message' : 'messages'}
        </button>
      )}

      {formFor && (
        <ProviderFormModal
          target={formFor}
          cats={cats}
          busy={busy}
          onClose={() => setFormFor(null)}
          onSubmit={async (form) => {
            const ok =
              formFor === 'create'
                ? await act('save', { action: 'create', ...form }, 'Provider created and verified')
                : await act('save', { action: 'update', id: formFor.id, ...form }, 'Provider updated');
            if (ok) setFormFor(null);
          }}
        />
      )}

      {loginFor && (
        <LoginModal
          p={loginFor.p}
          mode={loginFor.mode}
          busy={busy}
          onClose={() => setLoginFor(null)}
          onSubmit={async (email, password) => {
            const ok =
              loginFor.mode === 'create'
                ? await act('login', { action: 'create_login', id: loginFor.p.id, email, password }, 'Login created')
                : await act('login', { action: 'set_password', id: loginFor.p.id, password }, 'Password updated');
            if (ok) setLoginFor(null);
          }}
        />
      )}

      {delFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDelFor(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-white">Delete {delFor.display_name}?</h2>
            <p className="text-xs text-slate-400 mt-2">
              The provider and their services are removed and buyers can no longer find them. This cannot be undone. A provider with a job in progress cannot be deleted.
            </p>
            {delFor.user_id && (
              <label className="flex items-center gap-2 text-xs text-slate-300 mt-3">
                <input type="checkbox" checked={alsoLogin} onChange={(e) => setAlsoLogin(e.target.checked)} /> Also delete their login
              </label>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setDelFor(null)} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancel</button>
              <button disabled={busy === 'del'} onClick={() => remove()} className="px-4 py-2 rounded-lg text-xs font-bold bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white">
                {busy === 'del' ? 'Deleting...' : 'Delete provider'}
              </button>
            </div>
          </div>
        </div>
      )}

      {chatFor && <ChatModal prov={chatFor} call={call} onClose={() => { setChatFor(null); load(); }} />}
    </>
  );
}

/* ---------- Services panel (inside a provider card) ---------- */

function ServicesPanel({
  provider,
  services,
  cats,
  act,
  busy,
  catName,
}: {
  provider: Prov;
  services: Svc[];
  cats: Cat[];
  act: Act;
  busy: string | null;
  catName: (id: string) => string;
}) {
  const [categoryId, setCategoryId] = useState(cats[0]?.id || '');
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('job');

  const add = async () => {
    const ok = await act('svc' + provider.id, { action: 'add_service', id: provider.id, category_id: categoryId, title, price_from: price, price_unit: unit }, 'Service added');
    if (ok) {
      setTitle('');
      setPrice('');
    }
  };

  return (
    <div className="px-5 md:px-6 py-4 border-t border-slate-800 bg-slate-950/30 space-y-3">
      {services.length === 0 ? (
        <p className="text-xs text-slate-500">No services yet. A provider with no active service cannot be found by buyers.</p>
      ) : (
        <ul className="divide-y divide-slate-800/70 rounded-lg border border-slate-800 bg-slate-900">
          {services.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className={`min-w-0 ${s.active ? '' : 'opacity-60'}`}>
                <p className="text-xs font-medium text-white truncate">
                  {s.title}
                  {!s.active && <span className="ml-2 text-[10px] font-semibold text-amber-400">Paused</span>}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {catName(s.category_id)}
                  {s.price_from != null ? ` \u00B7 from ${naira(s.price_from)} / ${s.price_unit || 'job'}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  disabled={!!busy}
                  onClick={() => act('s' + s.id, { action: 'update_service', service_id: s.id, active: !s.active }, s.active ? 'Service paused' : 'Service is live')}
                  className="text-[11px] font-medium text-slate-300 border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 rounded-lg px-2.5 py-1.5 transition disabled:opacity-50"
                >
                  {s.active ? 'Pause' : 'Resume'}
                </button>
                <button
                  disabled={!!busy}
                  onClick={() => window.confirm(`Remove "${s.title}"?`) && act('s' + s.id, { action: 'delete_service', service_id: s.id }, 'Service removed')}
                  aria-label={`Remove ${s.title}`}
                  className="text-slate-500 hover:text-red-400 p-2 transition disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid sm:grid-cols-5 gap-2">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${inputCls} sm:col-span-1`} aria-label="Category">
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Service title" className={`${inputCls} sm:col-span-2`} />
        <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder={'From (\u20A6)'} className={inputCls} />
        <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls} aria-label="Price unit">
          <option value="job">per job</option>
          <option value="hour">per hour</option>
          <option value="day">per day</option>
          <option value="item">per item</option>
        </select>
      </div>
      <button
        disabled={busy === 'svc' + provider.id}
        onClick={add}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 rounded-lg px-3.5 py-2 transition"
      >
        <Plus className="w-3.5 h-3.5" /> Add service
      </button>
    </div>
  );
}

/* ---------- Add / edit provider ---------- */

function ProviderFormModal({
  target,
  cats,
  busy,
  onClose,
  onSubmit,
}: {
  target: 'create' | Prov;
  cats: Cat[];
  busy: string | null;
  onClose: () => void;
  onSubmit: (f: Form) => void;
}) {
  const editing = target !== 'create';
  const [f, setF] = useState<Form>(() =>
    target === 'create'
      ? EMPTY_FORM
      : {
          ...EMPTY_FORM,
          display_name: target.display_name,
          provider_type: target.provider_type || 'individual',
          phone: target.phone || '',
          city: target.city,
          area: target.area || '',
          bio: target.bio || '',
          service_areas: (target.service_areas || []).join(', '),
          typical_arrival_minutes: target.typical_arrival_minutes ? String(target.typical_arrival_minutes) : '',
          offers_emergency: !!target.offers_emergency,
          years_experience: target.years_experience != null ? String(target.years_experience) : '',
          bank_name: target.bank_name || '',
          account_name: target.account_name || '',
          account_number: target.account_number || '',
        }
  );
  const set = (k: keyof Form, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const label = 'block text-xs text-slate-400 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-base font-bold text-white">{editing ? `Edit ${(target as Prov).display_name}` : 'Add provider'}</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-200 p-1"><X className="w-4 h-4" /></button>
        </div>
        {!editing && <p className="text-xs text-slate-400 mt-1">The provider is verified straight away. Add a login so they can sign in at /provider/login, or leave it empty and manage them from here.</p>}

        <div className="space-y-3 mt-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <label><span className={label}>Name or shop name</span><input className={inputCls} value={f.display_name} onChange={(e) => set('display_name', e.target.value)} /></label>
            <label><span className={label}>Type</span>
              <select className={inputCls} value={f.provider_type} onChange={(e) => set('provider_type', e.target.value)}>
                <option value="individual">Individual</option>
                <option value="shop">Shop or business</option>
              </select>
            </label>
            <label><span className={label}>Phone</span><input className={inputCls} type="tel" placeholder="0803 123 4567" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></label>
            <label><span className={label}>City</span>
              <select className={inputCls} value={f.city} onChange={(e) => set('city', e.target.value)}>
                {!CITIES.includes(f.city) && f.city && <option value={f.city}>{f.city}</option>}
                {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="sm:col-span-2"><span className={label}>Area or street</span><input className={inputCls} value={f.area} onChange={(e) => set('area', e.target.value)} placeholder="Example: Ikot Ekpene Road" /></label>
            <label className="sm:col-span-2"><span className={label}>Other areas covered (comma separated)</span><input className={inputCls} value={f.service_areas} onChange={(e) => set('service_areas', e.target.value)} placeholder="Ewet Housing, Itam, Aka Road" /></label>
            <label><span className={label}>Usually arrives within</span>
              <select className={inputCls} value={f.typical_arrival_minutes} onChange={(e) => set('typical_arrival_minutes', e.target.value)}>
                {ARRIVAL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label><span className={label}>Years of experience</span><input className={inputCls} inputMode="numeric" value={f.years_experience} onChange={(e) => set('years_experience', e.target.value.replace(/\D/g, '').slice(0, 2))} /></label>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={f.offers_emergency} onChange={(e) => set('offers_emergency', e.target.checked)} className="accent-emerald-500" /> Takes emergency calls</label>
          <label className="block"><span className={label}>About</span><textarea rows={3} className={`${inputCls} resize-none`} value={f.bio} onChange={(e) => set('bio', e.target.value)} /></label>

          {editing ? (
            <div className="pt-3 border-t border-slate-800">
              <p className="text-xs font-bold text-white mb-2">Payout account</p>
              <div className="grid sm:grid-cols-3 gap-2">
                <input className={inputCls} placeholder="Bank" value={f.bank_name} onChange={(e) => set('bank_name', e.target.value)} />
                <input className={inputCls} placeholder="Account name" value={f.account_name} onChange={(e) => set('account_name', e.target.value)} />
                <input className={inputCls} placeholder="Account number" inputMode="numeric" maxLength={10} value={f.account_number} onChange={(e) => set('account_number', e.target.value.replace(/\D/g, ''))} />
              </div>
            </div>
          ) : (
            <>
              <div className="pt-3 border-t border-slate-800">
                <p className="text-xs font-bold text-white mb-2">Login (optional)</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  <input className={inputCls} type="email" placeholder="Email" value={f.email} onChange={(e) => set('email', e.target.value)} />
                  <input className={inputCls} placeholder="Temporary password (min 8)" value={f.password} onChange={(e) => set('password', e.target.value)} />
                </div>
              </div>
              <div className="pt-3 border-t border-slate-800">
                <p className="text-xs font-bold text-white mb-2">First service (optional)</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  <select className={inputCls} value={f.category_id} onChange={(e) => set('category_id', e.target.value)} aria-label="Category">
                    <option value="">Choose a category</option>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input className={inputCls} placeholder="Example: Pipe repairs" value={f.service_title} onChange={(e) => set('service_title', e.target.value)} />
                  <input className={inputCls} inputMode="numeric" placeholder={'Starting price (\u20A6)'} value={f.price_from} onChange={(e) => set('price_from', e.target.value.replace(/\D/g, ''))} />
                  <select className={inputCls} value={f.price_unit} onChange={(e) => set('price_unit', e.target.value)} aria-label="Price unit">
                    <option value="job">per job</option><option value="hour">per hour</option><option value="day">per day</option><option value="item">per item</option>
                  </select>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancel</button>
          <button disabled={busy === 'save'} onClick={() => onSubmit(f)} className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950">
            {busy === 'save' ? 'Saving...' : editing ? 'Save changes' : 'Create provider'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Create login / reset password ---------- */

function LoginModal({
  p,
  mode,
  busy,
  onClose,
  onSubmit,
}: {
  p: Prov;
  mode: 'create' | 'password';
  busy: string | null;
  onClose: () => void;
  onSubmit: (email: string, password: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-white">{mode === 'create' ? 'Create login' : 'Reset password'}</h2>
        <p className="text-xs text-slate-400 mt-1">
          {mode === 'create' ? `Lets ${p.display_name} sign in at /provider/login.` : `Sets a new password for ${p.display_name}. Tell them what it is.`}
        </p>
        <div className="space-y-3 mt-4">
          {mode === 'create' && <input className={inputCls} type="email" placeholder="Email (their login)" value={email} onChange={(e) => setEmail(e.target.value)} />}
          <input className={inputCls} placeholder="Password (min 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancel</button>
          <button disabled={busy === 'login'} onClick={() => onSubmit(email, password)} className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950">
            {busy === 'login' ? 'Saving...' : mode === 'create' ? 'Create login' : 'Update password'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Chat with a provider ---------- */

function ChatModal({ prov, call, onClose }: { prov: Prov; call: Call; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { ok, json } = await call('GET', undefined, '?thread=' + prov.id);
    if (ok) {
      setMsgs(json.messages || []);
      setErr('');
    } else setErr(json.error || 'Could not load messages.');
    setLoaded(true);
  }, [call, prov.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const { ok, json } = await call('POST', { action: 'send_message', id: prov.id, body });
    setSending(false);
    if (!ok) return setErr(json.error || 'Could not send.');
    setText('');
    setErr('');
    load();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full sm:max-w-md h-[85vh] sm:h-[600px] bg-slate-900 border border-slate-700 sm:rounded-2xl rounded-t-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800 shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">{prov.display_name}</p>
            <p className="text-[11px] text-slate-400 truncate">{prov.phone || 'Provider'} · messages go to their portal</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-200 p-1"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5">
          {!loaded ? (
            <p className="text-xs text-slate-500 text-center pt-6">Loading messages...</p>
          ) : msgs.length === 0 && !err ? (
            <p className="text-xs text-slate-500 text-center pt-6">No messages yet. Say hello to {prov.display_name.split(' ')[0]}.</p>
          ) : (
            msgs.map((m) => (
              <div key={m.id} className={`flex ${m.sender_role === 'admin' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3.5 py-2 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap break-words ${m.sender_role === 'admin' ? 'bg-emerald-500 text-slate-950 font-medium rounded-br-md' : 'bg-slate-800 text-slate-200 border border-slate-700/50 rounded-bl-md'}`}>
                  {m.body}
                  <p className={`text-[10px] mt-1 ${m.sender_role === 'admin' ? 'text-slate-800/70' : 'text-slate-500'}`}>{when(m.created_at)}</p>
                </div>
              </div>
            ))
          )}
          {err && <p className="text-xs text-red-400">{err}</p>}
          <div ref={endRef} />
        </div>

        <div className="p-3 border-t border-slate-800 flex items-end gap-2 shrink-0">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            maxLength={2000}
            placeholder="Type a message..."
            className="flex-1 min-w-0 resize-none max-h-28 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
          <button onClick={send} disabled={sending || !text.trim()} aria-label="Send message" className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 p-2.5 rounded-xl transition shrink-0">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}