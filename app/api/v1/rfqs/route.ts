// app/api/v1/rfqs/route.ts
// GET  /api/v1/rfqs   list this key owner's RFQs
// POST /api/v1/rfqs   ask the Velrenta agent to source quotes (goes through your existing n8n flow)

import { NextResponse } from 'next/server';
import { adminClient, apiError, authenticate, parseLimit } from '../../../lib/apiServer';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await authenticate(req, 'rfqs:read');
  if (!auth.ok) return auth.res;

  const status = new URL(req.url).searchParams.get('status');
  let q = adminClient()
    .from('rfqs')
    .select('rfq_id, title, description, delivery_location, delivery_deadline, budget, currency, status, created_at')
    .eq('buyer_id', auth.buyerId)
    .order('created_at', { ascending: false })
    .limit(parseLimit(req));
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return apiError(500, 'server_error', 'Could not load RFQs.');
  return NextResponse.json({ object: 'list', data });
}

export async function POST(req: Request) {
  const auth = await authenticate(req, 'rfqs:write');
  if (!auth.ok) return auth.res;

  const body = await req.json().catch(() => null);
  const product = typeof body?.product === 'string' ? body.product.trim() : '';
  const location = typeof body?.delivery_location === 'string' ? body.delivery_location.trim() : '';
  const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
  const quantity = Number(body?.quantity);

  if (product.length < 2 || product.length > 200) return apiError(400, 'invalid_request', '"product" is required (2-200 chars).');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000_000) return apiError(400, 'invalid_request', '"quantity" must be a positive integer.');
  if (location.length < 2 || location.length > 100) return apiError(400, 'invalid_request', '"delivery_location" is required.');
  if (notes.length > 500) return apiError(400, 'invalid_request', '"notes" must be 500 chars or fewer.');

  const webhook = process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL;
  if (!webhook) return apiError(503, 'unavailable', 'Procurement engine is not configured.');

  const { data: buyer } = await adminClient().from('buyers').select('phone').eq('id', auth.buyerId).maybeSingle();
  const phone = buyer?.phone || '2348145340003';
  const text = `I need ${quantity} ${product} in ${location}${notes ? `. ${notes}` : ''}`;

  // Same payload the dashboard chat sends, so the existing agent handles it unchanged.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        phone,
        buyer_id: auth.buyerId,
        message: text,
        text,
        sender: 'web_chat',
        entry: [{ changes: [{ value: { messages: [{ text: { body: text }, from: phone }] } }] }],
      }),
    });
    if (!r.ok) return apiError(502, 'engine_error', 'Procurement engine rejected the request.');
  } catch (e: any) {
    // A slow agent is not a failure: the request was delivered, it is just still working.
    if (e?.name !== 'AbortError') return apiError(502, 'engine_unreachable', 'Could not reach the procurement engine.');
  } finally {
    clearTimeout(timer);
  }

  return NextResponse.json(
    {
      object: 'rfq_request',
      status: 'processing',
      message: 'Request accepted. Poll GET /api/v1/rfqs to see the RFQ once suppliers are being contacted.',
      request: { product, quantity, delivery_location: location },
    },
    { status: 202 }
  );
}
