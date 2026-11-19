'use client';

// app/page.tsx  (buyer dashboard)
// Navigation (desktop sidebar + phone bottom bar with "More") comes from BuyerNav.

export const dynamic = 'force-dynamic';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  FileText,
  CheckCircle,
  Bot,
  Users,
  X,
  MapPin,
  ChevronRight,
  Plus,
  Repeat,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from './lib/supabaseClient';
import NotificationBell from './components/NotificationBell';
import TrustCenter from './components/TrustCenter';
import BuyerNav from './components/BuyerNav';

interface Message {
  id?: string;
  sender: 'user' | 'agent';
  text: string;
}

interface RFQItem {
  id?: string;
  rfq_id?: string;
  title: string;
  delivery_location: string;
  status: string;
}

interface BuyerProfile {
  id: string;
  contact_name: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
}

// A past order the buyer can send again with one tap.
interface ReorderItem {
  key: string;
  label: string;
  location: string;
  message: string;
}

// An accepted, fully paid order the buyer hasn't rated yet.
interface ReviewableOrder {
  poId: string;
  supplierName: string;
  poLabel: string;
}

const WELCOME = 'Hello! How can Velrenta assist your procurement needs today?';

const SUGGESTIONS = ['I need a quote for steel pipes', 'I want to place an order'];

// Short city codes that show up in order descriptions.
const LOCATION_NAMES: Record<string, string> = { PH: 'Port Harcourt' };

// Strips a stray leading "=" that shows up in some AI-generated RFQ titles.
const cleanDisplayText = (text: string | null | undefined): string => {
  if (!text) return '';
  return text.replace(/^=+\s*/, '').trim();
};

// 999 -> "999", 3000 -> "3,000", 12500 -> "12.5K", 2400000 -> "2.4M"
// Keeps big numbers from overflowing the small stat cards.
const formatStat = (n: number): string => {
  if (n < 10000) return n.toLocaleString('en-US');
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
};

const statusStyle = (status?: string) => {
  const s = (status || 'active').toLowerCase();
  if (['closed', 'cancelled', 'expired'].includes(s)) return 'bg-slate-800 text-slate-400 border-slate-700';
  if (['quoted', 'awarded', 'ordered'].includes(s)) return 'bg-sky-500/10 text-sky-300 border-sky-500/30';
  if (['pending', 'draft'].includes(s)) return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
};

