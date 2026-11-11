'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  Search,
  X,
  MapPin,
  Star,
  ShieldCheck,
  Clock,
  Wallet,
  Truck,
  Phone,
  MessageCircle,
  Building2,
  HardHat,
  ChevronDown,
  MessageSquare,
  UserCheck,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import BuyerShell from '../components/BuyerShell';
import TrackRecord, { type Track } from '../components/TrackRecord';

interface SupplierProduct {
  product_name: string | null;
  unit: string | null;
  category?: string | null;
  price: number | null;
  currency: string | null;
  min_order: number | null;
  available: number | null;
  lead_time_days: number | null;
  availability: string | null;
}

interface Supplier {
  id: string;
  company_name: string;
  city: string | null;
  state: string | null;
  about: string | null;
  rating: number | null;
  years_in_business: number | null;
  verification_level: string | null;
  payment_terms: string | null;
  product_count: number;
  products: SupplierProduct[];
}

interface Professional {
  id: string;
  full_name: string;
  business_name: string | null;
  trade: string;
  specialties: string[] | null;
  city: string | null;
  state: string | null;
  service_areas: string[] | null;
  phone: string | null;
  years_experience: number | null;
  rating: number | null;
  completed_jobs: number | null;
  verified_at: string | null;
  is_sample: boolean | null;
}

interface Facets {
  supplier_count?: number;
  professional_count?: number;
  supplier_cities?: string[];
  professional_cities?: string[];
  trades?: string[];
}

type Tab = 'suppliers' | 'professionals';

const PAGE = 18;

const toNum = (v: unknown) =>
  v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);

const formatAmount = (n: number, currency?: string | null) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currency || 'NGN',
    maximumFractionDigits: 0,
  }).format(n);

const cap = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?';

const askLink = (text: string) => `/?ask=${encodeURIComponent(text)}`;

const waLink = (phone: string) => `https://wa.me/${phone.replace(/[^\d]/g, '')}`;

function RatingStars({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <span className="inline-flex items-center gap-1 text-amber-400">
      <Star className="w-3.5 h-3.5 fill-current" />
      <span className="text-slate-200">{value.toFixed(1)}</span>
    </span>
  );
}

function VerifiedBadge({ label = 'Verified' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
      <ShieldCheck className="w-3 h-3" /> {label}
    </span>
  );
}

