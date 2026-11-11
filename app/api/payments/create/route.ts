import { NextResponse } from 'next/server';
import { getAdmin } from '../../../lib/supabaseAdmin';
import { nextPayment } from '../../../lib/paymentPlan';
import { initTransaction, initBankTransfer } from '../../../lib/monnify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REUSE_WINDOW_MS = 30 * 60 * 1000;
const PUBLIC_FIELDS =
  'id, po_id, stage, amount, status, checkout_url, bank_name, account_number, account_name, created_at';

// TEMP: set to a number (e.g. 1000) to test small amounts in sandbox. Set to null for real amounts.
// const TEST_AMOUNT: number | null = 1000;
   const TEST_AMOUNT: number | null = null;


export async function POST(req: Request) {
  try {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    const admin = getAdmin();
    const { data: auth, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !auth?.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    const user = auth.user;

    const { po_id } = await req.json();
    if (!po_id) return NextResponse.json({ error: 'po_id is required' }, { status: 400 });

    const { data: po } = await admin
      .from('purchase_orders')
      .select('id, po_number, buyer_id, supplier_id, supplier_status, total_amount, payment_terms, payment_status')
      .eq('id', po_id)
      .maybeSingle();

    if (!po || po.buyer_id !== user.id) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (po.supplier_status !== 'accepted') {
      return NextResponse.json({ error: 'The supplier has not accepted this order yet.' }, { status: 409 });
    }

    const due = nextPayment(po);
    if (!due) return NextResponse.json({ error: 'Nothing left to pay on this order.' }, { status: 409 });

    // Reuse a recent unpaid attempt for the same stage instead of creating duplicates.
    const since = new Date(Date.now() - REUSE_WINDOW_MS).toISOString();
    const { data: existing } = await admin
      .from('payments')
      .select(PUBLIC_FIELDS)
      .eq('po_id', po.id)
      .eq('stage', due.stage)
      .eq('status', 'pending')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1);
    if (existing && existing.length > 0) return NextResponse.json({ payment: existing[0] });

    const { data: buyer } = await admin.from('buyers').select('contact_name, email').eq('id', user.id).maybeSingle();

    const ref = `VLR-${String(po.po_number).replace(/[^A-Za-z0-9-]/g, '')}-${due.stage}-${Date.now().toString(36)}`;

    // In test mode, store the test amount too so it matches what Monnify will report.
    const chargeAmount = TEST_AMOUNT ?? due.amount;

    // Insert first so the webhook can always find the row.
    const { data: row, error: insErr } = await admin
      .from('payments')
      .insert({
        po_id: po.id,
        buyer_id: po.buyer_id,
        supplier_id: po.supplier_id,
        stage: due.stage,
        amount: chargeAmount,
        payment_reference: ref,
      })
      .select('id')
      .single();
    if (insErr || !row) {
      console.error('Payment insert error:', insErr);
      return NextResponse.json({ error: 'Could not start the payment.' }, { status: 500 });
    }

    try {
      // Use your public tunnel URL (https), not localhost.
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
      const init = await initTransaction({
        amount: chargeAmount,
        customerName: buyer?.contact_name || user.email?.split('@')[0] || 'Velrenta buyer',
        customerEmail: buyer?.email || user.email || '',
        paymentReference: ref,
        paymentDescription: `${po.po_number} - ${due.stage} payment`,
        redirectUrl: `${appUrl}/pos?paid=${encodeURIComponent(ref)}`,
        metaData: { po_id: po.id, stage: due.stage },
      });

      // Bank-transfer details are a bonus: if this call fails the checkout link still works.
      let bank: any = null;
      try {
        bank = await initBankTransfer(init.transactionReference);
      } catch (e) {
        console.warn('Bank transfer init failed (checkout link still usable):', e);
      }

      await admin
        .from('payments')
        .update({
          monnify_transaction_reference: init.transactionReference,
          checkout_url: init.checkoutUrl,
          bank_name: bank?.bankName ?? null,
          account_number: bank?.accountNumber ?? null,
          account_name: bank?.accountName ?? null,
        })
        .eq('id', row.id);
    } catch (e: any) {
      console.error('Monnify init error:', e);
      await admin.from('payments').update({ status: 'failed' }).eq('id', row.id);
      // In local development, show the real reason in the browser. In production, keep it generic.
      const detail = process.env.NODE_ENV !== 'production' ? ` (${e?.message || e})` : '';
      return NextResponse.json(
        { error: `Could not reach the payment provider.${detail}` },
        { status: 502 }
      );
    }

    const { data: payment } = await admin.from('payments').select(PUBLIC_FIELDS).eq('id', row.id).single();
    return NextResponse.json({ payment });
  } catch (e) {
    console.error('payments/create error:', e);
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}