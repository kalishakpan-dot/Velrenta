'use client';

// app/provider/page.tsx  (provider portal: go online, take requests, manage jobs)

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  LogOut,
  MapPin,
  Phone,
  MessageCircle,
  Zap,
  Plus,
  Trash2,
  BadgeCheck,
  Clock,
  Loader2,
  Star,
  Briefcase,
  Check,
  Circle,
  BellRing,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import ProviderInbox from '../components/ProviderInbox';

/* ---------- Types ---------- */

interface Category {
  id: string;
  name: string;
  mode: 'instant' | 'booking';
}

interface Me {
  id: string;
  display_name: string;
  provider_type: 'individual' | 'shop';
  phone: string | null;
  city: string;
  area: string | null;
  bio: string | null;
  is_online: boolean;
  is_verified: boolean;
  rating: number;
  review_count: number;
  completed_jobs: number;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  service_areas: string[];
  typical_arrival_minutes: number | null;
  offers_emergency: boolean;
  years_experience: number | null;
}

interface ProviderForm {
  display_name: string;
  provider_type: string;
  phone: string;
  city: string;
  area: string;
  bio: string;
  service_areas: string;
  typical_arrival_minutes: string;
  offers_emergency: boolean;
  years_experience: string;
}

interface Listing {
  id: string;
  category_id: string;
  title: string;
  description: string | null;
  price_from: number | null;
  price_unit: string | null;
  active: boolean;
}

interface Job {
  id: string;
  category_id: string;
  provider_id: string | null;
  description: string;
  city: string;
  address: string | null;
  budget: number | null;
  status: string;
  created_at: string;
  service_categories: { name: string } | null;
  service_request_contacts: { contact_name: string | null; contact_phone: string | null } | null;
}

interface JobReview {
  rating: number;
  comment: string | null;
}

type Tab = 'requests' | 'jobs' | 'history' | 'services' | 'messages' | 'profile';

const TONES = {
  sky: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  slate: 'bg-slate-800 text-slate-400 border-slate-700',
} as const;

const CITIES = ['Uyo', 'Port Harcourt', 'Lagos', 'Abuja', 'Calabar', 'Enugu'];

const SOUND_KEY = 'velrenta_provider_sound';

const naira = (n: number | null | undefined) => (n == null ? '' : `\u20A6${Number(n).toLocaleString()}`);
const digitsOnly = (p: string | null | undefined) => (p || '').replace(/[^\d]/g, '');

// Nigerian numbers: 0803... or 803... become 234803... so tel: and WhatsApp links work.
const intlPhone = (p: string | null | undefined) => {
  const d = digitsOnly(p);
  if (!d) return '';
  if (d.startsWith('234')) return d;
  if (d.startsWith('0')) return `234${d.slice(1)}`;
  if (d.length === 10) return `234${d}`;
  return d;
};

const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
};

const parseAreas = (s: string) =>
  Array.from(new Set(s.split(',').map((x) => x.trim()).filter(Boolean))).slice(0, 12);

const ARRIVAL_OPTIONS: [string, string][] = [
  ['', 'Not sure'],
  ['15', '15 minutes'],
  ['30', '30 minutes'],
  ['45', '45 minutes'],
  ['60', '1 hour'],
  ['120', '2 hours'],
  ['240', '4 hours'],
  ['1440', 'Same day'],
];

const field =
  'w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500';

/* ---------- Page ---------- */