// Buyer logs that they hired this professional. The job then shows on their dashboard,
// where they mark it completed and rate it. Ratings only count for completed jobs.
function HireButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const first = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).join(' ');

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc('hire_professional', {
      p_professional: id,
      p_description: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: error.message });
      return;
    }
    setOpen(false);
    setNote('');
    setMsg({
      ok: true,
      text: 'Job logged. When the work is done, mark it completed on your dashboard to rate them.',
    });
  };

  return (
    <div>
      {!open && (
        <button
          onClick={() => {
            setOpen(true);
            setMsg(null);
          }}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 rounded-lg px-3 py-2 transition"
        >
          <UserCheck className="w-3.5 h-3.5" /> I hired {first}
        </button>
      )}

      {open && (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="What is the job? (optional)"
            className="w-full resize-none bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={submit}
              disabled={busy}
              className="text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 rounded-lg px-3.5 py-2 transition"
            >
              {busy ? 'Saving...' : 'Log this job'}
            </button>
            <button
              onClick={() => setOpen(false)}
              disabled={busy}
              className="text-xs text-slate-400 hover:text-slate-200 px-2 py-2 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {msg && <p className={`text-[11px] mt-2 ${msg.ok ? 'text-emerald-400' : 'text-red-300'}`}>{msg.text}</p>}
    </div>
  );
}

function SupplierCard({ s, track }: { s: Supplier; track?: Track }) {
  const [expanded, setExpanded] = useState(false);
  const rating = toNum(s.rating);
  const years = toNum(s.years_in_business);
  const products = s.products || [];
  const shown = expanded ? products : products.slice(0, 3);
  const location = [s.city, s.state].filter(Boolean).join(', ');

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 p-4 md:p-5 flex flex-col min-w-0">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 flex items-center justify-center text-sm font-bold shrink-0">
          {initials(s.company_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm md:text-base font-semibold text-white truncate">{s.company_name}</h3>
            <VerifiedBadge label={s.verification_level ? `Verified · ${cap(s.verification_level)}` : 'Verified'} />
          </div>
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-slate-400 mt-1">
            {location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3 shrink-0 text-slate-500" /> {location}
              </span>
            )}
            <RatingStars value={rating} />
            {years !== null && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 shrink-0 text-slate-500" /> {years} {years === 1 ? 'yr' : 'yrs'} in business
              </span>
            )}
          </div>
        </div>
      </div>

      <TrackRecord track={track} noun="orders" />

      {s.about && <p className="text-xs text-slate-400 mt-3 line-clamp-2">{s.about}</p>}

      {s.payment_terms && (
        <p className="flex items-center gap-2 text-xs text-slate-400 mt-3">
          <Wallet className="w-3.5 h-3.5 text-slate-500 shrink-0" /> {s.payment_terms}
        </p>
      )}

      <div className="mt-4 pt-3 border-t border-slate-800 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Products ({s.product_count})</p>

        {products.length === 0 ? (
          <p className="text-xs text-slate-500">No products listed yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {shown.map((p, i) => {
              const price = toNum(p.price);
              const lead = toNum(p.lead_time_days);
              const moq = toNum(p.min_order);
              const stock = toNum(p.available);
              const out = (p.availability || '') === 'out_of_stock' || stock === 0;
              return (
                <li key={`${p.product_name}-${i}`} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-100 truncate">{p.product_name || 'Product'}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                      {moq !== null && moq > 1 && <span>Min {moq}</span>}
                      {lead !== null && (
                        <span className="flex items-center gap-1">
                          <Truck className="w-3 h-3" /> {lead} {lead === 1 ? 'day' : 'days'}
                        </span>
                      )}
                      <span className={out ? 'text-red-300/90' : 'text-emerald-400/80'}>
                        {out ? 'Out of stock' : 'In stock'}
                      </span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-emerald-400">
                      {price !== null ? formatAmount(price, p.currency) : '—'}
                    </p>
                    <p className="text-[10px] text-slate-500">{p.unit ? `per ${p.unit}` : ''}</p>
                    {p.product_name && !out && (
                      <Link
                        href={askLink(`I need a quote for ${p.product_name}`)}
                        className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
                      >
                        Get quote
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {products.length > 3 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition"
          >
            {expanded ? 'Show less' : `Show ${products.length - 3} more`}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
        {s.product_count > products.length && expanded && (
          <p className="text-[11px] text-slate-500 mt-2">
            Showing {products.length} of {s.product_count}. Ask the assistant for the full list.
          </p>
        )}
      </div>

      <div className="mt-4">
        <Link
          href={askLink(`I need a quote from ${s.company_name}`)}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg px-3.5 py-2 transition"
        >
          <MessageSquare className="w-3.5 h-3.5" /> Request a quote
        </Link>
      </div>
    </article>
  );
}

function ProfessionalCard({ p, track }: { p: Professional; track?: Track }) {
  const rating = toNum(p.rating);
  const years = toNum(p.years_experience);
  const jobs = toNum(p.completed_jobs);
  const location = [p.city, p.state].filter(Boolean).join(', ');
  const also = (p.service_areas || []).filter(Boolean);

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 p-4 md:p-5 flex flex-col min-w-0">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-sky-500/10 border border-sky-500/25 text-sky-300 flex items-center justify-center text-sm font-bold shrink-0">
          {initials(p.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm md:text-base font-semibold text-white truncate">{p.full_name}</h3>
            <VerifiedBadge />
            {p.is_sample && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-amber-500/10 text-amber-400 border-amber-500/30">
                Sample
              </span>
            )}
          </div>
          {p.business_name && <p className="text-xs text-slate-400 mt-0.5 truncate">{p.business_name}</p>}
        </div>
        <span className="shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border bg-slate-800 text-slate-300 border-slate-700">
          {cap(p.trade)}
        </span>
      </div>

      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-slate-400 mt-3">
        {location && (
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3 shrink-0 text-slate-500" /> {location}
          </span>
        )}
        <RatingStars value={rating} />
        {jobs !== null && jobs > 0 && <span>{jobs} jobs completed</span>}
        {years !== null && (
          <span>
            {years} {years === 1 ? 'yr' : 'yrs'} experience
          </span>
        )}
      </div>

      <TrackRecord track={track} noun="jobs" />

      {also.length > 0 && <p className="text-[11px] text-slate-500 mt-2">Also covers: {also.join(', ')}</p>}

      {(p.specialties || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {(p.specialties || []).map((sp) => (
            <span
              key={sp}
              className="px-2 py-0.5 rounded-md text-[11px] bg-slate-800/80 border border-slate-700/60 text-slate-300"
            >
              {sp}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-slate-800 space-y-3">
        {p.phone && (
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`tel:${p.phone}`}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg px-3.5 py-2 transition"
            >
              <Phone className="w-3.5 h-3.5" /> Call
            </a>
            <a
              href={waLink(p.phone)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/10 rounded-lg px-3.5 py-2 transition"
            >
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
            </a>
            <span className="text-[11px] font-mono text-slate-500">{p.phone}</span>
          </div>
        )}
        <HireButton id={p.id} name={p.full_name} />
      </div>
    </article>
  );
}

export default function MarketplacePage() {
  const [tab, setTab] = useState<Tab>('suppliers');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [city, setCity] = useState('');
  const [trade, setTrade] = useState('');
  const [facets, setFacets] = useState<Facets>({});

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pros, setPros] = useState<Professional[]>([]);
  const [tracks, setTracks] = useState<Record<string, Track>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqId = useRef(0);
  const countRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.rpc('marketplace_facets');
      if (err) {
        console.error('Marketplace facets error:', err);
        return;
      }
      if (data && !(data as any).error) setFacets(data as Facets);
    })();
  }, []);

  // Track record (completed orders/jobs, reviews, on-time %) for the cards on screen.
  const loadTracks = useCallback(async (kind: Tab, ids: string[]) => {
    if (ids.length === 0) return;
    const { data, error: err } = await supabase.rpc('marketplace_track_records', { p_kind: kind, p_ids: ids });
    if (err || !Array.isArray(data)) {
      if (err) console.warn('Track record error:', err.message);
      return;
    }
    setTracks((prev) => {
      const next = { ...prev };
      for (const t of data as Track[]) next[t.id] = t;
      return next;
    });
  }, []);

  const load = useCallback(
    async (reset: boolean) => {
      const id = ++reqId.current;
      if (reset) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      const offset = reset ? 0 : countRef.current;

      const { data, error: err } =
        tab === 'suppliers'
          ? await supabase.rpc('marketplace_suppliers', {
              p_search: dq || null,
              p_city: city || null,
              p_limit: PAGE,
              p_offset: offset,
            })
          : await supabase.rpc('marketplace_professionals', {
              p_search: dq || null,
              p_trade: trade || null,
              p_city: city || null,
              p_limit: PAGE,
              p_offset: offset,
            });

      if (id !== reqId.current) return;

      const payload = data as { total?: number; items?: any[]; error?: string } | null;
      if (err || !payload || payload.error) {
        console.error('Marketplace fetch error:', err || payload?.error);
        setError(err?.message || payload?.error || 'Could not load the marketplace.');
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      const rows = payload.items || [];
      countRef.current = (reset ? 0 : countRef.current) + rows.length;
      setTotal(payload.total || 0);
      if (tab === 'suppliers') setSuppliers((prev) => (reset ? rows : [...prev, ...rows]));
      else setPros((prev) => (reset ? rows : [...prev, ...rows]));
      setLoading(false);
      setLoadingMore(false);
      loadTracks(
        tab,
        rows.map((r: any) => r.id)
      );
    },
    [tab, dq, city, trade, loadTracks]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  const switchTab = (t: Tab) => {
    if (t === tab) return;
    setCity('');
    setTrade('');
    countRef.current = 0;
    setTotal(0);
    setTab(t);
  };

  const list = tab === 'suppliers' ? suppliers : pros;
  const cities = tab === 'suppliers' ? facets.supplier_cities || [] : facets.professional_cities || [];
  const hasFilters = q.trim() !== '' || city !== '' || trade !== '';

  const tabs: { key: Tab; label: string; count?: number; Icon: typeof Building2 }[] = [
    { key: 'suppliers', label: 'Suppliers', count: facets.supplier_count, Icon: Building2 },
    { key: 'professionals', label: 'Professionals', count: facets.professional_count, Icon: HardHat },
  ];

  return (
    <BuyerShell
      active="marketplace"
      title="Marketplace"
      subtitle="Find verified suppliers and professionals, then request a quote or get in touch."
    >
      <div className="flex gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800 w-full sm:w-fit mb-4">
        {tabs.map(({ key, label, count, Icon }) => (
          <button
            key={key}
            onClick={() => switchTab(key)}
            className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition ${
              tab === key ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {count !== undefined && (
              <span className={tab === key ? 'text-slate-600' : 'text-slate-500'}>{count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-col md:flex-row gap-2.5 mb-4">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            aria-label="Search the marketplace"
            placeholder={
              tab === 'suppliers' ? 'Search suppliers, products or city' : 'Search professionals, trades or city'
            }
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-10 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
          />
          {q && (
            <button
              onClick={() => setQ('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-200 transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex gap-2.5">
          {cities.length > 0 && (
            <select
              aria-label="Filter by city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="flex-1 md:flex-none bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-emerald-500 transition"
            >
              <option value="">All cities</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          {tab === 'professionals' && (facets.trades || []).length > 0 && (
            <select
              aria-label="Filter by trade"
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
              className="flex-1 md:flex-none capitalize bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-emerald-500 transition"
            >
              <option value="">All trades</option>
              {(facets.trades || []).map((t) => (
                <option key={t} value={t}>
                  {cap(t)}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <p className="text-[11px] text-slate-500 mb-4">
        {tab === 'suppliers'
          ? 'Ratings come from buyers whose delivery was confirmed on Velrenta.'
          : 'Professionals are verified by Velrenta. Agree the scope and price directly with them. Velrenta does not set their fees. Ratings come from jobs buyers mark as completed.'}
      </p>

      {loading ? (
        <div className="grid md:grid-cols-2 gap-3 animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex gap-3">
                <div className="h-10 w-10 rounded-lg bg-slate-800" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/2 rounded bg-slate-800" />
                  <div className="h-3 w-1/3 rounded bg-slate-800" />
                </div>
              </div>
              <div className="h-3 w-2/3 rounded bg-slate-800 mt-5" />
              <div className="h-3 w-1/2 rounded bg-slate-800 mt-3" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center">
          <p className="text-sm text-red-300">Could not load the marketplace.</p>
          <p className="text-xs text-red-300/70 mt-1 break-words">{error}</p>
          <button
            onClick={() => load(true)}
            className="mt-3 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
          >
            Try again
          </button>
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900 p-10 text-center">
          <Search className="w-6 h-6 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-300">
            {hasFilters ? `No ${tab} match your search` : `No ${tab} available yet`}
          </p>
          {hasFilters && (
            <button
              onClick={() => {
                setQ('');
                setCity('');
                setTrade('');
              }}
              className="mt-2 text-xs font-medium text-emerald-400 hover:text-emerald-300"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-3">
            Showing {list.length} of {total} {tab}
          </p>
          <div className="grid md:grid-cols-2 gap-3">
            {tab === 'suppliers'
              ? suppliers.map((s) => <SupplierCard key={s.id} s={s} track={tracks[s.id]} />)
              : pros.map((p) => <ProfessionalCard key={p.id} p={p} track={tracks[p.id]} />)}
          </div>
          {list.length < total && (
            <div className="flex justify-center mt-5">
              <button
                onClick={() => load(false)}
                disabled={loadingMore}
                className="text-xs font-bold text-slate-200 border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 rounded-lg px-4 py-2 transition disabled:opacity-50"
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </BuyerShell>
  );
}
