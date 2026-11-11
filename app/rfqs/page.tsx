'use client';

// app/rfqs/page.tsx
// Quotes now come from velrenta_quote_options (the options shown to the buyer).
// Each option card shows one status pill:
//   Ordered      - the buyer picked this option (used_at is set)
//   Not selected - another option from the same quote was ordered
//   Expired      - nothing was ordered and valid_until has passed
//   Active       - still open, can be ordered
// BuyerShell is untouched.

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText,
  Search,
  X,
  MapPin,
  ChevronDown,
  Clock,
  Truck,
  Wallet,
  MessageSquare,
  Hourglass,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import BuyerShell from '../components/BuyerShell';

interface RFQ {
  id?: string;
  rfq_id?: string;
  title: string;
  delivery_location: string;
  status: string;
  created_at?: string;
  quotes_count?: number;
}

interface BidRow {
  id: string;
  supplierName: string;
  city?: string | null;
  rating: number | null;
  years?: number | null;
  level?: string | null;
  total: number | null;
  currency: string;
  shipping: number | null;
  tax: number | null;
  ref?: string | null;
  validUntil?: string | null;
  terms?: string | null;
  days?: string | number | null;
  message?: string | null;
  status?: string | null;
  po: { po_number: string; supplier_status: string } | null;
}

type BidState = { loading: boolean; error?: boolean; rows: BidRow[] };

// Strips a stray leading "=" that shows up in some AI-generated RFQ titles.
const cleanDisplayText = (text: string | null | undefined): string => {
  if (!text) return '';
  return text.replace(/^=+\s*/, '').trim();
};

const statusStyle = (status?: string | null) => {
  const s = (status || 'open').toLowerCase();
  if (['closed', 'cancelled', 'expired', 'declined', 'rejected', 'not selected'].includes(s))
    return 'bg-slate-800 text-slate-400 border-slate-700';
  if (['quoted', 'awarded', 'ordered'].includes(s)) return 'bg-sky-500/10 text-sky-300 border-sky-500/30';
  if (['pending', 'draft', 'sent'].includes(s)) return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
};

const formatAmount = (n: number, currency = 'NGN') =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 0 }).format(n);

const timeAgo = (iso?: string) => {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
};

