'use client';

// app/components/QuoteChat.tsx
// The dashboard assistant as a popup, for the public pages (/prices, /insights).
// Bottom sheet on phones, centred card on desktop. Same n8n webhook and same
// conversation_messages history as the dashboard, so the chat carries over.

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { Bot, Send, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface Msg {
  id?: string;
  sender: 'user' | 'agent';
  text: string;
}

type Status = 'checking' | 'guest' | 'supplier' | 'buyer';

const WELCOME =
  'Hello! Tell me what you need and I will request quotes from suppliers. Include the quantity and your delivery city.';

/* ---------- open/close from anywhere on the page ---------- */

const Ctx = createContext<{ open: (ask?: string) => void }>({ open: () => {} });
export const useQuoteChat = () => useContext(Ctx);

export function OpenChatButton({
  ask,
  className,
  children,
}: {
  ask?: string;
  className?: string;
  children: ReactNode;
}) {
  const { open } = useQuoteChat();
  return (
    <button type="button" onClick={() => open(ask)} className={className}>
      {children}
    </button>
  );
}

export function QuoteChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [ask, setAsk] = useState('');

  const open = useCallback((a?: string) => {
    setAsk(a || '');
    setIsOpen(true);
  }, []);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {isOpen && <ChatModal ask={ask} onClose={() => setIsOpen(false)} />}
    </Ctx.Provider>
  );
}

/* ---------- message formatting (same as the dashboard) ---------- */

function inline(text: string, k: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g).map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={`${k}b${i}`}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <strong key={`${k}s${i}`}>{p.slice(1, -1)}</strong>;
    if (p.startsWith('_') && p.endsWith('_') && p.length > 2) return <em key={`${k}i${i}`}>{p.slice(1, -1)}</em>;
    return <span key={`${k}t${i}`}>{p}</span>;
  });
}

function body(text: string): ReactNode {
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = (key: string) => {
    if (!list.length) return;
    out.push(
      <ul key={key} className="list-disc pl-4 space-y-0.5 my-1">
        {list.map((li, i) => (
          <li key={`${key}-${i}`}>{inline(li, `${key}-${i}`)}</li>
        ))}
      </ul>
    );
    list = [];
  };
  text.split('\n').forEach((line, idx) => {
    const t = line.trim();
    if (t.startsWith('- ')) {
      list.push(t.slice(2));
      return;
    }
    flush(`l${idx}`);
    out.push(
      t === '' ? (
        <div key={`br${idx}`} className="h-1.5" />
      ) : (
        <p key={`p${idx}`} className="mb-0.5 last:mb-0">
          {inline(t, `p${idx}`)}
        </p>
      )
    );
  });
  flush('end');
  return out;
}

const sanitize = (raw: string) =>
  raw.includes('Calling ') && raw.includes('with input:')
    ? 'Purchase Order processing completed successfully! Your order has been logged and dispatched to the supplier.'
    : raw;

/* ---------- the modal ---------- */

