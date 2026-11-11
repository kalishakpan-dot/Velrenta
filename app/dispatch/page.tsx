'use client';

// app/dispatch/page.tsx  (customer: send a rider on an errand)
// Bolt-style: shows riders available now, offers the errand to one rider at a time (30s each),
// then shows the accepted rider, delivery code, receipt, live location and rating.

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ShoppingBasket, Wine, Apple, Pill, PackageCheck, Sparkles, ArrowLeft, Bike, MapPin, Clock,
  CheckCircle, Loader2, Star, Phone, AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

interface Errand {
  id: string;
  category: string;
  title: string;
  delivery_address: string;
  item_budget: number | null;
  delivery_fee: number | null;
  status: string;
  created_at: string;
  rider_release_reason: string | null;
  released_rider_name: string | null;
  delivery_code: string | null;
  actual_item_cost: number | null;
  receipt_note: string | null;
  rider_stars: number | null;
}
interface RiderCard { id: string; name: string; vehicle: string; area: string | null; rating: number; trips: number }
interface Counts { online: number; busy: number }
interface Loc { lat: number; lng: number; seconds_ago: number }
interface DispatchInfo {
  errand_status: string;
  offer_status: string | null;
  seconds_left: number;
  rider: { name: string; vehicle: string; plate: string | null; area: string | null; rating: number; trips: number; phone: string | null } | null;
  at: number; // when we fetched it, for the local countdown
}

const OFFER_SECONDS = 30;
const ACTIVE = ['pending', 'offering', 'no_riders', 'accepted', 'in_progress'];
const SEARCHING = ['pending', 'offering', 'no_riders'];

const CATEGORIES = [
  { id: 'market', label: 'Market run', hint: 'Foodstuff, provisions, fresh produce', Icon: ShoppingBasket, base: 1500, placeholder: 'e.g. 1 paint bucket of garri, 2 tubers of yam, tomatoes (₦2,000), pepper, onions...' },
  { id: 'drinks', label: 'Drinks', hint: 'Beer, soft drinks, water, wine', Icon: Wine, base: 1200, placeholder: 'e.g. 2 crates of Maltina, 1 carton of bottled water, 3 bottles of red wine...' },
  { id: 'groceries', label: 'Supermarket', hint: 'Toiletries, cooking items, snacks', Icon: Apple, base: 1200, placeholder: 'e.g. Indomie (1 carton), Peak milk tin, 5kg rice, detergent...' },
  { id: 'pharmacy', label: 'Pharmacy', hint: 'Drugs and health items', Icon: Pill, base: 1000, placeholder: 'e.g. Paracetamol, Vitamin C, and the prescription I will send on WhatsApp...' },
  { id: 'pickup', label: 'Pick up & drop', hint: 'Parcels, documents, keys, laundry', Icon: PackageCheck, base: 1000, placeholder: 'e.g. Collect a brown envelope from Mr. Ade at the front desk and deliver it...' },
  { id: 'custom', label: 'Other errand', hint: 'Anything else, just explain', Icon: Sparkles, base: 1500, placeholder: 'Describe what you need the rider to do...' },
];
const URGENCY = [
  { id: 'now', label: 'Right now', extra: 500 },
  { id: '1hr', label: 'Within 1 hour', extra: 200 },
  { id: 'scheduled', label: 'Schedule', extra: 0 },
];

const naira = (n: number | null | undefined) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const initials = (n: string) => n.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
const vehicleLabel = (v: string) => ({ bike: 'Motorbike', tricycle: 'Keke', car: 'Car', van: 'Van' } as Record<string, string>)[v] || v;