const toNum = (v: any) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export default function RFQPage() {
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [search, setSearch] = useState('');
  // True until the first fetch finishes (shows skeletons instead of 0s / empty state).
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState<'newest' | 'quotes'>('newest');
  const [openId, setOpenId] = useState<string | null>(null);
  const [bids, setBids] = useState<Record<string, BidState>>({});
  const openIdRef = useRef<string | null>(null);

  const fetchRFQs = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    let query = supabase.from('rfqs').select('*').order('created_at', { ascending: false });
    if (user?.id) query = query.eq('buyer_id', user.id);

    const { data: rfqData, error: rfqError } = await query;

    if (rfqError) {
      console.error('RFQ fetch error:', rfqError);
      setRfqs([]);
      return;
    }
    if (!rfqData || rfqData.length === 0) {
      setRfqs([]);
      return;
    }

    // Count the options in the newest quote batch of each RFQ.
    const identifiers = rfqData.map((r: any) => r.rfq_id || r.id).filter(Boolean);
    const quotesByRfq: Record<string, number> = {};

    if (identifiers.length > 0) {
      const { data: optRows, error: optError } = await supabase
        .from('velrenta_quote_options')
        .select('rfq_id, batch_id, created_at')
        .in('rfq_id', identifiers);

      if (optError) {
        console.error('Options count fetch error:', optError);
      } else if (optRows) {
        const latest: Record<string, { batch: string; at: string }> = {};
        optRows.forEach((r: any) => {
          const cur = latest[r.rfq_id];
          if (!cur || r.created_at > cur.at) latest[r.rfq_id] = { batch: r.batch_id, at: r.created_at };
        });
        optRows.forEach((r: any) => {
          if (latest[r.rfq_id]?.batch === r.batch_id) quotesByRfq[r.rfq_id] = (quotesByRfq[r.rfq_id] || 0) + 1;
        });
      }
    }

    setRfqs(
      rfqData.map((r: any) => ({
        ...r,
        quotes_count: quotesByRfq[r.rfq_id || r.id] || 0,
      }))
    );
  }, []);

  // Loads the newest quote batch for one RFQ, plus supplier details and the PO if one was placed.
  const loadBids = useCallback(async (key: string) => {
    setBids((p) => ({ ...p, [key]: { loading: !p[key]?.rows?.length, rows: p[key]?.rows || [] } }));

    const { data: opts, error } = await supabase
      .from('velrenta_quote_options')
      .select('*')
      .eq('rfq_id', key);
    if (error) {
      console.error('Bids fetch error:', error);
      setBids((p) => ({ ...p, [key]: { loading: false, error: true, rows: [] } }));
      return;
    }

    let options: any[] = opts || [];
    if (options.length) {
      const newest = options.reduce((a, b) => (a.created_at > b.created_at ? a : b));
      options = options.filter((o) => o.batch_id === newest.batch_id);
    }

    // If any option in the batch was ordered, the others were not selected.
    const batchOrdered = options.some((o) => !!o.used_at);

    // Find the PO placed from this RFQ (quotes -> purchase_orders). If the buyer cannot read
    // quotes (no RLS policy), this quietly returns nothing and the PO tag is simply not shown.
    let poForRfq: { po_number: string; supplier_status: string } | null = null;
    if (batchOrdered) {
      const { data: qrows } = await supabase.from('quotes').select('id').eq('rfq_id', key);
      const qids = (qrows || []).map((q: any) => q.id).filter(Boolean);
      if (qids.length) {
        const { data: pos } = await supabase
          .from('purchase_orders')
          .select('po_number, supplier_status, created_at')
          .in('quote_id', qids)
          .order('created_at', { ascending: false })
          .limit(1);
        if (pos && pos[0]) poForRfq = { po_number: pos[0].po_number, supplier_status: pos[0].supplier_status };
      }
    }

    const supplierIds = Array.from(new Set(options.map((o) => o.supplier_id).filter(Boolean)));
    const { data: sups } = supplierIds.length
      ? await supabase
          .from('suppliers')
          .select('id, company_name, city, rating, years_in_business, verification_level')
          .in('id', supplierIds)
      : { data: [] as any[] };
    const supMap = new Map<string, any>((sups || []).map((s: any) => [s.id, s]));

    const now = Date.now();
    const rows: BidRow[] = options.map((o) => {
      const s = supMap.get(o.supplier_id);
      const unit = toNum(o.unit_price);
      const qty = toNum(o.quantity);
      const ordered = !!o.used_at;
      const expired = !batchOrdered && o.valid_until && new Date(o.valid_until).getTime() < now;
      return {
        id: o.id,
        supplierName: o.supplier_name || s?.company_name || 'Supplier',
        city: s?.city,
        rating: toNum(s?.rating),
        years: s?.years_in_business,
        level: s?.verification_level,
        total: unit !== null && qty !== null ? unit * qty : null,
        currency: o.currency || 'NGN',
        shipping: null,
        tax: null,
        ref: `Option ${o.option_number} · ${qty} × ${o.product_name}${unit !== null ? ` @ ${formatAmount(unit, o.currency)}` : ''}`,
        validUntil: o.valid_until,
        terms: o.payment_terms,
        days: o.lead_time_days,
        message: null,
        status: ordered ? 'ordered' : batchOrdered ? 'not selected' : expired ? 'expired' : 'active',
        po: ordered ? poForRfq : null,
      };
    });
    rows.sort((a, b) => (a.total ?? 1e18) - (b.total ?? 1e18));

    setBids((p) => ({ ...p, [key]: { loading: false, rows } }));
  }, []);

  useEffect(() => {
    fetchRFQs().finally(() => setLoading(false));

    const refreshOpen = () => {
      if (openIdRef.current) loadBids(openIdRef.current);
    };

    const channel = supabase
      .channel('rfq-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfqs' }, () => fetchRFQs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'velrenta_quote_options' }, () => {
        fetchRFQs();
        refreshOpen();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_orders' }, refreshOpen)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchRFQs, loadBids]);

  const toggleBids = (key: string) => {
    if (openId === key) {
      setOpenId(null);
      openIdRef.current = null;
      return;
    }
    setOpenId(key);
    openIdRef.current = key;
    loadBids(key);
  };

  const filteredRfqs = rfqs
    .filter((r) => {
      const identifier = r.rfq_id || r.id || '';
      const matchesSearch =
        cleanDisplayText(r.title).toLowerCase().includes(search.toLowerCase()) ||
        identifier.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || (r.status || 'open').toLowerCase() === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => (sort === 'quotes' ? (b.quotes_count ?? 0) - (a.quotes_count ?? 0) : 0));

  const statuses = Array.from(new Set(rfqs.map((r) => (r.status || 'open').toLowerCase())));
  const totalQuotes = rfqs.reduce((t, r) => t + (r.quotes_count ?? 0), 0);
  const awaiting = rfqs.filter((r) => (r.quotes_count ?? 0) === 0).length;
  const hasFilters = search.trim() !== '' || statusFilter !== 'all';

  const summary = [
    { label: 'RFQs', value: rfqs.length, tone: 'text-white', Icon: FileText },
    { label: 'Quotes received', value: totalQuotes, tone: 'text-emerald-400', Icon: MessageSquare },
    { label: 'Awaiting quotes', value: awaiting, tone: awaiting > 0 ? 'text-amber-400' : 'text-white', Icon: Hourglass },
  ];

  return (
    <BuyerShell
      active="rfqs"
      title="RFQs & quotes"
      subtitle="Review your price requests and compare the quotes suppliers have sent back."
    >
      {/* Summary strip: one panel, three figures */}
      <section className="grid grid-cols-3 divide-x divide-slate-800 rounded-xl border border-slate-800 bg-slate-900 mb-5">
        {summary.map(({ label, value, tone, Icon }) => (
          <div key={label} className="px-3 py-4 md:px-5 min-w-0">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Icon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <p className="text-[11px] md:text-xs truncate">{label}</p>
            </div>
            {loading ? (
              <div className="h-8 md:h-9 w-12 mt-1.5 rounded-md bg-slate-800 animate-pulse" />
            ) : (
              <p className={`text-2xl md:text-3xl font-bold mt-1.5 ${tone}`}>{value}</p>
            )}
          </div>
        ))}
      </section>

      {/* Toolbar: search, status, sort in one row */}
      <div className="flex flex-col md:flex-row gap-2.5 mb-4">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            aria-label="Search RFQs"
            placeholder="Search by item or RFQ ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-10 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-200 transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex gap-2.5">
          {rfqs.length > 0 && (
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="flex-1 md:flex-none capitalize bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-emerald-500 transition"
            >
              <option value="all">All statuses ({rfqs.length})</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s} ({rfqs.filter((r) => (r.status || 'open').toLowerCase() === s).length})
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Sort RFQs"
            value={sort}
            onChange={(e) => setSort(e.target.value as 'newest' | 'quotes')}
            className="flex-1 md:flex-none bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-emerald-500 transition"
          >
            <option value="newest">Newest first</option>
            <option value="quotes">Most quotes</option>
          </select>
        </div>
      </div>

      {/* List: one panel, rows divided by hairlines */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-slate-800 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className="p-5">
                <div className="h-4 w-2/3 rounded bg-slate-800" />
                <div className="h-3 w-1/3 rounded bg-slate-800 mt-3" />
              </div>
            ))}
          </div>
        ) : filteredRfqs.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="w-6 h-6 text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-300">{hasFilters ? 'No RFQs match your search' : 'No RFQs yet'}</p>
            <div className="text-xs text-slate-500 mt-1">
              {hasFilters ? (
                <button
                  onClick={() => {
                    setSearch('');
                    setStatusFilter('all');
                  }}
                  className="text-emerald-400 hover:text-emerald-300 font-medium"
                >
                  Clear filters
                </button>
              ) : (
                'Ask the assistant on your dashboard for a quote and it will appear here.'
              )}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {filteredRfqs.map((rfq) => {
              const identifier = rfq.rfq_id || rfq.id || '';
              const quotes = rfq.quotes_count ?? 0;
              const isOpen = openId === identifier && identifier !== '';
              const b = bids[identifier];
              const priced = (b?.rows || []).filter((r) => r.total !== null);
              const lowest = priced.length > 1 ? Math.min(...priced.map((r) => r.total as number)) : null;

              return (
                <li key={identifier} className={isOpen ? 'bg-slate-950/30' : ''}>
                  <button
                    onClick={() => toggleBids(identifier)}
                    disabled={quotes === 0}
                    aria-expanded={isOpen}
                    className={`w-full text-left flex items-center gap-3 md:gap-4 px-4 md:px-5 py-4 transition border-l-2 ${
                      isOpen ? 'border-emerald-400' : 'border-transparent'
                    } ${quotes === 0 ? 'cursor-default' : 'hover:bg-slate-800/40'}`}
                  >
                    <span className="min-w-0 flex-1 block">
                      <span className="block text-sm md:text-base font-semibold text-white truncate">
                        {cleanDisplayText(rfq.title)}
                      </span>
                      <span className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-slate-500 mt-1">
                        <span className="font-mono text-emerald-400/90">#{identifier.substring(0, 8)}</span>
                        <span className="flex items-center gap-1.5 min-w-0">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">{rfq.delivery_location || 'No delivery location'}</span>
                        </span>
                        {rfq.created_at && (
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3 h-3 shrink-0" />
                            {timeAgo(rfq.created_at)}
                          </span>
                        )}
                      </span>
                    </span>

                    <span
                      className={`hidden sm:inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold border capitalize shrink-0 ${statusStyle(
                        rfq.status
                      )}`}
                    >
                      {rfq.status || 'Open'}
                    </span>

                    <span
                      className={`shrink-0 text-right min-w-[84px] ${quotes > 0 ? 'text-emerald-400' : 'text-slate-600'}`}
                    >
                      <span className="block text-lg font-bold leading-none">{quotes}</span>
                      <span className="block text-[11px] text-slate-500 mt-1">
                        {quotes === 0 ? 'no quotes yet' : quotes === 1 ? 'quote' : 'quotes'}
                      </span>
                    </span>

                    <ChevronDown
                      className={`w-4 h-4 shrink-0 transition-transform ${
                        quotes === 0 ? 'text-slate-700' : 'text-slate-400'
                      } ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {isOpen && (
                    <div className="px-4 md:px-5 pb-5 pt-1">
                      {!b || b.loading ? (
                        <div className="grid sm:grid-cols-2 gap-3 animate-pulse">
                          {[0, 1].map((i) => (
                            <div key={i} className="h-28 rounded-lg bg-slate-800/60" />
                          ))}
                        </div>
                      ) : b.error ? (
                        <p className="text-xs text-red-300">Could not load the quotes. Try again in a moment.</p>
                      ) : b.rows.length === 0 ? (
                        <p className="text-xs text-slate-500">No quotes found.</p>
                      ) : (
                        <>
                          <p className="text-xs text-slate-400 mb-3">
                            {b.rows.length} {b.rows.length === 1 ? 'quote' : 'quotes'}, sorted by price, lowest first.
                          </p>
                          <ul className="grid lg:grid-cols-2 gap-3">
                            {b.rows.map((r) => {
                              const isLowest = lowest !== null && r.total === lowest;
                              const meta = [
                                r.city,
                                r.rating !== null ? `★ ${r.rating.toFixed(1)}` : null,
                                r.years !== null && r.years !== undefined ? `${r.years} yrs in business` : null,
                                r.level,
                              ].filter(Boolean);
                              return (
                                <li
                                  key={r.id}
                                  className={`rounded-lg border p-4 flex flex-col min-w-0 ${
                                    isLowest ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-slate-800 bg-slate-900'
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-white truncate">{r.supplierName}</p>
                                      {meta.length > 0 && (
                                        <p className="text-xs text-slate-500 mt-0.5">{meta.join(' · ')}</p>
                                      )}
                                    </div>
                                    {r.status && (
                                      <span
                                        className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${statusStyle(
                                          r.status
                                        )}`}
                                      >
                                        {r.status}
                                      </span>
                                    )}
                                  </div>

                                  <div className="mt-3">
                                    <p className="text-xl font-bold text-emerald-400 leading-tight">
                                      {r.total !== null ? formatAmount(r.total, r.currency) : 'No price'}
                                    </p>
                                    {((r.shipping ?? 0) > 0 || (r.tax ?? 0) > 0) && (
                                      <p className="text-[11px] text-slate-500 mt-0.5">
                                        Incl.
                                        {(r.shipping ?? 0) > 0 ? ` shipping ${formatAmount(r.shipping as number, r.currency)}` : ''}
                                        {(r.shipping ?? 0) > 0 && (r.tax ?? 0) > 0 ? ',' : ''}
                                        {(r.tax ?? 0) > 0 ? ` tax ${formatAmount(r.tax as number, r.currency)}` : ''}
                                      </p>
                                    )}
                                  </div>

                                  {(isLowest || r.po) && (
                                    <div className="flex gap-1.5 flex-wrap mt-2.5">
                                      {isLowest && (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                          Lowest price
                                        </span>
                                      )}
                                      {r.po && (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-sky-500/10 text-sky-300 border-sky-500/30">
                                          Ordered · {r.po.po_number}
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {(r.terms || r.days !== null || r.validUntil) && (
                                    <div className="grid gap-1.5 mt-3 pt-3 border-t border-slate-800 text-xs text-slate-400">
                                      {r.terms && (
                                        <span className="flex items-center gap-2">
                                          <Wallet className="w-3.5 h-3.5 text-slate-500 shrink-0" /> {r.terms}
                                        </span>
                                      )}
                                      {r.days !== null && r.days !== undefined && (
                                        <span className="flex items-center gap-2">
                                          <Truck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                          {toNum(r.days) !== null
                                            ? `${r.days} ${Number(r.days) === 1 ? 'day' : 'days'} delivery`
                                            : r.days}
                                        </span>
                                      )}
                                      {r.validUntil && (
                                        <span className="flex items-center gap-2">
                                          <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                          Valid until{' '}
                                          {new Date(r.validUntil).toLocaleDateString('en-NG', {
                                            day: 'numeric',
                                            month: 'short',
                                            year: 'numeric',
                                          })}
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {r.message && (
                                    <p className="mt-3 text-xs text-slate-300 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
                                      {r.message}
                                    </p>
                                  )}

                                  {r.ref && <p className="text-[11px] font-mono text-slate-600 mt-3">{r.ref}</p>}
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </BuyerShell>
  );
}