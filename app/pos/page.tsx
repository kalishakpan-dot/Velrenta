'use client';

// app/pos/page.tsx
// Buyer purchase orders. Payment now goes through Monnify via <PaymentPanel />.
// BuyerShell is untouched.

import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle,
  Search,
  X,
  Download,
  MapPin,
  Clock,
  Wallet,
  Banknote,
  Hourglass,
  CircleDollarSign,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import BuyerShell from '../components/BuyerShell';
import PaymentPanel from '../components/PaymentPanel';

interface SupplierInfo {
  company_name: string | null;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  status: string;
  created_at: string;
  buyer_id: string;
  total_amount: number | null;
  supplier_status?: string | null;
  supplier_responded_at?: string | null;
  decline_reason?: string | null;
  order_description?: string | null;
  delivery_location?: string | null;
  payment_terms?: string | null;
  payment_status?: string | null;
  suppliers?: SupplierInfo | SupplierInfo[] | null;
}

type Filter = 'all' | 'pending' | 'accepted' | 'declined';

const PO_COLUMNS = `
  id, po_number, status, created_at, buyer_id, total_amount,
  supplier_status, supplier_responded_at, decline_reason,
  order_description, delivery_location, payment_terms, payment_status
`;

const EDGE: Record<string, string> = {
  pending: 'before:bg-amber-400',
  accepted: 'before:bg-emerald-500/60',
  declined: 'before:bg-red-500/60',
};

const BADGE: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  accepted: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  declined: 'bg-red-500/10 text-red-400 border-red-500/30',
};

