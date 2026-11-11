'use client';

// app/supplier/page.tsx
// Supplier dashboard. No login form here: unauthenticated users, and
// logins that are not linked to a suppliers row, are sent to /login.

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Package,
  CheckCircle2,
  XCircle,
  Settings as SettingsIcon,
  LogOut,
  Clock,
  MapPin,
  User,
  Wallet,
  Hourglass,
  X,
  Landmark,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  EyeOff,
  Boxes,
  Search,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import SupplierProductEditor, { type EditorTarget } from '../components/SupplierProductEditor';
import DeliveryControls from '../components/DeliveryControls';


interface SupplierProfile {
  id: string;
  user_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  email: string | null;
  auto_accept: boolean;
  verification_status: string;
  bank_name?: string | null;
  account_name?: string | null;
  account_number?: string | null;
  phone?: string | null;
  city?: string | null;
  website?: string | null;
  capacity_description?: string | null;
  payment_terms?: string | null;
  verification_level?: string | null;
  rating?: number | string | null;
  years_in_business?: number | null;
}

type SupplierStatus = 'pending' | 'accepted' | 'declined';

interface IncomingPO {
  id: string;
  po_number: string;
  status: string;
  supplier_status: SupplierStatus;
  created_at: string;
  total_amount: number | null;
  order_description?: string | null;
  delivery_location?: string | null;
  payment_terms?: string | null;
  decline_reason?: string | null;
  payment_status?: string | null;
  buyers?: { contact_name: string | null; phone: string | null } | { contact_name: string | null; phone: string | null }[] | null;
  dispatched_at?: string | null;
  delivery_confirmed_at?: string | null;
  dispatch_note?: string | null;
}

interface CatalogProduct {
  id: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  unit: string | null;
  specifications: Record<string, unknown> | null;
}

interface CatalogItem {
  id: string;
  price: number | string | null;
  currency: string | null;
  minimum_order_quantity: number | string | null;
  available_quantity: number | string | null;
  lead_time_days: number | null;
  availability_status: string | null;
  specifications: Record<string, unknown> | null;
  products: CatalogProduct | CatalogProduct[] | null;
}

type CatalogRow = { item: CatalogItem; p: CatalogProduct };

type Filter = 'all' | SupplierStatus;

const groupOf = (p: CatalogProduct) => p.subcategory || p.category || 'Other';

// Readable spec chips: product specs, overridden by this supplier's own listing specs.
const specEntriesOf = (row: CatalogRow): [string, string][] =>
  Object.entries({ ...(row.p.specifications || {}), ...(row.item.specifications || {}) })
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object')
    .map(([k, v]) => [k.replace(/_/g, ' '), String(v)] as [string, string]);

const availabilityStyle = (status?: string | null) => {
  const s = (status || 'available').toLowerCase();
  if (s === 'available') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
  if (['limited', 'low', 'low_stock'].includes(s)) return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  return 'bg-red-500/10 text-red-400 border-red-500/30';
};

const N8N_PO_STATUS_WEBHOOK = process.env.NEXT_PUBLIC_N8N_PO_STATUS_WEBHOOK_URL || '';