// Turns past purchase orders ("100 Black Steel Pipe 2 inch (6m) - Lagos") into
// up to 3 distinct "order again" shortcuts (newest first, one per product and
// location). The agent still fetches fresh prices, so a reorder never reuses an old quote.
function buildReorderItems(
  rows: { order_description: string | null; delivery_location: string | null }[]
): ReorderItem[] {
  const seen = new Set<string>();
  const out: ReorderItem[] = [];

  for (const r of rows) {
    const desc = cleanDisplayText(r.order_description);
    if (!desc) continue;

    const m = desc.match(/^(\d[\d,]*)\s+(.+?)\s+-\s+(.+)$/);
    const qty = m ? m[1].replace(/,/g, '') : '';
    const product = m ? m[2] : desc;
    const rawLocation = (m ? m[3] : r.delivery_location || '').trim();
    const location = LOCATION_NAMES[rawLocation.toUpperCase()] || rawLocation;

    const key = `${product}|${location}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      key,
      label: qty ? `${qty} ${product}` : product,
      location,
      message: qty ? `I need ${qty} ${product}${location ? ` in ${location}` : ''}` : `I need ${desc}`,
    });
    if (out.length === 3) break;
  }
  return out;
}

// Orders the supplier accepted AND the buyer has fully paid, not yet reviewed (max 2 shown).
// Returns [] if the supplier_reviews table has not been created yet.
async function fetchReviewable(buyerId: string): Promise<ReviewableOrder[]> {
  const { data: pos, error: poErr } = await supabase
    .from('purchase_orders')
    .select('*')
    .eq('buyer_id', buyerId)
    .eq('supplier_status', 'accepted')
    .eq('payment_status', 'paid')
    .limit(100);
  if (poErr || !pos || pos.length === 0) return [];

  const { data: reviewed, error: revErr } = await supabase
    .from('supplier_reviews')
    .select('po_id')
    .eq('buyer_id', buyerId);
  if (revErr) return [];

  const done = new Set((reviewed || []).map((r: any) => r.po_id));
  const pending = (pos as any[]).filter((po) => po.supplier_id && !done.has(po.id)).slice(0, 2);
  if (pending.length === 0) return [];

  const ids = Array.from(new Set(pending.map((po) => po.supplier_id as string)));
  const { data: sups } = await supabase.from('suppliers').select('id, company_name').in('id', ids);
  const names = new Map((sups || []).map((s: any) => [s.id, s.company_name] as [string, string]));

  return pending.map((po) => ({
    poId: po.id as string,
    supplierName: names.get(po.supplier_id) || 'this supplier',
    poLabel: po.po_number || String(po.id).slice(0, 8),
  }));
}

// Links inside chat replies. Velrenta pages open inside the app, anything else opens in a new tab.
const URL_RE = /(https?:\/\/[^\s<>"]+)/g;

const INTERNAL_LINKS: Record<string, string> = {
  '/sharp': 'Open My Plug',
  '/dispatch': 'Open Errand',
  '/marketplace': 'Open Marketplace',
  '/rfqs': 'Open RFQs',
  '/pos': 'Open Purchase orders',
  '/tracking': 'Open Order tracking',
};

function renderLink(raw: string, key: string): React.ReactNode {
  // Keep trailing punctuation (like a full stop) outside the link.
  const m = raw.match(/^(.*?)([.,;:!?)\]*_]*)$/);
  const url = m ? m[1] : raw;
  const trail = m ? m[2] : '';
  const linkClass =
    'font-semibold text-emerald-400 hover:text-emerald-300 underline underline-offset-2 break-all';

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return <span key={key}>{raw}</span>;
  }

  const p = u.pathname.replace(/\/+$/, '') || '/';
  const label = INTERNAL_LINKS[p];

  if (label) {
    return (
      <span key={key}>
        <Link href={p + u.search + u.hash} className={linkClass}>
          {label} &rarr;
        </Link>
        {trail}
      </span>
    );
  }

  return (
    <span key={key}>
      <a href={url} target="_blank" rel="noreferrer" className={linkClass}>
        {url}
      </a>
      {trail}
    </span>
  );
}

// WhatsApp-style inline formatting: *bold*, _italic_ (and tolerates **bold**).
function formatPlain(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={keyPrefix + '-b2-' + i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <strong key={keyPrefix + '-b1-' + i}>{part.slice(1, -1)}</strong>;
    }
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
      return <em key={keyPrefix + '-i-' + i}>{part.slice(1, -1)}</em>;
    }
    return <span key={keyPrefix + '-t-' + i}>{part}</span>;
  });
}

// Links are pulled out first so underscores or asterisks inside a URL are never treated as formatting.
function renderInlineFormatting(text: string, keyPrefix: string): React.ReactNode[] {
  return text
    .split(URL_RE)
    .flatMap((chunk, i) =>
      /^https?:\/\//.test(chunk)
        ? [renderLink(chunk, keyPrefix + '-u' + i)]
        : formatPlain(chunk, keyPrefix + '-c' + i)
    );
}

function renderMessageBody(text: string): React.ReactNode {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: string) => {
    if (listBuffer.length > 0) {
      elements.push(
        <ul key={key} className="list-disc pl-4 space-y-0.5 my-1">
          {listBuffer.map((item, idx) => (
            <li key={`${key}-li-${idx}`}>{renderInlineFormatting(item, `${key}-${idx}`)}</li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      listBuffer.push(trimmed.slice(2));
      return;
    }
    flushList(`list-${idx}`);
    if (trimmed === '') {
      elements.push(<div key={`br-${idx}`} className="h-1.5" />);
    } else {
      elements.push(
        <p key={`p-${idx}`} className="mb-0.5 last:mb-0">
          {renderInlineFormatting(trimmed, `p-${idx}`)}
        </p>
      );
    }
  });
  flushList('list-end');

  return elements;
}

export default function Dashboard() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ sender: 'agent', text: WELCOME }]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [rfqs, setRfqs] = useState<RFQItem[]>([]);
  const [stats, setStats] = useState({ activeRfqs: 0, issuedPos: 0, suppliers: 0 });
  // True until the first data fetch finishes (shows skeletons instead of 0s / empty state).
  const [dataLoading, setDataLoading] = useState(true);

  const [reorderItems, setReorderItems] = useState<ReorderItem[]>([]);
  const [reviewable, setReviewable] = useState<ReviewableOrder[]>([]);

  const [user, setUser] = useState<any>(null);
  const [buyer, setBuyer] = useState<BuyerProfile | null>(null);

  // UI-only state
  const [chatOpen, setChatOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const loadedChatKeyRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ready) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, ready]);

  // Auto-grow the chat textarea as the text wraps (up to ~5 lines); resets after sending.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    // Scrolling is only switched on once the box is at its max height.
    el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden';
  }, [inputMessage]);

  // "Get quote" links arrive as /?ask=..., or as a request saved in the browser
  // when a visitor logged in from the public popup chat.
  // Open the chat with that text prefilled so the buyer can add quantity and location.
  useEffect(() => {
    if (!ready) return;
    let ask = new URLSearchParams(window.location.search).get('ask');
    if (!ask) {
      try {
        ask = sessionStorage.getItem('velrenta_pending_ask');
        sessionStorage.removeItem('velrenta_pending_ask');
      } catch {
        /* storage unavailable */
      }
    }
    if (!ask) return;
    setInputMessage(ask);
    setChatOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
    router.replace('/');
  }, [ready, router]);

  const fetchData = useCallback(
    async (buyerId?: string) => {
      const currentBuyerId = buyerId || buyer?.id || user?.id;
      if (!currentBuyerId) return;

      try {
        const { data: rfqData, error: rfqError } = await supabase
          .from('rfqs')
          .select('*')
          .eq('buyer_id', currentBuyerId)
          .order('created_at', { ascending: false })
          .limit(5);
        if (rfqError) console.error('RFQ fetch error (Recent Requisitions):', rfqError);
        if (rfqData) setRfqs(rfqData as RFQItem[]);

        const { count: rfqCount } = await supabase
          .from('rfqs')
          .select('*', { count: 'exact', head: true })
          .eq('buyer_id', currentBuyerId);

        const { count: poCount, error: poErr } = await supabase
          .from('purchase_orders')
          .select('*', { count: 'exact', head: true })
          .eq('buyer_id', currentBuyerId);
        if (poErr) console.error('PO count error:', poErr);

        const { count: supplierCount } = await supabase
          .from('suppliers')
          .select('*', { count: 'exact', head: true });

        setStats({
          activeRfqs: rfqCount || 0,
          issuedPos: poCount || 0,
          suppliers: supplierCount || 0,
        });

        // "Order again" shortcuts from past purchase orders. Isolated so a failure
        // here never affects the stats above.
        try {
          const { data: pastOrders, error: pastErr } = await supabase
            .from('purchase_orders')
            .select('order_description, delivery_location')
            .eq('buyer_id', currentBuyerId)
            .order('created_at', { ascending: false })
            .limit(30);
          if (pastErr) console.error('Reorder fetch error:', pastErr);
          if (pastOrders) setReorderItems(buildReorderItems(pastOrders));
        } catch (err) {
          console.error('Reorder build error:', err);
        }

        // Orders waiting for a review. Same isolation.
        try {
          setReviewable(await fetchReviewable(currentBuyerId));
        } catch (err) {
          console.error('Reviewable orders error:', err);
        }
      } finally {
        // Only ever turns loading off, so realtime refetches never flash skeletons.
        setDataLoading(false);
      }
    },
    [buyer?.id, user?.id]
  );

  // Loads the last 24h of this buyer's chat. Matches on buyer_id (saved on every message by n8n)
  // so it works even if the phone number on the profile differs from the one n8n used.
  const fetchChatHistory = useCallback(async (buyerId: string) => {
    if (!buyerId) return;

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: history, error } = await supabase
      .from('conversation_messages')
      .select('id, message_id, role, message, created_at')
      .eq('buyer_id', buyerId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Chat history fetch error:', error);
      return;
    }

    if (history && history.length > 0) {
      const formatted: Message[] = history.map((m: any) => ({
        id: m.message_id || m.id,
        sender: m.role === 'user' ? 'user' : 'agent',
        text: m.message,
      }));
      setMessages(formatted);
      loadedChatKeyRef.current = buyerId;
      return;
    }

    if (loadedChatKeyRef.current !== buyerId) {
      setMessages([{ sender: 'agent', text: WELCOME }]);
      loadedChatKeyRef.current = buyerId;
    }
  }, []);

  // Guard: must be signed in, and must NOT be a supplier.
  useEffect(() => {
    let isMounted = true;

    const guard = async () => {
      const {
        data: { user: sessionUser },
      } = await supabase.auth.getUser();

      if (!sessionUser) {
        router.replace('/login');
        return;
      }

      // Service providers belong on the provider portal.
      const { data: providerMe } = await supabase.rpc('provider_me');
      const providerRow = Array.isArray(providerMe) ? providerMe[0] : providerMe;
      if (providerRow?.id) {
        router.replace('/provider');
        return;
      }

      // Riders belong on the rider portal and must not get a buyer profile.
      const { data: riderMe } = await supabase.rpc('rider_me');
      if (riderMe) {
        router.replace('/rider');
        return;
      }

      // Suppliers belong on their own dashboard.
      const { data: supplierRow } = await supabase
        .from('suppliers')
        .select('id')
        .eq('user_id', sessionUser.id)
        .maybeSingle();

      if (supplierRow) {
        router.replace('/supplier');
        return;
      }

      if (!isMounted) return;
      setUser(sessionUser);

      try {
        const { data: existingBuyer } = await supabase
          .from('buyers')
          .select('*')
          .eq('id', sessionUser.id)
          .maybeSingle();

        let profile = existingBuyer as BuyerProfile | null;

        if (!profile) {
          const { data: createdBuyer } = await supabase
            .from('buyers')
            .upsert(
              {
                id: sessionUser.id,
                contact_name:
                  sessionUser.user_metadata?.contact_name ||
                  sessionUser.email?.split('@')[0] ||
                  'New Buyer',
                email: sessionUser.email,
                phone: sessionUser.user_metadata?.phone || '2348145340003',
                verification_status: 'unverified',
              },
              { onConflict: 'id' }
            )
            .select()
            .maybeSingle();
          profile = createdBuyer as BuyerProfile | null;
        }

        if (profile && isMounted) {
          setBuyer(profile);
          fetchData(profile.id);
          fetchChatHistory(profile.id);
        } else if (isMounted) {
          // No profile: don't leave the skeletons stuck forever.
          setDataLoading(false);
        }
      } catch (err) {
        console.error('Profile sync error:', err);
        if (isMounted) setDataLoading(false);
      }

      if (isMounted) setReady(true);
    };

    guard();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
        router.replace('/login');
      }
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfqs' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_orders' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_messages' }, () => {
        if (buyer?.id) fetchChatHistory(buyer.id);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ready, fetchData, fetchChatHistory, buyer?.id]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const sanitizeAgentMessage = (rawText: string): string => {
    if (rawText.includes('Calling ') && rawText.includes('with input:')) {
      return 'Purchase Order processing completed successfully! Your order has been logged and dispatched to the supplier.';
    }
    return rawText;
  };

  // The reply is always saved to conversation_messages by n8n. If the webhook response body
  // is empty or unreadable, wait for that saved row (up to about 75 seconds) and show it.
  const waitForAssistantReply = async (buyerId: string, sinceIso: string): Promise<boolean> => {
    for (let i = 0; i < 80; i++) {
      const { data } = await supabase
        .from('conversation_messages')
        .select('id')
        .eq('buyer_id', buyerId)
        .eq('role', 'assistant')
        .gte('created_at', sinceIso)
        .limit(1);
      if (data && data.length > 0) {
        await fetchChatHistory(buyerId);
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    return false;
  };

  // Core send: used by the chat form and by one-tap reorders.
  const sendText = async (rawText: string) => {
    const userText = rawText.trim();
    if (!userText || isLoading) return;

    setMessages((prev) => [...prev, { sender: 'user', text: userText }]);
    setInputMessage('');
    setIsLoading(true);

    const activePhone = buyer?.phone || '2348145340003';
    const chatBuyerId: string | undefined = buyer?.id || user?.id;
    // Cushion so a slightly different clock never hides the reply.
    const sentAt = new Date(Date.now() - 10000).toISOString();

    try {
      const response = await fetch(process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL || '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: activePhone,
          buyer_id: chatBuyerId,
          message: userText,
          text: userText,
          sender: 'web_chat',
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [{ text: { body: userText }, from: activePhone }],
                  },
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const responseText = await response.text();
      let replyText = '';

      if (responseText) {
        try {
          let data = JSON.parse(responseText);
          if (Array.isArray(data) && data.length > 0) data = data[0];
          replyText =
            data.reply ||
            data.message ||
            data.output ||
            data.text ||
            (typeof data === 'string' ? data : '');
        } catch {
          replyText = responseText;
        }
      }

      if (replyText) {
        setMessages((prev) => [...prev, { sender: 'agent', text: sanitizeAgentMessage(replyText) }]);
      } else {
        // Nothing readable came back: read the saved reply from the database instead.
        const found = chatBuyerId ? await waitForAssistantReply(chatBuyerId, sentAt) : false;
        if (!found) {
          setMessages((prev) => [
            ...prev,
            { sender: 'agent', text: 'Request received. Processing with suppliers...' },
          ]);
        }
      }

      // Show exactly what was saved (this includes the supplier recommendation).
      if (chatBuyerId) setTimeout(() => fetchChatHistory(chatBuyerId), 1200);
      setTimeout(() => fetchData(), 1000);
      } catch (error) {
      console.error('Webhook error:', error);
      // The request can be dropped (slow run, flaky mobile network, gateway timeout) even though
      // n8n keeps working and saves the reply. Wait for the saved reply instead of showing an error.
      let recovered = false;
      if (chatBuyerId) {
        setMessages((prev) => [
          ...prev,
          { sender: 'agent', text: 'Still working on your request. This can take a minute or two...' },
        ]);
        recovered = await waitForAssistantReply(chatBuyerId, sentAt);
      }
      if (!recovered) {
        setMessages((prev) => [
          ...prev,
          {
            sender: 'agent',
            text: 'This is taking longer than usual. Your request was received and the reply will appear here when it is ready. You can also refresh the page in a minute.',
          },
        ]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await sendText(inputMessage);
  };

  if (!ready) {
    return (
      <div className="flex h-dvh w-full bg-slate-950 items-center justify-center">
        <div className="text-slate-400 text-sm">Loading procurement portal...</div>
      </div>
    );
  }

  const firstName = buyer?.contact_name?.split(' ')[0];

  const startRequest = () => {
    setChatOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // One tap: open the chat and send the same request again (fresh prices come back).
  const reorder = (item: ReorderItem) => {
    setChatOpen(true);
    sendText(item.message);
  };

  // Same request, but let the buyer change the quantity first.
  const editReorder = (item: ReorderItem) => {
    setChatOpen(true);
    setInputMessage(item.message);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const statCards = [
    { label: 'RFQs', short: 'RFQs', value: stats.activeRfqs, Icon: FileText, href: '/rfqs', tone: 'text-white' },
    { label: 'Purchase orders', short: 'Orders', value: stats.issuedPos, Icon: CheckCircle, href: '/pos', tone: 'text-emerald-400' },
    { label: 'Suppliers', short: 'Suppliers', value: stats.suppliers, Icon: Users, href: '/marketplace' as string | null, tone: 'text-white' },
  ];

  return (
    <div className="flex flex-col md:flex-row h-dvh w-full bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Navigation: left sidebar on desktop, bottom bar + "More" sheet on phones */}
      <BuyerNav
        name={buyer?.contact_name || user?.email || ''}
        email={user?.email || ''}
        onLogout={handleLogout}
      />

      {/* Main content */}
      <main className="flex-1 min-w-0 h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 md:p-8">
          <header className="mb-5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-slate-400">Welcome back</p>
              <h1 className="text-2xl md:text-3xl font-bold text-white truncate">{firstName || 'Buyer'}</h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <NotificationBell />
              <button
                onClick={startRequest}
                className="hidden md:flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs transition"
              >
                <Plus className="w-4 h-4" /> New request
              </button>
            </div>
          </header>

          {/* Phone: one tap to start a request */}
          <button
            onClick={startRequest}
            className="md:hidden group w-full mb-5 flex items-center gap-3 rounded-2xl border border-slate-800 bg-gradient-to-r from-emerald-500/15 via-slate-900 to-slate-900 p-3 text-left active:scale-[0.99] transition"
          >
            <span className="h-10 w-10 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-white">What do you need today?</span>
              <span className="block text-xs text-slate-400 truncate">Try: 100 PVC pipes in Lagos</span>
            </span>
            <Plus className="w-4 h-4 text-emerald-400 shrink-0" />
          </button>

          <section className="grid grid-cols-3 gap-2.5 sm:gap-3 mb-5 sm:mb-6">
            {statCards.map(({ label, short, value, Icon, href, tone }) => {
              const inner = (
                <>
                  <span className="h-8 w-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-emerald-400" />
                  </span>
                  <div className="min-w-0">
                    {dataLoading ? (
                      <div className="h-6 w-10 rounded-md bg-slate-800 animate-pulse" />
                    ) : (
                      <p
                        title={value.toLocaleString('en-US')}
                        className={`text-lg sm:text-xl font-bold leading-none tabular-nums truncate ${tone}`}
                      >
                        {formatStat(value)}
                      </p>
                    )}
                    <p className="text-[11px] sm:text-xs text-slate-400 mt-1.5 truncate">
                      <span className="sm:hidden">{short}</span>
                      <span className="hidden sm:inline">{label}</span>
                    </p>
                  </div>
                </>
              );

              const cls =
                'min-w-0 flex flex-col gap-2.5 rounded-2xl border border-slate-800 bg-slate-900 p-3';

              return href ? (
                <Link
                  key={label}
                  href={href}
                  className={`${cls} hover:border-emerald-500/40 active:scale-[0.97] transition`}
                >
                  {inner}
                </Link>
              ) : (
                <div key={label} className={cls}>
                  {inner}
                </div>
              );
            })}
          </section>

          {/* Reputation: rate completed (accepted + paid) orders */}
          {!dataLoading && buyer?.id && <TrustCenter buyerId={buyer.id} />}

          {/* Reorder in one tap */}
          {!dataLoading && reorderItems.length > 0 && (
            <section className="rounded-xl border border-slate-800 bg-slate-900 min-w-0 mb-6">
              <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-800">
                <h2 className="text-sm font-bold text-white">Order again</h2>
                <p className="text-[11px] text-slate-500">You always get fresh prices</p>
              </div>
              <ul className="divide-y divide-slate-800/70">
                {reorderItems.map((item) => (
                  <li key={item.key} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{item.label}</p>
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 truncate">
                        <MapPin className="w-3 h-3 shrink-0" />
                        {item.location || 'No delivery location'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => editReorder(item)}
                        className="text-xs font-medium text-slate-300 border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 rounded-lg px-3 py-2 transition"
                      >
                        Change qty
                      </button>
                      <button
                        onClick={() => reorder(item)}
                        disabled={isLoading}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 rounded-lg px-3.5 py-2 transition"
                      >
                        <Repeat className="w-3.5 h-3.5" /> Reorder
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-xl border border-slate-800 bg-slate-900 min-w-0">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800">
              <h2 className="text-sm font-bold text-white">Recent requests</h2>
              <Link href="/rfqs" className="text-xs font-medium text-emerald-400 hover:text-emerald-300 transition">
                View all
              </Link>
            </div>

            {dataLoading ? (
              <ul className="divide-y divide-slate-800/70">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
                    <div className="space-y-2 flex-1">
                      <div className="h-3.5 w-2/3 rounded bg-slate-800 animate-pulse" />
                      <div className="h-3 w-1/3 rounded bg-slate-800/70 animate-pulse" />
                    </div>
                    <div className="h-5 w-16 rounded-full bg-slate-800 animate-pulse" />
                  </li>
                ))}
              </ul>
            ) : rfqs.length === 0 ? (
              <div className="p-10 text-center">
                <FileText className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-300">No requests yet</p>
                <p className="text-xs text-slate-500 mt-1">Tell the assistant what you need and it will request quotes for you.</p>
                <button
                  onClick={startRequest}
                  className="mt-4 text-xs font-bold border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 text-slate-300 rounded-lg px-3.5 py-2 transition"
                >
                  Start a request
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-slate-800/70">
                {rfqs.map((rfq) => (
                  <li key={rfq.rfq_id || rfq.id}>
                    <Link
                      href="/rfqs"
                      className="flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-slate-800/40 transition"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{cleanDisplayText(rfq.title)}</p>
                        <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 truncate">
                          <MapPin className="w-3 h-3 shrink-0" />
                          {rfq.delivery_location || 'No delivery location'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border capitalize whitespace-nowrap ${statusStyle(
                            rfq.status
                          )}`}
                        >
                          {rfq.status || 'Active'}
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-600" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      {/* Floating chat button (below xl) */}
      {!chatOpen && (
        <button
          onClick={startRequest}
          aria-label="Open assistant"
          className="hidden md:flex xl:hidden fixed right-4 bottom-6 z-30 h-12 w-12 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20 flex items-center justify-center transition"
        >
          <Bot className="w-5 h-5" />
        </button>
      )}

      {/* Embedded Procurement AI Assistant: side panel on xl, full-screen drawer below */}
      <section
        className={`${chatOpen ? 'fixed inset-0 z-40 flex' : 'hidden'
          } xl:relative xl:inset-auto xl:z-auto xl:flex xl:h-full w-full xl:w-96 border-l border-slate-800 bg-slate-900 flex-col shrink-0 min-w-0`}
      >
        <div className="p-4 border-b border-slate-800 flex items-center justify-between shrink-0">
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
            onClick={() => setChatOpen(false)}
            aria-label="Close assistant"
            className="xl:hidden text-slate-400 hover:text-white p-1.5 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {messages.map((msg, index) => (
            <div
              key={msg.id || index}
              className={`flex min-w-0 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[88%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed break-words [overflow-wrap:anywhere] min-w-0 overflow-hidden ${msg.sender === 'user'
                  ? 'bg-emerald-500 text-slate-950 font-semibold rounded-br-md'
                  : 'bg-slate-800 text-slate-200 border border-slate-700/50 rounded-bl-md'
                  }`}
              >
                {renderMessageBody(msg.text)}
              </div>
            </div>
          ))}

          {messages.length <= 1 && !isLoading && (
            <div className="flex flex-wrap gap-2 pt-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setInputMessage(s);
                    inputRef.current?.focus();
                  }}
                  className="text-[11px] text-slate-300 border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 rounded-full px-3 py-1.5 transition"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {isLoading && (
            <div className="flex items-center gap-2 text-[11px] text-slate-400 px-1 pt-1">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-bounce" />
              </span>
              Velrenta AI is processing your request...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={handleSendMessage}
          className="p-3 border-t border-slate-800 flex items-end gap-2 bg-slate-900 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Type 'Option 1' or your request..."
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter adds a new line.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            className="flex-1 min-w-0 resize-none max-h-[120px] overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs leading-relaxed text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
          />
          <button
            type="submit"
            disabled={isLoading || !inputMessage.trim()}
            aria-label="Send message"
            className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 p-2.5 rounded-xl font-bold transition flex items-center justify-center shrink-0 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </section>
    </div>
  );
}