// Server-only. The one place a payment is marked as paid.
import { getAdmin } from './supabaseAdmin';

const RANK: Record<string, number> = { unpaid: 0, deposit_paid: 1, paid: 2 };

const safeIso = (v?: string) => {
  const d = v ? new Date(v.replace(' ', 'T')) : null;
  return d && !isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
};

export async function settlePayment(
  payment: { id: string; po_id: string; stage: string; amount: number | string },
  info: { amountPaid: number; paidOn?: string; raw?: unknown }
): Promise<{ settled: boolean; reason?: string }> {
  const admin = getAdmin();

  // FIX: a NaN amount used to slip past the old check (NaN < x is false) and mark the payment as paid.
  if (!Number.isFinite(info.amountPaid)) {
    console.error('Payment has no usable amountPaid, left pending:', payment.id);
    return { settled: false, reason: 'bad_amount' };
  }
  if (info.amountPaid + 0.005 < Number(payment.amount)) {
    console.error('Underpaid payment, left pending:', payment.id, info.amountPaid, payment.amount);
    return { settled: false, reason: 'underpaid' };
  }

  // Idempotent claim: only the first caller flips pending -> paid. Duplicate webhooks do nothing here.
  const { error: claimErr } = await admin
    .from('payments')
    .update({
      status: 'paid',
      amount_paid: info.amountPaid,
      paid_at: safeIso(info.paidOn),
      raw: info.raw ?? null,
    })
    .eq('id', payment.id)
    .neq('status', 'paid');
  if (claimErr) throw claimErr;

  // Always make sure the PO reflects it (safe to repeat; status only ever moves forward).
  const target = payment.stage === 'upfront' ? 'deposit_paid' : 'paid';
  const { data: po, error: poReadErr } = await admin
    .from('purchase_orders')
    .select('payment_status')
    .eq('id', payment.po_id)
    .single();
  if (poReadErr) throw poReadErr;

  const current = po?.payment_status || 'unpaid';
  if ((RANK[target] ?? 0) > (RANK[current] ?? 0)) {
    const patch: Record<string, string> = { payment_status: target };
    if (target === 'paid') patch.paid_at = new Date().toISOString();
    const { error } = await admin.from('purchase_orders').update(patch).eq('id', payment.po_id);
    if (error) throw error;
  }
  return { settled: true };
}