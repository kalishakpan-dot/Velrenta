'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Bell, CheckCircle2, XCircle, Volume2, VolumeX, Megaphone, Newspaper, Tag, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface Notice {
  id: string;
  po_id: string | null;
  type: string;
  title: string;
  message: string | null;
  read: boolean;
  created_at: string;
  link?: string | null;
}

const SOUND_KEY = 'velrenta_bell_sound';

export default function NotificationBell() {
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Notice | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const soundRef = useRef(true);
  const titleBase = useRef<string | null>(null);

  /* ---------- Sound ---------- */

  // Browsers only allow sound after the person has tapped or clicked the page once.
  const unlockAudio = useCallback(() => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!audio.current) audio.current = new Ctx();
      audio.current?.resume?.();
    } catch {
      /* audio unavailable */
    }
  }, []);

  // Remembered choice (on by default)
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

  // Unlock audio on the first tap, click or key press anywhere on the page.
  useEffect(() => {
    const events = ['pointerdown', 'touchstart', 'keydown'] as const;
    const unlock = () => {
      unlockAudio();
      events.forEach((e) => document.removeEventListener(e, unlock));
    };
    events.forEach((e) => document.addEventListener(e, unlock));
    return () => events.forEach((e) => document.removeEventListener(e, unlock));
  }, [unlockAudio]);

  // A short two-note chime
  const beep = useCallback(() => {
    if (!soundRef.current) return;
    try {
      unlockAudio();
      const ctx = audio.current;
      if (!ctx) return;
      const notes: [number, number][] = [
        [0, 784],
        [0.2, 988],
      ];
      notes.forEach(([offset, freq]) => {
        const start = ctx.currentTime + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.27);
      });
    } catch {
      /* ignore */
    }
  }, [unlockAudio]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    soundRef.current = next;
    try {
      localStorage.setItem(SOUND_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (next) beep(); // preview
  };

  // When the tab is in the background, flash the title until the person comes back.
  const flashTitle = useCallback(() => {
    if (typeof document === 'undefined' || !document.hidden) return;
    if (titleBase.current === null) titleBase.current = document.title;
    document.title = '\uD83D\uDD14 New notification';
    const restore = () => {
      if (document.hidden) return;
      if (titleBase.current !== null) document.title = titleBase.current;
      titleBase.current = null;
      document.removeEventListener('visibilitychange', restore);
    };
    document.addEventListener('visibilitychange', restore);
  }, []);

  /* ---------- Data ---------- */

  const load = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) console.error('Notifications fetch error:', error);
    if (data) setItems(data as Notice[]);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id);
        load(data.user.id);
      }
    });
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Notice;
          setItems((prev) => [n, ...prev]);
          setToast(n);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setToast(null), 6000);

          // Let the person know: sound, vibration, tab title
          beep();
          try {
            navigator.vibrate?.([200, 100, 200]);
          } catch {
            /* ignore */
          }
          flashTitle();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, beep, flashTitle]);

  const unread = items.filter((i) => !i.read).length;

  const markAllRead = async () => {
    if (!userId || unread === 0) return;
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false);
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) markAllRead();
  };

  const Icon = (t: string) => {
    const cls = 'w-4 h-4 shrink-0 mt-0.5';
    if (t === 'po_declined') return <XCircle className={`${cls} text-red-400`} />;
    if (t === 'broadcast_news') return <Newspaper className={`${cls} text-sky-300`} />;
    if (t === 'broadcast_offer') return <Tag className={`${cls} text-violet-300`} />;
    if (t === 'broadcast_alert') return <AlertTriangle className={`${cls} text-amber-400`} />;
    if (t.startsWith('broadcast')) return <Megaphone className={`${cls} text-emerald-400`} />;
    return <CheckCircle2 className={`${cls} text-emerald-400`} />;
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label="Notifications"
        className="relative h-10 w-10 rounded-xl border border-slate-800 bg-slate-900 hover:border-slate-600 flex items-center justify-center text-slate-300 transition"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-amber-500 text-slate-950 text-[10px] font-bold flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-white">Notifications</span>
            <button
              onClick={toggleSound}
              aria-pressed={soundOn}
              aria-label={soundOn ? 'Turn notification sound off' : 'Turn notification sound on'}
              title={soundOn ? 'Sound on' : 'Sound off'}
              className={`inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full border px-2.5 py-1 transition ${soundOn
                ? 'border-emerald-500/40 text-emerald-400 hover:border-emerald-400'
                : 'border-slate-700 text-slate-500 hover:border-slate-500'
                }`}
            >
              {soundOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              {soundOn ? 'Sound on' : 'Sound off'}
            </button>
          </div>
          {items.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500">Nothing yet.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-slate-800/70">
              {items.map((n) => (
                <li key={n.id}>
                  <Link href={n.link || (n.type.startsWith('broadcast') ? '/' : '/pos')} onClick={() => setOpen(false)} className="flex gap-2.5 px-4 py-3 hover:bg-slate-800/40 transition">
                    {Icon(n.type)}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white">{n.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5 break-words">{n.message}</p>
                      <p className="text-[10px] text-slate-600 mt-1">{new Date(n.created_at).toLocaleString('en-NG')}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-20 md:bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[calc(100vw-2rem)] flex gap-2.5 rounded-lg border border-emerald-500/40 bg-slate-900 px-4 py-3 shadow-lg"
        >
          {Icon(toast.type)}
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white">{toast.title}</p>
            <p className="text-xs text-slate-300 mt-0.5">{toast.message}</p>
          </div>
        </div>
      )}
    </div>
  );
}