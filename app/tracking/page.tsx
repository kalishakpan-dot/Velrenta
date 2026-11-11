'use client';

// app/tracking/page.tsx  (buyer order tracking)
// Lists every order the supplier accepted AND that has been paid for (upfront or in full),
// with a 4-step tracker. Updates live when the supplier marks dispatched / delivered.

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ShoppingBag,
  Store,
  FileText,
  CheckCircle,
  Newspaper,
  Truck,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  MapPin,
  Package,
  PackageCheck,
  Wallet,
  Clock,
  KeyRound,
  Star,
  Wrench,
  Bike,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

type Stage = 'preparing' | 'dispatched' | 'delivered';
type Filter = 'all' | Stage;

interface TrackedPO {
  id: string;
  po_number: string;
  total_amount: number | null;
  created_at: string;
  order_description: string | null;
  delivery_location: string | null;
  payment_status: string | null;
  paid_at: string | null;
  supplier_id: string | null;
  supplier_responded_at: string | null;
  dispatched_at: string | null;
  delivery_confirmed_at: string | null;
  dispatch_note: string | null;
}

const stageOf = (po: TrackedPO): Stage =>
  po.delivery_confirmed_at ? 'delivered' : po.dispatched_at ? 'dispatched' : 'preparing';

const STAGE_META: Record<
  Stage,
  { badge: string; label: string; edge: string; panel: string; tile: string; Icon: LucideIcon }
> = {
  preparing: {
    badge: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    label: 'Being prepared',
    edge: 'before:bg-amber-400',
    panel: 'bg-amber-500/[0.06] border-amber-500/20',
    tile: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    Icon: Package,
  },
  dispatched: {
    badge: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    label: 'On the way',
    edge: 'before:bg-sky-400',
    panel: 'bg-sky-500/[0.06] border-sky-500/20',
    tile: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    Icon: Truck,
  },
  delivered: {
    badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    label: 'Delivered',
    edge: 'before:bg-emerald-500/60',
    panel: 'bg-emerald-500/[0.06] border-emerald-500/20',
    tile: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    Icon: PackageCheck,
  },
};

const formatAmount = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(n);

const shortDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : '';

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) +
  ', ' +
  new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });

const timeAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
};

const headline = (po: TrackedPO, stage: Stage) => {
  const place = po.delivery_location ? ` to ${po.delivery_location}` : '';
  if (stage === 'delivered') return { title: 'Delivered', sub: `Marked as delivered ${timeAgo(po.delivery_confirmed_at!)}.` };
  if (stage === 'dispatched') return { title: `On its way${place}`, sub: `Dispatched ${timeAgo(po.dispatched_at!)}.` };
  return {
    title: 'The supplier is preparing your order',
    sub: "You'll see it here as soon as it's dispatched.",
  };
};

interface Step {
  label: string;
  Icon: LucideIcon;
  done: boolean;
  at?: string | null;
}

const buildSteps = (po: TrackedPO): Step[] => [
  { label: 'Confirmed', Icon: CheckCircle, done: true, at: po.supplier_responded_at },
  {
    label: po.payment_status === 'paid' ? 'Paid' : 'Upfront paid',
    Icon: Wallet,
    done: true,
    at: po.payment_status === 'paid' ? po.paid_at : null,
  },
  { label: 'On the way', Icon: Truck, done: !!po.dispatched_at, at: po.dispatched_at },
  { label: 'Delivered', Icon: PackageCheck, done: !!po.delivery_confirmed_at, at: po.delivery_confirmed_at },
];

