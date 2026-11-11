'use client';

// app/sharp/page.tsx  (buyer: describe a problem, get matched, request, track, review)

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  MapPin,
  Star,
  BadgeCheck,
  Phone,
  MessageCircle,
  X,
  Zap,
  Scissors,
  Car,
  Wrench,
  Cog,
  Sparkles,
  Utensils,
  Brush,
  Hammer,
  Camera,
  GraduationCap,
  Truck,
  Flame,
  Snowflake,
  Music,
  Palette,
  Shirt,
  Loader2,
  LocateFixed,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import BuyerShell from '../components/BuyerShell';

/* ---------- Types ---------- */

interface Category {
  id: string;
  name: string;
  icon: string;
  mode: 'instant' | 'booking';
}

interface ProviderService {
  id: string;
  category_id: string;
  title: string;
  description: string | null;
  price_from: number | null;
  price_unit: string | null;
  active: boolean;
}

// Note: phone and bank details are deliberately NOT loaded when browsing.
interface Provider {
  id: string;
  display_name: string;
  provider_type: 'individual' | 'shop';
  city: string;
  area: string | null;
  bio: string | null;
  is_online: boolean;
  rating: number;
  review_count: number;
  completed_jobs: number;
  service_areas?: string[] | null;
  typical_arrival_minutes?: number | null;
  offers_emergency?: boolean | null;
  years_experience?: number | null;
  last_active_at?: string | null;
  provider_services: ProviderService[];
}

interface MyRequest {
  id: string;
  category_id: string;
  provider_id: string | null;
  description: string;
  city: string;
  address: string | null;
  budget: number | null;
  status: string;
  created_at: string;
  service_providers: { display_name: string; phone: string | null; rating: number } | null;
  service_categories: { name: string } | null;
}

interface Target {
  category: Category;
  provider: Provider | null;
  prefill?: string;
}

// What the AI agent (n8n) sends back for a search sentence
interface AiIntent {
  q: string; // the query this answer belongs to
  category_id: string | null;
  confidence: number;
  keywords: string[];
  urgent: boolean;
  summary: string;
}

/* ---------- Constants ---------- */

const ICONS: Record<string, LucideIcon> = {
  scissors: Scissors,
  car: Car,
  wrench: Wrench,
  zap: Zap,
  cog: Cog,
  sparkles: Sparkles,
  utensils: Utensils,
  brush: Brush,
  hammer: Hammer,
  camera: Camera,
  'graduation-cap': GraduationCap,
  truck: Truck,
  flame: Flame,
  snowflake: Snowflake,
  music: Music,
  palette: Palette,
  shirt: Shirt,
};

const DEFAULT_CITIES = ['Uyo', 'Port Harcourt', 'Lagos', 'Abuja', 'Calabar', 'Enugu'];
const CITY_KEY = 'velrenta_sharp_city';

// Used only to pick the nearest city when the buyer taps "use my location". No external API.
const CITY_COORDS: Record<string, [number, number]> = {
  Uyo: [5.0377, 7.9128],
  'Port Harcourt': [4.8156, 7.0498],
  Lagos: [6.5244, 3.3792],
  Abuja: [9.0765, 7.3986],
  Calabar: [4.9757, 8.3417],
  Enugu: [6.4584, 7.5464],
};

const EXAMPLES = [
  'My pipe is leaking',
  "My car won't start",
  'Sew two senator outfits',
  'Inverter not working',
  'Clean my house today',
];

const STATUS_LABEL: Record<string, string> = {
  open: 'Finding a provider',
  requested: 'Waiting for provider',
  accepted: 'Accepted',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  declined: 'Declined',
};

const statusStyle = (s: string) => {
  if (s === 'completed') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
  if (s === 'accepted' || s === 'in_progress') return 'bg-sky-500/10 text-sky-300 border-sky-500/30';
  if (s === 'open' || s === 'requested') return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  return 'bg-slate-800 text-slate-400 border-slate-700';
};

/* ---------- Problem-first matching ---------- */
/* Words people use when they describe a problem, mapped to category ids.
   Categories not listed here still match on their own name.
   This is the fallback. The AI agent is used first when it answers. */