const STATUS_STYLES: Record<SupplierStatus, { badge: string; edge: string }> = {
  pending: { badge: 'bg-amber-500/10 text-amber-400 border-amber-500/30', edge: 'before:bg-amber-400' },
  accepted: { badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', edge: 'before:bg-emerald-500/60' },
  declined: { badge: 'bg-red-500/10 text-red-400 border-red-500/30', edge: 'before:bg-red-500/60' },
};

const profileFrom = (s: any) => ({
  contact_name: s?.contact_name || '',
  phone: s?.phone || '',
  city: s?.city || '',
  website: s?.website || '',
  capacity_description: s?.capacity_description || '',
  payment_terms: s?.payment_terms || '',
});

const TERM_PRESETS = ['100% upfront', '70% upfront', '50% upfront, 50% on delivery', '30% upfront, 70% on delivery', 'Net 30 days'];

// Small pulsing placeholder used while data is still loading.
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rounded-md bg-slate-800 animate-pulse ${className}`} />;
}

export default function SupplierDashboard() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<'orders' | 'products' | 'payments' | 'settings'>('orders');
  const [bank, setBank] = useState({ bank_name: '', account_name: '', account_number: '' });
  const [savingBank, setSavingBank] = useState(false);
  const [editingBank, setEditingBank] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [profile, setProfile] = useState(profileFrom(null));
  const [savingProfile, setSavingProfile] = useState(false);
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [supplier, setSupplier] = useState<SupplierProfile | null>(null);
  const [pos, setPos] = useState<IncomingPO[]>([]);
  // True until the first orders fetch finishes (shows skeletons instead of 0s / empty states).
  const [posLoading, setPosLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [declineTarget, setDeclineTarget] = useState<IncomingPO | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  // True until the first catalog fetch finishes.
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogGroup, setCatalogGroup] = useState('all');
  const [editor, setEditor] = useState<null | { mode: 'add' } | { mode: 'edit'; target: EditorTarget }>(null);
  const [removeTarget, setRemoveTarget] = useState<CatalogRow | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (text: string, tone: 'ok' | 'err' = 'ok') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  const getBuyerInfo = (po: IncomingPO) => {
    if (!po.buyers) return { contact_name: 'Buyer', phone: '' };
    return Array.isArray(po.buyers) ? po.buyers[0] : po.buyers;
  };

  const fetchPOs = useCallback(async (supplierId: string) => {
    try {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(
          `id, po_number, status, supplier_status, created_at, total_amount,
         order_description, delivery_location, payment_terms, decline_reason, payment_status, dispatched_at, delivery_confirmed_at, dispatch_note,
         buyers:buyer_id ( contact_name, phone )`
        )
        .eq('supplier_id', supplierId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Incoming PO fetch error:', error);
        return;
      }
      if (data) setPos(data as unknown as IncomingPO[]);
    } finally {
      // Only ever turns loading off, so realtime refetches never flash skeletons.
      setPosLoading(false);
    }
  }, []);

  const fetchCatalog = useCallback(async (supplierId: string) => {
    try {
      const { data, error } = await supabase
        .from('supplier_products')
        .select(
          `id, price, currency, minimum_order_quantity, available_quantity, lead_time_days,
         availability_status, specifications,
         products:product_id ( id, name, category, subcategory, description, unit, specifications )`
        )
        .eq('supplier_id', supplierId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supplier catalog fetch error:', error);
        setCatalogError(true);
        return;
      }
      setCatalogError(false);
      if (data) setCatalog(data as unknown as CatalogItem[]);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  // Guard: must be signed in AND linked to a suppliers row.
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

      const { data: existing, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('user_id', sessionUser.id)
        .maybeSingle();

      if (error) console.error('Supplier profile fetch error:', error);

      if (!existing) {
        // Signed in, but not a supplier: send them to the buyer dashboard.
        router.replace('/');
        return;
      }

      if (!isMounted) return;
      setUser(sessionUser);
      setSupplier(existing as SupplierProfile);
      setBank({
        bank_name: existing.bank_name || '',
        account_name: existing.account_name || '',
        account_number: existing.account_number || '',
      });
      setProfile(profileFrom(existing));
      fetchPOs(existing.id);
      fetchCatalog(existing.id);
      setReady(true);
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
  }, [router, fetchPOs, fetchCatalog]);

  useEffect(() => {
    if (!supplier?.id) return;
    const channel = supabase
      .channel('supplier-po-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'purchase_orders', filter: `supplier_id=eq.${supplier.id}` },
        () => fetchPOs(supplier.id)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supplier?.id, fetchPOs]);

  // Refresh the catalog each time the Products tab is opened.
  useEffect(() => {
    if (view === 'products' && supplier?.id) fetchCatalog(supplier.id);
  }, [view, supplier?.id, fetchCatalog]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const notifyBuyer = async (poId: string, action: 'accepted' | 'declined', reason?: string) => {
    if (!N8N_PO_STATUS_WEBHOOK) return;
    try {
      await fetch(N8N_PO_STATUS_WEBHOOK, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({ po_id: poId, action, decline_reason: reason || null }),
      });
    } catch (err) {
      console.error('Notify webhook error:', err);
    }
  };

  const handleAccept = async (po: IncomingPO) => {
    setBusyId(po.id);
    const { data, error } = await supabase
      .from('purchase_orders')
      .update({
        supplier_status: 'accepted',
        status: 'confirmed',
        supplier_responded_at: new Date().toISOString(),
      })
      .eq('id', po.id)
      .select('id');

    if (error || !data || data.length === 0) {
      console.error('Accept error:', error);
      showToast('Could not accept the order. Try again.', 'err');
    } else {
      await notifyBuyer(po.id, 'accepted');
      if (supplier) fetchPOs(supplier.id);
      showToast(`${po.po_number} accepted`);
    }
    setBusyId(null);
  };

  const confirmDecline = async () => {
    if (!declineTarget) return;
    const po = declineTarget;
    const reason = declineReason.trim();
    setBusyId(po.id);
    const { data, error } = await supabase
      .from('purchase_orders')
      .update({
        supplier_status: 'declined',
        status: 'declined',
        supplier_responded_at: new Date().toISOString(),
        decline_reason: reason || null,
      })
      .eq('id', po.id)
      .select('id');

    if (error || !data || data.length === 0) {
      console.error('Decline error:', error);
      showToast('Could not decline the order. Try again.', 'err');
    } else {
      await notifyBuyer(po.id, 'declined', reason);
      if (supplier) fetchPOs(supplier.id);
      showToast(`${po.po_number} declined`);
      setDeclineTarget(null);
      setDeclineReason('');
    }
    setBusyId(null);
  };

  const handleAutoAcceptToggle = async () => {
    if (!supplier) return;
    const next = !supplier.auto_accept;
    setSupplier({ ...supplier, auto_accept: next });
    const { data, error } = await supabase.from('suppliers').update({ auto_accept: next }).eq('id', supplier.id).select('id');
    if (error || !data || data.length === 0) {
      console.error('Auto-accept update error:', error);
      setSupplier({ ...supplier, auto_accept: !next });
      showToast('Could not save the setting.', 'err');
    }
  };

  const handleSaveBank = async () => {
    if (!supplier) return;
    const payload = {
      bank_name: bank.bank_name.trim(),
      account_name: bank.account_name.trim(),
      account_number: bank.account_number.trim(),
    };
    if (!payload.bank_name || !payload.account_name) {
      showToast('Enter the bank name and account name.', 'err');
      return;
    }
    if (!/^\d{10}$/.test(payload.account_number)) {
      showToast('Account number must be 10 digits.', 'err');
      return;
    }
    setSavingBank(true);
    const { data, error } = await supabase.from('suppliers').update(payload).eq('id', supplier.id).select('id');
    if (error || !data || data.length === 0) {
      console.error('Bank details save error:', error);
      showToast('Could not save payment details. Try again.', 'err');
    } else {
      setSupplier({ ...supplier, ...payload });
      setEditingBank(false);
      showToast('Payment details saved');
    }
    setSavingBank(false);
  };

  const handleSaveProfile = async () => {
    if (!supplier) return;
    const phone = profile.phone.replace(/[\s-]/g, '');
    if (!profile.contact_name.trim()) {
      showToast('Contact name is required.', 'err');
      return;
    }
    if (phone && !/^\+?\d{10,15}$/.test(phone)) {
      showToast('Enter a valid phone number, for example +2348012345678.', 'err');
      return;
    }
    const toSave = {
      contact_name: profile.contact_name.trim(),
      phone: phone || null,
      city: profile.city.trim() || null,
      website: profile.website.trim() || null,
      capacity_description: profile.capacity_description.trim() || null,
      payment_terms: profile.payment_terms.trim() || null,
    };
    setSavingProfile(true);
    const { data, error } = await supabase.from('suppliers').update(toSave).eq('id', supplier.id).select('id');
    if (error || !data || data.length === 0) {
      console.error('Profile save error:', error);
      showToast('Could not save your changes. Try again.', 'err');
    } else {
      setSupplier({ ...supplier, ...toSave });
      setProfile(profileFrom(toSave));
      showToast('Settings saved');
    }
    setSavingProfile(false);
  };

  const handleChangePassword = async () => {
    if (pw.next.length < 8) {
      showToast('Use at least 8 characters for your password.', 'err');
      return;
    }
    if (pw.next !== pw.confirm) {
      showToast('The two passwords do not match.', 'err');
      return;
    }
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    if (error) {
      console.error('Password update error:', error);
      showToast(error.message || 'Could not update your password.', 'err');
    } else {
      setPw({ next: '', confirm: '' });
      showToast('Password updated');
    }
    setSavingPw(false);
  };

  const handlePaymentStep = async (po: IncomingPO, next: 'deposit_paid' | 'paid') => {
    setBusyId(po.id);
    const { data, error } = await supabase
      .from('purchase_orders')
      .update(next === 'paid' ? { payment_status: 'paid', paid_at: new Date().toISOString() } : { payment_status: next })
      .eq('id', po.id)
      .select('id');
    if (error || !data || data.length === 0) {
      console.error('Payment update error:', error);
      showToast('Could not update payment status.', 'err');
    } else {
      if (supplier) fetchPOs(supplier.id);
      showToast(
        next === 'paid'
          ? `${po.po_number} fully paid. You can dispatch it from Orders.`
          : `Upfront payment for ${po.po_number} received. You can dispatch it from Orders.`
      );
    }
    setBusyId(null);
  };

  const handleCopyBank = async () => {
    if (!supplier) return;
    try {
      await navigator.clipboard.writeText(`${supplier.bank_name}\n${supplier.account_name}\n${supplier.account_number}`);
      showToast('Bank details copied');
    } catch {
      showToast('Could not copy to clipboard.', 'err');
    }
  };

  const openEdit = (row: CatalogRow) => {
    setEditor({
      mode: 'edit',
      target: {
        listingId: row.item.id,
        product: row.p,
        price: row.item.price,
        moq: row.item.minimum_order_quantity,
        qty: row.item.available_quantity,
        lead: row.item.lead_time_days,
        status: row.item.availability_status,
        specs: row.item.specifications,
      },
    });
  };

  const handleQuickStatus = async (row: CatalogRow, next: 'available' | 'out_of_stock') => {
    if (!supplier) return;
    setBusyId(row.item.id);
    const { data, error } = await supabase
      .from('supplier_products')
      .update({ availability_status: next, updated_at: new Date().toISOString() })
      .eq('id', row.item.id)
      .eq('supplier_id', supplier.id)
      .select('id');
    if (error || !data || data.length === 0) {
      console.error('Availability update error:', error);
      showToast('Could not update availability. Try again.', 'err');
    } else {
      fetchCatalog(supplier.id);
      showToast(next === 'available' ? `${row.p.name} marked available` : `${row.p.name} marked out of stock`);
    }
    setBusyId(null);
  };

  const confirmRemove = async () => {
    if (!removeTarget || !supplier) return;
    const row = removeTarget;
    setBusyId(row.item.id);
    const { data, error } = await supabase
      .from('supplier_products')
      .delete()
      .eq('id', row.item.id)
      .eq('supplier_id', supplier.id)
      .select('id');
    if (error?.code === '23503') {
      showToast('This product is linked to existing quotes or orders, so it cannot be removed. Mark it out of stock instead.', 'err');
    } else if (error || !data || data.length === 0) {
      console.error('Remove listing error:', error);
      showToast('Could not remove the product. Try again.', 'err');
    } else {
      fetchCatalog(supplier.id);
      showToast(`${row.p.name} removed`);
      setRemoveTarget(null);
    }
    setBusyId(null);
  };

  const formatAmount = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) return '—';
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ', ' +
    new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });

  const stats = useMemo(() => {
    const pending = pos.filter((p) => p.supplier_status === 'pending');
    const accepted = pos.filter((p) => p.supplier_status === 'accepted');
    const declined = pos.filter((p) => p.supplier_status === 'declined');
    const sum = (list: IncomingPO[]) => list.reduce((t, p) => t + (p.total_amount || 0), 0);
    return {
      pending: pending.length,
      accepted: accepted.length,
      declined: declined.length,
      pendingValue: sum(pending),
      acceptedValue: sum(accepted),
    };
  }, [pos]);

  // Pending orders first (they need action), then newest first.
  const visiblePos = useMemo(() => {
    const list = filter === 'all' ? pos : pos.filter((p) => p.supplier_status === filter);
    return [...list].sort((a, b) => {
      if (a.supplier_status === 'pending' && b.supplier_status !== 'pending') return -1;
      if (b.supplier_status === 'pending' && a.supplier_status !== 'pending') return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [pos, filter]);

  const catalogRows = useMemo(() => {
    const rows: CatalogRow[] = [];
    for (const item of catalog) {
      const p = Array.isArray(item.products) ? item.products[0] : item.products;
      if (p) rows.push({ item, p });
    }
    return rows;
  }, [catalog]);

  const catalogCategories = useMemo(
    () => ['all', ...Array.from(new Set(catalogRows.map((r) => groupOf(r.p)))).sort()],
    [catalogRows]
  );

  const catalogGroups = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    const grouped = new Map<string, CatalogRow[]>();
    catalogRows
      .filter(
        (r) =>
          (catalogGroup === 'all' || groupOf(r.p) === catalogGroup) &&
          (!q || `${r.p.name} ${r.p.description || ''} ${groupOf(r.p)}`.toLowerCase().includes(q))
      )
      .sort((a, b) => a.p.name.localeCompare(b.p.name, undefined, { numeric: true }))
      .forEach((r) => {
        const g = groupOf(r.p);
        grouped.set(g, [...(grouped.get(g) || []), r]);
      });
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [catalogRows, catalogSearch, catalogGroup]);

  if (!ready) {
    return (
      <div className="flex h-screen w-screen bg-slate-950 items-center justify-center">
        <div className="text-slate-400 text-sm">Loading supplier portal...</div>
      </div>
    );
  }

  const hasBank = !!(supplier?.bank_name && supplier?.account_name && supplier?.account_number);
  // Reads terms like "30% upfront, 70% on delivery" to split the payment into two steps.
  const upfrontPct = (terms?: string | null) => {
    const m = terms?.match(/(\d{1,2})\s*%\s*(?:up\s*-?\s*front|deposit|advance)/i);
    const n = m ? parseInt(m[1], 10) : 0;
    return n > 0 && n < 100 ? n : 0;
  };
  const schedule = (po: IncomingPO) => {
    const total = po.total_amount || 0;
    const pct = upfrontPct(po.payment_terms);
    const upfront = Math.round((total * pct) / 100);
    const received = po.payment_status === 'paid' ? total : po.payment_status === 'deposit_paid' ? upfront : 0;
    return { total, pct, upfront, balance: total - upfront, received, outstanding: total - received };
  };
  const nextStep = (po: IncomingPO): { to: 'deposit_paid' | 'paid'; label: string } | null => {
    if (po.payment_status === 'paid') return null;
    if (schedule(po).pct > 0 && po.payment_status !== 'deposit_paid') return { to: 'deposit_paid', label: 'Confirm upfront received' };
    return { to: 'paid', label: po.payment_status === 'deposit_paid' ? 'Confirm balance received' : 'Confirm payment received' };
  };
  const acceptedPos = pos
    .filter((p) => p.supplier_status === 'accepted')
    .sort((a, b) => Number(a.payment_status === 'paid') - Number(b.payment_status === 'paid'));
  const totalAccepted = acceptedPos.reduce((t, p) => t + schedule(p).total, 0);
  const totalReceived = acceptedPos.reduce((t, p) => t + schedule(p).received, 0);
  const inputCls =
    'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500';

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: pos.length },
    { key: 'pending', label: 'Pending', count: stats.pending },
    { key: 'accepted', label: 'Accepted', count: stats.accepted },
    { key: 'declined', label: 'Declined', count: stats.declined },
  ];

  const verified = supplier?.verification_status === 'verified';
  const profileDirty = JSON.stringify(profile) !== JSON.stringify(profileFrom(supplier));
  const profileFields: { key: 'contact_name' | 'phone' | 'city' | 'website'; label: string; placeholder: string; hint?: string }[] = [
    { key: 'contact_name', label: 'Contact name', placeholder: 'Who buyers should speak to' },
    { key: 'phone', label: 'Phone / WhatsApp', placeholder: '+2348012345678', hint: 'Include the country code.' },
    { key: 'city', label: 'City', placeholder: 'e.g. Port Harcourt' },
    { key: 'website', label: 'Website', placeholder: 'www.example.com' },
  ];
  const overview = [
    { label: 'Status', value: verified ? 'Verified' : 'Pending' },
    { label: 'Level', value: supplier?.verification_level || '—' },
    { label: 'Rating', value: supplier?.rating != null && supplier?.rating !== '' ? `★ ${Number(supplier.rating).toFixed(1)}` : '—' },
    { label: 'Experience', value: supplier?.years_in_business != null ? `${supplier.years_in_business} yrs` : '—' },
  ];
  const navItems: { key: 'orders' | 'products' | 'payments' | 'settings'; label: string; Icon: typeof Package; badge: number; dot: boolean }[] = [
    { key: 'orders', label: 'Orders', Icon: Package, badge: stats.pending, dot: false },
    { key: 'products', label: 'Products', Icon: Boxes, badge: 0, dot: false },
    { key: 'payments', label: 'Payments', Icon: Landmark, badge: 0, dot: !hasBank },
    { key: 'settings', label: 'Settings', Icon: SettingsIcon, badge: 0, dot: false },
  ];

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Sidebar: left rail on desktop, bottom tab bar on mobile */}
      <aside
        className={`order-last md:order-first shrink-0 flex md:flex-col bg-slate-900 border-t md:border-t-0 md:border-r border-slate-800 pb-[env(safe-area-inset-bottom)] md:pb-0 md:transition-[width] md:duration-200 ${collapsed ? 'md:w-[76px]' : 'md:w-64'
          }`}
      >
        {/* Brand */}
        <div
          className={`hidden md:flex items-center gap-3 h-16 border-b border-slate-800 shrink-0 ${collapsed ? 'justify-center' : 'px-5'
            }`}
        >
          <div className="h-9 w-9 rounded-xl bg-emerald-500 flex items-center justify-center font-bold text-slate-950 text-xl shrink-0">
            V
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-bold text-white leading-tight">Velrenta</p>
              <p className="text-[11px] text-slate-400 leading-tight">Supplier portal</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 md:flex-col md:gap-1 md:p-3" aria-label="Main">
          {navItems.map(({ key, label, Icon, badge, dot }) => {
            const active = view === key;
            return (
              <button
                key={key}
                onClick={() => setView(key)}
                title={collapsed ? label : undefined}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-1 md:flex-none flex-col md:flex-row items-center justify-center gap-1 md:gap-3 py-2.5 md:px-3 md:rounded-lg text-[11px] md:text-sm font-medium transition ${collapsed ? '' : 'md:justify-start'
                  } ${active
                    ? 'text-emerald-400 md:bg-emerald-500/10 md:before:absolute md:before:left-0 md:before:top-2 md:before:bottom-2 md:before:w-0.5 md:before:rounded-full md:before:bg-emerald-400'
                    : 'text-slate-400 hover:text-slate-200 md:hover:bg-slate-800/60'
                  }`}
              >
                <span className="relative shrink-0">
                  <Icon className="w-5 h-5 md:w-4 md:h-4" />
                  {badge > 0 && (
                    <span
                      className={`absolute -top-1.5 -right-2.5 bg-amber-500 text-slate-950 text-[10px] font-bold rounded-full h-4 min-w-4 px-1 flex items-center justify-center ${collapsed ? '' : 'md:hidden'
                        }`}
                    >
                      {badge}
                    </span>
                  )}
                  {dot && (
                    <span
                      className={`absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-amber-400 ${collapsed ? '' : 'md:hidden'}`}
                    />
                  )}
                </span>
                <span className={collapsed ? 'md:hidden' : ''}>{label}</span>
                {!collapsed && badge > 0 && (
                  <span className="hidden md:flex ml-auto bg-amber-500 text-slate-950 text-[10px] font-bold rounded-full h-5 min-w-5 px-1 items-center justify-center">
                    {badge}
                  </span>
                )}
                {!collapsed && dot && (
                  <span className="hidden md:block ml-auto h-2 w-2 rounded-full bg-amber-400" title="Bank details missing" />
                )}
              </button>
            );
          })}

          <button
            onClick={handleLogout}
            className="md:hidden flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium text-slate-400 hover:text-red-400 transition"
          >
            <LogOut className="w-5 h-5" />
            Log out
          </button>
        </nav>

        {/* Footer (desktop) */}
        <div className="hidden md:block border-t border-slate-800 p-3 space-y-2 shrink-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-xs text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 transition ${collapsed ? 'justify-center' : ''
              }`}
          >
            {collapsed ? (
              <ChevronsRight className="w-4 h-4" />
            ) : (
              <>
                <ChevronsLeft className="w-4 h-4" /> Collapse
              </>
            )}
          </button>

          <div
            className={`rounded-xl bg-slate-800/50 border border-slate-700/50 p-2.5 flex items-center gap-3 ${collapsed ? 'flex-col' : ''
              }`}
          >
            <div
              title={collapsed ? supplier?.company_name || undefined : undefined}
              className="h-9 w-9 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center font-bold text-xs text-emerald-400 shrink-0"
            >
              {supplier?.company_name?.[0]?.toUpperCase() || 'S'}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white truncate">{supplier?.company_name || user?.email}</p>
                <p className={`text-[11px] flex items-center gap-1.5 ${verified ? 'text-emerald-400' : 'text-amber-400'}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {verified ? 'Verified supplier' : 'Pending verification'}
                </p>
              </div>
            )}
            <button
              onClick={handleLogout}
              title="Log out"
              aria-label="Log out"
              className="text-slate-400 hover:text-red-400 p-1 transition shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 md:p-8">
          {supplier?.verification_status === 'unverified' && (
            <div className="mb-5 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs rounded-xl px-4 py-3">
              Your account is pending verification by our team. You'll start receiving orders once approved.
            </div>
          )}

          {view === 'orders' ? (
            <>
              <header className="mb-6">
                <h1 className="text-2xl font-bold text-white">Incoming orders</h1>
                <p className="text-slate-400 text-sm mt-1">
                  Accept or decline purchase orders sent to {supplier?.company_name || 'you'} by Velrenta buyers.
                </p>
              </header>

              {!hasBank && (
                <div className="mb-5 flex items-center justify-between gap-4 flex-wrap bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs rounded-xl px-4 py-3">
                  <span>Add your bank account so buyers know where to pay you after you accept an order.</span>
                  <button
                    onClick={() => setView('payments')}
                    className="font-bold bg-amber-400 text-slate-950 rounded-lg px-3 py-1.5 hover:bg-amber-300 transition"
                  >
                    Add payment details
                  </button>
                </div>
              )}

              {/* Summary */}
              <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                <div
                  className={`rounded-xl border p-4 ${!posLoading && stats.pending > 0 ? 'bg-amber-500/5 border-amber-500/30' : 'bg-slate-900 border-slate-800'
                    }`}
                >
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Hourglass className="w-3.5 h-3.5 text-amber-400" /> Awaiting your response
                  </div>
                  {posLoading ? (
                    <>
                      <Skeleton className="h-8 w-12 mt-2" />
                      <Skeleton className="h-3 w-28 mt-2" />
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-white mt-2">{stats.pending}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{formatAmount(stats.pendingValue)} on hold</p>
                    </>
                  )}
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Accepted
                  </div>
                  {posLoading ? (
                    <>
                      <Skeleton className="h-8 w-12 mt-2" />
                      <Skeleton className="h-3 w-28 mt-2" />
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-white mt-2">{stats.accepted}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{formatAmount(stats.acceptedValue)} confirmed</p>
                    </>
                  )}
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <XCircle className="w-3.5 h-3.5 text-red-400" /> Declined
                  </div>
                  {posLoading ? (
                    <>
                      <Skeleton className="h-8 w-12 mt-2" />
                      <Skeleton className="h-3 w-16 mt-2" />
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-white mt-2">{stats.declined}</p>
                      <p className="text-xs text-slate-500 mt-0.5">All time</p>
                    </>
                  )}
                </div>
              </section>

              {/* Filters */}
              <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setFilter(t.key)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition ${filter === t.key
                      ? 'bg-slate-100 text-slate-900 border-slate-100'
                      : 'text-slate-400 border-slate-800 hover:border-slate-600 hover:text-slate-200'
                      }`}
                  >
                    {t.label}{' '}
                    {posLoading ? (
                      <span className="inline-block align-middle h-3 w-4 rounded bg-slate-700/60 animate-pulse" />
                    ) : (
                      <span className={filter === t.key ? 'text-slate-600' : 'text-slate-500'}>{t.count}</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Orders */}
              <div className="space-y-3">
                {posLoading ? (
                  [0, 1, 2].map((i) => (
                    <div key={i} className="bg-slate-900 rounded-xl border border-slate-800 p-4 md:p-5 animate-pulse">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-2.5">
                          <div className="h-3.5 w-32 rounded bg-slate-800" />
                          <div className="h-3 w-2/3 rounded bg-slate-800/70" />
                        </div>
                        <div className="h-5 w-20 rounded bg-slate-800" />
                      </div>
                      <div className="h-3 w-1/2 rounded bg-slate-800/70 mt-5" />
                    </div>
                  ))
                ) : visiblePos.length === 0 ? (
                  <div className="bg-slate-900 rounded-xl border border-dashed border-slate-800 p-10 text-center">
                    <Package className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                    <p className="text-sm text-slate-300">
                      {pos.length === 0 ? 'No orders yet' : `No ${filter} orders`}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {pos.length === 0
                        ? 'New purchase orders from buyers will appear here.'
                        : 'Switch filters to see your other orders.'}
                    </p>
                  </div>
                ) : (
                  visiblePos.map((po) => {
                    const buyerInfo = getBuyerInfo(po);
                    const s = STATUS_STYLES[po.supplier_status] || STATUS_STYLES.pending;
                    return (
                      <article
                        key={po.id}
                        className={`relative overflow-hidden bg-slate-900 rounded-xl border border-slate-800 p-4 md:p-5 pl-5 md:pl-6 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${s.edge}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2.5 flex-wrap">
                              <span className="font-mono text-sm text-white">{po.po_number}</span>
                              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${s.badge}`}>
                                {po.supplier_status.charAt(0).toUpperCase() + po.supplier_status.slice(1)}
                              </span>
                              {po.supplier_status === 'accepted' && (
                                <span
                                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${po.payment_status === 'paid' || po.payment_status === 'deposit_paid'
                                    ? 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                                    : 'bg-slate-800 text-slate-400 border-slate-700'
                                    }`}
                                >
                                  {po.payment_status === 'paid'
                                    ? 'Paid'
                                    : po.payment_status === 'deposit_paid'
                                      ? 'Upfront paid'
                                      : 'Awaiting payment'}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-slate-300 mt-1.5">
                              {po.order_description || 'No description provided'}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-lg md:text-xl font-bold text-emerald-400 leading-tight">
                              {formatAmount(po.total_amount)}
                            </p>
                            <p className="text-[11px] text-slate-500">Total value</p>
                          </div>
                        </div>

                        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2.5 mt-4 text-xs">
                          <div className="flex items-center gap-2 text-slate-400 min-w-0">
                            <User className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                            <span className="truncate">{buyerInfo?.contact_name || 'Buyer'}</span>
                          </div>
                          <div className="flex items-center gap-2 text-slate-400 min-w-0">
                            <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                            <span className={`truncate ${po.delivery_location ? '' : 'text-slate-600'}`}>
                              {po.delivery_location || 'No delivery location'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-slate-400 min-w-0">
                            <Wallet className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                            <span className={`truncate ${po.payment_terms ? '' : 'text-slate-600'}`}>
                              {po.payment_terms || 'No payment terms'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-slate-400 min-w-0">
                            <Clock className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                            <span className="truncate">{formatDate(po.created_at)}</span>
                          </div>
                        </dl>

                        {po.supplier_status === 'pending' && (
                          <div className="flex flex-col sm:flex-row gap-2 mt-4 pt-4 border-t border-slate-800">
                            <button
                              onClick={() => handleAccept(po)}
                              disabled={busyId === po.id}
                              className="sm:w-40 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold py-2 rounded-lg text-xs transition"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> Accept order
                            </button>
                            <button
                              onClick={() => {
                                setDeclineTarget(po);
                                setDeclineReason('');
                              }}
                              disabled={busyId === po.id}
                              className="sm:w-40 flex items-center justify-center gap-1.5 bg-transparent hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 disabled:opacity-50 text-slate-300 font-bold py-2 rounded-lg text-xs transition border border-slate-700"
                            >
                              <XCircle className="w-3.5 h-3.5" /> Decline
                            </button>
                          </div>
                        )}

                        {po.supplier_status === 'declined' && po.decline_reason && (
                          <p className="text-xs text-red-400/80 mt-4 pt-4 border-t border-slate-800">
                            Reason for declining: {po.decline_reason}
                          </p>
                        )}

                        <DeliveryControls
                          po={po}
                          supplierId={supplier!.id}
                          onUpdated={(m) => { if (supplier) fetchPOs(supplier.id); showToast(m); }}
                          onError={(m) => showToast(m, 'err')}
                          onGoToPayments={() => setView('payments')}
                        />
                      </article>
                    );
                  })
                )}
              </div>
            </>
          ) : view === 'products' ? (
            <>
              <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold text-white">My products</h1>
                  <p className="text-slate-400 text-sm mt-1">
                    What {supplier?.company_name || 'you'} supply on Velrenta, with your price per unit. Buyers request quotes against these items.
                  </p>
                </div>
                <button
                  onClick={() => setEditor({ mode: 'add' })}
                  className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs transition shrink-0"
                >
                  <Plus className="w-4 h-4" /> Add product
                </button>
              </header>

              <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                {[
                  { label: 'Products listed', value: catalogRows.length },
                  { label: 'Categories', value: Math.max(catalogCategories.length - 1, 0) },
                  {
                    label: 'Available now',
                    value: catalogRows.filter((r) => (r.item.availability_status || 'available').toLowerCase() === 'available').length,
                  },
                ].map((c) => (
                  <div key={c.label} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                    <p className="text-xs text-slate-400">{c.label}</p>
                    {catalogLoading ? (
                      <Skeleton className="h-8 w-12 mt-2" />
                    ) : (
                      <p className="text-2xl font-bold text-white mt-2">{c.value}</p>
                    )}
                  </div>
                ))}
              </section>

              {catalogError ? (
                <div className="bg-slate-900 rounded-xl border border-dashed border-red-500/30 p-8 text-center">
                  <p className="text-sm text-slate-300">We could not load your products</p>
                  <p className="text-xs text-slate-500 mt-1">Please refresh the page. If this keeps happening, contact the Velrenta team.</p>
                </div>
              ) : catalogLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="bg-slate-900 rounded-xl border border-slate-800 p-4 animate-pulse">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-2.5">
                          <div className="h-3.5 w-1/2 rounded bg-slate-800" />
                          <div className="h-3 w-2/3 rounded bg-slate-800/70" />
                        </div>
                        <div className="h-5 w-20 rounded bg-slate-800" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : catalogRows.length === 0 ? (
                <div className="bg-slate-900 rounded-xl border border-dashed border-slate-800 p-10 text-center">
                  <Boxes className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                  <p className="text-sm text-slate-300">No products listed yet</p>
                  <p className="text-xs text-slate-500 mt-1">Add what you supply, with your price per unit, so buyers can request quotes from you.</p>
                  <button
                    onClick={() => setEditor({ mode: 'add' })}
                    className="mt-4 text-xs font-bold border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 text-slate-300 rounded-lg px-3.5 py-2 transition"
                  >
                    Add your first product
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative mb-3">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                      placeholder="Search your products"
                      aria-label="Search your products"
                      className={`${inputCls} pl-9`}
                    />
                  </div>
                  <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1">
                    {catalogCategories.map((g) => (
                      <button
                        key={g}
                        onClick={() => setCatalogGroup(g)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition ${catalogGroup === g
                          ? 'bg-slate-100 text-slate-900 border-slate-100'
                          : 'text-slate-400 border-slate-800 hover:border-slate-600 hover:text-slate-200'
                          }`}
                      >
                        {g === 'all' ? 'All' : g}
                      </button>
                    ))}
                  </div>

                  {catalogGroups.length === 0 ? (
                    <div className="bg-slate-900 rounded-xl border border-dashed border-slate-800 p-8 text-center">
                      <p className="text-sm text-slate-300">No products match your search</p>
                    </div>
                  ) : (
                    catalogGroups.map(([group, rows]) => (
                      <section key={group} className="mb-6">
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2.5">
                          {group} <span className="text-slate-600">· {rows.length}</span>
                        </h2>
                        <div className="space-y-3">
                          {rows.map((row) => {
                            const { item, p } = row;
                            const specs = specEntriesOf(row);
                            const status = (item.availability_status || 'available').replace(/_/g, ' ');
                            const num = (v: number | string | null) =>
                              v === null || v === '' ? '—' : Number(v).toLocaleString('en-NG');
                            const unit = p.unit || 'unit';
                            const isOut = (item.availability_status || 'available').toLowerCase() === 'out_of_stock';
                            return (
                              <article key={item.id} className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-white">{p.name}</p>
                                    {p.description && <p className="text-xs text-slate-400 mt-1">{p.description}</p>}
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-lg font-bold text-emerald-400 leading-tight">
                                      {item.price === null || item.price === '' ? '—' : formatAmount(Number(item.price))}
                                    </p>
                                    <p className="text-[11px] text-slate-500">per {unit}</p>
                                  </div>
                                </div>

                                <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3 text-xs">
                                  <div className="rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
                                    <dt className="text-[11px] text-slate-500">Minimum order</dt>
                                    <dd className="text-slate-200 mt-0.5">{num(item.minimum_order_quantity)} {unit}</dd>
                                  </div>
                                  <div className="rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
                                    <dt className="text-[11px] text-slate-500">In stock</dt>
                                    <dd className="text-slate-200 mt-0.5">{num(item.available_quantity)} {unit}</dd>
                                  </div>
                                  <div className="rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
                                    <dt className="text-[11px] text-slate-500">Lead time</dt>
                                    <dd className="text-slate-200 mt-0.5">
                                      {item.lead_time_days === null ? '—' : `${item.lead_time_days} ${item.lead_time_days === 1 ? 'day' : 'days'}`}
                                    </dd>
                                  </div>
                                  <div className="rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
                                    <dt className="text-[11px] text-slate-500">Status</dt>
                                    <dd className="mt-0.5">
                                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border capitalize ${availabilityStyle(item.availability_status)}`}>
                                        {status}
                                      </span>
                                    </dd>
                                  </div>
                                </dl>

                                {specs.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 mt-3">
                                    {specs.map(([k, v]) => (
                                      <span key={k} className="px-2.5 py-1 rounded-full text-[11px] border border-slate-700 text-slate-300">
                                        <span className="text-slate-500 capitalize">{k}:</span> {v}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-800">
                                  <button
                                    onClick={() => openEdit(row)}
                                    className="flex items-center gap-1.5 text-xs font-semibold border border-slate-700 hover:border-slate-500 text-slate-300 rounded-lg px-3 py-1.5 transition"
                                  >
                                    <Pencil className="w-3.5 h-3.5" /> Edit
                                  </button>
                                  <button
                                    onClick={() => handleQuickStatus(row, isOut ? 'available' : 'out_of_stock')}
                                    disabled={busyId === item.id}
                                    className="text-xs font-semibold border border-slate-700 hover:border-slate-500 disabled:opacity-50 text-slate-300 rounded-lg px-3 py-1.5 transition"
                                  >
                                    {isOut ? 'Mark available' : 'Mark out of stock'}
                                  </button>
                                  <button
                                    onClick={() => setRemoveTarget(row)}
                                    disabled={busyId === item.id}
                                    className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-red-400 disabled:opacity-50 px-2 py-1.5 transition"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" /> Remove
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    ))
                  )}
                </>
              )}
            </>
          ) : view === 'payments' ? (
            <>
              <header className="mb-6">
                <h1 className="text-2xl font-bold text-white">Payments</h1>
                <p className="text-slate-400 text-sm mt-1">
                  Set the account buyers pay into, and track payment for orders you've accepted.
                </p>
              </header>

              {editingBank || !hasBank ? (
                <section className="bg-slate-900 rounded-xl border border-slate-800 p-5 mb-6">
                  <h2 className="text-sm font-semibold text-white">{hasBank ? 'Edit bank account' : 'Add your bank account'}</h2>
                  <p className="text-xs text-slate-400 mt-1">Buyers receive these details once you accept an order.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div>
                      <label htmlFor="bank-name" className="block text-xs text-slate-300 mb-1.5">Bank name</label>
                      <input
                        id="bank-name"
                        list="ng-banks"
                        value={bank.bank_name}
                        onChange={(e) => setBank({ ...bank, bank_name: e.target.value })}
                        placeholder="e.g. Zenith Bank"
                        className={inputCls}
                      />
                      <datalist id="ng-banks">
                        {['Access Bank', 'First Bank', 'FCMB', 'Fidelity Bank', 'GTBank', 'Kuda', 'Moniepoint', 'Opay', 'Palmpay', 'Polaris Bank', 'Stanbic IBTC', 'Sterling Bank', 'UBA', 'Union Bank', 'Wema Bank', 'Zenith Bank'].map((b) => (
                          <option key={b} value={b} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label htmlFor="acct-number" className="block text-xs text-slate-300 mb-1.5">Account number</label>
                      <input
                        id="acct-number"
                        inputMode="numeric"
                        maxLength={10}
                        value={bank.account_number}
                        onChange={(e) => setBank({ ...bank, account_number: e.target.value.replace(/\D/g, '') })}
                        placeholder="10 digits"
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="acct-name" className="block text-xs text-slate-300 mb-1.5">Account name</label>
                      <input
                        id="acct-name"
                        value={bank.account_name}
                        onChange={(e) => setBank({ ...bank, account_name: e.target.value })}
                        placeholder="Name on the account"
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                    {hasBank && (
                      <button
                        onClick={() => {
                          setBank({
                            bank_name: supplier?.bank_name || '',
                            account_name: supplier?.account_name || '',
                            account_number: supplier?.account_number || '',
                          });
                          setEditingBank(false);
                        }}
                        className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      onClick={handleSaveBank}
                      disabled={savingBank}
                      className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold px-5 py-2 rounded-lg text-xs transition"
                    >
                      {savingBank ? 'Saving...' : 'Save payment details'}
                    </button>
                  </div>
                </section>
              ) : (
                <section className="bg-slate-900 rounded-xl border border-slate-800 p-5 mb-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                        <Landmark className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{supplier?.bank_name}</p>
                        <p className="text-xs text-slate-400 truncate">{supplier?.account_name}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={handleCopyBank}
                        className="text-xs font-semibold border border-slate-700 hover:border-slate-500 text-slate-300 rounded-lg px-3 py-1.5 transition"
                      >
                        Copy details
                      </button>
                      <button
                        onClick={() => setEditingBank(true)}
                        className="text-xs font-semibold border border-slate-700 hover:border-slate-500 text-slate-300 rounded-lg px-3 py-1.5 transition"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                  <p className="font-mono text-2xl tracking-widest text-white mt-4">
                    {(supplier?.account_number || '').replace(/(\d{4})(?=\d)/g, '$1 ')}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">Buyers receive these details when you accept an order.</p>
                </section>
              )}

              <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                  <p className="text-xs text-slate-400">Accepted orders</p>
                  {posLoading ? (
                    <>
                      <Skeleton className="h-7 w-28 mt-2" />
                      <Skeleton className="h-3 w-16 mt-2" />
                    </>
                  ) : (
                    <>
                      <p className="text-xl font-bold text-white mt-2">{formatAmount(totalAccepted)}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{acceptedPos.length} {acceptedPos.length === 1 ? 'order' : 'orders'}</p>
                    </>
                  )}
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                  <p className="text-xs text-slate-400">Received</p>
                  {posLoading ? (
                    <>
                      <Skeleton className="h-7 w-28 mt-2" />
                      <Skeleton className="h-3 w-24 mt-2" />
                    </>
                  ) : (
                    <>
                      <p className="text-xl font-bold text-emerald-400 mt-2">{formatAmount(totalReceived)}</p>
                      <p className="text-xs text-slate-500 mt-0.5">Confirmed by you</p>
                    </>
                  )}
                </div>
                <div className={`rounded-xl border p-4 ${!posLoading && totalAccepted - totalReceived > 0 ? 'bg-amber-500/5 border-amber-500/30' : 'bg-slate-900 border-slate-800'}`}>
                  <p className="text-xs text-slate-400">Still to receive</p>
                  {posLoading ? (
                    <>
                      <Skeleton className="h-7 w-28 mt-2" />
                      <Skeleton className="h-3 w-28 mt-2" />
                    </>
                  ) : (
                    <>
                      <p className="text-xl font-bold text-white mt-2">{formatAmount(totalAccepted - totalReceived)}</p>
                      <p className="text-xs text-slate-500 mt-0.5">Across unpaid orders</p>
                    </>
                  )}
                </div>
              </section>

              <div className="space-y-3">
                {posLoading ? (
                  [0, 1].map((i) => (
                    <div key={i} className="bg-slate-900 rounded-xl border border-slate-800 p-4 animate-pulse">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          <div className="h-3.5 w-28 rounded bg-slate-800" />
                          <div className="h-3 w-40 rounded bg-slate-800/70" />
                        </div>
                        <div className="h-4 w-20 rounded bg-slate-800" />
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-800 mt-4" />
                    </div>
                  ))
                ) : acceptedPos.length === 0 ? (
                  <div className="bg-slate-900 rounded-xl border border-dashed border-slate-800 p-8 text-center">
                    <p className="text-sm text-slate-300">No accepted orders yet</p>
                    <p className="text-xs text-slate-500 mt-1">Once you accept an order, you can track its payment here.</p>
                  </div>
                ) : (
                  acceptedPos.map((po) => {
                    const sc = schedule(po);
                    const step = nextStep(po);
                    const pctDone = sc.total ? Math.round((sc.received / sc.total) * 100) : 0;
                    const upfrontDone = po.payment_status === 'deposit_paid' || po.payment_status === 'paid';
                    const balanceDone = po.payment_status === 'paid';
                    return (
                      <div key={po.id} className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="font-mono text-sm text-white">{po.po_number}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{po.payment_terms || 'No payment terms set'}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-emerald-400">{formatAmount(sc.total)}</p>
                            <p className="text-[11px] text-slate-500">
                              {sc.outstanding > 0 ? `${formatAmount(sc.outstanding)} outstanding` : 'Fully paid'}
                            </p>
                          </div>
                        </div>

                        <div className="h-1.5 rounded-full bg-slate-800 mt-3 overflow-hidden">
                          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pctDone}%` }} />
                        </div>

                        {sc.pct > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 text-xs">
                            <div className="flex items-center justify-between rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
                              <span className="text-slate-400">Upfront ({sc.pct}%)</span>
                              <span className={upfrontDone ? 'text-emerald-400' : 'text-slate-300'}>
                                {formatAmount(sc.upfront)} · {upfrontDone ? 'Received' : 'Pending'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
                              <span className="text-slate-400">Balance ({100 - sc.pct}%)</span>
                              <span className={balanceDone ? 'text-emerald-400' : 'text-slate-300'}>
                                {formatAmount(sc.balance)} · {balanceDone ? 'Received' : 'Pending'}
                              </span>
                            </div>
                          </div>
                        )}

                        {step && (
                          <div className="flex justify-end mt-3">
                            <button
                              onClick={() => handlePaymentStep(po, step.to)}
                              disabled={busyId === po.id}
                              className="text-xs font-bold border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 disabled:opacity-50 text-slate-300 rounded-lg px-3 py-1.5 transition"
                            >
                              {step.label}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <>
              <header className="mb-6">
                <h1 className="text-2xl font-bold text-white">Settings</h1>
                <p className="text-slate-400 text-sm mt-1">
                  Manage your company profile, quoting defaults and account security.
                </p>
              </header>

              <div className="max-w-2xl">
                {/* Account overview */}
                <section className="bg-slate-900 rounded-xl border border-slate-800 p-5 mb-5">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-lg font-bold text-emerald-400 shrink-0">
                      {supplier?.company_name?.[0]?.toUpperCase() || 'S'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-bold text-white truncate">{supplier?.company_name}</p>
                      <p className="text-xs text-slate-400 truncate">{user?.email}</p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
                    {overview.map((o) => (
                      <div key={o.label} className="rounded-lg bg-slate-950/50 border border-slate-800 px-3 py-2.5">
                        <dt className="text-[11px] text-slate-500">{o.label}</dt>
                        <dd className="text-sm font-semibold text-white mt-0.5 capitalize">{o.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-[11px] text-slate-500 mt-3">Verification, level and rating are managed by the Velrenta team.</p>
                </section>

                {/* Company profile */}
                <section className="bg-slate-900 rounded-xl border border-slate-800 p-5 mb-5">
                  <h2 className="text-sm font-semibold text-white">Company profile</h2>
                  <p className="text-xs text-slate-400 mt-1">How buyers and the Velrenta team can reach you.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div className="sm:col-span-2">
                      <label htmlFor="pf-company" className="block text-xs text-slate-300 mb-1.5">Company name</label>
                      <input
                        id="pf-company"
                        value={supplier?.company_name || ''}
                        disabled
                        className={`${inputCls} opacity-60 cursor-not-allowed`}
                      />
                      <p className="text-[11px] text-slate-500 mt-1.5">Contact the Velrenta team to change your registered name.</p>
                    </div>
                    {profileFields.map((f) => (
                      <div key={f.key}>
                        <label htmlFor={`pf-${f.key}`} className="block text-xs text-slate-300 mb-1.5">{f.label}</label>
                        <input
                          id={`pf-${f.key}`}
                          value={profile[f.key]}
                          onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })}
                          placeholder={f.placeholder}
                          className={inputCls}
                        />
                        {f.hint && <p className="text-[11px] text-slate-500 mt-1.5">{f.hint}</p>}
                      </div>
                    ))}
                  </div>
                </section>

                {/* Quoting defaults */}
                <section className="bg-slate-900 rounded-xl border border-slate-800 p-5 mb-5">
                  <h2 className="text-sm font-semibold text-white">Quoting defaults</h2>
                  <p className="text-xs text-slate-400 mt-1">Your standard terms and what you can supply.</p>

                  <label htmlFor="pf-terms" className="block text-xs text-slate-300 mt-4 mb-1.5">Default payment terms</label>
                  <input
                    id="pf-terms"
                    value={profile.payment_terms}
                    onChange={(e) => setProfile({ ...profile, payment_terms: e.target.value })}
                    placeholder="e.g. 50% upfront, 50% on delivery"
                    className={inputCls}
                  />
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {TERM_PRESETS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setProfile({ ...profile, payment_terms: t })}
                        className={`px-3 py-1 rounded-full text-[11px] border transition ${profile.payment_terms === t
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'text-slate-400 border-slate-700 hover:border-slate-500'
                          }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <label htmlFor="pf-capacity" className="block text-xs text-slate-300 mt-5 mb-1.5">Supply capacity</label>
                  <textarea
                    id="pf-capacity"
                    value={profile.capacity_description}
                    onChange={(e) => setProfile({ ...profile, capacity_description: e.target.value })}
                    maxLength={300}
                    rows={3}
                    placeholder="e.g. Can supply up to 3,000 steel pipes per month"
                    className={inputCls}
                  />
                  <p className="text-[11px] text-slate-500 mt-1.5 text-right">{profile.capacity_description.length}/300</p>
                </section>

                {profileDirty && (
                  <div className="sticky bottom-4 z-20 mb-5 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-slate-900/95 backdrop-blur px-4 py-3 shadow-lg">
                    <p className="text-xs text-slate-300">You have unsaved changes</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setProfile(profileFrom(supplier))}
                        className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
                      >
                        Discard
                      </button>
                      <button
                        onClick={handleSaveProfile}
                        disabled={savingProfile}
                        className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 transition"
                      >
                        {savingProfile ? 'Saving...' : 'Save changes'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Order handling */}
                <section className="bg-slate-900 rounded-xl border border-slate-800 p-5 mb-5">
                  <h2 className="text-sm font-semibold text-white">Order handling</h2>
                  <div className="flex items-center justify-between gap-6 mt-3">
                    <div>
                      <p className="text-sm font-medium text-white">Auto-accept orders</p>
                      <p className="text-xs text-slate-400 mt-1 max-w-sm">
                        New purchase orders are confirmed automatically the moment they're issued, with no manual
                        review here.
                      </p>
                      {supplier?.auto_accept && (
                        <p className="text-[11px] text-amber-400 mt-2">
                          On: new orders are confirmed without your review.
                        </p>
                      )}
                    </div>
                    <button
                      role="switch"
                      aria-checked={!!supplier?.auto_accept}
                      aria-label="Auto-accept orders"
                      onClick={handleAutoAcceptToggle}
                      className={`relative w-11 h-6 rounded-full transition shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${supplier?.auto_accept ? 'bg-emerald-500' : 'bg-slate-700'
                        }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${supplier?.auto_accept ? 'translate-x-5' : ''
                          }`}
                      />
                    </button>
                  </div>
                </section>

                {/* Security */}
                <section className="bg-slate-900 rounded-xl border border-slate-800 p-5 mb-5">
                  <h2 className="text-sm font-semibold text-white">Password</h2>
                  <p className="text-xs text-slate-400 mt-1">Choose a new password for signing in. Use at least 8 characters.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div>
                      <label htmlFor="pw-new" className="block text-xs text-slate-300 mb-1.5">New password</label>
                      <input
                        id="pw-new"
                        type={showPw ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={pw.next}
                        onChange={(e) => setPw({ ...pw, next: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label htmlFor="pw-confirm" className="block text-xs text-slate-300 mb-1.5">Confirm password</label>
                      <input
                        id="pw-confirm"
                        type={showPw ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={pw.confirm}
                        onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-4">
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
                    >
                      {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {showPw ? 'Hide' : 'Show'} passwords
                    </button>
                    <button
                      onClick={handleChangePassword}
                      disabled={savingPw || !pw.next}
                      className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold px-5 py-2 rounded-lg text-xs transition"
                    >
                      {savingPw ? 'Updating...' : 'Update password'}
                    </button>
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Add / edit product */}
      {editor && supplier && (
        <SupplierProductEditor
          supplierId={supplier.id}
          mode={editor.mode}
          target={editor.mode === 'edit' ? editor.target : undefined}
          listedProductIds={catalogRows.map((r) => r.p.id)}
          onClose={() => setEditor(null)}
          onSaved={(message) => {
            setEditor(null);
            fetchCatalog(supplier.id);
            showToast(message);
          }}
        />
      )}

      {/* Remove product dialog */}
      {removeTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setRemoveTarget(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-white">Remove {removeTarget.p.name}?</h2>
            <p className="text-xs text-slate-400 mt-1.5">
              Buyers will no longer be able to get quotes for this product from you. To pause it instead, use
              &quot;Mark out of stock&quot;.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setRemoveTarget(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
              >
                Keep product
              </button>
              <button
                onClick={confirmRemove}
                disabled={busyId === removeTarget.item.id}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white transition"
              >
                Remove product
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Decline dialog */}
      {declineTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setDeclineTarget(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-white">Decline {declineTarget.po_number}?</h2>
                <p className="text-xs text-slate-400 mt-1">
                  The buyer will be notified. Your reason is shared with our procurement team.
                </p>
              </div>
              <button
                onClick={() => setDeclineTarget(null)}
                aria-label="Close"
                className="text-slate-500 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <label htmlFor="decline-reason" className="block text-xs text-slate-300 mt-4 mb-1.5">
              Reason (optional)
            </label>
            <textarea
              id="decline-reason"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              rows={3}
              placeholder="For example: out of stock, cannot meet the delivery date"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setDeclineTarget(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
              >
                Keep order
              </button>
              <button
                onClick={confirmDecline}
                disabled={busyId === declineTarget.id}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white transition"
              >
                Decline order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg text-xs font-medium border shadow-lg ${toast.tone === 'ok'
            ? 'bg-slate-900 border-emerald-500/40 text-emerald-300'
            : 'bg-slate-900 border-red-500/40 text-red-300'
            }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}