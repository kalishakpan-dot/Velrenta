import { NextResponse } from 'next/server';
import { getAdmin } from '../../../lib/supabaseAdmin';
import { verifyWebhookSignature } from '../../../lib/monnify';
import { settlePayment } from '../../../lib/payments';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  // Signature must be checked against the RAW body, before any JSON parsing.
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get('monnify-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Bad payload' }, { status: 400 });
  }

  // We only act on successful payments; acknowledge everything else.
  if (event?.eventType !== 'SUCCESSFUL_TRANSACTION') return NextResponse.json({ ok: true });

  const d = event.eventData || {};
  if (d.paymentStatus && d.paymentStatus !== 'PAID') return NextResponse.json({ ok: true });

  try {
    const admin = getAdmin();
    let { data: payment } = await admin
      .from('payments')
      .select('id, po_id, stage, amount')
      .eq('payment_reference', d.paymentReference)
      .maybeSingle();

    if (!payment && d.transactionReference) {
      ({ data: payment } = await admin
        .from('payments')
        .select('id, po_id, stage, amount')
        .eq('monnify_transaction_reference', d.transactionReference)
        .maybeSingle());
    }

    if (!payment) {
      // Not one of ours (or created elsewhere). Ack so Monnify stops retrying.
      console.warn('Webhook for unknown payment:', d.paymentReference);
      return NextResponse.json({ ok: true });
    }

    await settlePayment(payment, {
      amountPaid: Number(d.amountPaid ?? d.totalPayable),
      paidOn: d.paidOn,
      raw: event,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Webhook processing error:', e);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 }); // Monnify will retry
  }
}