const INTENT_WORDS: Record<string, string[]> = {
  plumber: ['plumber', 'plumbing', 'pipe', 'leak', 'leaking', 'tap', 'toilet', 'borehole', 'tank', 'water', 'drain', 'sink', 'flush', 'blocked', 'burst'],
  electrician: ['electrician', 'electric', 'light', 'lights', 'wiring', 'socket', 'inverter', 'solar', 'generator', 'power', 'nepa', 'bulb', 'cable', 'breaker', 'fuse', 'shock'],
  mechanic: ['mechanic', 'engine', 'brake', 'brakes', 'tyre', 'tire', 'flat', 'battery', 'car', 'breakdown', 'gearbox', 'radiator', 'puncture', 'vulcanizer', 'tow', 'start'],
  car_rental: ['car hire', 'rental', 'rent', 'hire', 'driver', 'airport', 'pickup', 'suv', 'sedan', 'trip', 'ride'],
  tailor: ['tailor', 'sew', 'sewing', 'dress', 'outfit', 'outfits', 'gown', 'senator', 'aso ebi', 'alteration', 'alter', 'uniform', 'uniforms', 'native', 'fabric', 'trouser', 'shirt', 'fix my clothes', 'repair clothes', 'zip'],
  hair: ['hair', 'barber', 'haircut', 'braid', 'braids', 'weave', 'salon', 'makeup', 'gele', 'beard', 'wig', 'lashes', 'nails'],
  cleaner: ['clean', 'cleaner', 'cleaning', 'fumigate', 'sweep', 'mop', 'house', 'office'],
  caterer: ['cater', 'caterer', 'catering', 'food', 'event', 'party', 'jollof', 'small chops', 'cook', 'buffet', 'wedding'],
  carpenter: ['carpenter', 'furniture', 'wood', 'door', 'cabinet', 'wardrobe'],
  painter: ['painter', 'paint', 'painting', 'wall', 'walls'],
  welder: ['welder', 'welding', 'gate', 'burglar proof', 'iron'],
  photographer: ['photographer', 'photo', 'photos', 'camera', 'video', 'videographer', 'shoot', 'pictures'],
  ac_technician: ['ac', 'air conditioner', 'air conditioning', 'cooling', 'freezer', 'fridge', 'refrigerator', 'split unit', 'gas refill'],
  mover: ['mover', 'movers', 'moving', 'relocate', 'relocation', 'move house', 'packing', 'haulage'],
  tutor: ['tutor', 'lesson', 'lessons', 'teacher', 'exam', 'jamb', 'waec', 'maths', 'homework', 'coaching'],
  dj: ['dj', 'mc', 'sound system', 'disc jockey', 'entertainer'],
  graphic_designer: ['logo', 'flyer', 'designer', 'graphic', 'branding', 'poster', 'banner'],
  laundry: ['dry cleaning', 'ironing', 'laundry', 'laundry service', 'wash my clothes', 'washing', 'wash'],
};

const STOP = new Set([
  'my', 'me', 'is', 'am', 'are', 'was', 'the', 'a', 'an', 'to', 'for', 'of', 'in', 'on', 'at', 'it', 'its', 'and', 'or', 'with',
  'need', 'needs', 'want', 'please', 'help', 'near', 'around', 'i', 'we', 'you', 'can', 'do', 'does', 'not', 'wont', 'dont', 'some', 'someone',
  'urgent', 'urgently', 'now', 'today', 'asap', 'from', 'that', 'this', 'get', 'have', 'has', 'just', 'new', 'quick', 'person',
]);

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (s: string) => normalize(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t));

function wordHit(w: string, tokens: string[], norm: string) {
  if (w.includes(' ')) return norm.includes(w);
  return tokens.some((t) => t === w || (w.length >= 4 && t.startsWith(w)));
}

