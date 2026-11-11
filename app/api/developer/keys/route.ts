// app/api/developer/keys/route.ts
// Key management for the logged-in buyer (called by the /developer page with their Supabase session token).
//   GET     list keys (never returns the secret)
//   POST    create a key  -> the full key is returned ONCE in this response
//   DELETE  ?id=<uuid>    revoke a key

import { NextResponse } from 'next/server';
import { ALL_SCOPES, adminClient, apiError, generateKey, isUuid, type Scope } from '../../../lib/apiServer';

export const dynamic = 'force-dynamic';

const MAX_ACTIVE_KEYS = 5;

async function currentBuyerId(req: Request): Promise<string | null> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const db = adminClient();
  const { data } = await db.auth.getUser(token);
  if (!data.user) return null;
  const { data: buyer } = await db.from('buyers').select('id').eq('id', data.user.id).maybeSingle();
  return buyer?.id ?? null;
}

export async function GET(req: Request) {
  const buyerId = await currentBuyerId(req);
  if (!buyerId) return apiError(401, 'unauthorized', 'Sign in to manage API keys.');

  const db = adminClient();
  const { data: keys, error } = await db
    .from('api_keys')
    .select('id, name, key_prefix, scopes, created_at, last_used_at, revoked_at')
    .eq('buyer_id', buyerId)
    .order('created_at', { ascending: false });
  if (error) return apiError(500, 'server_error', 'Could not load keys.');

  // Calls in the last 24h per key (best effort).
  const counts: Record<string, number> = {};
  try {
    const ids = (keys || []).map((k) => k.id);
    if (ids.length) {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: logs } = await db
        .from('api_request_logs')
        .select('api_key_id')
        .in('api_key_id', ids)
        .gte('created_at', since)
        .limit(5000);
      (logs || []).forEach((l: any) => (counts[l.api_key_id] = (counts[l.api_key_id] || 0) + 1));
    }
  } catch {
    /* ignore */
  }

  return NextResponse.json({ data: (keys || []).map((k) => ({ ...k, requests_24h: counts[k.id] || 0 })) });
}

export async function POST(req: Request) {
  const buyerId = await currentBuyerId(req);
  if (!buyerId) return apiError(401, 'unauthorized', 'Sign in to manage API keys.');

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const scopes = Array.isArray(body?.scopes) ? (body.scopes as string[]).filter((s): s is Scope => ALL_SCOPES.includes(s as Scope)) : [];

  if (name.length < 2 || name.length > 60) return apiError(400, 'invalid_request', 'Give the key a name (2-60 chars).');
  if (scopes.length === 0) return apiError(400, 'invalid_request', 'Pick at least one scope.');

  const db = adminClient();
  const { count } = await db
    .from('api_keys')
    .select('*', { count: 'exact', head: true })
    .eq('buyer_id', buyerId)
    .is('revoked_at', null);
  if ((count || 0) >= MAX_ACTIVE_KEYS) return apiError(400, 'limit_reached', `You can have at most ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`);

  const { raw, prefix, hash } = generateKey();
  const { data, error } = await db
    .from('api_keys')
    .insert({ buyer_id: buyerId, name, key_prefix: prefix, key_hash: hash, scopes })
    .select('id, name, key_prefix, scopes, created_at')
    .single();
  if (error) return apiError(500, 'server_error', 'Could not create key. Did you run supabase/api_keys.sql?');

  return NextResponse.json({ ...data, key: raw }, { status: 201 });
}

export async function DELETE(req: Request) {
  const buyerId = await currentBuyerId(req);
  if (!buyerId) return apiError(401, 'unauthorized', 'Sign in to manage API keys.');

  const id = new URL(req.url).searchParams.get('id') || '';
  if (!isUuid(id)) return apiError(400, 'invalid_request', 'Invalid key id.');

  const { error } = await adminClient()
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('buyer_id', buyerId);
  if (error) return apiError(500, 'server_error', 'Could not revoke key.');
  return NextResponse.json({ ok: true });
}
