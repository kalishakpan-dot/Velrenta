// Shared by the server routes and the UI, so both always agree on what is due.

export type PayStage = 'upfront' | 'balance' | 'full';

export interface PlanInput {
  total_amount: number | null;
  payment_terms?: string | null;
  payment_status?: string | null;
}

// "30% upfront, 70% on delivery" -> 30.  "Net 30 days" -> 0 (pay in full).
export const upfrontPct = (terms?: string | null) => {
  const m = terms?.match(/(\d{1,2})\s*%\s*(?:up\s*-?\s*front|deposit|advance)/i);
  const n = m ? parseInt(m[1], 10) : 0;
  return n > 0 && n < 100 ? n : 0;
};

export function paymentSchedule(po: PlanInput) {
  const total = Number(po.total_amount || 0);
  const pct = upfrontPct(po.payment_terms);
  const upfront = Math.round((total * pct) / 100);
  return { total, pct, upfront, balance: total - upfront };
}

export function nextPayment(po: PlanInput): { stage: PayStage; amount: number; label: string } | null {
  const status = po.payment_status || 'unpaid';
  if (status === 'paid') return null;
  const s = paymentSchedule(po);
  if (s.total <= 0) return null;
  if (s.pct > 0) {
    if (status === 'deposit_paid') return { stage: 'balance', amount: s.balance, label: `Pay balance (${100 - s.pct}%)` };
    return { stage: 'upfront', amount: s.upfront, label: `Pay upfront (${s.pct}%)` };
  }
  return { stage: 'full', amount: s.total, label: 'Pay in full' };
}