export default function ProviderPortal() {
  const router = useRouter();
  const [booting, setBooting] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [reviews, setReviews] = useState<Record<string, JobReview>>({});
  const [tab, setTab] = useState<Tab>('requests');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [soundOn, setSoundOn] = useState(true);
  const [notifPerm, setNotifPerm] = useState<string>('granted');
  const [pageHidden, setPageHidden] = useState(false);
  const seenIncoming = useRef<Set<string> | null>(null);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const prevUnread = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const soundRef = useRef(true);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }, []);

  /* ---------- Sound, vibration and browser alerts for new requests ---------- */

  // Browsers only allow sound after the user has tapped something on the page.
  const unlockAudio = useCallback(() => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!audio.current) audio.current = new Ctx();
      audio.current?.resume?.();
    } catch {
      /* audio unavailable */
    }
  }, []);

  const beep = useCallback(() => {
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
  }, [unlockAudio]);

  const alertNew = useCallback(
    (fresh: Job[]) => {
      beep();
      try {
        navigator.vibrate?.([300, 150, 300, 150, 300]);
      } catch {
        /* ignore */
      }
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        const j = fresh[0];
        try {
          new Notification(fresh.length === 1 ? 'New job request' : `${fresh.length} new job requests`, {
            body: `${j.service_categories?.name || 'Service'} \u00B7 ${j.description.split('\n')[0].slice(0, 80)}`,
          });
        } catch {
          /* ignore */
        }
      }
    },
    [beep]
  );

  const changeSound = (on: boolean) => {
    setSoundOn(on);
    soundRef.current = on;
    try {
      localStorage.setItem(SOUND_KEY, on ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (on) beep(); // preview, and it unlocks sound in the browser
  };

  const enableAlerts = async () => {
    unlockAudio();
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setNotifPerm(p);
  };

  // Remember the sound setting, read the notification permission, unlock sound on the first tap.
  useEffect(() => {
    try {
      if (localStorage.getItem(SOUND_KEY) === '0') {
        setSoundOn(false);
        soundRef.current = false;
      }
    } catch {
      /* storage unavailable */
    }
    if (typeof Notification !== 'undefined') setNotifPerm(Notification.permission);

    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [unlockAudio]);

  // Know when the provider has switched to another tab or app.
  useEffect(() => {
    const sync = () => setPageHidden(document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const loadMe = useCallback(async () => {
    const { data } = await supabase.rpc('provider_me');
    const row = Array.isArray(data) ? data[0] : data;
    let next: Me | null = null;
    if (row && row.id) {
      // Newer profile fields are read separately so this works whatever provider_me returns.
      const { data: extra } = await supabase
        .from('service_providers')
        .select('service_areas, typical_arrival_minutes, offers_emergency, years_experience')
        .eq('id', row.id)
        .maybeSingle();
      next = {
        ...(row as Me),
        service_areas: extra?.service_areas || [],
        typical_arrival_minutes: extra?.typical_arrival_minutes ?? null,
        offers_emergency: !!extra?.offers_emergency,
        years_experience: extra?.years_experience ?? null,
      };
    }
    setMe(next);
    return next;
  }, []);

  const loadListings = useCallback(async (providerId: string) => {
    const { data } = await supabase
      .from('provider_services')
      .select('*')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false });
    if (data) setListings(data as Listing[]);
  }, []);

  const loadJobs = useCallback(async () => {
    const { data, error } = await supabase
      .from('service_requests')
      .select('*, service_categories(name), service_request_contacts(contact_name, contact_phone)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) console.error('Jobs fetch error:', error);
    if (data) setJobs(data as unknown as Job[]);
  }, []);

  const loadReviews = useCallback(async (providerId: string) => {
    const { data } = await supabase
      .from('service_reviews')
      .select('request_id, rating, comment')
      .eq('provider_id', providerId);
    if (data) {
      setReviews(
        Object.fromEntries(
          (data as any[]).map((r) => [r.request_id as string, { rating: Number(r.rating), comment: (r.comment as string | null) || null }])
        )
      );
    }
  }, []);

  /* Boot: must be signed in. Riders and suppliers go to their own portals. */
  useEffect(() => {
    let mounted = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }

      const { data: riderMe } = await supabase.rpc('rider_me');
      if (riderMe) {
        router.replace('/rider');
        return;
      }
      const { data: supplierRow } = await supabase.from('suppliers').select('id').eq('user_id', user.id).maybeSingle();
      if (supplierRow) {
        router.replace('/supplier');
        return;
      }
      if (!mounted) return;
      setUserId(user.id);

      const { data: cats } = await supabase.from('service_categories').select('id, name, mode').order('sort_order');
      if (cats) setCategories(cats as Category[]);

      const profile = await loadMe();
      if (profile) {
        await Promise.all([loadListings(profile.id), loadJobs(), loadReviews(profile.id)]);
      }
      if (mounted) setBooting(false);
    })();
    return () => {
      mounted = false;
    };
  }, [router, loadMe, loadListings, loadJobs, loadReviews]);

  /* Live updates: new open requests, bookings sent to me, verification changes */
  useEffect(() => {
    if (!me?.id) return;
    const channel = supabase
      .channel(`sharp-provider-${me.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_requests' }, () => loadJobs())
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'service_providers', filter: `id=eq.${me.id}` },
        () => loadMe()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'service_reviews', filter: `provider_id=eq.${me.id}` },
        () => {
          loadReviews(me.id);
          loadMe();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [me?.id, loadJobs, loadMe, loadReviews]);

  /* Requests I can act on: sent to me, or open in my city for a category I offer */
  const myCats = useMemo(() => new Set(listings.filter((l) => l.active).map((l) => l.category_id)), [listings]);

  const incoming = useMemo(() => {
    if (!me) return [] as Job[];
    const myCity = me.city.trim().toLowerCase();
    return jobs.filter((j) => {
      if (j.status === 'requested' && j.provider_id === me.id) return true;
      if (j.status === 'open' && !j.provider_id) {
        return myCats.has(j.category_id) && j.city.trim().toLowerCase() === myCity;
      }
      return false;
    });
  }, [jobs, me, myCats]);

  /* Beep, vibrate and notify when a new request arrives */
  useEffect(() => {
    if (booting || !me) return;
    const ids = new Set(incoming.map((j) => j.id));
    if (seenIncoming.current) {
      const prev = seenIncoming.current;
      const fresh = incoming.filter((j) => !prev.has(j.id));
      const direct = fresh.some((j) => j.status === 'requested');
      if (fresh.length > 0 && (me.is_online || direct)) {
        alertNew(fresh);
        flash(fresh.length === 1 ? 'New job request just came in' : `${fresh.length} new job requests`);
      }
    }
    seenIncoming.current = ids;
  }, [incoming, booting, me, flash, alertNew]);

  /* Heartbeat: tells buyers this provider is really online right now */
  const meId = me?.id;
  const meOnline = !!me?.is_online;
  useEffect(() => {
    if (!meId || !meOnline) return;
    const beat = () => {
      supabase
        .from('service_providers')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', meId)
        .then(() => {});
    };
    beat();
    const t = setInterval(beat, 4 * 60 * 1000);
    const onVis = () => {
      if (document.visibilityState === 'visible') beat();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [meId, meOnline]);

  /* Messages from the Velrenta team: count unread, and beep when a new one arrives */
  useEffect(() => {
    if (!meId) return;
    let alive = true;
    const check = async () => {
      const { count, error } = await supabase
        .from('provider_admin_messages')
        .select('id', { count: 'exact', head: true })
        .eq('provider_id', meId)
        .eq('sender_role', 'admin')
        .is('read_at', null);
      if (!alive || error) return;
      const n = count || 0;
      if (prevUnread.current !== null && n > prevUnread.current) {
        beep();
        try {
          navigator.vibrate?.([200, 100, 200]);
        } catch {
          /* ignore */
        }
        flash('New message from the Velrenta team');
      }
      prevUnread.current = n;
      setUnreadMsgs(n);
    };
    check();
    const t = setInterval(check, 8000);
    const onVis = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [meId, beep, flash]);

  const onInboxRead = useCallback(() => {
    setUnreadMsgs(0);
    prevUnread.current = 0;
  }, []);

  /* While online, check for new requests every 5 seconds so none are missed */
  useEffect(() => {
    if (!meId || !meOnline) return;
    const t = setInterval(loadJobs, 5000);
    const onVis = () => {
      if (document.visibilityState === 'visible') loadJobs();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [meId, meOnline, loadJobs]);

  /* Flash the tab title while a request is waiting and the provider is on another tab */
  const pending = incoming.length;
  useEffect(() => {
    if (pending === 0 || !pageHidden || !meOnline) return;
    const base = document.title;
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? '\uD83D\uDD14 New job request!' : base;
    }, 800);
    return () => {
      clearInterval(t);
      document.title = base;
    };
  }, [pending, pageHidden, meOnline]);

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const toggleOnline = async () => {
    if (!me) return;
    unlockAudio();
    if (!me.is_verified) {
      flash('You can go online once your account is verified.');
      return;
    }
    if (!me.is_online && myCats.size === 0) {
      flash('Add at least one active service before going online.');
      setTab('services');
      return;
    }
    const next = !me.is_online;
    setMe({ ...me, is_online: next });
    const { error } = await supabase.from('service_providers').update({ is_online: next }).eq('id', me.id);
    if (error) {
      setMe({ ...me, is_online: !next });
      flash(error.message);
    }
  };

  const run = async (jobId: string, fn: string, args: Record<string, unknown>, okMsg: string) => {
    setBusy(jobId);
    const { error } = await supabase.rpc(fn, args);
    setBusy(null);
    if (error) flash(error.message);
    else flash(okMsg);
    loadJobs();
    loadMe();
    if (me) loadReviews(me.id);
  };

  if (booting) {
    return (
      <div className="flex h-screen w-screen bg-slate-950 items-center justify-center">
        <div className="text-slate-400 text-sm">Loading provider portal...</div>
      </div>
    );
  }

  if (!me) {
    return (
      <Onboarding
        userId={userId}
        categories={categories}
        onCreated={async () => {
          const p = await loadMe();
          if (p) await loadListings(p.id);
        }}
        onLogout={logout}
      />
    );
  }

  const myId = me.id;
  const active = jobs.filter((j) => j.provider_id === myId && ['accepted', 'in_progress'].includes(j.status));
  const history = jobs.filter((j) => j.provider_id === myId && ['completed', 'cancelled', 'declined'].includes(j.status));

  const tabs: [Tab, string][] = [
    ['requests', `Requests${incoming.length ? ` (${incoming.length})` : ''}`],
    ['jobs', `Jobs${active.length ? ` (${active.length})` : ''}`],
    ['history', 'History'],
    ['services', 'My services'],
    ['messages', `Messages${unreadMsgs ? ` (${unreadMsgs})` : ''}`],
    ['profile', 'Profile'],
  ];

  const checklist: { label: string; done: boolean; go?: Tab }[] = [
    { label: 'Add your phone number', done: !!me.phone, go: 'profile' },
    { label: 'Write a short bio', done: !!me.bio, go: 'profile' },
    { label: 'List the areas you cover', done: (me.service_areas || []).length > 0, go: 'profile' },
    { label: 'List at least one service with a starting price', done: listings.some((l) => l.active && l.price_from != null), go: 'services' },
    { label: 'Add a payout account', done: !!(me.bank_name && me.account_number), go: 'profile' },
    { label: 'Get verified by Velrenta', done: me.is_verified },
  ];

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 font-sans">
      <header className="sticky top-0 z-20 bg-slate-900 border-b border-slate-800">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-emerald-500 flex items-center justify-center font-bold text-slate-950 text-xl shrink-0">
              V
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white leading-tight truncate flex items-center gap-1.5">
                {me.display_name}
                {me.is_verified && <BadgeCheck className="w-4 h-4 text-emerald-400 shrink-0" aria-label="Verified" />}
              </p>
              <p className="text-[11px] text-slate-400 leading-tight">Sharp Sharp provider</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={toggleOnline}
              role="switch"
              aria-checked={me.is_online}
              className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-bold transition ${
                me.is_online
                  ? 'bg-emerald-500 border-emerald-500 text-slate-950'
                  : 'border-slate-700 text-slate-300 hover:border-emerald-500/50'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${me.is_online ? 'bg-slate-950' : 'bg-slate-500'}`} />
              {me.is_online ? 'Online' : 'Offline'}
            </button>
            <button onClick={logout} aria-label="Log out" title="Log out" className="text-slate-400 hover:text-red-400 p-2 transition">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 md:p-6">
        {!me.is_verified && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 mb-5 flex gap-3">
            <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-amber-300">Verification pending</p>
              <p className="text-xs text-amber-200/80 mt-1">
                We are checking your details. Until you are verified, buyers cannot see you and you cannot go online. Add your services now so you are ready.
              </p>
            </div>
          </div>
        )}

        {checklist.some((c) => !c.done) && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 mb-5">
            <p className="text-sm font-bold text-white">
              Complete your profile ({checklist.filter((c) => c.done).length}/{checklist.length})
            </p>
            <p className="text-xs text-slate-400 mt-1">Buyers pick providers with clear prices and a full profile first.</p>
            <ul className="mt-3 space-y-1.5">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-xs">
                  {c.done ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <Circle className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                  )}
                  {c.done || !c.go ? (
                    <span className={c.done ? 'text-slate-500 line-through' : 'text-slate-300'}>{c.label}</span>
                  ) : (
                    <button onClick={() => setTab(c.go!)} className="text-slate-200 hover:text-emerald-400 text-left transition">
                      {c.label}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <section className="grid grid-cols-3 gap-3 mb-5">
          <Stat label="Rating" value={me.review_count > 0 ? Number(me.rating).toFixed(1) : 'New'} icon={<Star className="w-4 h-4 text-amber-400" />} />
          <Stat label="Jobs done" value={String(me.completed_jobs)} icon={<Briefcase className="w-4 h-4 text-emerald-400" />} />
          <Stat label="Reviews" value={String(me.review_count)} icon={<BadgeCheck className="w-4 h-4 text-emerald-400" />} />
        </section>

        <div className="flex gap-1 mb-5 border-b border-slate-800 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
                tab === k ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* A request arrives while the provider is on another tab */}
        {tab !== 'requests' && incoming.length > 0 && (
          <button
            onClick={() => setTab('requests')}
            className="sticky top-[72px] z-10 w-full mb-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/50 bg-slate-900 shadow-lg px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-bold text-emerald-400">
              <BellRing className="w-4 h-4 animate-pulse" />
              {incoming.length === 1 ? 'New job request' : `${incoming.length} new job requests`}
            </span>
            <span className="text-xs font-semibold text-emerald-400">View</span>
          </button>
        )}

        {tab === 'requests' && (
          <div className="space-y-3">
            {notifPerm === 'default' && (
              <button
                onClick={enableAlerts}
                className="w-full flex items-center justify-center gap-2 text-xs font-semibold border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 text-slate-300 rounded-xl py-2.5 transition"
              >
                <BellRing className="w-4 h-4" /> Turn on alerts for new requests
              </button>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">
                {!me.is_verified
                  ? ''
                  : me.is_online
                    ? 'You are online. You will hear a beep when a request comes in.'
                    : 'You are offline. Go online so buyers see you as available.'}
              </p>
              <button
                onClick={() => changeSound(!soundOn)}
                aria-pressed={soundOn}
                className={`shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full border px-3 py-1.5 transition ${
                  soundOn ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-slate-700 text-slate-400 hover:border-slate-500'
                }`}
              >
                {soundOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                Sound {soundOn ? 'on' : 'off'}
              </button>
            </div>

            {incoming.length === 0 ? (
              me.is_online ? (
                <section className="rounded-2xl border border-dashed border-slate-800 bg-slate-900 p-8 text-center">
                  <span className="relative inline-flex h-3 w-3 mb-3">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400" />
                  </span>
                  <p className="text-sm text-slate-200">Waiting for job requests</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                    Keep this page open. You will hear a beep and see the request here the moment one comes in for {me.city}.
                  </p>
                </section>
              ) : (
                <Empty
                  title="No requests right now"
                  hint={`New requests in ${me.city} for the services you list show up here instantly.`}
                />
              )
            ) : (
              incoming.map((j) => {
                const direct = j.status === 'requested';
                return (
                  <JobCard
                    key={j.id}
                    job={j}
                    highlight
                    tag={direct ? 'Sent to you' : 'Open to all nearby'}
                    tagIcon={direct ? undefined : <Zap className="w-3 h-3" />}
                  >
                    {direct && (
                      <button
                        disabled={busy === j.id}
                        onClick={() => run(j.id, 'decline_service_request', { p_request: j.id }, 'Request declined')}
                        className="flex-1 py-3 rounded-xl text-xs font-bold border border-slate-700 text-slate-300 hover:bg-slate-800 hover:border-red-500/50 hover:text-red-400 disabled:opacity-50 transition"
                      >
                        Decline
                      </button>
                    )}
                    <button
                      disabled={busy === j.id || !me.is_verified}
                      onClick={() => run(j.id, 'accept_service_request', { p_request: j.id }, 'Job accepted. The buyer has been notified.')}
                      className="flex-[2] inline-flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 transition"
                    >
                      {busy === j.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Accept job
                    </button>
                  </JobCard>
                );
              })
            )}
          </div>
        )}

        {tab === 'jobs' && (
          <div className="space-y-6">
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-white">In progress</h2>
              {active.length === 0 ? (
                <Empty title="No active jobs" hint="Accepted jobs appear here with the buyer's contact details." />
              ) : (
                active.map((j) => (
                  <JobCard key={j.id} job={j} showContact tag={j.status === 'accepted' ? 'Accepted' : 'In progress'}>
                    {j.status === 'accepted' && (
                      <button
                        disabled={busy === j.id}
                        onClick={() => run(j.id, 'advance_service_request', { p_request: j.id, p_status: 'in_progress' }, 'Job started')}
                        className="text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 rounded-lg px-4 py-2.5 transition"
                      >
                        Start job
                      </button>
                    )}
                    <button
                      disabled={busy === j.id}
                      onClick={() => run(j.id, 'advance_service_request', { p_request: j.id, p_status: 'completed' }, 'Job marked complete')}
                      className={`text-xs font-bold rounded-lg px-4 py-2.5 transition disabled:opacity-50 ${
                        j.status === 'in_progress'
                          ? 'text-slate-950 bg-emerald-500 hover:bg-emerald-400'
                          : 'text-slate-300 border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400'
                      }`}
                    >
                      Mark complete
                    </button>
                  </JobCard>
                ))
              )}
            </div>

            {history.length > 0 && (
              <button
                onClick={() => setTab('history')}
                className="text-xs font-medium text-slate-300 border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 rounded-lg px-3.5 py-2 transition"
              >
                View job history ({history.length})
              </button>
            )}
          </div>
        )}

        {tab === 'history' && <History jobs={history} reviews={reviews} completedCount={me.completed_jobs} />}

        {tab === 'services' && (
          <Services me={me} categories={categories} listings={listings} reload={() => loadListings(myId)} flash={flash} />
        )}

        {tab === 'messages' && <ProviderInbox providerId={me.id} onRead={onInboxRead} />}

        {tab === 'profile' && <Profile me={me} reload={loadMe} flash={flash} />}
      </main>

      {toast && (
        <div
          role="status"
          className="fixed left-1/2 -translate-x-1/2 bottom-8 z-50 max-w-[90vw] bg-slate-800 border border-slate-700 text-sm text-white rounded-xl px-4 py-2.5 shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

/* ---------- Small pieces ---------- */

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3.5 min-w-0">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">{label}</p>
        {icon}
      </div>
      <p className="text-2xl font-bold text-white mt-2">{value}</p>
    </div>
  );
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-10 text-center">
      <p className="text-sm text-slate-300">{title}</p>
      <p className="text-xs text-slate-500 mt-1">{hint}</p>
    </div>
  );
}

function JobCard({
  job,
  tag,
  tagIcon,
  tone,
  showContact,
  showBuyer,
  review,
  footnote,
  muted,
  highlight,
  children,
}: {
  job: Job;
  tag: string;
  tagIcon?: React.ReactNode;
  showContact?: boolean;
  tone?: keyof typeof TONES;
  showBuyer?: boolean;
  review?: JobReview | null;
  footnote?: string;
  muted?: boolean;
  highlight?: boolean;
  children?: React.ReactNode;
}) {
  const c = job.service_request_contacts;
  const num = intlPhone(c?.contact_phone);
  return (
    <article
      className={
        highlight
          ? 'rounded-2xl border border-emerald-500/50 bg-emerald-500/5 p-4'
          : `rounded-xl border border-slate-800 bg-slate-900 p-4 ${muted ? 'opacity-70' : ''}`
      }
    >
      {highlight && (
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-400">
            <BellRing className="w-3.5 h-3.5" /> New request
          </span>
          <span className="text-[11px] text-slate-400">{timeAgo(job.created_at)}</span>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">{job.service_categories?.name || 'Service'}</p>
          <p
            className={
              highlight
                ? 'text-xs text-slate-300 mt-2 rounded-lg bg-slate-950/60 border border-slate-800 p-3 break-words whitespace-pre-line'
                : 'text-xs text-slate-300 mt-1 break-words whitespace-pre-line'
            }
          >
            {job.description}
          </p>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold rounded-full border px-2.5 py-0.5 whitespace-nowrap ${TONES[tone || 'sky']}`}>
          {tagIcon}
          {tag}
        </span>
      </div>

      <p className="text-xs text-slate-500 mt-2.5 flex items-center gap-1.5 flex-wrap">
        <MapPin className="w-3 h-3 shrink-0" />
        {[job.address, job.city].filter(Boolean).join(', ')}
        {job.budget != null && <span>&middot; Budget {naira(job.budget)}</span>}
        {!highlight && <span>&middot; {timeAgo(job.created_at)}</span>}
      </p>

      {showContact && c?.contact_phone && (
        <div className="mt-3 rounded-lg bg-slate-800/50 border border-slate-700/50 p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white truncate">{c.contact_name || 'Buyer'}</p>
            <p className="text-[11px] text-slate-400">{c.contact_phone}</p>
          </div>
          <div className="flex gap-2">
            <a href={`tel:+${num}`} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg px-3 py-2 transition">
              <Phone className="w-3.5 h-3.5" /> Call
            </a>
            <a
              href={`https://wa.me/${num}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 rounded-lg px-3 py-2 transition"
            >
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
            </a>
          </div>
        </div>
      )}

      {showBuyer && c?.contact_name && (
        <p className="text-xs text-slate-400 mt-2">
          Buyer: <span className="font-semibold text-white">{c.contact_name}</span>
        </p>
      )}

      {review && (
        <div className="mt-3 rounded-lg bg-slate-800/50 border border-slate-700/50 p-3">
          <p className="flex items-center gap-0.5 text-xs font-semibold text-white">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} className={`w-3.5 h-3.5 ${n <= review.rating ? 'text-amber-400 fill-amber-400' : 'text-slate-600'}`} />
            ))}
            <span className="ml-1.5">Buyer review</span>
          </p>
          {review.comment && <p className="text-xs text-slate-300 mt-1.5 break-words">{review.comment}</p>}
        </div>
      )}

      {footnote && <p className="text-[11px] text-slate-500 mt-3">{footnote}</p>}

      {children && <div className={highlight ? 'flex gap-2 mt-4' : 'flex flex-wrap gap-2 mt-3'}>{children}</div>}
    </article>
  );
}

/* ---------- History ---------- */

function History({ jobs, reviews, completedCount }: { jobs: Job[]; reviews: Record<string, JobReview>; completedCount: number }) {
  const [filter, setFilter] = useState<'all' | 'completed' | 'other'>('all');

  const done = jobs.filter((j) => j.status === 'completed');
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thisMonth = done.filter((j) => new Date(j.created_at) >= monthStart).length;
  const reviewedCount = done.filter((j) => reviews[j.id]).length;

  const shown = jobs.filter((j) => (filter === 'all' ? true : filter === 'completed' ? j.status === 'completed' : j.status !== 'completed'));

  const filterBtn = (k: typeof filter, label: string) => (
    <button
      key={k}
      onClick={() => setFilter(k)}
      aria-pressed={filter === k}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
        filter === k ? 'bg-emerald-500 border-emerald-500 text-slate-950' : 'border-slate-700 text-slate-300 hover:border-emerald-500/50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Completed" value={String(done.length)} icon={<Check className="w-4 h-4 text-emerald-400" />} />
        <Stat label="This month" value={String(thisMonth)} icon={<Briefcase className="w-4 h-4 text-emerald-400" />} />
        <Stat label="Reviewed" value={String(reviewedCount)} icon={<Star className="w-4 h-4 text-amber-400" />} />
      </div>

      {completedCount > done.length && (
        <p className="text-xs text-amber-200/80 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          Your profile counts {completedCount} completed {completedCount === 1 ? 'job' : 'jobs'}, but only {done.length} {done.length === 1 ? 'has' : 'have'} details here.
          Older jobs may have been recorded before job history was tracked.
        </p>
      )}

      <div className="flex gap-2">
        {filterBtn('all', 'All')}
        {filterBtn('completed', 'Completed')}
        {filterBtn('other', 'Cancelled or declined')}
      </div>

      {shown.length === 0 ? (
        <Empty title="No jobs here yet" hint="Jobs you complete, and the reviews buyers leave, show up here." />
      ) : (
        <div className="space-y-3">
          {shown.map((j) => {
            const isDone = j.status === 'completed';
            return (
              <JobCard
                key={j.id}
                job={j}
                tag={j.status[0].toUpperCase() + j.status.slice(1)}
                tone={isDone ? 'emerald' : 'slate'}
                muted={!isDone}
                showBuyer
                review={isDone ? reviews[j.id] || null : null}
                footnote={isDone && !reviews[j.id] ? 'The buyer has not left a review yet.' : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- My services ---------- */

function Services({
  me,
  categories,
  listings,
  reload,
  flash,
}: {
  me: Me;
  categories: Category[];
  listings: Listing[];
  reload: () => void;
  flash: (m: string) => void;
}) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('job');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!categoryId && categories[0]) setCategoryId(categories[0].id);
  }, [categories, categoryId]);

  const add = async () => {
    if (!title.trim() || !categoryId) {
      flash('Add a category and a title.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('provider_services').insert({
      provider_id: me.id,
      category_id: categoryId,
      title: title.trim(),
      description: details.trim() || null,
      price_from: price ? Number(price) : null,
      price_unit: unit,
    });
    setSaving(false);
    if (error) {
      flash(error.message);
      return;
    }
    setTitle('');
    setDetails('');
    setPrice('');
    reload();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('provider_services').delete().eq('id', id);
    if (error) flash(error.message);
    reload();
  };

  const toggleActive = async (l: Listing) => {
    const { error } = await supabase.from('provider_services').update({ active: !l.active }).eq('id', l.id);
    if (error) flash(error.message);
    else flash(l.active ? 'Service paused. Buyers will not see it.' : 'Service is live again.');
    reload();
  };

  const catName = (id: string) => categories.find((c) => c.id === id)?.name || id;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
        <h2 className="text-sm font-bold text-white">Add a service</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={field} aria-label="Category">
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Example: Emergency leak repairs" className={field} />
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))}
            inputMode="numeric"
            placeholder={'Starting price (\u20A6)'}
            className={field}
          />
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className={field} aria-label="Price unit">
            <option value="job">per job</option>
            <option value="hour">per hour</option>
            <option value="day">per day</option>
            <option value="item">per item</option>
          </select>
        </div>
        <input
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Details buyers search for (optional). Example: taps, toilets, burst pipes"
          className={field}
        />
        <button
          onClick={add}
          disabled={saving}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 rounded-lg px-4 py-2.5 transition"
        >
          <Plus className="w-3.5 h-3.5" /> Add service
        </button>
        <p className="text-[11px] text-slate-500">
          You only receive requests for categories you list here, in {me.city}. Prices shown to buyers are starting prices, so agree the final price with each buyer.
        </p>
      </div>

      {listings.length === 0 ? (
        <Empty title="No services listed" hint="Add at least one so buyers can find you." />
      ) : (
        <ul className="rounded-xl border border-slate-800 bg-slate-900 divide-y divide-slate-800/70">
          {listings.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className={`min-w-0 ${l.active ? '' : 'opacity-60'}`}>
                <p className="text-sm font-medium text-white truncate">
                  {l.title}
                  {!l.active && <span className="ml-2 text-[11px] font-semibold text-amber-400">Paused</span>}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {catName(l.category_id)}
                  {l.price_from != null ? ` \u00B7 from ${naira(l.price_from)} / ${l.price_unit || 'job'}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => toggleActive(l)}
                  className="text-[11px] font-medium text-slate-300 border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 rounded-lg px-2.5 py-1.5 transition"
                >
                  {l.active ? 'Pause' : 'Resume'}
                </button>
                <button onClick={() => remove(l.id)} aria-label={`Remove ${l.title}`} className="text-slate-500 hover:text-red-400 p-2 transition">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Profile ---------- */

function Profile({ me, reload, flash }: { me: Me; reload: () => Promise<Me | null>; flash: (m: string) => void }) {
  const [form, setForm] = useState({
    display_name: me.display_name,
    provider_type: me.provider_type,
    phone: me.phone || '',
    city: me.city,
    area: me.area || '',
    bio: me.bio || '',
    service_areas: (me.service_areas || []).join(', '),
    typical_arrival_minutes: me.typical_arrival_minutes ? String(me.typical_arrival_minutes) : '',
    offers_emergency: !!me.offers_emergency,
    years_experience: me.years_experience != null ? String(me.years_experience) : '',
    bank_name: me.bank_name || '',
    account_name: me.account_name || '',
    account_number: me.account_number || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.display_name.trim() || !form.city.trim()) {
      flash('Name and city are required.');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('service_providers')
      .update({
        display_name: form.display_name.trim(),
        provider_type: form.provider_type,
        phone: form.phone.trim() ? intlPhone(form.phone) : null,
        city: form.city.trim(),
        area: form.area.trim() || null,
        bio: form.bio.trim() || null,
        service_areas: parseAreas(form.service_areas),
        typical_arrival_minutes: form.typical_arrival_minutes ? Number(form.typical_arrival_minutes) : null,
        offers_emergency: form.offers_emergency,
        years_experience: form.years_experience !== '' ? Number(form.years_experience) : null,
        bank_name: form.bank_name.trim() || null,
        account_name: form.account_name.trim() || null,
        account_number: form.account_number.trim() || null,
      })
      .eq('id', me.id);
    setSaving(false);
    if (error) flash(error.message);
    else {
      flash('Profile saved');
      reload();
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
      <ProfileFields form={form} set={set} />
      <div className="pt-2 border-t border-slate-800 space-y-3">
        <h2 className="text-sm font-bold text-white">Payout account</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <input value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)} placeholder="Bank" className={field} />
          <input value={form.account_name} onChange={(e) => set('account_name', e.target.value)} placeholder="Account name" className={field} />
          <input
            value={form.account_number}
            onChange={(e) => set('account_number', e.target.value.replace(/[^\d]/g, ''))}
            inputMode="numeric"
            maxLength={10}
            placeholder="Account number"
            className={field}
          />
        </div>
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 rounded-lg px-5 py-2.5 transition"
      >
        {saving ? 'Saving...' : 'Save changes'}
      </button>
    </div>
  );
}

function ProfileFields({
  form,
  set,
}: {
  form: ProviderForm;
  set: (k: any, v: any) => void;
}) {
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-slate-400">Name or shop name</span>
          <input value={form.display_name} onChange={(e) => set('display_name', e.target.value)} className={`${field} mt-1`} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">I am</span>
          <select value={form.provider_type} onChange={(e) => set('provider_type', e.target.value)} className={`${field} mt-1`}>
            <option value="individual">An individual</option>
            <option value="shop">A shop or business</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">City</span>
          <select value={form.city} onChange={(e) => set('city', e.target.value)} className={`${field} mt-1`}>
            {!CITIES.includes(form.city) && form.city && <option value={form.city}>{form.city}</option>}
            {CITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">Area or street</span>
          <input value={form.area} onChange={(e) => set('area', e.target.value)} placeholder="Example: Ikot Ekpene Road" className={`${field} mt-1`} />
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-slate-400">Phone (buyers see it only after you accept their job)</span>
        <input value={form.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" placeholder="0803... or 234..." className={`${field} mt-1`} />
      </label>
      <label className="block">
        <span className="text-xs text-slate-400">Other areas you cover (separate with commas)</span>
        <input
          value={form.service_areas}
          onChange={(e) => set('service_areas', e.target.value)}
          placeholder="Example: Ewet Housing, Itam, Aka Road"
          className={`${field} mt-1`}
        />
      </label>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-slate-400">You usually arrive within</span>
          <select
            value={form.typical_arrival_minutes}
            onChange={(e) => set('typical_arrival_minutes', e.target.value)}
            className={`${field} mt-1`}
          >
            {ARRIVAL_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">Years of experience</span>
          <input
            value={form.years_experience}
            onChange={(e) => set('years_experience', e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
            inputMode="numeric"
            placeholder="Example: 5"
            className={`${field} mt-1`}
          />
        </label>
      </div>
      <label className="flex items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={form.offers_emergency}
          onChange={(e) => set('offers_emergency', e.target.checked)}
          className="mt-0.5 accent-emerald-500"
        />
        <span className="text-xs text-slate-300">I take emergency calls (late night or weekends)</span>
      </label>
      <label className="block">
        <span className="text-xs text-slate-400">About you</span>
        <textarea value={form.bio} onChange={(e) => set('bio', e.target.value)} rows={3} placeholder="Years of experience, what you are best at" className={`${field} mt-1 resize-none`} />
      </label>
    </>
  );
}

/* ---------- Onboarding (signed in, no provider profile yet) ---------- */

function Onboarding({
  userId,
  categories,
  onCreated,
  onLogout,
}: {
  userId: string | null;
  categories: Category[];
  onCreated: () => Promise<void>;
  onLogout: () => void;
}) {
  const [form, setForm] = useState<ProviderForm>({
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
  });
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: any, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!userId) return;
    if (!form.display_name.trim() || intlPhone(form.phone).length < 12) {
      setErr('Add your name and a valid phone number.');
      return;
    }
    if (!categoryId || !title.trim()) {
      setErr('Pick a category and describe what you offer.');
      return;
    }
    setSaving(true);
    setErr('');
    const { data: created, error } = await supabase
      .from('service_providers')
      .insert({
        user_id: userId,
        display_name: form.display_name.trim(),
        provider_type: form.provider_type,
        phone: intlPhone(form.phone),
        city: form.city,
        area: form.area.trim() || null,
        bio: form.bio.trim() || null,
        service_areas: parseAreas(form.service_areas),
        typical_arrival_minutes: form.typical_arrival_minutes ? Number(form.typical_arrival_minutes) : null,
        offers_emergency: form.offers_emergency,
        years_experience: form.years_experience !== '' ? Number(form.years_experience) : null,
      })
      .select('id')
      .single();

    if (error || !created) {
      setSaving(false);
      setErr(error?.message || 'Could not create your profile.');
      return;
    }
    await supabase.from('provider_services').insert({
      provider_id: created.id,
      category_id: categoryId,
      title: title.trim(),
      price_from: price ? Number(price) : null,
      price_unit: 'job',
    });
    setSaving(false);
    await onCreated();
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 font-sans flex items-start sm:items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6 my-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h1 className="text-xl font-bold text-white">Offer your services on Sharp Sharp</h1>
          <button onClick={onLogout} aria-label="Log out" className="text-slate-400 hover:text-red-400 p-1 transition shrink-0">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-slate-400 mb-5">
          Set up your profile. We verify every provider before buyers can see you.
        </p>

        <div className="space-y-3">
          <ProfileFields form={form} set={set} />

          <div className="pt-2 border-t border-slate-800 space-y-3">
            <h2 className="text-sm font-bold text-white">Your first service</h2>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={field} aria-label="Category">
              <option value="">Choose a category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Example: Pipe repairs and installations" className={field} />
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              placeholder={'Starting price per job (\u20A6), optional'}
              className={field}
            />
          </div>

          {err && <p className="text-xs text-red-400">{err}</p>}

          <button
            onClick={submit}
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold text-sm rounded-xl py-3 transition"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Create provider profile
          </button>
        </div>
      </div>
    </div>
  );
}