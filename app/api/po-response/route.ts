// app/api/po-response/route.ts
// Called by the supplier dashboard when a supplier clicks Accept / Decline.
// 1. Verifies the caller is a signed-in supplier who owns this PO
// 2. Hands the decision to n8n, which updates the PO + quote and
//    WhatsApps the buyer (same flow the WhatsApp buttons use).
//
// Required in .env.local (restart `next dev` after any change):
//   NEXT_PUBLIC_SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...        (Supabase > Settings > API Keys > Secret key)
//   N8N_PO_STATUS_WEBHOOK_URL=...        (Workflow B's PRODUCTION webhook URL)

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const n8nUrl =
    process.env.N8N_PO_STATUS_WEBHOOK_URL || process.env.NEXT_PUBLIC_N8N_PO_STATUS_WEBHOOK_URL;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server is missing Supabase credentials.' }, { status: 500 });
  }
  if (!n8nUrl) {
    return NextResponse.json({ error: 'N8N_PO_STATUS_WEBHOOK_URL is not set.' }, { status: 500 });
  }

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: 'Session expired. Sign in again.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const poId: string | undefined = body?.po_id;
  const action: string | undefined = body?.action;
  const declineReason: string | null = body?.decline_reason || null;

  if (!poId || (action !== 'accepted' && action !== 'declined')) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const { data: supplier } = await admin
    .from('suppliers')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!supplier) return NextResponse.json({ error: 'Not a supplier account.' }, { status: 403 });

  const { data: po } = await admin
    .from('purchase_orders')
    .select('id, supplier_status')
    .eq('id', poId)
    .eq('supplier_id', supplier.id)
    .maybeSingle();
  if (!po) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  if (po.supplier_status && po.supplier_status !== 'pending') {
    return NextResponse.json({ error: `This order was already ${po.supplier_status}.` }, { status: 409 });
  }

  try {
    const res = await fetch(n8nUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({ po_id: poId, action, decline_reason: declineReason, source: 'supplier_dashboard' }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Automation returned ${res.status}. Is the n8n workflow published?` },
        { status: 502 }
      );
    }
  } catch (err) {
    console.error('n8n webhook error:', err);
    return NextResponse.json({ error: 'Could not reach the automation server.' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}