'use client';

// app/components/AdminBroadcasts.tsx
// Compose a message, preview it exactly as users will see it, send it to a
// chosen audience, and unsend it later if needed.

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Megaphone,
  Newspaper,
  AlertTriangle,
  Tag,
  Send,
  Users,
  Building2,
  Bell,
  Undo2,
  Copy,
  X,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

type Kind = 'news' | 'announcement' | 'alert' | 'offer';
type Audience = 'buyers' | 'suppliers' | 'all';

interface Broadcast {
  id: string;
  title: string;
  body: string;
  kind: Kind;
  audience: Audience;
  verified_only: boolean;
  link: string | null;
  recipient_count: number;
  created_at: string;
}

const TITLE_MAX = 80;
const BODY_MAX = 500;

const KINDS: Record<Kind, { label: string; hint: string; Icon: typeof Bell; chip: string; icon: string; edge: string }> = {
  announcement: {
    label: 'Announcement',
    hint: 'Platform updates and notices',
    Icon: Megaphone,
    chip: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    icon: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    edge: 'before:bg-emerald-500/60',
  },
  news: {
    label: 'News',
    hint: 'Stories and market updates',
    Icon: Newspaper,
    chip: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    icon: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    edge: 'before:bg-sky-400',
  },
  offer: {
    label: 'Offer',
    hint: 'Deals and promotions',
    Icon: Tag,
    chip: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
    icon: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    edge: 'before:bg-violet-400',
  },
  alert: {
    label: 'Alert',
    hint: 'Urgent, needs attention',
    Icon: AlertTriangle,
    chip: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    icon: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    edge: 'before:bg-amber-400',
  },
};

const AUDIENCES: { key: Audience; label: string; hint: string; Icon: typeof Users }[] = [
  { key: 'all', label: 'Everyone', hint: 'Buyers and suppliers', Icon: Bell },
  { key: 'buyers', label: 'Buyers', hint: 'Everyone who orders', Icon: Users },
  { key: 'suppliers', label: 'Suppliers', hint: 'Everyone who sells', Icon: Building2 },
];

const EDGE_BASE = 'relative overflow-hidden before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1';

const inputCls =
  'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition';

