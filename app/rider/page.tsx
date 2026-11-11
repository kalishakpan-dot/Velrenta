'use client';

// app/rider/page.tsx  (rider dashboard)
// Phone-first. Tabs: Home (requests + active errand), Earnings, Settings.
// A rider goes online, gets errand requests with a 30-second countdown (sound + vibration +
// title flash), accepts, then moves the errand along: accepted -> in progress -> delivered.
// If they cannot finish, they drop it with a reason: the customer is told and it goes to the next rider.

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bike,
  LogOut,
  MapPin,
  Phone,
  Navigation,
  Wallet,
  Star,
  CheckCircle,
  Loader2,
  BellRing,
  PackageCheck,
  Clock,
  Home,
  Settings as SettingsIcon,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import RiderSettings, { type RiderProfile } from '../components/RiderSettings';
import RiderEarnings from '../components/RiderEarnings';
import RiderWallet from '../components/RiderWallet';
import DeliveryFlow from '../components/DeliveryFlow';

type Rider = RiderProfile;
type View = 'home' | 'earnings' | 'settings';

interface Offer {
  offer_id: string;
  errand_id: string;
  seconds_left: number;
  category: string;
  title: string;
  details: string | null;
  pickup_location: string | null;
  delivery_address: string;
  item_budget: number | null;
  delivery_fee: number | null;
  urgency: string | null;
  scheduled_for: string | null;
  at: number; // when we fetched it, for the local countdown
}

interface Job {
  id: string;
  category: string;
  title: string;
  details: string | null;
  pickup_location: string | null;
  delivery_address: string;
  item_budget: number | null;
  delivery_fee: number | null;
  status: 'accepted' | 'in_progress';
  contact_phone: string | null;
  buyer_name: string | null;
  actual_item_cost: number | null;
  receipt_note: string | null;
  urgency: string | null;
  scheduled_for: string | null;
}

interface Recent {
  today_jobs: number;
  today_earned: number;
  jobs: { id: string; title: string; delivery_fee: number | null; status: string; updated_at: string }[];
}

const OFFER_SECONDS = 30;
const SOUND_KEY = 'velrenta_rider_sound';

const CATEGORY_LABEL: Record<string, string> = {
  market: 'Market run',
  drinks: 'Drinks',
  groceries: 'Supermarket',
  pharmacy: 'Pharmacy',
  pickup: 'Pick up & drop',
  custom: 'Other errand',
};
const URGENCY_LABEL: Record<string, string> = { now: 'Right now', '1hr': 'Within 1 hour', scheduled: 'Scheduled' };
const VEHICLE_LABEL: Record<string, string> = { bike: 'Motorbike', tricycle: 'Keke', car: 'Car', van: 'Van' };
const CANCEL_REASONS = ['Vehicle problem', 'Emergency', "Can't find the item", 'Customer not reachable', "Can't locate the address", 'Other'];

const naira = (n: number | null | undefined) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const initials = (n: string) => n.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
const mapsLink = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const telLink = (p: string) => `tel:+${p.replace(/\D/g, '')}`;
const when = (o: { urgency: string | null; scheduled_for: string | null }) =>
  o.urgency === 'scheduled' && o.scheduled_for
    ? new Date(o.scheduled_for).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : URGENCY_LABEL[o.urgency || 'now'] || 'Right now';

function Row({ Icon, label, children }: { Icon: typeof MapPin; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-xs">
      <Icon className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[11px] text-slate-500">{label}</p>
        <div className="text-slate-200 break-words">{children}</div>
      </div>
    </div>
  );
}