const statusStyle = (s: string) => {
  switch (s) {
    case 'delivered': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    case 'cancelled': return 'bg-slate-800 text-slate-400 border-slate-700';
    case 'accepted':
    case 'in_progress': return 'bg-sky-500/10 text-sky-300 border-sky-500/30';
    default: return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  }
};
const statusLabel = (s: string) =>
  ({ pending: 'Finding a rider', offering: 'Offered to a rider', no_riders: 'No rider free', accepted: 'Rider assigned', in_progress: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' } as Record<string, string>)[s] || s;

function Avatar({ name }: { name: string }) {
  return (
    <span className="h-9 w-9 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center justify-center shrink-0">
      {initials(name)}
    </span>
  );
}

// "Riders available now": the Bolt-style strip. First card = next in the queue.
function AvailableRiders({ riders, error, counts }: { riders: RiderCard[]; error: string | null; counts: Counts | null }) {
  const busyOnly = riders.length === 0 && !error && counts && counts.online > 0;
  return (
    <section className="mb-5">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-sm font-bold text-white">Riders available now</p>
        <span className="text-[11px] text-emerald-400 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {riders.length} online
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-300 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5">
          Could not load riders: {error}. Run <span className="font-mono">fix_available_riders.sql</span> in Supabase.
        </p>
      ) : riders.length === 0 ? (
        <p className="text-xs text-slate-500 rounded-xl border border-slate-800 bg-slate-900 p-3.5">
          {busyOnly
            ? `${counts!.online} rider${counts!.online === 1 ? ' is' : 's are'} online but busy on other errands. Send your errand and it goes to the next rider who is free.`
            : 'No riders are online right now. You can still send your errand and tap Search again when one comes online.'}
        </p>
      ) : (
        <div className="flex gap-2.5 overflow-x-auto pb-1">
          {riders.map((r, i) => (
            <div key={r.id} className={`shrink-0 w-48 rounded-xl border p-3 ${i === 0 ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-800 bg-slate-900'}`}>
              <div className="flex items-center gap-2.5">
                <Avatar name={r.name} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{r.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{vehicleLabel(r.vehicle)}{r.area ? ` · ${r.area}` : ''}</p>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2.5 text-[11px] text-slate-400">
                <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-400 fill-amber-400" />{Number(r.rating).toFixed(1)} · {r.trips} errands</span>
                {i === 0 && <span className="text-emerald-400 font-semibold">Next up</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// The rider currently offered this errand (30s countdown), or the accepted rider with a Call button.
function DispatchPanel({ status, d, secs, onRetry }: { status: string; d?: DispatchInfo; secs: number; onRetry: () => void }) {
  if (!ACTIVE.includes(status)) return null;
  const r = d?.rider;
  const box = 'mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3';

  if (status === 'no_riders') {
    return (
      <div className={`${box} flex items-center justify-between gap-3`}>
        <p className="text-xs text-slate-400">No rider is free right now.</p>
        <button onClick={onRetry} className="text-xs font-bold text-emerald-400 hover:text-emerald-300 transition">Search again</button>
      </div>
    );
  }
  if ((status === 'accepted' || status === 'in_progress') && r) {
    return (
      <div className={`${box} flex items-center gap-3`}>
        <Avatar name={r.name} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">{r.name} is your rider</p>
          <p className="text-[11px] text-slate-500 truncate">{vehicleLabel(r.vehicle)}{r.plate ? ` · ${r.plate}` : ''} · ★ {Number(r.rating).toFixed(1)}</p>
        </div>
        {r.phone && (
          <a href={`tel:+${r.phone.replace(/\D/g, '')}`} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg px-3 py-2 transition">
            <Phone className="w-3.5 h-3.5" /> Call
          </a>
        )}
      </div>
    );
  }
  if (r && d?.offer_status === 'offered' && secs > 0) {
    return (
      <div className={box}>
        <div className="flex items-center gap-3">
          <Avatar name={r.name} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white truncate">{r.name}</p>
            <p className="text-[11px] text-slate-500 truncate">{vehicleLabel(r.vehicle)}{r.area ? ` · ${r.area}` : ''} · ★ {Number(r.rating).toFixed(1)}</p>
          </div>
          <span className="text-xs font-semibold text-emerald-400 tabular-nums">{secs}s</span>
        </div>
        <div className="h-1 rounded-full bg-slate-800 mt-2.5 overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all duration-1000 ease-linear" style={{ width: `${(secs / OFFER_SECONDS) * 100}%` }} />
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5">Waiting for {r.name} to accept. If they don&apos;t, the next rider gets it.</p>
      </div>
    );
  }
  return (
    <div className={`${box} flex items-center gap-2 text-xs text-slate-400`}>
      <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
      {d?.offer_status === 'expired' || d?.offer_status === 'declined' ? 'That rider is busy. Trying the next one...' : 'Finding a rider...'}
    </div>
  );
}

function RiderMap({ loc }: { loc: Loc }) {
  const d = 0.008;
  const bbox = [loc.lng - d, loc.lat - d, loc.lng + d, loc.lat + d].join(',');
  const src = 'https://www.openstreetmap.org/export/embed.html?bbox=' + bbox + '&layer=mapnik&marker=' + loc.lat + '%2C' + loc.lng;
  return (
    <div className="mt-3">
      <iframe title="Rider location" src={src} loading="lazy" className="w-full h-40 rounded-lg border border-slate-800" />
      <p className="text-[11px] text-slate-500 mt-1.5">Live rider location · updated {loc.seconds_ago}s ago</p>
    </div>
  );
}

function RateRider({ e, onRated }: { e: Errand; onRated: () => void }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  if (e.rider_stars) return <p className="mt-3 text-xs text-slate-400">You rated this rider {e.rider_stars} out of 5.</p>;
  const send = async () => {
    if (!stars) return;
    setBusy(true);
    await supabase.rpc('rate_rider', { p_errand_id: e.id, p_stars: stars, p_comment: comment });
    setBusy(false);
    onRated();
  };
  return (
    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-xs font-medium text-slate-300">How was your rider?</p>
      <div className="flex gap-1 mt-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setStars(n)} aria-label={n + ' stars'} aria-pressed={stars === n}>
            <Star className={'w-7 h-7 ' + (n <= stars ? 'text-amber-400 fill-amber-400' : 'text-slate-600')} />
          </button>
        ))}
      </div>
      {stars > 0 && (
        <>
          <input value={comment} onChange={(ev) => setComment(ev.target.value)} maxLength={300} placeholder="Add a comment (optional)" className="w-full mt-2.5 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500" />
          <button onClick={send} disabled={busy} className="mt-2.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg px-4 py-2 transition">{busy ? 'Sending...' : 'Submit rating'}</button>
        </>
      )}
    </div>
  );
}

function ErrandExtras({ e, loc, onRated }: { e: Errand; loc?: Loc; onRated: () => void }) {
  const live = e.status === 'accepted' || e.status === 'in_progress';
  const diff = e.actual_item_cost != null ? (e.item_budget || 0) - e.actual_item_cost : 0;
  return (
    <>
      {live && e.delivery_code && (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">Your delivery code. Tell the rider only when you have your order.</p>
          <span className="text-2xl font-bold tracking-[0.3em] text-emerald-400 tabular-nums">{e.delivery_code}</span>
        </div>
      )}
      {live && loc && <RiderMap loc={loc} />}
      {e.actual_item_cost != null && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
          <p>Rider spent <b className="text-white">{naira(e.actual_item_cost)}</b> on items (you gave {naira(e.item_budget)}).</p>
          {diff > 0 && <p className="text-emerald-400 mt-1">The rider should hand back {naira(diff)} change.</p>}
          {diff < 0 && <p className="text-amber-400 mt-1">That is {naira(-diff)} more than your budget.</p>}
          {e.receipt_note && <p className="text-slate-500 mt-1">Note: {e.receipt_note}</p>}
        </div>
      )}
      {e.status === 'delivered' && <RateRider e={e} onRated={onRated} />}
    </>
  );
}

const field =
  'w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition';

export default function DispatchPage() {
  const router = useRouter();
  const [buyerId, setBuyerId] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [errands, setErrands] = useState<Errand[]>([]);
  const [loading, setLoading] = useState(true);

  const [category, setCategory] = useState('market');
  const [details, setDetails] = useState('');
  const [pickup, setPickup] = useState('');
  const [address, setAddress] = useState('');
  const [budget, setBudget] = useState('');
  const [urgency, setUrgency] = useState('now');
  const [when, setWhen] = useState('');
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [available, setAvailable] = useState<RiderCard[]>([]);
  const [availError, setAvailError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [dispatch, setDispatch] = useState<Record<string, DispatchInfo>>({});
  const [locs, setLocs] = useState<Record<string, Loc>>({});
  const [now, setNow] = useState(Date.now());
  const errandsRef = useRef<Errand[]>([]);
  const advancing = useRef<Set<string>>(new Set());

  const cat = CATEGORIES.find((c) => c.id === category)!;
  const fee = cat.base + (URGENCY.find((u) => u.id === urgency)?.extra || 0);
  const itemBudget = Number(budget.replace(/,/g, '')) || 0;

  const loadErrands = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from('dispatch_errands')
      .select('id, category, title, delivery_address, item_budget, delivery_fee, status, created_at, rider_release_reason, released_rider_name, delivery_code, actual_item_cost, receipt_note, rider_stars')
      .eq('buyer_id', id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) console.error('Errands fetch error:', error);
    if (data) setErrands(data as Errand[]);
    setLoading(false);
  }, []);

  // Sign-in check, buyer profile, errands, and a realtime channel with a unique name per mount
  // (a shared name made React's double-mount in dev throw "cannot add postgres_changes callbacks").
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.replace('/login');
      const { data: buyer } = await supabase.from('buyers').select('id, phone').eq('id', user.id).maybeSingle();
      if (cancelled) return;
      setBuyerId(user.id);
      if (buyer?.phone) { setPhone(buyer.phone); setContact(buyer.phone); }
      await loadErrands(user.id);
      if (cancelled) return;
      channel = supabase
        .channel('dispatch-errands-' + Math.random().toString(36).slice(2))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatch_errands' }, () => loadErrands(user.id))
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [router, loadErrands]);

  errandsRef.current = errands;
  const secsLeft = (d?: DispatchInfo) => (d ? Math.max(0, d.seconds_left - Math.floor((now - d.at) / 1000)) : 0);

  // Riders available now. Its own poll, so nothing else on the page can stop it.
  const loadAvailable = useCallback(async () => {
    try {
      const [a, c] = await Promise.all([supabase.rpc('get_available_riders'), supabase.rpc('get_rider_counts')]);
      if (a.error) { console.error('get_available_riders error:', a.error); setAvailError(a.error.message); return; }
      setAvailError(null);
      setAvailable(Array.isArray(a.data) ? (a.data as RiderCard[]) : []);
      if (c.data) setCounts(c.data as Counts);
    } catch (err: any) {
      setAvailError(err?.message || 'Network error');
    }
  }, []);

  // The rider offered each open errand (with countdown) and the rider's live location.
  const refreshDispatch = useCallback(async () => {
    try {
      const open = errandsRef.current.filter((e) => ACTIVE.includes(e.status));
      const results = await Promise.all(open.map(async (e) => [e.id, (await supabase.rpc('get_errand_rider', { p_errand_id: e.id })).data] as const));
      setDispatch((prev) => {
        const next = { ...prev };
        results.forEach(([id, data]) => { if (data) next[id] = { ...(data as any), at: Date.now() }; });
        return next;
      });
    } catch (err) {
      console.error('refreshDispatch error:', err);
    }
    try {
      const moving = errandsRef.current.filter((e) => e.status === 'accepted' || e.status === 'in_progress');
      const locRes = await Promise.all(moving.map(async (e) => [e.id, (await supabase.rpc('get_errand_location', { p_errand_id: e.id })).data] as const));
      setLocs(Object.fromEntries(locRes.filter(([, d]) => d)) as Record<string, Loc>);
    } catch (err) {
      console.error('location error:', err);
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!buyerId) return;
    loadAvailable();
    const t = setInterval(loadAvailable, 5000);
    return () => clearInterval(t);
  }, [buyerId, loadAvailable]);

  useEffect(() => {
    if (!buyerId) return;
    refreshDispatch();
    const t = setInterval(refreshDispatch, 4000);
    return () => clearInterval(t);
  }, [buyerId, errands.length, refreshDispatch]);

  // No live offer (new errand, declined, or timed out): offer it to the next rider in the queue.
  useEffect(() => {
    errands.forEach((e) => {
      if (e.status !== 'pending' && e.status !== 'offering') return;
      const d = dispatch[e.id];
      const live = d && d.offer_status === 'offered' && secsLeft(d) > 0;
      if (live || advancing.current.has(e.id)) return;
      advancing.current.add(e.id);
      supabase.rpc('advance_dispatch', { p_errand_id: e.id }).then(() => {
        if (buyerId) loadErrands(buyerId);
        refreshDispatch();
        loadAvailable();
      });
      setTimeout(() => advancing.current.delete(e.id), 3000);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, errands, dispatch]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setNotice(null);
    if (!details.trim() || !address.trim() || !buyerId) {
      setNotice({ ok: false, text: 'Add what you need and where the rider should deliver it.' });
      return;
    }
    if (urgency === 'scheduled' && !when) {
      setNotice({ ok: false, text: 'Pick the date and time for the errand.' });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('dispatch_errands').insert({
      buyer_id: buyerId,
      category,
      title: `${cat.label}: ${details.trim().slice(0, 60)}`,
      details: details.trim(),
      pickup_location: pickup.trim() || null,
      delivery_address: address.trim(),
      item_budget: itemBudget,
      delivery_fee: fee, // the database recalculates this, so it cannot be tampered with
      urgency,
      scheduled_for: urgency === 'scheduled' ? new Date(when).toISOString() : null,
      contact_phone: contact.trim() || phone || null,
    });
    setSubmitting(false);
    if (error) {
      console.error('Errand insert error:', error);
      setNotice({ ok: false, text: 'Could not send your errand. Check your connection and try again.' });
      return;
    }
    setDetails(''); setPickup(''); setBudget(''); setWhen('');
    setNotice({ ok: true, text: 'Errand sent. We are finding a rider near you.' });
    loadErrands(buyerId);
  };

  const cancel = async (id: string) => {
    if (!buyerId) return;
    await supabase.rpc('cancel_errand', { p_errand_id: id });
    loadErrands(buyerId);
  };

  const retry = async (id: string) => {
    await supabase.rpc('retry_dispatch', { p_errand_id: id });
    if (buyerId) loadErrands(buyerId);
    refreshDispatch();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <div className="max-w-3xl mx-auto p-4 md:p-8 pb-24">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-emerald-400 transition mb-5">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to dashboard
        </Link>

        <header className="mb-6 flex items-center gap-3">
          <span className="h-11 w-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <Bike className="w-5 h-5 text-emerald-400" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-white">Send a rider</h1>
            <p className="text-slate-400 text-sm mt-0.5">Tell us what to buy or pick up. A rider does the running for you.</p>
          </div>
        </header>

        <AvailableRiders riders={available} error={availError} counts={counts} />

        <form onSubmit={submit} className="space-y-5">
          <section>
            <p className="text-sm font-bold text-white mb-2.5">What kind of errand?</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {CATEGORIES.map(({ id, label, hint, Icon }) => {
                const on = id === category;
                return (
                  <button type="button" key={id} onClick={() => setCategory(id)} aria-pressed={on}
                    className={`text-left rounded-xl border p-3.5 transition ${on ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-600'}`}>
                    <Icon className={`w-5 h-5 mb-2 ${on ? 'text-emerald-400' : 'text-slate-400'}`} />
                    <p className="text-sm font-semibold text-white">{label}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{hint}</p>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1.5">What should the rider get or do?</label>
              <textarea rows={4} value={details} onChange={(e) => setDetails(e.target.value)} placeholder={cat.placeholder} className={`${field} resize-none`} />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1.5">Where to buy or collect (optional)</label>
                <input value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="e.g. Mile 3 Market, Shoprite GRA" className={field} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1.5">Deliver to</label>
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House number, street, landmark" className={field} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1.5">Cash for the items (₦)</label>
                <input inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d,]/g, ''))} placeholder="0 if nothing to buy" className={field} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1.5">Phone the rider can call</label>
                <input type="tel" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="080..." className={field} />
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> When do you need it?</p>
              <div className="flex flex-wrap gap-2">
                {URGENCY.map((u) => (
                  <button type="button" key={u.id} onClick={() => setUrgency(u.id)} aria-pressed={urgency === u.id}
                    className={`text-xs rounded-full border px-3.5 py-1.5 transition ${urgency === u.id ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-400 font-semibold' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
                    {u.label}
                  </button>
                ))}
              </div>
              {urgency === 'scheduled' && <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={`${field} mt-3 sm:w-64`} />}
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex justify-between text-sm text-slate-300"><span>Rider fee (estimate)</span><span className="font-semibold text-white">{naira(fee)}</span></div>
            <div className="flex justify-between text-sm text-slate-300 mt-1.5"><span>Cash for items</span><span className="font-semibold text-white">{naira(itemBudget)}</span></div>
            <div className="flex justify-between text-sm mt-3 pt-3 border-t border-slate-800"><span className="text-slate-300">Have ready for the rider</span><span className="font-bold text-emerald-400">{naira(fee + itemBudget)}</span></div>
            <p className="text-[11px] text-slate-500 mt-2">The rider confirms the final fee before starting, based on distance and traffic.</p>
          </section>

          {notice && (
            <p role="status" className={`text-xs rounded-lg border px-3.5 py-2.5 flex items-center gap-2 ${notice.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
              {notice.ok && <CheckCircle className="w-4 h-4 shrink-0" />}{notice.text}
            </p>
          )}

          <button type="submit" disabled={submitting}
            className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold py-3 rounded-xl text-sm transition">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bike className="w-4 h-4" />}
            {submitting ? 'Sending...' : 'Send rider'}
          </button>
        </form>

        <section className="rounded-xl border border-slate-800 bg-slate-900 mt-8">
          <div className="px-4 py-3.5 border-b border-slate-800"><h2 className="text-sm font-bold text-white">Your errands</h2></div>
          {loading ? (
            <div className="p-4 space-y-3">{[0, 1].map((i) => <div key={i} className="h-10 rounded bg-slate-800 animate-pulse" />)}</div>
          ) : errands.length === 0 ? (
            <div className="p-10 text-center">
              <Bike className="w-6 h-6 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-300">No errands yet</p>
              <p className="text-xs text-slate-500 mt-1">Fill the form above and your first rider is on the way.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-800/70">
              {errands.map((e) => (
                <li key={e.id} className="px-4 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{e.title}</p>
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 truncate">
                        <MapPin className="w-3 h-3 shrink-0" />{e.delivery_address} · {naira((e.delivery_fee || 0) + (e.item_budget || 0))}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${statusStyle(e.status)}`}>{statusLabel(e.status)}</span>
                      {SEARCHING.includes(e.status) && <button onClick={() => cancel(e.id)} className="text-[11px] text-slate-400 hover:text-red-400 transition">Cancel</button>}
                    </div>
                  </div>

                  {e.rider_release_reason && SEARCHING.includes(e.status) && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold">{e.released_rider_name || 'Your rider'} had to drop this errand</p>
                        <p className="text-amber-300/80 mt-0.5">Reason: {e.rider_release_reason}. We are finding you another rider.</p>
                      </div>
                    </div>
                  )}

                  <DispatchPanel status={e.status} d={dispatch[e.id]} secs={secsLeft(dispatch[e.id])} onRetry={() => retry(e.id)} />
                  <ErrandExtras e={e} loc={locs[e.id]} onRated={() => buyerId && loadErrands(buyerId)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}