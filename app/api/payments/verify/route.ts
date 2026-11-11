import { NextResponse } from 'next/server';
import { getAdmin } from '../../../lib/supabaseAdmin';
import { getTransactionStatus } from '../../../lib/monnify';
import { settlePayment } from '../../../lib/payments';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Asks Monnify directly whether a buyer's pending payments have gone through.
// Backup for the webhook (and the only option while developing on localhost).
export async function POST(req: Request) {
  try {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    const admin = getAdmin();
    const { data: auth } = await admin.auth.getUser(token);
    if (!auth?.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    const { po_id } = await req.json();
    if (!po_id) return NextResponse.json({ error: 'po_id is required' }, { status: 400 });

    const { data: pending } = await admin
      .from('payments')
      .select('id, po_id, stage, amount, monnify_transaction_reference')
      .eq('po_id', po_id)
      .eq('buyer_id', auth.user.id)
      .eq('status', 'pending');

    let paid = 0;
    for (const p of pending || []) {
      if (!p.monnify_transaction_reference) continue;
      try {
        const s = await getTransactionStatus(p.monnify_transaction_reference);
        if (s.paymentStatus === 'PAID' || s.paymentStatus === 'OVERPAID') {
          const r = await settlePayment(p, {
            amountPaid: Number(s.amountPaid ?? s.totalPayable ?? s.amount),
            paidOn: s.paidOn,
            raw: s,
          });
          if (r.settled) paid++;
        } else if (['EXPIRED', 'FAILED', 'CANCELLED'].includes(s.paymentStatus)) {
          await admin
            .from('payments')
            .update({ status: s.paymentStatus === 'EXPIRED' ? 'expired' : 'failed' })
            .eq('id', p.id);
        }
      } catch (e) {
        console.warn('Status check failed for', p.id, e);
      }
    }
    return NextResponse.json({ paid });
  } catch (e) {
    console.error('payments/verify error:', e);
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}