export default function RiderDashboard() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('home');
  const [rider, setRider] = useState<Rider | null>(null);
  const [email, setEmail] = useState('');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [recent, setRecent] = useState<Recent>({ today_jobs: 0, today_earned: 0, jobs: [] });
  const [loadError, setLoadError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [notifPerm, setNotifPerm] = useState<string>('granted');
  const [soundOn, setSoundOn] = useState(true);
  const [presence, setPresence] = useState<{ ok: boolean; visible?: boolean; busy?: boolean } | null>(null);
  const wantOnline = useRef(false); // the rider chose to be online
  const wasOnline = useRef(false);  // last state the server told us

  // Drop-an-errand dialog
  const [cancelTarget, setCancelTarget] = useState<Job | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNote, setCancelNote] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const seen = useRef<Set<string>>(new Set());
  const audio = useRef<AudioContext | null>(null);
  const soundRef = useRef(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string, ok = true) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, ok });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const changeSound = (on: boolean) => {
    setSoundOn(on);
    soundRef.current = on;
    try {
      localStorage.setItem(SOUND_KEY, on ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  };

  useEffect(() => {
    try {
      if (localStorage.getItem(SOUND_KEY) === '0') {
        setSoundOn(false);
        soundRef.current = false;
      }
    } catch {
      /* storage unavailable */
    }
  }, []);

  // ─── sound / vibration / notification for a new request ───
  const unlockAudio = () => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!audio.current) audio.current = new Ctx();
      audio.current?.resume?.();
    } catch {
      /* audio unavailable */
    }
  };

  const beep = () => {
    if (!soundRef.current) return;
    try {
      unlockAudio();
      const ctx = audio.current;
      if (!ctx) return;
      [0, 0.25, 0.5].forEach((t, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = i % 2 ? 660 : 880;
        gain.gain.value = 0.15;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + 0.18);
      });
    } catch {
      /* ignore */
    }
  };

  const alertNew = useCallback((o: Offer) => {
    beep();
    try {
      navigator.vibrate?.([300, 150, 300, 150, 300]);
    } catch {
      /* ignore */
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      try {
        new Notification('New errand request', { body: `${o.title} · ${naira(o.delivery_fee)}` });
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── data ───
  const refresh = useCallback(async () => {
    const [o, j, r, me] = await Promise.all([
      supabase.rpc('rider_incoming_offers'),
      supabase.rpc('rider_active_jobs'),
      supabase.rpc('rider_recent_jobs'),
      supabase.rpc('rider_me'),
    ]);
    if (o.error || j.error) {
      console.error('Rider refresh error:', o.error || j.error);
      setLoadError(true);
      return;
    }
    setLoadError(false);

    const fetchedAt = Date.now();
    const list = ((Array.isArray(o.data) ? o.data : []) as Omit<Offer, 'at'>[]).map((x) => ({ ...x, at: fetchedAt }));
    list.forEach((of) => {
      if (!seen.current.has(of.offer_id)) {
        seen.current.add(of.offer_id);
        alertNew(of);
      }
    });
    setOffers(list);
    setJobs(Array.isArray(j.data) ? (j.data as Job[]) : []);
    if (r.data) setRecent(r.data as Recent);
    if (me.data) {
      const m = me.data as Rider;
      if (wantOnline.current && wasOnline.current && !m.is_online) {
        wantOnline.current = false;
        showToast('You were set offline because the app lost connection. Tap Go online to start again.', false);
      }
      wasOnline.current = m.is_online;
      setRider(m);
    }
  }, [alertNew, showToast]);

  // Guard: signed in AND linked to a riders row.
  useEffect(() => {
    let alive = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/rider/login');
        return;
      }
      const { data: me } = await supabase.rpc('rider_me');
      if (!alive) return;
      if (!me) {
        router.replace('/');
        return;
      }
      setEmail(user.email || '');
      setRider(me as Rider);
      if (typeof Notification !== 'undefined') setNotifPerm(Notification.permission);
      setReady(true);
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) router.replace('/rider/login');
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [router]);

  // Poll every 3s (offers last 30s) on every tab, so a request is never missed while the
  // rider is on Settings or Earnings. The rider functions bypass table RLS, so polling is the
  // reliable way to receive them; we also refresh the moment the rider returns to the tab.
  useEffect(() => {
    if (!ready) return;
    refresh();
    const t = setInterval(refresh, 3000);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready, refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const secsLeft = (o: Offer) => Math.max(0, o.seconds_left - Math.floor((now - o.at) / 1000));
  const liveOffers = offers.filter((o) => secsLeft(o) > 0);

  // Flash the tab title while a request is waiting.
  useEffect(() => {
    if (liveOffers.length === 0) return;
    const base = document.title;
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? '🔔 New errand request!' : base;
    }, 800);
    return () => {
      clearInterval(t);
      document.title = base;
    };
  }, [liveOffers.length]);

  // ─── actions ───
  // Share live location with the customer only while an errand is active.
  const hasJob = jobs.length > 0;
  useEffect(() => {
    if (!hasJob || !navigator.geolocation) return;
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - last < 10000) return;
        last = Date.now();
        supabase.rpc('rider_update_location', { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [hasJob]);

  // Check in every 20s while online. Riders who stop checking in are taken off the customer's list.
  const online = !!rider?.is_online;
  useEffect(() => {
    if (!ready || !online) {
      setPresence(null);
      return;
    }
    let alive = true;
    const beat = async () => {
      const { data, error } = await supabase.rpc('rider_heartbeat');
      if (alive) setPresence(error || !data ? { ok: false } : { ok: true, visible: !!(data as any).visible, busy: !!(data as any).busy });
    };
    beat();
    const t = setInterval(beat, 20000);
    const onVisible = () => {
      if (!document.hidden) beat();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready, online]);

  const toggleOnline = async () => {
    if (!rider || !rider.is_verified) return;
    unlockAudio();
    const next = !rider.is_online;
    wantOnline.current = next;
    setRider({ ...rider, is_online: next });
    const { error } = await supabase.rpc('rider_set_online', { p_online: next });
    if (error) {
      console.error('Online toggle error:', error);
      setRider({ ...rider, is_online: !next });
      showToast('Could not change your status. Try again.', false);
    } else {
      showToast(next ? 'You are online. Requests will appear here.' : 'You are offline.');
    }
  };

  const respond = async (o: Offer, accept: boolean) => {
    setBusy(o.offer_id);
    const { data, error } = await supabase.rpc('rider_respond_offer', { p_offer_id: o.offer_id, p_accept: accept });
    setBusy(null);
    if (error) {
      console.error('Respond error:', error);
      showToast('Something went wrong. Try again.', false);
    } else if (data === 'accepted') {
      showToast('Errand accepted. The customer has been told you are coming.');
    } else if (data === 'taken' || data === 'expired') {
      showToast('Too late. That request timed out or was taken.', false);
    }
    refresh();
  };

  const advance = async (j: Job, next: 'in_progress' | 'delivered', code?: string): Promise<boolean> => {
    setBusy(j.id);
    const { data, error } = await supabase.rpc('rider_update_job', { p_errand_id: j.id, p_status: next, p_code: code ?? null });
    setBusy(null);
    const problems: Record<string, string> = {
      bad_code: 'Wrong code. Ask the customer to check the code in their app.',
      locked: 'Too many wrong codes. Contact Velrenta support.',
      receipt_required: 'Save what you spent on the items first.',
      invalid: 'Could not update this errand. Refresh and try again.',
      missing: 'Could not update this errand. Refresh and try again.',
    };
    const problem = error ? 'Could not update this errand. Refresh and try again.' : problems[data as string];
    if (problem) {
      console.error('Update job error:', error, data);
      showToast(problem, false);
    } else {
      setConfirmId(null);
      showToast(next === 'delivered' ? 'Delivered. Well done!' : 'Errand started. The customer can see you are on the way.');
    }
    refresh();
    return !problem;
  };

  const openCancel = (j: Job) => {
    setCancelTarget(j);
    setCancelReason('');
    setCancelNote('');
  };

  const submitCancel = async () => {
    if (!cancelTarget) return;
    const note = cancelNote.trim();
    if (!cancelReason) return showToast('Pick a reason so the customer knows what happened.', false);
    if (cancelReason === 'Other' && note.length < 3) return showToast('Tell us briefly what happened.', false);

    const reason = cancelReason === 'Other' ? note : [cancelReason, note].filter(Boolean).join(': ');
    setCancelling(true);
    const { data, error } = await supabase.rpc('rider_cancel_job', { p_errand_id: cancelTarget.id, p_reason: reason });
    setCancelling(false);
    if (error || data !== 'released') {
      console.error('Cancel error:', error, data);
      showToast('Could not drop this errand. Refresh and try again.', false);
      return;
    }
    setCancelTarget(null);
    setConfirmId(null);
    showToast('Errand released. The customer has been told and we will find another rider.');
    refresh();
  };

  const enableAlerts = async () => {
    unlockAudio();
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setNotifPerm(p);
  };

  const logout = async () => {
    if (rider?.is_online) await supabase.rpc('rider_set_online', { p_online: false });
    await supabase.auth.signOut();
    router.replace('/rider/login');
  };

  if (!ready || !rider) {
    return (
      <div className="flex h-screen w-screen bg-slate-950 items-center justify-center">
        <div className="text-slate-400 text-sm">Loading rider portal...</div>
      </div>
    );
  }

  const on = rider.is_online;
  const tabs: { key: View; label: string; Icon: typeof Home }[] = [
    { key: 'home', label: 'Home', Icon: Home },
    { key: 'earnings', label: 'Earnings', Icon: Wallet },
    { key: 'settings', label: 'Settings', Icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <span className="h-10 w-10 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-sm font-bold flex items-center justify-center shrink-0">
            {initials(rider.full_name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white truncate">{rider.full_name}</p>
            <p className="text-[11px] text-slate-400 truncate">
              {VEHICLE_LABEL[rider.vehicle_type] || rider.vehicle_type}
              {rider.plate_number ? ` · ${rider.plate_number}` : ''}
              {rider.area ? ` · ${rider.area}` : ''}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={on}
            onClick={toggleOnline}
            disabled={!rider.is_verified}
            className={`flex items-center gap-2 rounded-full pl-3 pr-1.5 py-1.5 text-xs font-bold border transition disabled:opacity-50 ${on ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
          >
            {on ? 'Online' : 'Offline'}
            <span className={`relative h-5 w-9 rounded-full transition ${on ? 'bg-emerald-500' : 'bg-slate-600'}`}>
              <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
            </span>
          </button>
          <button onClick={logout} aria-label="Log out" title="Log out" className="p-1.5 text-slate-400 hover:text-red-400 transition shrink-0">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="max-w-xl mx-auto p-4 pb-28 space-y-4">
        {/* A request arrives while the rider is on another tab */}
        {view !== 'home' && liveOffers.length > 0 && (
          <button
            onClick={() => setView('home')}
            className="sticky top-[76px] z-10 w-full flex items-center justify-between gap-3 rounded-xl border border-emerald-500/50 bg-slate-900 shadow-lg px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-bold text-emerald-400">
              <BellRing className="w-4 h-4 animate-pulse" /> New errand request
            </span>
            <span className="text-xs font-semibold text-emerald-400 tabular-nums">{secsLeft(liveOffers[0])}s · View</span>
          </button>
        )}

        {view === 'earnings' && (
          <>
            <RiderEarnings refreshKey={rider.total_errands} />
            <RiderWallet toast={showToast} refreshKey={rider.total_errands} />
          </>
        )}

        {view === 'settings' && (
          <RiderSettings
            rider={rider}
            email={email}
            soundOn={soundOn}
            onSound={changeSound}
            onSaved={(r) => setRider(r)}
            toast={showToast}
          />
        )}

        {view === 'home' && (
          <>
            {!rider.is_verified && (
              <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs rounded-xl px-4 py-3">
                Your account is waiting for verification by the Velrenta team. You will start getting requests once approved.
              </div>
            )}

            {loadError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-300 text-xs rounded-xl px-4 py-3">
                We could not load your requests. Check your connection. We will keep trying.
              </div>
            )}

            {/* Stats */}
            <section className="grid grid-cols-3 gap-2.5">
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                <p className="text-[11px] text-slate-400">Errands today</p>
                <p className="text-xl font-bold text-white mt-1">{recent.today_jobs}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                <p className="text-[11px] text-slate-400">Fees today</p>
                <p className="text-xl font-bold text-emerald-400 mt-1">{naira(recent.today_earned)}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                <p className="text-[11px] text-slate-400">Rating</p>
                <p className="text-xl font-bold text-white mt-1 flex items-center gap-1">
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  {Number(rider.rating).toFixed(1)}
                </p>
              </div>
            </section>

            {on && presence && (
              <div
                className={
                  'rounded-xl border px-4 py-2.5 text-xs flex items-center gap-2 ' +
                  (!presence.ok
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : presence.visible
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-slate-700 bg-slate-900 text-slate-300')
                }
              >
                <span className={'h-2 w-2 rounded-full shrink-0 ' + (!presence.ok ? 'bg-amber-400' : presence.visible ? 'bg-emerald-400' : 'bg-slate-500')} />
                {!presence.ok
                  ? 'Connection problem. Customers may not see you until it is back.'
                  : presence.visible
                    ? 'Customers can see you and can send you requests.'
                    : presence.busy
                      ? 'You are on an errand, so new requests are paused.'
                      : 'You are online but hidden from customers. Contact Velrenta.'}
              </div>
            )}

            {notifPerm === 'default' && (
              <button
                onClick={enableAlerts}
                className="w-full flex items-center justify-center gap-2 text-xs font-semibold border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 text-slate-300 rounded-xl py-2.5 transition"
              >
                <BellRing className="w-4 h-4" /> Turn on alerts for new requests
              </button>
            )}

            {/* Incoming requests */}
            {liveOffers.map((o) => {
              const s = secsLeft(o);
              return (
                <section key={o.offer_id} className="rounded-2xl border border-emerald-500/50 bg-emerald-500/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-400">
                      <BellRing className="w-3.5 h-3.5" /> New request
                    </span>
                    <span className="text-sm font-bold text-emerald-400 tabular-nums">{s}s</span>
                  </div>
                  <div className="h-1 rounded-full bg-slate-800 mt-2 overflow-hidden">
                    <div className="h-full bg-emerald-500 transition-all duration-1000 ease-linear" style={{ width: `${(s / OFFER_SECONDS) * 100}%` }} />
                  </div>

                  <div className="flex items-start justify-between gap-3 mt-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{CATEGORY_LABEL[o.category] || 'Errand'}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{when(o)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xl font-bold text-emerald-400 leading-tight">{naira(o.delivery_fee)}</p>
                      <p className="text-[11px] text-slate-500">your fee</p>
                    </div>
                  </div>

                  {o.details && <p className="text-xs text-slate-300 mt-3 rounded-lg bg-slate-950/60 border border-slate-800 p-3 whitespace-pre-wrap break-words">{o.details}</p>}

                  <div className="space-y-2.5 mt-3">
                    {o.pickup_location && <Row Icon={MapPin} label="Buy or collect at">{o.pickup_location}</Row>}
                    <Row Icon={Navigation} label="Deliver to">{o.delivery_address}</Row>
                    <Row Icon={Wallet} label="Cash for the items">{naira(o.item_budget)}</Row>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-4">
                    <button
                      onClick={() => respond(o, false)}
                      disabled={busy === o.offer_id}
                      className="col-span-1 py-3 rounded-xl text-xs font-bold border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition"
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => respond(o, true)}
                      disabled={busy === o.offer_id}
                      className="col-span-2 flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 transition"
                    >
                      {busy === o.offer_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                      Accept errand
                    </button>
                  </div>
                </section>
              );
            })}

            {/* Active errands */}
            {jobs.map((j) => (
              <section key={j.id} className="rounded-2xl border border-sky-500/40 bg-slate-900 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold border bg-sky-500/10 text-sky-300 border-sky-500/30">
                    {j.status === 'accepted' ? 'Accepted: head to pickup' : 'In progress'}
                  </span>
                  <p className="text-base font-bold text-emerald-400">{naira(j.delivery_fee)}</p>
                </div>

                <p className="text-sm font-semibold text-white mt-3">{CATEGORY_LABEL[j.category] || 'Errand'}</p>
                {j.details && <p className="text-xs text-slate-300 mt-2 rounded-lg bg-slate-950/60 border border-slate-800 p-3 whitespace-pre-wrap break-words">{j.details}</p>}

                <div className="space-y-2.5 mt-3">
                  {j.pickup_location && (
                    <Row Icon={MapPin} label="Buy or collect at">
                      {j.pickup_location}{' '}
                      <a href={mapsLink(j.pickup_location)} target="_blank" rel="noreferrer" className="text-emerald-400 hover:text-emerald-300 ml-1">Map</a>
                    </Row>
                  )}
                  <Row Icon={Navigation} label="Deliver to">
                    {j.delivery_address}{' '}
                    <a href={mapsLink(j.delivery_address)} target="_blank" rel="noreferrer" className="text-emerald-400 hover:text-emerald-300 ml-1">Map</a>
                  </Row>
                  <Row Icon={Wallet} label="Cash the customer gives you for items">{naira(j.item_budget)}</Row>
                  <Row Icon={Clock} label="When">{when(j)}</Row>
                </div>

                <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-slate-800">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{j.buyer_name || 'Customer'}</p>
                    <p className="text-[11px] text-slate-500">Confirm the final fee with them before you start.</p>
                  </div>
                  {j.contact_phone && (
                    <a href={telLink(j.contact_phone)} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg px-3.5 py-2.5 transition shrink-0">
                      <Phone className="w-3.5 h-3.5" /> Call
                    </a>
                  )}
                </div>

                <div className="mt-3">
                  {j.status === 'accepted' ? (
                    <button
                      onClick={() => advance(j, 'in_progress')}
                      disabled={busy === j.id}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 transition"
                    >
                      {busy === j.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bike className="w-4 h-4" />}
                      Start errand
                    </button>
                  ) : confirmId === j.id ? (
                    <DeliveryFlow
                      key={j.id}
                      budget={j.item_budget || 0}
                      savedCost={j.actual_item_cost}
                      savedNote={j.receipt_note}
                      busy={busy === j.id}
                      onSaveReceipt={async (cost, note) => {
                        const { data } = await supabase.rpc('rider_set_receipt', { p_errand_id: j.id, p_cost: cost, p_note: note });
                        if (data === 'saved') {
                          showToast('Receipt saved. The customer can see it.');
                          refresh();
                          return true;
                        }
                        showToast('Could not save the receipt. Try again.', false);
                        return false;
                      }}
                      onDeliver={(code) => advance(j, 'delivered', code)}
                    />
                  ) : (
                    <button
                      onClick={() => setConfirmId(j.id)}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition"
                    >
                      <PackageCheck className="w-4 h-4" /> Mark as delivered
                    </button>
                  )}
                </div>

                <button
                  onClick={() => openCancel(j)}
                  className="w-full mt-2 py-2 text-[11px] font-medium text-slate-500 hover:text-red-400 transition"
                >
                  Can&apos;t complete this errand?
                </button>
              </section>
            ))}

            {/* Waiting / offline state */}
            {liveOffers.length === 0 && jobs.length === 0 && (
              <section className="rounded-2xl border border-dashed border-slate-800 bg-slate-900 p-8 text-center">
                {on ? (
                  <>
                    <span className="relative inline-flex h-3 w-3 mb-3">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400" />
                    </span>
                    <p className="text-sm text-slate-200">Waiting for errand requests</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                      Keep this page open. You will hear a beep and see the request here the moment one comes in.
                    </p>
                  </>
                ) : (
                  <>
                    <Bike className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                    <p className="text-sm text-slate-200">You are offline</p>
                    <p className="text-xs text-slate-500 mt-1">Go online to start receiving errand requests.</p>
                    {rider.is_verified && (
                      <button onClick={toggleOnline} className="mt-4 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg px-4 py-2.5 transition">
                        Go online
                      </button>
                    )}
                  </>
                )}
              </section>
            )}

            {/* Recent errands */}
            <section className="rounded-xl border border-slate-800 bg-slate-900">
              <div className="px-4 py-3.5 border-b border-slate-800">
                <h2 className="text-sm font-bold text-white">Recent errands</h2>
              </div>
              {recent.jobs.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">Errands you finish will show up here.</p>
              ) : (
                <ul className="divide-y divide-slate-800/70">
                  {recent.jobs.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate">{r.title}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {new Date(r.updated_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
                          {r.status === 'cancelled' ? ' · Cancelled' : ''}
                        </p>
                      </div>
                      <p className={`text-sm font-semibold shrink-0 ${r.status === 'delivered' ? 'text-emerald-400' : 'text-slate-500'}`}>{naira(r.delivery_fee)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-slate-900 border-t border-slate-800 pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        <div className="max-w-xl mx-auto grid grid-cols-3">
          {tabs.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              aria-current={view === key ? 'page' : undefined}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${view === key ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <span className="relative">
                <Icon className="w-5 h-5" />
                {key === 'home' && liveOffers.length > 0 && view !== 'home' && (
                  <span className="absolute -top-1 -right-2 h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
                )}
              </span>
              {label}
            </button>
          ))}
        </div>
      </nav>

      {/* Drop-an-errand dialog */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4" onClick={() => !cancelling && setCancelTarget(null)}>
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-white">Drop this errand?</h2>
            <p className="text-xs text-slate-400 mt-1.5">
              The customer will see your reason and we will find another rider for them.
            </p>

            {cancelTarget.status === 'in_progress' && (
              <div className="flex items-start gap-2 mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>You have already started. If you bought any items, call the customer first so they can arrange to collect them.</span>
              </div>
            )}

            <p className="text-xs font-medium text-slate-300 mt-4 mb-2">Why can&apos;t you complete it?</p>
            <div className="flex flex-wrap gap-2">
              {CANCEL_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setCancelReason(r)}
                  aria-pressed={cancelReason === r}
                  className={`text-xs rounded-full border px-3 py-1.5 transition ${cancelReason === r ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-400 font-semibold' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
                >
                  {r}
                </button>
              ))}
            </div>

            <textarea
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder={cancelReason === 'Other' ? 'Tell the customer what happened' : 'Add more detail (optional)'}
              className="w-full mt-3 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
            />

            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                onClick={() => setCancelTarget(null)}
                disabled={cancelling}
                className="py-2.5 rounded-lg text-xs font-bold border border-slate-700 text-slate-300 hover:bg-slate-800 transition"
              >
                Keep errand
              </button>
              <button
                onClick={submitCancel}
                disabled={cancelling}
                className="py-2.5 rounded-lg text-xs font-bold bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white transition"
              >
                {cancelling ? 'Dropping...' : 'Drop errand'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] px-4 py-2.5 rounded-lg text-xs font-medium border shadow-lg bg-slate-900 ${toast.ok ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300'
            }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}