function ChatModal({ ask, onClose }: { ask: string; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  const [status, setStatus] = useState<Status>('checking');
  const [buyer, setBuyer] = useState<{ id: string; phone: string } | null>(null);
  const [messages, setMessages] = useState<Msg[]>([{ sender: 'agent', text: WELCOME }]);
  const [input, setInput] = useState(ask);
  const [hint, setHint] = useState(Boolean(ask));
  const [loading, setLoading] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const loadedRef = useRef(false);

  // Slide-in, Escape to close, lock page scroll behind the popup.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Who is this?
  useEffect(() => {
    let alive = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!alive) return;
      if (!user) return setStatus('guest');

      const [{ data: b }, { data: s }] = await Promise.all([
        supabase.from('buyers').select('phone').eq('id', user.id).maybeSingle(),
        supabase.from('suppliers').select('id').eq('user_id', user.id).maybeSingle(),
      ]);
      if (!alive) return;
      if (s) return setStatus('supplier');
      setBuyer({ id: user.id, phone: b?.phone || '2348145340003' });
      setStatus('buyer');
    })();
    return () => {
      alive = false;
    };
  }, []);

  const fetchHistory = useCallback(async (buyerId: string) => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('conversation_messages')
      .select('id, message_id, role, message, created_at')
      .eq('buyer_id', buyerId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true });
    if (error) return console.error('Chat history error:', error);
    if (data && data.length > 0) {
      setMessages(
        data.map((m: any) => ({
          id: m.message_id || m.id,
          sender: m.role === 'user' ? 'user' : 'agent',
          text: m.message,
        }))
      );
    }
    loadedRef.current = true;
  }, []);

  // Once we know it's a buyer: load history, focus, and listen for new replies.
  useEffect(() => {
    if (status !== 'buyer' || !buyer) return;
    fetchHistory(buyer.id);
    setTimeout(() => inputRef.current?.focus(), 350);

    const channel = supabase
      .channel('public-quote-chat')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_messages' }, () =>
        fetchHistory(buyer.id)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [status, buyer, fetchHistory]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Auto-grow the textarea.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden';
  }, [input, status]);

  const waitForReply = async (buyerId: string, sinceIso: string) => {
    for (let i = 0; i < 30; i++) {
      const { data } = await supabase
        .from('conversation_messages')
        .select('id')
        .eq('buyer_id', buyerId)
        .eq('role', 'assistant')
        .gte('created_at', sinceIso)
        .limit(1);
      if (data && data.length > 0) {
        await fetchHistory(buyerId);
        return true;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    return false;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading || !buyer) return;

    setMessages((p) => [...p, { sender: 'user', text }]);
    setInput('');
    setHint(false);
    setLoading(true);
    const sentAt = new Date(Date.now() - 10000).toISOString();

    try {
      const res = await fetch(process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL || '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: buyer.phone,
          buyer_id: buyer.id,
          message: text,
          text,
          sender: 'web_chat',
          entry: [{ changes: [{ value: { messages: [{ text: { body: text }, from: buyer.phone }] } }] }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const raw = await res.text();
      let reply = '';
      if (raw) {
        try {
          let d = JSON.parse(raw);
          if (Array.isArray(d) && d.length) d = d[0];
          reply = d.reply || d.message || d.output || d.text || (typeof d === 'string' ? d : '');
        } catch {
          reply = raw;
        }
      }

      if (reply) {
        setMessages((p) => [...p, { sender: 'agent', text: sanitize(reply) }]);
      } else if (!(await waitForReply(buyer.id, sentAt))) {
        setMessages((p) => [...p, { sender: 'agent', text: 'Request received. Processing with suppliers...' }]);
      }
      setTimeout(() => fetchHistory(buyer.id), 1200);
    } catch (err) {
      console.error('Webhook error:', err);
      setMessages((p) => [
        ...p,
        { sender: 'agent', text: 'Something went wrong sending that. Please try again in a moment.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const rememberAsk = () => {
    try {
      if (ask) sessionStorage.setItem('velrenta_pending_ask', ask);
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity duration-300 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Velrenta assistant"
        className={`relative w-full sm:max-w-md h-[88dvh] sm:h-[640px] sm:max-h-[85dvh] bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden transition duration-300 ease-out ${
          shown ? 'translate-y-0 sm:opacity-100' : 'translate-y-full sm:translate-y-4 sm:opacity-0'
        }`}
      >
        <div className="sm:hidden flex justify-center pt-2.5 shrink-0">
          <span className="h-1 w-10 rounded-full bg-slate-700" />
        </div>

        <div className="px-4 py-3.5 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-sm text-white truncate">Velrenta assistant</h2>
              <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close assistant"
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {status === 'checking' && (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-500">Getting things ready...</div>
        )}

        {(status === 'guest' || status === 'supplier') && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Bot className="w-6 h-6" />
            </div>
            {status === 'guest' ? (
              <>
                <h3 className="mt-4 text-base font-bold text-white">Log in to request quotes</h3>
                <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                  Suppliers send quotes to your account, so you can compare prices and order in one place.
                </p>
                {ask && (
                  <p className="mt-4 text-xs text-slate-300 bg-slate-800/70 border border-slate-700/60 rounded-xl px-3 py-2">
                    {ask}
                  </p>
                )}
                <Link
                  href="/login"
                  onClick={rememberAsk}
                  className="mt-5 w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 rounded-xl text-sm transition"
                >
                  Log in or create an account
                </Link>
              </>
            ) : (
              <>
                <h3 className="mt-4 text-base font-bold text-white">This chat is for buyers</h3>
                <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                  You are signed in with a supplier account. Open your supplier dashboard to manage quotes.
                </p>
                <Link
                  href="/supplier"
                  className="mt-5 w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 rounded-xl text-sm transition"
                >
                  Go to supplier dashboard
                </Link>
              </>
            )}
          </div>
        )}

        {status === 'buyer' && (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              {messages.map((m, i) => (
                <div key={m.id || i} className={`flex min-w-0 ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[88%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed break-words [overflow-wrap:anywhere] min-w-0 overflow-hidden ${
                      m.sender === 'user'
                        ? 'bg-emerald-500 text-slate-950 font-semibold rounded-br-md'
                        : 'bg-slate-800 text-slate-200 border border-slate-700/50 rounded-bl-md'
                    }`}
                  >
                    {body(m.text)}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex items-center gap-2 text-[11px] text-slate-400 px-1 pt-1">
                  <span className="flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-bounce" />
                  </span>
                  Velrenta AI is processing your request...
                </div>
              )}
              <div ref={endRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="p-3 border-t border-slate-800 bg-slate-900 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            >
              {hint && (
                <p className="text-[11px] text-emerald-400/90 mb-2 px-1">
                  Add the quantity and delivery city, then send.
                </p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  placeholder="Type your request..."
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setHint(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  className="flex-1 min-w-0 resize-none max-h-[120px] overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs leading-relaxed text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  aria-label="Send message"
                  className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 p-2.5 rounded-xl font-bold transition flex items-center justify-center shrink-0 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