const audienceLabel = (a: Audience, verifiedOnly: boolean) =>
  `${a === 'all' ? 'Everyone' : a === 'buyers' ? 'Buyers' : 'Suppliers'}${verifiedOnly ? ', verified only' : ''}`;

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function AdminBroadcasts({
  getToken,
  toast,
}: {
  getToken: () => Promise<string>;
  toast: (text: string, tone?: 'ok' | 'err') => void;
}) {
  const [kind, setKind] = useState<Kind>('announcement');
  const [audience, setAudience] = useState<Audience>('all');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');

  const [reach, setReach] = useState<number | null>(null);
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [unsendingId, setUnsendingId] = useState<string | null>(null);

  const k = KINDS[kind];
  const canSend = title.trim().length > 0 && body.trim().length > 0;

  const authed = useCallback(async (url: string, init: RequestInit = {}) => {
    const res = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: { ...(init.headers || {}), Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  }, [getToken]);

  const loadHistory = useCallback(async () => {
    try {
      const { res, json } = await authed('/api/admin/broadcasts');
      if (!res.ok) throw new Error();
      setHistory(json.broadcasts || []);
      setReady(json.ready !== false);
    } catch {
      toast('Could not load past broadcasts.', 'err');
    } finally {
      setLoading(false);
    }
  }, [authed, toast]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // How many people this will reach, refreshed whenever the audience changes
  const reachSeq = useRef(0);
  useEffect(() => {
    const seq = ++reachSeq.current;
    setReach(null);
    const t = setTimeout(async () => {
      try {
        const { res, json } = await authed(`/api/admin/broadcasts?count=1&audience=${audience}&verified_only=${verifiedOnly ? 1 : 0}`);
        if (seq === reachSeq.current && res.ok) setReach(json.count);
      } catch {
        /* leave as unknown */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [audience, verifiedOnly, authed]);

  const send = async () => {
    setSending(true);
    try {
      const { res, json } = await authed('/api/admin/broadcasts', {
        method: 'POST',
        body: JSON.stringify({ title, body, kind, audience, verified_only: verifiedOnly, link }),
      });
      if (!res.ok) {
        toast(json.error || 'Could not send. Try again.', 'err');
        return;
      }
      toast(`Sent to ${json.sent} ${json.sent === 1 ? 'person' : 'people'}`);
      setConfirming(false);
      setTitle('');
      setBody('');
      setLink('');
      loadHistory();
    } catch {
      toast('Network error. Try again.', 'err');
    } finally {
      setSending(false);
    }
  };

  const unsend = async (b: Broadcast) => {
    if (!window.confirm(`Unsend "${b.title}"? It will disappear from ${b.recipient_count} notification lists.`)) return;
    setUnsendingId(b.id);
    try {
      const { res, json } = await authed(`/api/admin/broadcasts?id=${b.id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast(json.error || 'Could not unsend.', 'err');
        return;
      }
      toast('Broadcast unsent');
      loadHistory();
    } finally {
      setUnsendingId(null);
    }
  };

  const reuse = (b: Broadcast) => {
    setKind(b.kind);
    setAudience(b.audience);
    setVerifiedOnly(b.verified_only);
    setTitle(b.title);
    setBody(b.body);
    setLink(b.link || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Broadcasts</h1>
          <p className="text-slate-400 text-sm mt-1">Send news and announcements straight to your users’ notifications.</p>
        </div>
        <button
          onClick={loadHistory}
          aria-label="Refresh broadcasts"
          className="flex items-center gap-2 border border-slate-700 hover:border-slate-500 text-slate-300 px-3 py-2 rounded-lg text-xs font-semibold transition"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </header>

      {!ready && (
        <div className="mb-5 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs rounded-xl px-4 py-3">
          The broadcasts table is not set up yet. Run <span className="font-mono">admin-broadcasts.sql</span> in the Supabase SQL Editor, then refresh.
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-5 items-start">
        {/* ── Composer ── */}
        <section className="lg:col-span-3 rounded-xl border border-slate-800 bg-slate-900 p-5 md:p-6 min-w-0">
          <h2 className="text-sm font-bold text-white">What kind of message is it?</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {(Object.keys(KINDS) as Kind[]).map((key) => {
              const it = KINDS[key];
              const on = kind === key;
              return (
                <button
                  key={key}
                  onClick={() => setKind(key)}
                  aria-pressed={on}
                  className={`text-left rounded-xl border p-3 transition ${
                    on ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-slate-800 hover:border-slate-600 bg-slate-950/40'
                  }`}
                >
                  <span className={`h-8 w-8 rounded-lg border flex items-center justify-center ${it.icon}`}>
                    <it.Icon className="w-4 h-4" />
                  </span>
                  <p className="text-xs font-semibold text-white mt-2.5">{it.label}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{it.hint}</p>
                </button>
              );
            })}
          </div>

          <h2 className="text-sm font-bold text-white mt-6">Who should get it?</h2>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {AUDIENCES.map((a) => {
              const on = audience === a.key;
              return (
                <button
                  key={a.key}
                  onClick={() => setAudience(a.key)}
                  aria-pressed={on}
                  className={`flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                    on ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-slate-800 hover:border-slate-600 bg-slate-950/40'
                  }`}
                >
                  <a.Icon className={`w-4 h-4 shrink-0 ${on ? 'text-emerald-400' : 'text-slate-500'}`} />
                  <span className="min-w-0 text-center sm:text-left">
                    <span className="block text-xs font-semibold text-white">{a.label}</span>
                    <span className="hidden sm:block text-[11px] text-slate-500 truncate">{a.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <label className="flex items-center gap-2.5 mt-3 text-xs text-slate-300 cursor-pointer select-none w-fit">
            <input
              type="checkbox"
              checked={verifiedOnly}
              onChange={(e) => setVerifiedOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-emerald-500"
            />
            <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
            Only verified accounts
          </label>

          <p className="text-xs mt-3 text-slate-400" aria-live="polite">
            {reach === null ? (
              'Counting recipients...'
            ) : (
              <>
                This will reach <span className="font-semibold text-emerald-400">{reach}</span> {reach === 1 ? 'person' : 'people'}.
              </>
            )}
          </p>

          <div className="border-t border-slate-800 my-5" />

          <div className="flex items-baseline justify-between">
            <label htmlFor="bc-title" className="text-xs text-slate-300">Title</label>
            <span className={`text-[11px] ${title.length > TITLE_MAX - 10 ? 'text-amber-400' : 'text-slate-600'}`}>{title.length}/{TITLE_MAX}</span>
          </div>
          <input
            id="bc-title"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Delivery rates are changing on Monday"
            className={`${inputCls} mt-1.5`}
          />

          <div className="flex items-baseline justify-between mt-4">
            <label htmlFor="bc-body" className="text-xs text-slate-300">Message</label>
            <span className={`text-[11px] ${body.length > BODY_MAX - 40 ? 'text-amber-400' : 'text-slate-600'}`}>{body.length}/{BODY_MAX}</span>
          </div>
          <textarea
            id="bc-body"
            rows={5}
            value={body}
            maxLength={BODY_MAX}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Say what changed and what they need to do, if anything."
            className={`${inputCls} mt-1.5 resize-y`}
          />

          <label htmlFor="bc-link" className="block text-xs text-slate-300 mt-4">Link (optional)</label>
          <input
            id="bc-link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://… or /orders"
            className={`${inputCls} mt-1.5`}
          />

          <div className="flex justify-end mt-5">
            <button
              onClick={() => setConfirming(true)}
              disabled={!canSend || !ready || reach === 0}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:hover:bg-emerald-500 text-slate-950 font-bold px-5 py-2.5 rounded-lg text-xs transition"
            >
              <Send className="w-3.5 h-3.5" /> Review and send
            </button>
          </div>
        </section>

        {/* ── Live preview ── */}
        <aside className="lg:col-span-2 lg:sticky lg:top-6 min-w-0">
          <p className="text-xs text-slate-400 mb-2.5">How it looks to users</p>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className={`${EDGE_BASE} rounded-xl border border-slate-800 bg-slate-950 ${k.edge}`}>
              <div className="flex items-start gap-3 pl-5 pr-4 py-4">
                <span className={`h-9 w-9 rounded-lg border flex items-center justify-center shrink-0 ${k.icon}`}>
                  <k.Icon className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className={`text-sm font-semibold break-words ${title ? 'text-white' : 'text-slate-600'}`}>
                      {title || 'Your title appears here'}
                    </p>
                    <span className="text-[10px] text-slate-500 shrink-0 mt-0.5">Just now</span>
                  </div>
                  <p className={`text-xs mt-1 whitespace-pre-wrap break-words leading-relaxed ${body ? 'text-slate-300' : 'text-slate-600'}`}>
                    {body || 'The message you write shows up in full under the title.'}
                  </p>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${k.chip}`}>{k.label}</span>
                    {link.trim() && <span className="text-[11px] text-emerald-400 truncate max-w-[10rem]">Opens a link</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
            It lands in each person’s notifications as unread. You can unsend it later from the list below.
          </p>
        </aside>
      </div>

      {/* ── History ── */}
      <section className="mt-8">
        <h2 className="text-sm font-bold text-white mb-3">Sent broadcasts</h2>
        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="bg-slate-900 rounded-xl border border-slate-800 p-4 animate-pulse">
                <div className="h-3.5 w-1/3 rounded bg-slate-800" />
                <div className="h-3 w-2/3 rounded bg-slate-800/70 mt-3" />
              </div>
            ))}
          </div>
        ) : history.length === 0 ? (
          <div className="bg-slate-900 rounded-xl border border-dashed border-slate-800 p-10 text-center">
            <p className="text-sm text-slate-300">Nothing sent yet</p>
            <p className="text-xs text-slate-500 mt-1">Write your first message above and it will be listed here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((b) => {
              const it = KINDS[b.kind] || KINDS.announcement;
              return (
                <article key={b.id} className={`${EDGE_BASE} rounded-xl border border-slate-800 bg-slate-900 ${it.edge}`}>
                  <div className="flex items-start justify-between gap-4 px-5 md:px-6 pt-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-white">{b.title}</p>
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${it.chip}`}>{it.label}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{formatWhen(b.created_at)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold text-emerald-400 leading-none">{b.recipient_count}</p>
                      <p className="text-[11px] text-slate-500 mt-1">{b.recipient_count === 1 ? 'recipient' : 'recipients'}</p>
                    </div>
                  </div>
                  <p className="px-5 md:px-6 py-3 text-xs text-slate-300 whitespace-pre-wrap line-clamp-3">{b.body}</p>
                  <div className="flex items-center justify-between gap-3 flex-wrap px-5 md:px-6 py-3 border-t border-slate-800 bg-slate-950/20">
                    <p className="text-xs text-slate-500">{audienceLabel(b.audience, b.verified_only)}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => reuse(b)}
                        className="flex items-center gap-1.5 text-xs font-bold border border-slate-700 hover:border-slate-500 text-slate-300 rounded-lg px-3 py-1.5 transition"
                      >
                        <Copy className="w-3 h-3" /> Reuse
                      </button>
                      <button
                        onClick={() => unsend(b)}
                        disabled={unsendingId === b.id}
                        className="flex items-center gap-1.5 text-xs font-bold border border-slate-700 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 text-slate-300 rounded-lg px-3 py-1.5 transition disabled:opacity-50"
                      >
                        <Undo2 className="w-3 h-3" /> {unsendingId === b.id ? 'Unsending...' : 'Unsend'}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Confirm dialog ── */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !sending && setConfirming(false)}>
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-white">Send to {reach ?? 'everyone selected'} {reach === 1 ? 'person' : 'people'}?</h2>
                <p className="text-xs text-slate-400 mt-1">{audienceLabel(audience, verifiedOnly)}</p>
              </div>
              <button onClick={() => setConfirming(false)} disabled={sending} aria-label="Close" className="text-slate-500 hover:text-slate-200 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5">
              <p className="text-sm font-semibold text-white break-words">{title}</p>
              <p className="text-xs text-slate-400 mt-1 line-clamp-3 whitespace-pre-wrap break-words">{body}</p>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setConfirming(false)}
                disabled={sending}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
              >
                Keep editing
              </button>
              <button
                onClick={send}
                disabled={sending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 transition"
              >
                <Send className="w-3.5 h-3.5" /> {sending ? 'Sending...' : 'Send now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}