const LABEL: Record<string, string> = {
  pending: 'Awaiting supplier',
  accepted: 'Accepted',
  declined: 'Declined',
};

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export default function PurchaseOrdersPage() {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [search, setSearch] = useState('');
  const [buyerName, setBuyerName] = useState('Buyer');
  // True until the first fetch finishes (shows skeletons instead of 0s / empty state).
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  const fetchPOs = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    if (user) {
      const { data: buyerData } = await supabase
        .from('buyers')
        .select('contact_name, email')
        .eq('id', user.id)
        .maybeSingle();
      if (buyerData) setBuyerName(buyerData.contact_name || buyerData.email || 'Buyer');
    }

    const build = (select: string) => {
      let q = supabase.from('purchase_orders').select(select).order('created_at', { ascending: false });
      if (user?.id) q = q.eq('buyer_id', user.id);
      return q;
    };

    // Supplier bank details are no longer fetched: buyers pay through Monnify now.
    const attempts = [`${PO_COLUMNS}, suppliers:supplier_id ( company_name )`, '*'];

    for (const select of attempts) {
      const { data, error } = await build(select);
      if (!error && data) {
        setPos(data as unknown as PurchaseOrder[]);
        return;
      }
      console.error('PO fetch error:', error);
    }
  }, []);

  useEffect(() => {
    fetchPOs().finally(() => setLoading(false));

    const channel = supabase
      .channel('po-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_orders' }, () => fetchPOs())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPOs]);

  const getSupplier = (po: PurchaseOrder): SupplierInfo | null => {
    if (!po.suppliers) return null;
    return Array.isArray(po.suppliers) ? po.suppliers[0] || null : po.suppliers;
  };
  const getSupplierName = (po: PurchaseOrder) => getSupplier(po)?.company_name || 'Supplier';
  const respStatus = (po: PurchaseOrder) => po.supplier_status || 'pending';

  const formatAmount = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) return '—';
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

  // Reads terms like "30% upfront, 70% on delivery" (same rule the payment API uses).
  const upfrontPct = (terms?: string | null) => {
    const m = terms?.match(/(\d{1,2})\s*%\s*(?:up\s*-?\s*front|deposit|advance)/i);
    const n = m ? parseInt(m[1], 10) : 0;
    return n > 0 && n < 100 ? n : 0;
  };
  const outstanding = (po: PurchaseOrder) => {
    const total = po.total_amount || 0;
    const upfront = Math.round((total * upfrontPct(po.payment_terms)) / 100);
    const received = po.payment_status === 'paid' ? total : po.payment_status === 'deposit_paid' ? upfront : 0;
    return total - received;
  };

  // Opens a print-ready copy of the PO. Choose "Save as PDF" in the print dialog.
  const downloadPO = (po: PurchaseOrder) => {
    const row = (k: string, v: string) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(po.po_number)}</title><style>
      body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:40px}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #10b981;padding-bottom:16px;margin-bottom:24px}
      .logo{font-weight:700;font-size:20px}
      .logo span{display:inline-block;background:#10b981;color:#fff;border-radius:6px;width:28px;height:28px;text-align:center;line-height:28px;margin-right:8px}
      h1{font-size:20px;margin:0}.sub{color:#64748b;font-size:13px;margin-top:4px}
      table{width:100%;border-collapse:collapse;font-size:14px}
      td{padding:10px 0;border-bottom:1px solid #e2e8f0;vertical-align:top}.k{color:#64748b;width:35%}
      .total{margin-top:24px;text-align:right;font-size:22px;font-weight:700}
      .foot{margin-top:40px;color:#94a3b8;font-size:12px}
    </style></head><body>
      <div class="head">
        <div class="logo"><span>V</span>Velrenta</div>
        <div style="text-align:right"><h1>Purchase order</h1><div class="sub">${esc(po.po_number || '')}</div></div>
      </div>
      <table>
        ${row('Issued', formatDate(po.created_at))}
        ${row('Buyer', buyerName)}
        ${row('Supplier', getSupplierName(po))}
        ${row('Description', po.order_description || '—')}
        ${row('Delivery location', po.delivery_location || '—')}
        ${row('Payment terms', po.payment_terms || '—')}
        ${row('Supplier response', LABEL[respStatus(po)] || respStatus(po))}
      </table>
      <div class="total">${esc(formatAmount(po.total_amount))}</div>
      <div class="foot">Generated by Velrenta on ${esc(new Date().toLocaleDateString('en-NG'))}</div>
    </body></html>`;

    const w = window.open('', '_blank');
    if (!w) {
      window.alert('Please allow pop-ups to download the PDF.');
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  const filteredPOs = pos.filter((po) => {
    const q = search.toLowerCase();
    const matchesSearch = po.po_number?.toLowerCase().includes(q) || getSupplierName(po).toLowerCase().includes(q);
    const matchesFilter = filter === 'all' || respStatus(po) === filter;
    return matchesSearch && matchesFilter;
  });

  const totalValue = filteredPOs.reduce((sum, po) => sum + (po.total_amount || 0), 0);
  const count = (s: Filter) => (s === 'all' ? pos.length : pos.filter((p) => respStatus(p) === s).length);
  const toPay = pos.filter((p) => respStatus(p) === 'accepted').reduce((t, p) => t + outstanding(p), 0);
  const hasFilters = search.trim() !== '' || filter !== 'all';

  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Awaiting supplier' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'declined', label: 'Declined' },
  ];

  const summary = [
    { label: 'Total value', value: formatAmount(totalValue), tone: 'text-white', Icon: Banknote },
    {
      label: 'Awaiting supplier',
      value: String(count('pending')),
      tone: count('pending') > 0 ? 'text-amber-400' : 'text-white',
      Icon: Hourglass,
    },
    { label: 'Accepted', value: String(count('accepted')), tone: 'text-emerald-400', Icon: CheckCircle },
    {
      label: 'Still to pay',
      value: formatAmount(toPay),
      tone: toPay > 0 ? 'text-white' : 'text-slate-500',
      Icon: CircleDollarSign,
    },
  ];

  return (
    <BuyerShell
      active="pos"
      title="Purchase orders"
      subtitle="Track each order from supplier response to payment, and download a copy for your records."
    >
      {/* Summary strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 rounded-xl border border-slate-800 bg-slate-900 mb-5 overflow-hidden">
        {summary.map(({ label, value, tone, Icon }, i) => (
          <div
            key={label}
            className={`px-4 py-4 md:px-5 min-w-0 border-slate-800 ${i % 2 === 1 ? 'border-l' : ''} ${
              i > 1 ? 'border-t lg:border-t-0' : ''
            } ${i > 0 ? 'lg:border-l' : ''}`}
          >
            <div className="flex items-center gap-1.5 text-slate-400">
              <Icon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <p className="text-xs truncate">{label}</p>
            </div>
            {loading ? (
              <div className="h-7 md:h-8 w-20 mt-1.5 rounded-md bg-slate-800 animate-pulse" />
            ) : (
              <p className={`text-xl md:text-2xl font-bold mt-1.5 truncate ${tone}`}>{value}</p>
            )}
          </div>
        ))}
      </section>

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="relative w-full lg:max-w-xs shrink-0">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            aria-label="Search purchase orders"
            placeholder="Search PO number or supplier"
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

        <div className="flex gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto min-w-0 lg:ml-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                filter === t.key
                  ? 'bg-slate-100 text-slate-900'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {t.label}{' '}
              {loading ? (
                <span className="inline-block align-middle h-3 w-4 rounded bg-slate-700/60 animate-pulse" />
              ) : (
                <span className={filter === t.key ? 'text-slate-600' : 'text-slate-500'}>{count(t.key)}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-slate-800 bg-slate-900 p-5 animate-pulse">
              <div className="h-3 w-32 rounded bg-slate-800" />
              <div className="h-4 w-1/2 rounded bg-slate-800 mt-3" />
              <div className="h-3 w-1/3 rounded bg-slate-800 mt-3" />
            </div>
          ))
        ) : filteredPOs.length === 0 ? (
          <div className="bg-slate-900 rounded-xl border border-dashed border-slate-800 p-10 text-center">
            <CheckCircle className="w-6 h-6 text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-300">
              {hasFilters ? 'No purchase orders match your search' : 'No purchase orders yet'}
            </p>
            <div className="text-xs text-slate-500 mt-1">
              {hasFilters ? (
                <button
                  onClick={() => {
                    setSearch('');
                    setFilter('all');
                  }}
                  className="text-emerald-400 hover:text-emerald-300 font-medium"
                >
                  Clear filters
                </button>
              ) : (
                'Orders you place with suppliers will appear here.'
              )}
            </div>
          </div>
        ) : (
          filteredPOs.map((po) => {
            const rs = respStatus(po);
            const hasSide = rs === 'pending' || rs === 'declined' || rs === 'accepted';

            return (
              <article
                key={po.id}
                className={`relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${
                  EDGE[rs] || 'before:bg-slate-700'
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 px-5 md:px-6 pt-4 md:pt-5">
                  <div className="min-w-0 flex items-center gap-2.5 flex-wrap">
                    <span className="font-mono text-sm text-white">
                      {po.po_number || `#PO-${po.id.substring(0, 8)}`}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${BADGE[rs] || BADGE.pending}`}>
                      {LABEL[rs] || rs}
                    </span>
                    {rs === 'accepted' && (
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                          po.payment_status === 'paid' || po.payment_status === 'deposit_paid'
                            ? 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {po.payment_status === 'paid'
                          ? 'Paid'
                          : po.payment_status === 'deposit_paid'
                            ? 'Upfront paid'
                            : 'Awaiting payment'}
                      </span>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xl md:text-2xl font-bold text-emerald-400 leading-none">
                      {formatAmount(po.total_amount)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">Total value</p>
                  </div>
                </div>

                {/* Body: order details left, payment / status right */}
                <div
                  className={`grid gap-4 px-5 md:px-6 py-4 ${hasSide ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]' : ''}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100">{getSupplierName(po)}</p>
                    {po.order_description && <p className="text-xs text-slate-400 mt-1">{po.order_description}</p>}
                    <div className="grid gap-2 mt-3 text-xs text-slate-400">
                      <span className="flex items-center gap-2 min-w-0">
                        <Clock className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                        Issued {formatDate(po.created_at)}
                      </span>
                      {po.delivery_location && (
                        <span className="flex items-center gap-2 min-w-0">
                          <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                          <span className="truncate">{po.delivery_location}</span>
                        </span>
                      )}
                      {po.payment_terms && (
                        <span className="flex items-center gap-2 min-w-0">
                          <Wallet className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                          <span className="truncate">{po.payment_terms}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {rs === 'pending' && (
                    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3.5 text-xs text-slate-400 self-start">
                      Sent to the supplier. You'll be notified when they respond.
                    </div>
                  )}

                  {rs === 'declined' && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3.5 text-xs text-red-300/90 self-start">
                      The supplier declined this order{po.decline_reason ? `: ${po.decline_reason}` : '.'}
                    </div>
                  )}

                  {rs === 'accepted' && (
                    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 self-start min-w-0">
                      <PaymentPanel po={po} onPaid={fetchPOs} embedded />
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex justify-end px-5 md:px-6 py-3 border-t border-slate-800 bg-slate-950/20">
                  <button
                    onClick={() => downloadPO(po)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
                  >
                    <Download className="w-3.5 h-3.5" /> Download PDF
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </BuyerShell>
  );
}