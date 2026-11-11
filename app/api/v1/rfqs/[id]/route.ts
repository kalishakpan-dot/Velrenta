// app/api/v1/rfqs/[id]/route.ts
// GET /api/v1/rfqs/:id

import { NextResponse } from 'next/server';
import { adminClient, apiError, authenticate, isUuid } from '../../../../lib/apiServer';

export const dynamic = 'force-dynamic';

// `params` is a Promise in newer Next versions and a plain object in older ones; await handles both.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const auth = await authenticate(req, 'rfqs:read');
  if (!auth.ok) return auth.res;

  const { id } = await ctx.params;
  if (!isUuid(id)) return apiError(400, 'invalid_request', 'Invalid RFQ id.');

  const { data, error } = await adminClient()
    .from('rfqs')
    .select('rfq_id, title, description, delivery_location, delivery_deadline, budget, currency, status, created_at, updated_at')
    .eq('rfq_id', id)
    .eq('buyer_id', auth.buyerId) // ownership check: a key can only ever see its own buyer's data
    .maybeSingle();

  if (error) return apiError(500, 'server_error', 'Could not load RFQ.');
  if (!data) return apiError(404, 'not_found', 'RFQ not found.');
  return NextResponse.json({ object: 'rfq', ...data });
}
