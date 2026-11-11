'use client';

// Buyer-side payment box. Drop it inside each purchase-order card on app/pos/page.tsx:
//   <PaymentPanel po={po} onPaid={loadOrders} />
// `po` must include: id, supplier_status, total_amount, payment_terms, payment_status.
// `onPaid` should re-fetch your purchase orders so po.payment_status updates.

import { useCallback, useEffect, useState } from 'react';
import { CreditCard, Copy, RefreshCw, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { nextPayment, paymentSchedule } from '../lib/paymentPlan';

interface Props {
  po: {
    id: string;
    supplier_status?: string | null;
    total_amount: number | null;
    payment_terms?: string | null;
    payment_status?: string | null;
  };
  onPaid?: () => void;
  embedded?: boolean; // true = no top margin/border (already inside a card)
}

interface PaymentRow {
  id: string;
  stage: string;
  amount: number;
  checkout_url: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
}

const naira = (n: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(n);

export default function PaymentPanel({ po, onPaid, embedded }: Props) {
  const wrap = embedded ? '' : 'mt-4 pt-4 border-t border-slate-800';
  const [payment, setPayment] = useState<PaymentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const due = nextPayment(po);
  const sc = paymentSchedule(po);
  const status = po.payment_status || 'unpaid';

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token;

  const loadPending = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('payments')
      .select('id, stage, amount, checkout_url, bank_name, account_number, account_name')
      .eq('po_id', po.id)
      .eq('status', 'pending')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1);
    setPayment(data && data.length > 0 ? (data[0] as PaymentRow) : null);
  }, [po.id]);

  // Reload whenever the PO's payment status changes (e.g. upfront just landed).
  useEffect(() => {
    loadPending();
  }, [loadPending, po.payment_status]);

  const paymentId = payment?.id;

  const checkNow = useCallback(async () => {
    if (!paymentId) return;
    setChecking(true);
    try {
      const t = await token();
      if (!t) return;

      // 1) Ask Monnify (via our server) and settle if it has been paid.
      await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ po_id: po.id }),
      }).catch(() => null);

      // 2) FIX: look at the row itself. If the webhook settled it first, verify finds nothing
      //    pending and returns paid = 0, which used to leave this panel stuck forever.
      const { data: row } = await supabase.from('payments').select('status').eq('id', paymentId).maybeSingle();
      if (row?.status === 'paid') {
        setPayment(null);
        if (onPaid) onPaid();
        else window.location.reload();
      } else if (row?.status === 'expired' || row?.status === 'failed') {
        setPayment(null);
        setError('That payment expired or failed. Please start it again.');
      }
    } finally {
      setChecking(false);
    }
  }, [paymentId, po.id, onPaid]);

  // While a payment is waiting, check every 8s as a backup to the webhook.
  useEffect(() => {
    if (!paymentId) return;
    const t = setInterval(checkNow, 8000);
    return () => clearInterval(t);
  }, [paymentId, checkNow]);

  const startPayment = async () => {
    setBusy(true);
    setError('');
    try {
      const t = await token();
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ po_id: po.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not start the payment.');
      setPayment(json.payment);
    } catch (e: any) {
      setError(e.message || 'Could not start the payment.');
    } finally {
      setBusy(false);
    }
  };

  const copyAccount = async () => {
    if (!payment?.account_number) return;
    try {
      await navigator.clipboard.writeText(payment.account_number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the number is still visible */
    }
  };

  if (po.supplier_status !== 'accepted') {
    return <p className={`text-xs text-slate-500 ${wrap}`}>Payment opens once the supplier accepts this order.</p>;
  }

  if (status === 'paid') {
    return (
      <p className={`flex items-center gap-1.5 text-xs text-emerald-400 ${wrap}`}>
        <CheckCircle2 className="w-3.5 h-3.5" /> Fully paid. Velrenta holds the funds until delivery is confirmed.
      </p>
    );
  }

  return (
    <div className={`space-y-3 ${wrap}`}>
      {sc.pct > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="flex items-center justify-between rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
            <span className="text-slate-400">Upfront ({sc.pct}%)</span>
            <span className={status === 'deposit_paid' ? 'text-emerald-400' : 'text-slate-300'}>
              {naira(sc.upfront)} · {status === 'deposit_paid' ? 'Paid' : 'Due'}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
            <span className="text-slate-400">Balance ({100 - sc.pct}%)</span>
            <span className="text-slate-300">{naira(sc.balance)} · {status === 'deposit_paid' ? 'Due' : 'After upfront'}</span>
          </div>
        </div>
      )}

      {!payment && due && (
        <button
          onClick={startPayment}
          disabled={busy}
          className="flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold px-4 py-2 rounded-lg text-xs transition"
        >
          <CreditCard className="w-3.5 h-3.5" /> {busy ? 'Preparing...' : `${due.label} · ${naira(due.amount)}`}
        </button>
      )}

      {payment && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3.5 space-y-3">
          <p className="text-xs text-slate-300">
            Pay <span className="font-bold text-white">{naira(Number(payment.amount))}</span> by bank transfer or card.
            This page updates by itself when the payment arrives.
          </p>

          {payment.account_number && (
            <div className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2.5">
              <p className="text-[11px] text-slate-500">Transfer exactly this amount to</p>
              <div className="flex items-center justify-between gap-3 mt-1">
                <p className="font-mono text-lg tracking-widest text-white">{payment.account_number}</p>
                <button
                  onClick={copyAccount}
                  className="flex items-center gap-1 text-[11px] font-semibold text-slate-300 border border-slate-700 hover:border-slate-500 rounded-md px-2 py-1 transition"
                >
                  <Copy className="w-3 h-3" /> {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {payment.bank_name} · {payment.account_name}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {payment.checkout_url && (
              <a
                href={payment.checkout_url}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-xs transition"
              >
                Pay with card or transfer
              </a>
            )}
            <button
              onClick={checkNow}
              disabled={checking}
              className="flex items-center gap-1.5 text-xs font-semibold border border-slate-700 hover:border-slate-500 text-slate-300 rounded-lg px-3 py-2 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} /> I've paid, check status
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}