// Each step keeps its OWN icon. Completed steps turn green, the next step glows blue, the rest stay grey.
function Tracker({ steps }: { steps: Step[] }) {
  const current = steps.findIndex((s) => !s.done); // -1 when everything is done

  return (
    <ol className="grid grid-cols-4" aria-label="Order progress">
      {steps.map((s, i) => {
        const isCurrent = i === current;
        const state = s.done ? 'done' : isCurrent ? 'current' : 'pending';
        const next = steps[i + 1];

        return (
          <li
            key={s.label}
            aria-current={isCurrent ? 'step' : undefined}
            className="relative flex flex-col items-center text-center px-1"
          >
            {/* connector to the next step */}
            {next && (
              <span
                aria-hidden
                className={`absolute top-[19px] left-1/2 w-full h-[3px] rounded-full ${next.done
                  ? 'bg-emerald-500'
                  : s.done
                    ? 'bg-gradient-to-r from-emerald-500 to-slate-700'
                    : 'bg-slate-800'
                  }`}
              />
            )}

            <span className="relative z-10">
              {isCurrent && (
                <span aria-hidden className="absolute inset-0 rounded-full bg-sky-400/30 motion-safe:animate-ping" />
              )}
              <span
                className={`relative h-10 w-10 rounded-full flex items-center justify-center border-2 transition-colors ${state === 'done'
                  ? 'bg-emerald-950 border-emerald-500 text-emerald-400'
                  : state === 'current'
                    ? 'bg-sky-950 border-sky-400 text-sky-300'
                    : 'bg-slate-900 border-slate-700 text-slate-600'
                  }`}
              >
                <s.Icon className="w-[18px] h-[18px]" strokeWidth={2.25} />
              </span>
            </span>

            <span
              className={`mt-2.5 text-[11px] md:text-xs font-semibold leading-tight ${state === 'done' ? 'text-emerald-400' : state === 'current' ? 'text-sky-300' : 'text-slate-500'
                }`}
            >
              {s.label}
            </span>
            <span className="text-[10px] md:text-[11px] text-slate-500 mt-0.5 h-3.5">
              {s.done ? shortDate(s.at) : isCurrent ? 'Next' : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function TrackingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [buyerId, setBuyerId] = useState<string | null>(null);
  const [orders, setOrders] = useState<TrackedPO[]>([]);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const fetchOrders = useCallback(async (id: string) => {
    try {
      const { data, error: err } = await supabase
        .from('purchase_orders')
        .select(
          'id, po_number, total_amount, created_at, order_description, delivery_location, payment_status, paid_at, supplier_id, supplier_responded_at, dispatched_at, delivery_confirmed_at, dispatch_note'
        )
        .eq('buyer_id', id)
        .eq('supplier_status', 'accepted')
        .in('payment_status', ['deposit_paid', 'paid'])
        .order('created_at', { ascending: false });

      if (err) {
        console.error('Tracking fetch error:', err);
        setError(true);
        return;
      }
      setError(false);
      const rows = (data || []) as TrackedPO[];
      setOrders(rows);

      const ids = Array.from(new Set(rows.map((r) => r.supplier_id).filter(Boolean))) as string[];
      if (ids.length > 0) {
        const { data: sups } = await supabase.from('suppliers').select('id, company_name').in('id', ids);
        setSuppliers(Object.fromEntries((sups || []).map((s: any) => [s.id, s.company_name])));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const guard = async () => {
      const {
        data: { user: u },
      } = await supabase.auth.getUser();
      if (!u) {
        router.replace('/login');
        return;
      }
      const { data: sup } = await supabase.from('suppliers').select('id').eq('user_id', u.id).maybeSingle();
      if (sup) {
        router.replace('/supplier');
        return;
      }
      if (!mounted) return;
      setUser(u);
      setBuyerId(u.id);
      fetchOrders(u.id);
      setReady(true);
    };
    guard();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) router.replace('/login');
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [router, fetchOrders]);

  // Live updates: the moment a supplier taps "Dispatched" or "Delivered", it shows here.
  useEffect(() => {
    if (!buyerId) return;
    const channel = supabase
      .channel('buyer-tracking')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'purchase_orders', filter: `buyer_id=eq.${buyerId}` },
        () => fetchOrders(buyerId)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [buyerId, fetchOrders]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const counts = useMemo(() => {
    const c = { all: orders.length, preparing: 0, dispatched: 0, delivered: 0 };
    orders.forEach((o) => c[stageOf(o)]++);
    return c;
  }, [orders]);

  // On-the-way orders first (what buyers care about most), then preparing, then delivered.
  const visible = useMemo(() => {
    const rank: Record<Stage, number> = { dispatched: 0, preparing: 1, delivered: 2 };
    return orders
      .filter((o) => filter === 'all' || stageOf(o) === filter)
      .sort((a, b) => rank[stageOf(a)] - rank[stageOf(b)] || +new Date(b.created_at) - +new Date(a.created_at));
  }, [orders, filter]);

  // `short` is the label on the phone tab bar.
  // `group: 'apps'` items show under the "Apps" heading in the desktop sidebar.
  const navItems = [
    { href: '/', label: 'Dashboard', short: 'Home', Icon: ShoppingBag, active: false, group: 'main' },
    { href: '/marketplace', label: 'Marketplace', short: 'Market', Icon: Store, active: false, group: 'main' },
    { href: '/rfqs', label: 'RFQs & quotes', short: 'RFQs', Icon: FileText, active: false, group: 'main' },
    { href: '/pos', label: 'Purchase orders', short: 'Orders', Icon: CheckCircle, active: false, group: 'main' },
    { href: '/tracking', label: 'Order tracking', short: 'Tracking', Icon: Truck, active: true, group: 'main' },
    { href: '/insights', label: 'Market insights', short: 'Insights', Icon: Newspaper, active: false, group: 'main' },
    { href: '/developer', label: 'Developer API', short: 'API', Icon: KeyRound, active: false, group: 'main' },
    { href: '/sharp', label: 'My Plug', short: 'Plug', Icon: Wrench, active: false, group: 'apps' },
    { href: '/dispatch', label: 'Errand', short: 'Errand', Icon: Bike, active: false, group: 'apps' },
  ];

  const mainNav = navItems.filter((i) => i.group === 'main');
  const appsNav = navItems.filter((i) => i.group === 'apps');

  const renderNavLink = ({ href, label, short, Icon, active }: (typeof navItems)[number]) => (
    <Link
      key={href}
      href={href}
      title={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={`relative flex flex-1 md:flex-none flex-col md:flex-row items-center justify-center gap-1 md:gap-3 py-2.5 md:py-2 md:px-3 md:rounded-lg text-[10px] md:text-[13px] font-medium transition ${collapsed ? '' : 'md:justify-start'
        } ${active
          ? 'text-emerald-400 md:bg-emerald-500/10 md:before:absolute md:before:left-0 md:before:top-2 md:before:bottom-2 md:before:w-0.5 md:before:rounded-full md:before:bg-emerald-400'
          : 'text-slate-400 hover:text-slate-200 md:hover:bg-slate-800/60'
        }`}
    >
      <Icon className="w-5 h-5 md:w-[15px] md:h-[15px] shrink-0" />
      <span className="md:hidden">{short}</span>
      <span className={`hidden ${collapsed ? '' : 'md:inline'}`}>{label}</span>
    </Link>
  );

  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'dispatched', label: 'On the way' },
    { key: 'preparing', label: 'Being prepared' },
    { key: 'delivered', label: 'Delivered' },
  ];

  if (!ready) {
    return (
      <div className="flex h-screen w-screen bg-slate-950 items-center justify-center">
        <div className="text-slate-400 text-sm">Loading your orders...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      <aside
        className={`order-last md:order-first shrink-0 flex md:flex-col bg-slate-900 border-t md:border-t-0 md:border-r border-slate-800 pb-[env(safe-area-inset-bottom)] md:pb-0 md:transition-[width] md:duration-200 ${collapsed ? 'md:w-[76px]' : 'md:w-64'
          }`}
      >
        <div className={`hidden md:flex items-center gap-3 h-16 border-b border-slate-800 shrink-0 ${collapsed ? 'justify-center' : 'px-5'}`}>
          <div className="h-9 w-9 rounded-xl bg-emerald-500 flex items-center justify-center font-bold text-slate-950 text-xl shrink-0">V</div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-bold text-white leading-tight">Velrenta</p>
              <p className="text-[11px] text-slate-400 leading-tight">Buyer portal</p>
            </div>
          )}
        </div>

        <nav className="flex flex-1 md:flex-col md:gap-1 md:p-3" aria-label="Main">
          {mainNav.map(renderNavLink)}

          {/* "Apps" group heading (desktop only; becomes a thin divider when collapsed) */}
          <div className="hidden md:block mt-4 mb-1 px-3">
            {collapsed ? (
              <div className="h-px bg-slate-800" />
            ) : (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Apps</p>
            )}
          </div>

          {appsNav.map(renderNavLink)}
        </nav>

        <div className="hidden md:block border-t border-slate-800 p-3 space-y-2 shrink-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-xs text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 transition ${collapsed ? 'justify-center' : ''}`}
          >
            {collapsed ? <ChevronsRight className="w-4 h-4" /> : (<><ChevronsLeft className="w-4 h-4" /> Collapse</>)}
          </button>
          <div className={`rounded-xl bg-slate-800/50 border border-slate-700/50 p-2.5 flex items-center gap-3 ${collapsed ? 'flex-col' : ''}`}>
            <div className="h-9 w-9 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center font-bold text-xs text-emerald-400 shrink-0">
              {user?.email?.[0]?.toUpperCase() || 'U'}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-slate-400 truncate">{user?.email}</p>
              </div>
            )}
            <button onClick={handleLogout} title="Log out" aria-label="Log out" className="text-slate-400 hover:text-red-400 p-1 transition shrink-0">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-8 pb-8">
          <header className="pt-4 md:pt-8 pb-2">
            <h1 className="text-2xl font-bold text-white">Order tracking</h1>
            <p className="text-slate-400 text-sm mt-1">
              See where every paid order is, from the supplier&apos;s yard to your door. Updates appear here live.
            </p>
          </header>

          {/* Filters stay visible while scrolling through orders */}
          <div className="sticky top-0 z-20 -mx-4 md:-mx-8 px-4 md:px-8 py-3 bg-slate-950/90 backdrop-blur">
            <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Filter orders">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={filter === t.key}
                  onClick={() => setFilter(t.key)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition ${filter === t.key
                    ? 'bg-slate-100 text-slate-900 border-slate-100'
                    : 'text-slate-400 border-slate-800 hover:border-slate-600 hover:text-slate-200'
                    }`}
                >
                  {t.label}{' '}
                  {loading ? (
                    <span className="inline-block align-middle h-3 w-4 rounded bg-slate-700/60 animate-pulse" />
                  ) : (
                    <span className={filter === t.key ? 'text-slate-600' : 'text-slate-500'}>{counts[t.key]}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4 mt-1">
            {loading ? (
              [0, 1].map((i) => (
                <div key={i} className="bg-slate-900 rounded-2xl border border-slate-800 p-5 animate-pulse">
                  <div className="h-3.5 w-40 rounded bg-slate-800" />
                  <div className="h-3 w-2/3 rounded bg-slate-800/70 mt-3" />
                  <div className="h-8 w-full rounded bg-slate-800/60 mt-6" />
                </div>
              ))
            ) : error ? (
              <div className="bg-slate-900 rounded-2xl border border-dashed border-red-500/30 p-8 text-center">
                <p className="text-sm text-slate-300">We couldn&apos;t load your orders</p>
                <p className="text-xs text-slate-500 mt-1">Refresh the page. If it keeps happening, contact the Velrenta team.</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="bg-slate-900 rounded-2xl border border-dashed border-slate-800 p-10 text-center">
                <Truck className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-300">
                  {orders.length === 0 ? 'No paid orders to track yet' : 'Nothing in this view'}
                </p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  {orders.length === 0
                    ? 'Once a supplier accepts your purchase order and confirms your payment, it appears here and you can follow it until it arrives.'
                    : 'Switch tabs to see your other orders.'}
                </p>
                {orders.length === 0 && (
                  <Link
                    href="/pos"
                    className="inline-block mt-4 text-xs font-bold border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 text-slate-300 rounded-lg px-3.5 py-2 transition"
                  >
                    View purchase orders
                  </Link>
                )}
              </div>
            ) : (
              visible.map((po) => {
                const stage = stageOf(po);
                const meta = STAGE_META[stage];
                const h = headline(po, stage);
                const steps = buildSteps(po);
                const doneCount = steps.filter((s) => s.done).length;
                const StageIcon = meta.Icon;
                return (
                  <article
                    key={po.id}
                    className={`relative overflow-hidden bg-slate-900 rounded-2xl border border-slate-800 p-4 md:p-6 pl-5 md:pl-7 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${meta.edge}`}
                  >
                    {/* Order summary */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="font-mono text-sm text-white">{po.po_number}</span>
                          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${meta.badge}`}>{meta.label}</span>
                        </div>
                        <p className="text-sm text-slate-200 mt-2 font-medium">{po.order_description || 'Purchase order'}</p>
                        <p className="text-xs text-slate-500 mt-1">
                          from {(po.supplier_id && suppliers[po.supplier_id]) || 'your supplier'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg md:text-xl font-bold text-emerald-400 leading-tight">{formatAmount(po.total_amount)}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{po.payment_status === 'paid' ? 'Paid in full' : 'Upfront paid'}</p>
                      </div>
                    </div>

                    {/* Current status: the one thing buyers want to know */}
                    <div className={`mt-5 rounded-xl border p-3.5 flex items-start gap-3.5 ${meta.panel}`}>
                      <span className={`h-11 w-11 shrink-0 rounded-xl border flex items-center justify-center ${meta.tile}`}>
                        <StageIcon className="w-5 h-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm md:text-base font-semibold text-white leading-snug">{h.title}</p>
                          <span className="text-[11px] text-slate-400 whitespace-nowrap mt-0.5">{doneCount} of 4 steps</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{h.sub}</p>
                        {po.dispatch_note && stage !== 'preparing' && (
                          <p className="text-xs text-slate-300 mt-2.5 pt-2.5 border-t border-white/5 break-words">
                            <span className="text-slate-500">Delivery details: </span>
                            {po.dispatch_note}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Step tracker */}
                    <div className="mt-6">
                      <Tracker steps={steps} />
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between gap-3 flex-wrap mt-6 pt-4 border-t border-slate-800 text-xs text-slate-500">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{po.delivery_location || 'No delivery location'}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        Ordered {longDate(po.created_at)}
                      </span>
                    </div>

                    {stage === 'delivered' && (
                      <Link
                        href="/"
                        className="inline-flex items-center gap-1.5 mt-4 text-xs font-semibold text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg px-3 py-2 transition"
                      >
                        <Star className="w-3.5 h-3.5" />
                        Rate this supplier
                      </Link>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </div>
      </main>
    </div>
  );
}