'use client';

// app/components/ProviderInbox.tsx  (provider portal: chat with the Velrenta team)

import { useState, useEffect, useCallback, useRef } from 'react';
import { Send, Loader2, Check, CheckCheck, MessageCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface Msg {
  id: string;
  sender_role: 'admin' | 'provider';
  body: string;
  created_at: string;
  read_at: string | null;
}

const MAX = 2000;

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
};

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });

export default function ProviderInbox({ providerId, onRead }: { providerId: string; onRead: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('provider_admin_messages')
      .select('id, sender_role, body, created_at, read_at')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: true })
      .limit(300);
    if (error) {
      console.error('Inbox load error:', error);
      setErr('Messages are not available yet. Please contact Velrenta.');
      setLoading(false);
      return;
    }
    setErr('');
    const rows = (data || []) as Msg[];
    setMsgs(rows);
    setLoading(false);
    if (rows.some((m) => m.sender_role === 'admin' && !m.read_at)) {
      await supabase.rpc('provider_mark_messages_read');
      onReadRef.current();
    }
  }, [providerId]);

  useEffect(() => {
    load();
    // Live updates, with a slow refresh as a safety net (also keeps "seen" ticks current)
    const channel = supabase
      .channel(`provider-chat-${providerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'provider_admin_messages', filter: `provider_id=eq.${providerId}` },
        () => load()
      )
      .subscribe();
    const t = setInterval(load, 10000);
    return () => {
      clearInterval(t);
      supabase.removeChannel(channel);
    };
  }, [load, providerId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs.length, loading]);

  // Grow the box with the text, up to about five lines
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const { error } = await supabase
      .from('provider_admin_messages')
      .insert({ provider_id: providerId, sender_role: 'provider', body });
    setSending(false);
    if (error) {
      console.error('Inbox send error:', error);
      setErr('Could not send your message. Try again.');
      return;
    }
    setText('');
    setErr('');
    load();
  };

  let lastDay = '';

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden flex flex-col h-[70vh] min-h-[420px]">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 shrink-0">
        <span className="h-9 w-9 rounded-xl bg-emerald-500 flex items-center justify-center font-bold text-slate-950 text-lg shrink-0">V</span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white leading-tight">Velrenta team</p>
          <p className="text-[11px] text-slate-400 leading-tight">Ask about verification, payouts, or anything on your account.</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2">
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : msgs.length === 0 && !err ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <span className="h-10 w-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-3">
              <MessageCircle className="w-4 h-4 text-slate-400" />
            </span>
            <p className="text-sm text-slate-200">No messages yet</p>
            <p className="text-xs text-slate-500 mt-1 max-w-xs">Write to the Velrenta team below. Replies show up here and you will hear a beep.</p>
          </div>
        ) : (
          msgs.map((m) => {
            const mine = m.sender_role === 'provider';
            const day = dayLabel(m.created_at);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={m.id}>
                {showDay && (
                  <div className="flex justify-center my-3">
                    <span className="text-[10px] font-medium text-slate-500 bg-slate-800/70 rounded-full px-2.5 py-0.5">{day}</span>
                  </div>
                )}
                <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words [overflow-wrap:anywhere] ${
                      mine
                        ? 'bg-emerald-500 text-slate-950 rounded-br-md'
                        : 'bg-slate-800 text-slate-100 border border-slate-700/50 rounded-bl-md'
                    }`}
                  >
                    {!mine && <p className="text-[11px] font-semibold text-emerald-400 mb-0.5">Velrenta team</p>}
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${mine ? 'text-slate-950/60' : 'text-slate-500'}`}>
                      {clock(m.created_at)}
                      {mine && (m.read_at ? <CheckCheck className="w-3 h-3" aria-label="Seen" /> : <Check className="w-3 h-3" aria-label="Sent" />)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-end gap-2 p-3 border-t border-slate-800 shrink-0"
      >
        <textarea
          ref={boxRef}
          rows={1}
          value={text}
          maxLength={MAX}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Write to the Velrenta team"
          aria-label="Message to the Velrenta team"
          className="flex-1 min-w-0 resize-none bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          aria-label="Send message"
          className="shrink-0 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 p-3 rounded-xl transition"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </section>
  );
}