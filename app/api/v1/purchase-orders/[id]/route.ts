// app/api/v1/purchase-orders/[id]/route.ts
// GET /api/v1/purchase-orders/:id

import { NextResponse } from 'next/server';
import { adminClient, apiError, authenticate, isUuid } from '../../../../lib/apiServer';

export const dynamic = 'force-dynamic';

const PO_FIELDS =
  'id, po_number, total_amount, status, supplier_status, payment_status, payment_terms, order_description, delivery_location, created_at, paid_at, dispatched_at, delivery_confirmed_at';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const auth = await authenticate(req, 'orders:read');
  if (!auth.ok) return auth.res;

  const { id } = await ctx.params;
  if (!isUuid(id)) return apiError(400, 'invalid_request', 'Invalid purchase order id.');

  const { data, error } = await adminClient()
    .from('purchase_orders')
    .select(PO_FIELDS)
    .eq('id', id)
    .eq('buyer_id', auth.buyerId)
    .maybeSingle();

  if (error) return apiError(500, 'server_error', 'Could not load purchase order.');
  if (!data) return apiError(404, 'not_found', 'Purchase order not found.');
  return NextResponse.json({ object: 'purchase_order', ...data });
}