function detectCategory(q: string, cats: Category[]): Category | null {
  const norm = normalize(q);
  if (norm.length < 3) return null;
  const tokens = tokenize(q);
  let best: Category | null = null;
  let bestScore = 0;
  for (const c of cats) {
    const words = new Set<string>([...(INTENT_WORDS[c.id] || []), ...tokenize(c.name).filter((t) => t.length >= 3)]);
    let score = 0;
    words.forEach((w) => {
      if (wordHit(w, tokens, norm)) score += w.includes(' ') ? 2 : 1;
    });
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

function relevance(p: Provider, tokens: string[], intent: Category | null) {
  let s = 0;
  const name = p.display_name.toLowerCase();
  const area = coverage(p).join(' ').toLowerCase();
  const bio = (p.bio || '').toLowerCase();
  for (const t of tokens) {
    if (name.includes(t)) s += 3;
    if (area.includes(t)) s += 2;
    if (bio.includes(t)) s += 1;
    for (const sv of p.provider_services) {
      if (sv.title.toLowerCase().includes(t)) s += 2;
      if ((sv.description || '').toLowerCase().includes(t)) s += 1;
    }
  }
  if (intent && p.provider_services.some((sv) => sv.category_id === intent.id)) s += 4;
  return s;
}

/* ---------- Helpers ---------- */

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

const distKm = (a: [number, number], b: [number, number]) => {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// Every area a provider covers: their base area plus any extra service areas.
const coverage = (p: Provider) =>
  Array.from(new Set([p.area, ...(p.service_areas || [])].map((a) => (a || '').trim()).filter(Boolean)));

const etaLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} hr` : `${(m / 60).toFixed(1)} hr`);

// A provider counts as available only if they are online AND their heartbeat is recent.
const STALE_MS = 30 * 60 * 1000;

const CatIcon = ({ name, className }: { name: string; className?: string }) => {
  const I = ICONS[name] || Wrench;
  return <I className={className} />;
};

const chip = (on: boolean) =>
  `shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
    on ? 'bg-emerald-500 border-emerald-500 text-slate-950' : 'border-slate-700 text-slate-300 hover:border-emerald-500/50'
  }`;

/* ---------- Page ---------- */

export default function SharpSharpPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cities, setCities] = useState<string[]>(DEFAULT_CITIES);
  const [city, setCity] = useState('Uyo');
  const [catId, setCatId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [sortRated, setSortRated] = useState(false);
  const [area, setArea] = useState('');
  const [locating, setLocating] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'find' | 'mine'>('find');
  const [myRequests, setMyRequests] = useState<MyRequest[]>([]);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<Target | null>(null);
  const [toast, setToast] = useState('');
  const [ai, setAi] = useState<AiIntent | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const prevStatus = useRef<Record<string, string> | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }, []);

  /* Init: user, categories, remembered city, known cities */
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserId(user?.id || null);

      try {
        const saved = sessionStorage.getItem(CITY_KEY);
        if (saved) setCity(saved);
      } catch {
        /* storage unavailable */
      }

      const { data: cats } = await supabase
        .from('service_categories')
        .select('id, name, icon, mode')
        .order('sort_order');
      if (cats) setCategories(cats as Category[]);

      const { data: cityRows } = await supabase.from('service_providers').select('city').eq('is_verified', true);
      if (cityRows) {
        const merged = new Set(DEFAULT_CITIES);
        cityRows.forEach((r: any) => r.city && merged.add(r.city));
        setCities(Array.from(merged).sort());
      }
    })();
  }, []);

  const changeCity = (c: string) => {
    setCity(c);
    setArea('');
    try {
      sessionStorage.setItem(CITY_KEY, c);
    } catch {
      /* ignore */
    }
  };

  /* Pick the nearest covered city from the device location */
  const detectCity = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      flash('Location is not available on this device. Pick your city from the list.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        let best = '';
        let bestD = Infinity;
        cities.forEach((c) => {
          const xy = CITY_COORDS[c];
          if (!xy) return;
          const d = distKm(here, xy);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        });
        setLocating(false);
        if (best && bestD <= 80) {
          changeCity(best);
          flash(`Showing providers in ${best}`);
        } else {
          flash('We do not cover your area yet. Pick a city from the list.');
        }
      },
      () => {
        setLocating(false);
        flash('Location permission was denied. Pick your city from the list.');
      },
      { timeout: 10000 }
    );
  };

  /* Providers in the chosen city. Contact and bank details are not selected here. */
  const loadProviders = useCallback(async () => {
    const SVC = 'provider_services(id, category_id, title, description, price_from, price_unit, active)';
    const BASE = 'id, display_name, provider_type, city, area, bio, is_online, rating, review_count, completed_jobs';
    const fetchWith = (cols: string) =>
      supabase.from('service_providers').select(`${cols}, ${SVC}`).eq('is_verified', true).ilike('city', city);

    // Try with the new profile fields; fall back to the base fields if the migration has not been run yet.
    let res: { data: any; error: any } = await fetchWith(
      `${BASE}, service_areas, typical_arrival_minutes, offers_emergency, years_experience, last_active_at`
    );
    if (res.error) res = await fetchWith(BASE);
    const { data, error } = res;
    if (error) console.error('Providers fetch error:', error);

    const list = ((data as Provider[]) || []).map((p) => {
      const fresh = !p.last_active_at || Date.now() - new Date(p.last_active_at).getTime() < STALE_MS;
      return {
        ...p,
        is_online: p.is_online && fresh,
        provider_services: (p.provider_services || []).filter((s) => s.active),
      };
    });
    // Providers with no active service cannot be matched, so hide them.
    setProviders(list.filter((p) => p.provider_services.length > 0));
    setLoading(false);
  }, [city]);

  useEffect(() => {
    setLoading(true);
    loadProviders();
  }, [loadProviders]);

  /* Re-check availability every 2 minutes so stale "online" providers drop off */
  useEffect(() => {
    const t = setInterval(loadProviders, 120000);
    return () => clearInterval(t);
  }, [loadProviders]);

  /* The buyer's own requests, plus a notification when a status changes */
  const loadMine = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('service_requests')
      .select('*, service_providers(display_name, phone, rating), service_categories(name)')
      .eq('buyer_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) console.error('Requests fetch error:', error);
    if (data) {
      const rows = data as unknown as MyRequest[];
      if (prevStatus.current) {
        for (const r of rows) {
          const old = prevStatus.current[r.id];
          if (!old || old === r.status) continue;
          const who = r.service_providers?.display_name || 'A provider';
          if (r.status === 'accepted') flash(`${who} accepted your request. You can call them now.`);
          else if (r.status === 'in_progress') flash('Your job has started.');
          else if (r.status === 'completed') flash('Job completed. Leave a review in My requests.');
          else if (r.status === 'declined') flash(`${who} could not take this job. Try another provider.`);
        }
      }
      prevStatus.current = Object.fromEntries(rows.map((r) => [r.id, r.status]));
      setMyRequests(rows);
    }

    const { data: revs } = await supabase.from('service_reviews').select('request_id').eq('buyer_id', userId);
    setReviewed(new Set((revs || []).map((r: any) => r.request_id as string)));
  }, [userId, flash]);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  /* Live updates: provider accepts, starts or finishes a job; availability changes */
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`sharp-buyer-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'service_requests', filter: `buyer_id=eq.${userId}` },
        () => loadMine()
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'service_providers' }, () => loadProviders())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, loadMine, loadProviders]);

  /* Opened from the dashboard chat with /sharp?q=...: prefill the search so the AI starts right away */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const q = (params.get('q') || '').trim().slice(0, 300);
      if (q) {
        setQuery(q);
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch {
      /* ignore */
    }
  }, []);

  /* AI agent: after the buyer stops typing for 700ms, ask n8n what they need */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 6 || categories.length === 0) {
      setAi(null);
      setAiLoading(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setAiLoading(true);
      try {
        const res = await fetch('/api/sharp/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, categories: categories.map((c) => ({ id: c.id, name: c.name })) }),
        });
        const json = await res.json();
        if (!cancelled) setAi(json?.intent ? { ...json.intent, q } : null);
      } catch {
        if (!cancelled) setAi(null);
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, categories]);

  /* Matching */
  const activeCat = categories.find((c) => c.id === catId) || null;

  // Only trust the AI answer if it belongs to what is currently typed
  const aiNow = ai && ai.q === query.trim() ? ai : null;
  const aiCat =
    aiNow && aiNow.confidence >= 0.5 ? categories.find((c) => c.id === aiNow.category_id) || null : null;

  const tokens = useMemo(() => {
    const base = tokenize(query);
    const extra = aiNow ? (aiNow.keywords || []).flatMap((k) => tokenize(k)) : [];
    return Array.from(new Set([...base, ...extra]));
  }, [query, aiNow]);

  const detected = useMemo(() => (catId ? null : detectCategory(query, categories)), [query, categories, catId]);
  const intentCat = activeCat || aiCat || detected; // AI beats the keyword guess

  const areas = useMemo(() => Array.from(new Set(providers.flatMap(coverage))).sort(), [providers]);

  const visible = useMemo(() => {
    const hasQ = tokens.length > 0;
    const inArea = (p: Provider) => (area && coverage(p).some((a) => a.toLowerCase() === area.toLowerCase()) ? 1 : 0);

    const rows = providers
      .filter((p) => {
        if (catId && !p.provider_services.some((s) => s.category_id === catId)) return false;
        if (!catId && aiCat && !p.provider_services.some((s) => s.category_id === aiCat.id)) return false;
        if (onlineOnly && !p.is_online) return false;
        return true;
      })
      .map((p) => ({ p, score: hasQ ? relevance(p, tokens, intentCat) : 0 }))
      .filter((x) => !hasQ || x.score > 0);

    rows.sort((a, b) => {
      const near = inArea(b.p) - inArea(a.p);
      if (near) return near;
      if (sortRated) {
        return (
          b.p.rating - a.p.rating ||
          b.p.review_count - a.p.review_count ||
          Number(b.p.is_online) - Number(a.p.is_online) ||
          b.score - a.score
        );
      }
      return (
        Number(b.p.is_online) - Number(a.p.is_online) ||
        b.score - a.score ||
        b.p.rating - a.p.rating ||
        b.p.completed_jobs - a.p.completed_jobs
      );
    });
    return rows.map((x) => x.p);
  }, [providers, catId, onlineOnly, sortRated, area, tokens, intentCat, aiCat]);

  const onlineInIntent = providers.filter(
    (p) => p.is_online && (!intentCat || p.provider_services.some((s) => s.category_id === intentCat.id))
  ).length;

  const catById = (id: string) => categories.find((c) => c.id === id);

  const prefillFromQuery = query.trim().length >= 8 ? query.trim() : '';

  const cancelRequest = async (id: string) => {
    const { error } = await supabase.rpc('cancel_service_request', { p_request: id });
    if (error) flash(error.message);
    else flash('Request cancelled');
    loadMine();
  };

  const activeCount = myRequests.filter((r) => ['open', 'requested', 'accepted', 'in_progress'].includes(r.status)).length;
  const showSmartPanel = !!intentCat && (intentCat.mode === 'instant' || !!detected || !!aiCat);

  return (
    <BuyerShell
      active="sharp"
      title="My Plug"
      subtitle="Describe what you need, pick your city, and get connected to the right person, sharp sharp."
    >
      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-800">
        {(
          [
            ['find', 'Find a service'],
            ['mine', `My requests${activeCount ? ` (${activeCount})` : ''}`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
              tab === k ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'find' && (
        <>
          {/* City + problem-first search */}
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <div className="flex gap-2 sm:w-72 shrink-0">
              <label className="relative flex-1 min-w-0">
                <MapPin className="w-4 h-4 text-emerald-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={city}
                  onChange={(e) => changeCity(e.target.value)}
                  aria-label="City"
                  className="w-full appearance-none bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                >
                  {cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={detectCity}
                disabled={locating}
                aria-label="Use my location"
                title="Use my location"
                className="shrink-0 w-11 flex items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-300 hover:text-emerald-400 hover:border-emerald-500/50 disabled:opacity-60 transition"
              >
                {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
              </button>
            </div>

            <label className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Describe the problem, e.g. my pipe is leaking"
                aria-label="Describe what you need"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-9 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </label>
          </div>

          {/* Example problems */}
          {!query && !catId && (
            <div className="flex gap-2 overflow-x-auto pb-1 mb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <span className="shrink-0 text-xs text-slate-500 self-center">Try:</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setQuery(ex)}
                  className="shrink-0 rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-300 hover:border-emerald-500/50 hover:text-emerald-400 transition"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          {/* Category chips */}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button onClick={() => setCatId(null)} className={chip(!catId)}>
              All
            </button>
            {categories.map((c) => (
              <button key={c.id} onClick={() => setCatId(c.id === catId ? null : c.id)} className={chip(catId === c.id)}>
                <CatIcon name={c.icon} className="w-3.5 h-3.5" />
                {c.name}
              </button>
            ))}
          </div>

          {/* Quick filters */}
          <div className="flex gap-2 items-center overflow-x-auto pb-2 mb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button onClick={() => setOnlineOnly((v) => !v)} aria-pressed={onlineOnly} className={chip(onlineOnly)}>
              <span className={`h-1.5 w-1.5 rounded-full ${onlineOnly ? 'bg-slate-950' : 'bg-emerald-400'}`} />
              Available now
            </button>
            <button onClick={() => setSortRated((v) => !v)} aria-pressed={sortRated} className={chip(sortRated)}>
              <Star className="w-3.5 h-3.5" />
              Best rated
            </button>
            {areas.length > 0 && (
              <label className="shrink-0">
                <span className="sr-only">Nearest area</span>
                <select
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className={`appearance-none rounded-full border px-3.5 py-1.5 text-xs font-medium focus:outline-none ${
                    area
                      ? 'bg-emerald-500 border-emerald-500 text-slate-950'
                      : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-emerald-500/50'
                  }`}
                >
                  <option value="">Nearest to: any area</option>
                  {areas.map((a) => (
                    <option key={a} value={a}>
                      Nearest to: {a}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* What the AI understood */}
          {query.trim().length >= 6 && (aiLoading || aiNow?.summary) && (
            <p className="text-xs text-emerald-400 mb-2 flex items-center gap-1.5" aria-live="polite">
              {aiLoading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" /> Understanding your request...
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" /> {aiNow?.summary}
                </>
              )}
            </p>
          )}

          {/* Smart panel: suggests a category from the problem, offers instant request */}
          {showSmartPanel && intentCat && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 mb-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">
                  {activeCat ? `Need a ${intentCat.name.toLowerCase()} right now?` : `Sounds like you need a ${intentCat.name.toLowerCase()}`}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {intentCat.mode === 'instant'
                    ? onlineInIntent > 0
                      ? `${onlineInIntent} online in ${city}. The first to accept gets your job.`
                      : `Nobody is online in ${city} at the moment. Your request stays open until someone accepts.`
                    : `${onlineInIntent} available in ${city}. Pick a provider below to book.`}
                </p>
              </div>
              <div className="flex gap-2">
                {!activeCat && (
                  <button
                    onClick={() => setCatId(intentCat.id)}
                    className="text-xs font-medium text-slate-200 border border-slate-600 hover:border-emerald-500/50 hover:text-emerald-400 rounded-lg px-3.5 py-2.5 transition"
                  >
                    Show {intentCat.name.toLowerCase()} providers
                  </button>
                )}
                {intentCat.mode === 'instant' && (
                  <button
                    onClick={() => setTarget({ category: intentCat, provider: null, prefill: prefillFromQuery })}
                    className="inline-flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg px-4 py-2.5 transition"
                  >
                    <Zap className="w-3.5 h-3.5" /> Request now
                  </button>
                )}
              </div>
            </div>
          )}

          {!loading && (
            <p className="text-xs text-slate-500 mb-3" aria-live="polite">
              {visible.length} {visible.length === 1 ? 'provider' : 'providers'} in {city}
              {visible.filter((p) => p.is_online).length > 0 && ` \u00B7 ${visible.filter((p) => p.is_online).length} available now`}
            </p>
          )}

          {/* Results */}
          {loading ? (
            <div className="grid sm:grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-40 rounded-xl bg-slate-900 border border-slate-800 animate-pulse" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-10 text-center">
              <MapPin className="w-6 h-6 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-300">
                {onlineOnly
                  ? `Nobody matching is available right now in ${city}`
                  : `No ${intentCat ? intentCat.name.toLowerCase() : 'providers'} listed in ${city} yet`}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {onlineOnly ? 'Turn off "Available now" to see everyone, or try another city.' : 'Try another city or category, or clear your search.'}
              </p>
              <div className="flex gap-2 justify-center flex-wrap mt-4">
                {onlineOnly && (
                  <button
                    onClick={() => setOnlineOnly(false)}
                    className="text-xs font-bold border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 text-slate-300 rounded-lg px-3.5 py-2 transition"
                  >
                    Show everyone
                  </button>
                )}
                {intentCat?.mode === 'instant' && (
                  <button
                    onClick={() => setTarget({ category: intentCat, provider: null, prefill: prefillFromQuery })}
                    className="text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg px-3.5 py-2 transition"
                  >
                    Post an open request
                  </button>
                )}
                {!onlineOnly && (
                  <a
                    href="/provider/login"
                    className="text-xs font-medium text-slate-300 border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 rounded-lg px-3.5 py-2 transition"
                  >
                    Offer this service
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {visible.map((p) => {
                const pool = intentCat ? p.provider_services.filter((s) => s.category_id === intentCat.id) : [];
                const shown = (pool.length ? pool : p.provider_services).slice(0, 3);
                const firstCat = catById(shown[0]?.category_id || '') || activeCat;
                const isNear = !!area && coverage(p).some((a) => a.toLowerCase() === area.toLowerCase());
                return (
                  <article key={p.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex flex-col min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-white flex items-center gap-1.5 truncate">
                          {p.display_name}
                          <BadgeCheck className="w-4 h-4 text-emerald-400 shrink-0" aria-label="Verified" />
                        </h3>
                        <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 truncate">
                          <MapPin className="w-3 h-3 shrink-0" />
                          {p.area ? `${p.area}, ${p.city}` : p.city}
                          <span className="text-slate-700">|</span>
                          {p.provider_type === 'shop' ? 'Shop' : 'Individual'}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full border px-2.5 py-0.5 ${
                          p.is_online
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${p.is_online ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                        {p.is_online ? 'Available now' : 'Offline'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 mt-2.5 flex items-center gap-1.5 flex-wrap">
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      {p.review_count > 0 ? (
                        <>
                          <span className="text-white font-semibold">{Number(p.rating).toFixed(1)}</span>
                          ({p.review_count} {p.review_count === 1 ? 'review' : 'reviews'})
                        </>
                      ) : (
                        'New on Sharp Sharp'
                      )}
                      {p.completed_jobs > 0 && <span className="text-slate-500">&middot; {p.completed_jobs} jobs done</span>}
                      {isNear && <span className="text-emerald-400">&middot; In your area</span>}
                    </p>

                    {p.bio && <p className="text-xs text-slate-400 mt-2 line-clamp-2">{p.bio}</p>}

                    {(p.offers_emergency || !!p.typical_arrival_minutes || !!p.years_experience) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {p.offers_emergency && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 px-2 py-0.5">
                            <Zap className="w-3 h-3" /> Emergency calls
                          </span>
                        )}
                        {!!p.typical_arrival_minutes && (
                          <span className="text-[11px] rounded-full border border-slate-700 text-slate-300 px-2 py-0.5">
                            Usually arrives in ~{etaLabel(p.typical_arrival_minutes)}
                          </span>
                        )}
                        {!!p.years_experience && (
                          <span className="text-[11px] rounded-full border border-slate-700 text-slate-300 px-2 py-0.5">
                            {p.years_experience} {p.years_experience === 1 ? 'year' : 'years'} experience
                          </span>
                        )}
                      </div>
                    )}

                    {coverage(p).length > 1 && (
                      <p className="text-[11px] text-slate-500 mt-2 truncate">Covers: {coverage(p).join(', ')}</p>
                    )}

                    <ul className="mt-3 space-y-1.5">
                      {shown.map((s) => (
                        <li key={s.id} className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-slate-200 truncate">{s.title}</span>
                          {s.price_from != null && (
                            <span className="text-slate-400 shrink-0">
                              from <span className="text-white font-semibold">{naira(s.price_from)}</span>
                              {s.price_unit ? ` / ${s.price_unit}` : ''}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>

                    <div className="mt-auto pt-4">
                      <button
                        disabled={!firstCat}
                        onClick={() => firstCat && setTarget({ category: firstCat, provider: p, prefill: prefillFromQuery })}
                        className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-lg py-2.5 transition"
                      >
                        {firstCat?.mode === 'booking' ? 'Book' : 'Request'} {p.display_name.split(' ')[0]}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'mine' && (
        <div className="space-y-3">
          {myRequests.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-10 text-center">
              <p className="text-sm text-slate-300">No requests yet</p>
              <p className="text-xs text-slate-500 mt-1">Describe a problem on the Find tab and your request will show up here.</p>
              <button
                onClick={() => setTab('find')}
                className="mt-4 text-xs font-bold border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 text-slate-300 rounded-lg px-3.5 py-2 transition"
              >
                Find a service
              </button>
            </div>
          ) : (
            myRequests.map((r) => (
              <RequestCard
                key={r.id}
                r={r}
                reviewed={reviewed.has(r.id)}
                onCancel={() => cancelRequest(r.id)}
                onFindAnother={() => setTab('find')}
                onReviewed={() => {
                  flash('Thanks for your review');
                  loadMine();
                }}
                userId={userId}
              />
            ))
          )}
        </div>
      )}

      {target && userId && (
        <RequestModal
          target={target}
          city={city}
          userId={userId}
          onClose={() => setTarget(null)}
          onDone={(msg) => {
            setTarget(null);
            flash(msg);
            setTab('mine');
            loadMine();
          }}
        />
      )}

      {target && !userId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-5 text-center">
            <p className="text-sm font-bold text-white">Sign in to send a request</p>
            <p className="text-xs text-slate-400 mt-1">You need a buyer account so the provider can reach you.</p>
            <div className="flex gap-2 justify-center mt-4">
              <a href="/login" className="text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg px-4 py-2.5 transition">
                Sign in
              </a>
              <button
                onClick={() => setTarget(null)}
                className="text-xs font-medium text-slate-300 border border-slate-700 rounded-lg px-4 py-2.5 hover:border-slate-500 transition"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed left-1/2 -translate-x-1/2 bottom-24 md:bottom-8 z-50 max-w-[90vw] bg-slate-800 border border-slate-700 text-sm text-white rounded-xl px-4 py-2.5 shadow-lg"
        >
          {toast}
        </div>
      )}
    </BuyerShell>
  );
}

/* ---------- Progress tracker ---------- */

const stepIndex = (s: string) =>
  s === 'completed' ? 3 : s === 'in_progress' ? 2 : s === 'accepted' ? 1 : s === 'open' || s === 'requested' ? 0 : -1;

function Tracker({ status }: { status: string }) {
  const idx = stepIndex(status);
  if (idx < 0) return null;
  const labels = [status === 'open' ? 'Posted' : 'Sent', 'Accepted', 'In progress', 'Done'];
  return (
    <ol className="mt-4 flex items-start" aria-label="Request progress">
      {labels.map((l, i) => (
        <li key={l} className={`flex items-start ${i < labels.length - 1 ? 'flex-1' : ''}`}>
          <div className="flex flex-col items-center gap-1">
            <span
              className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                i <= idx ? 'bg-emerald-500 border-emerald-500 text-slate-950' : 'border-slate-700 text-slate-500'
              }`}
            >
              {i < idx || (i === idx && status === 'completed') ? <Check className="w-3 h-3" /> : i + 1}
            </span>
            <span className={`text-[10px] whitespace-nowrap ${i <= idx ? 'text-emerald-400' : 'text-slate-500'}`}>{l}</span>
          </div>
          {i < labels.length - 1 && <span className={`h-px flex-1 mx-1.5 mt-2.5 ${i < idx ? 'bg-emerald-500' : 'bg-slate-800'}`} />}
        </li>
      ))}
    </ol>
  );
}

function statusHint(r: MyRequest): string {
  const who = r.service_providers?.display_name;
  const cat = (r.service_categories?.name || 'provider').toLowerCase();
  switch (r.status) {
    case 'open':
      return `Online ${cat}s in ${r.city} can see this. The first to accept gets the job.`;
    case 'requested':
      return `Waiting for ${who || 'the provider'} to respond. Not heard back? Cancel and try someone else.`;
    case 'accepted':
      return 'Call or message your provider to agree the price and time.';
    case 'in_progress':
      return 'Work is under way.';
    case 'completed':
      return '';
    case 'declined':
      return 'This provider could not take the job. Find another provider and send a new request.';
    default:
      return '';
  }
}

/* ---------- Request card (My requests) ---------- */

function RequestCard({
  r,
  reviewed,
  onCancel,
  onFindAnother,
  onReviewed,
  userId,
}: {
  r: MyRequest;
  reviewed: boolean;
  onCancel: () => void;
  onFindAnother: () => void;
  onReviewed: () => void;
  userId: string | null;
}) {
  const prov = r.service_providers;
  const canCancel = ['open', 'requested', 'accepted'].includes(r.status);
  const showContact = prov?.phone && ['accepted', 'in_progress'].includes(r.status);
  const num = intlPhone(prov?.phone);
  const hint = statusHint(r);

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">{r.service_categories?.name || 'Service'}</p>
          <p className="text-xs text-slate-400 mt-1 break-words whitespace-pre-line">{r.description}</p>
        </div>
        <span className={`shrink-0 text-[11px] font-semibold rounded-full border px-2.5 py-0.5 whitespace-nowrap ${statusStyle(r.status)}`}>
          {STATUS_LABEL[r.status] || r.status}
        </span>
      </div>

      <p className="text-xs text-slate-500 mt-2.5 flex items-center gap-1.5 flex-wrap">
        <MapPin className="w-3 h-3 shrink-0" />
        {[r.address, r.city].filter(Boolean).join(', ')}
        {r.budget != null && <span>&middot; Budget {naira(r.budget)}</span>}
        <span>&middot; {timeAgo(r.created_at)}</span>
      </p>

      {prov && (
        <p className="text-xs text-slate-300 mt-2.5">
          Provider: <span className="font-semibold text-white">{prov.display_name}</span>
        </p>
      )}

      <Tracker status={r.status} />
      {hint && <p className="text-xs text-slate-400 mt-3">{hint}</p>}

      <div className="flex flex-wrap gap-2 mt-3">
        {showContact && (
          <>
            <a
              href={`tel:+${num}`}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg px-3.5 py-2 transition"
            >
              <Phone className="w-3.5 h-3.5" /> Call
            </a>
            <a
              href={`https://wa.me/${num}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 rounded-lg px-3.5 py-2 transition"
            >
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
            </a>
          </>
        )}
        {r.status === 'declined' && (
          <button
            onClick={onFindAnother}
            className="text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg px-3.5 py-2 transition"
          >
            Find another provider
          </button>
        )}
        {canCancel && (
          <button
            onClick={onCancel}
            className="text-xs font-medium text-slate-300 border border-slate-700 hover:border-red-500/50 hover:text-red-400 rounded-lg px-3.5 py-2 transition"
          >
            Cancel request
          </button>
        )}
      </div>

      {r.status === 'completed' && r.provider_id && !reviewed && userId && (
        <ReviewBox requestId={r.id} providerId={r.provider_id} buyerId={userId} onDone={onReviewed} />
      )}
      {r.status === 'completed' && reviewed && <p className="text-xs text-slate-500 mt-3">You reviewed this job.</p>}
    </article>
  );
}

/* ---------- Review box ---------- */

function ReviewBox({
  requestId,
  providerId,
  buyerId,
  onDone,
}: {
  requestId: string;
  providerId: string;
  buyerId: string;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!rating) return;
    setSaving(true);
    setErr('');
    const { error } = await supabase.from('service_reviews').insert({
      request_id: requestId,
      provider_id: providerId,
      buyer_id: buyerId,
      rating,
      comment: comment.trim() || null,
    });
    setSaving(false);
    if (error) setErr(error.message);
    else onDone();
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-800">
      <p className="text-xs font-semibold text-white mb-2">How did it go?</p>
      <div className="flex gap-1 mb-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} className="p-0.5">
            <Star className={`w-6 h-6 ${n <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-600'}`} />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        placeholder="Add a comment (optional)"
        className="w-full resize-none bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
      />
      {err && <p className="text-xs text-red-400 mt-1">{err}</p>}
      <button
        onClick={submit}
        disabled={!rating || saving}
        className="mt-2 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 rounded-lg px-4 py-2 transition"
      >
        {saving ? 'Saving...' : 'Submit review'}
      </button>
    </div>
  );
}

/* ---------- Request / booking modal ---------- */

function RequestModal({
  target,
  city,
  userId,
  onClose,
  onDone,
}: {
  target: Target;
  city: string;
  userId: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { category, provider, prefill } = target;
  const services = provider ? provider.provider_services.filter((s) => s.category_id === category.id) : [];
  const whenOptions = category.mode === 'instant' ? ['Right now', 'Today', 'This week'] : ['This week', 'Next week', 'Flexible'];

  const [serviceId, setServiceId] = useState(services[0]?.id || '');
  const [description, setDescription] = useState(prefill || '');
  const [when, setWhen] = useState(whenOptions[0]);
  const [address, setAddress] = useState('');
  const [budget, setBudget] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Prefill contact details from the buyer profile.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('buyers').select('contact_name, phone').eq('id', userId).maybeSingle();
      if (data) {
        setName((n) => n || data.contact_name || '');
        setPhone((p) => p || data.phone || '');
      }
    })();
  }, [userId]);

  const submit = async () => {
    if (!description.trim()) {
      setErr('Tell the provider what you need.');
      return;
    }
    const phoneIntl = intlPhone(phone);
    if (phoneIntl.length < 12) {
      setErr('Add a valid phone number so the provider can reach you.');
      return;
    }
    setSaving(true);
    setErr('');

    const fullDescription = `${description.trim()}\n\nWhen: ${when}`;

    const { data: req, error } = await supabase
      .from('service_requests')
      .insert({
        buyer_id: userId,
        category_id: category.id,
        provider_id: provider?.id || null,
        provider_service_id: serviceId || null,
        description: fullDescription,
        city,
        address: address.trim() || null,
        budget: budget ? Number(budget) : null,
        status: provider ? 'requested' : 'open',
      })
      .select('id')
      .single();

    if (error || !req) {
      setSaving(false);
      setErr(error?.message || 'Could not send your request. Try again.');
      return;
    }

    const { error: cErr } = await supabase
      .from('service_request_contacts')
      .insert({ request_id: req.id, contact_name: name.trim() || null, contact_phone: phoneIntl });
    if (cErr) console.error('Contact save error:', cErr);

    setSaving(false);
    onDone(provider ? `Request sent to ${provider.display_name}` : 'Request posted. Online providers can accept it now.');
  };

  const field =
    'w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-slate-900 border border-slate-800 p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white">
              {provider
                ? category.mode === 'booking'
                  ? `Book ${provider.display_name}`
                  : `Request ${provider.display_name}`
                : `Request a ${category.name.toLowerCase()}`}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {provider ? `${category.name} in ${city}` : `Online ${category.name.toLowerCase()}s in ${city} will see this.`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {provider && (
          <div className="mb-3 rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                {provider.display_name}
                <BadgeCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-label="Verified" />
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {provider.review_count > 0 ? `${Number(provider.rating).toFixed(1)} stars (${provider.review_count})` : 'New on Sharp Sharp'}
                {provider.completed_jobs > 0 ? ` \u00B7 ${provider.completed_jobs} jobs done` : ''}
              </p>
            </div>
            <span className={`shrink-0 text-[11px] font-semibold ${provider.is_online ? 'text-emerald-400' : 'text-slate-500'}`}>
              {provider.is_online ? 'Available now' : 'Offline'}
            </span>
          </div>
        )}

        {provider && !provider.is_online && (
          <p className="mb-3 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            {provider.display_name.split(' ')[0]} is offline right now. They will see your request when they come back online. For something urgent, cancel it in My requests and try someone who is available.
          </p>
        )}

        <div className="space-y-3">
          {services.length > 1 && (
            <label className="block">
              <span className="text-xs text-slate-400">Service</span>
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={`${field} mt-1`}>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                    {s.price_from != null ? ` (from ${naira(s.price_from)})` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="text-xs text-slate-400">What do you need?</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={
                category.id === 'tailor'
                  ? 'Example: Two senator outfits, need them in 5 days'
                  : category.id === 'car_rental'
                  ? 'Example: Sedan for 3 days from Friday, with a driver'
                  : 'Describe the problem, for example: kitchen pipe is leaking under the sink'
              }
              className={`${field} mt-1 resize-none`}
            />
          </label>

          <div>
            <span className="text-xs text-slate-400">When do you need it?</span>
            <div className="flex gap-2 flex-wrap mt-1.5">
              {whenOptions.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWhen(w)}
                  aria-pressed={when === w}
                  className={chip(when === w)}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-xs text-slate-400">Address or landmark</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Where should they come? Example: close to Ibom Plaza" className={`${field} mt-1`} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-400">Budget (optional)</span>
              <input
                value={budget}
                onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                placeholder={'\u20A6'}
                className={`${field} mt-1`}
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Your phone</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="0803... or 234..." className={`${field} mt-1`} />
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-slate-400">Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={`${field} mt-1`} />
          </label>

          <p className="text-[11px] text-slate-500">
            Your phone number is only shared with the provider who accepts the job. Agree the final price with them before work starts.
          </p>

          {err && <p className="text-xs text-red-400">{err}</p>}

          <button
            onClick={submit}
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold text-sm rounded-xl py-3 transition"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {provider ? (category.mode === 'booking' ? 'Send booking request' : 'Send request') : 'Post request'}
          </button>
        </div>
      </div>
    </div>
  );
}