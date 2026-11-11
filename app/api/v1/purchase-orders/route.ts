// app/api/v1/purchase-orders/route.ts
// GET /api/v1/purchase-orders   list this key owner's purchase orders (read-only)

import { NextResponse } from 'next/server';
import { adminClient, apiError, authenticate, parseLimit } from '../../../lib/apiServer';

export const dynamic = 'force-dynamic';

const PO_FIELDS =
  'id, po_number, total_amount, status, supplier_status, payment_status, payment_terms, order_description, delivery_location, created_at, paid_at, dispatched_at, delivery_confirmed_at';

export async function GET(req: Request) {
  const auth = await authenticate(req, 'orders:read');
  if (!auth.ok) return auth.res;

  const status = new URL(req.url).searchParams.get('status');
  let q = adminClient()
    .from('purchase_orders')
    .select(PO_FIELDS)
    .eq('buyer_id', auth.buyerId)
    .order('created_at', { ascending: false })
    .limit(parseLimit(req));
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return apiError(500, 'server_error', 'Could not load purchase orders.');
  return NextResponse.json({ object: 'list', data });
}
