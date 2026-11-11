// app/lib/apiServer.ts
// Server-only helpers for the public API (/api/v1) and key management. Never import this in a client component.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';
import { NextResponse } from 'next/server';

export type Scope = 'rfqs:read' | 'rfqs:write' | 'orders:read';
export const ALL_SCOPES: Scope[] = ['rfqs:read', 'rfqs:write', 'orders:read'];

let _admin: SupabaseClient | null = null;

/** Service-role client (bypasses RLS). Created lazily so a missing env var never breaks `next build`. */
export function adminClient(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  _admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

export function apiError(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export function generateKey() {
  const raw = 'vk_live_' + randomBytes(24).toString('base64url');
  return { raw, prefix: raw.slice(0, 12), hash: hashKey(raw) };
}

// Simple per-key limiter (60 req/min). In-memory: fine for one server / dev.
// On serverless with many instances, swap for Upstash/Redis later.
const RATE_LIMIT = 60;
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; reset: number }>();

function checkRate(keyId: string): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(keyId);
  if (!b || now > b.reset) {
    buckets.set(keyId, { count: 1, reset: now + WINDOW_MS });
    return { ok: true, retryAfter: 0 };
  }
  b.count += 1;
  return b.count > RATE_LIMIT
    ? { ok: false, retryAfter: Math.ceil((b.reset - now) / 1000) }
    : { ok: true, retryAfter: 0 };
}

type AuthResult =
  | { ok: true; buyerId: string; keyId: string }
  | { ok: false; res: NextResponse };

/** Validates `Authorization: Bearer vk_live_...`, checks scope + rate limit, records usage. */
export async function authenticate(req: Request, scope: Scope): Promise<AuthResult> {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(vk_live_[A-Za-z0-9_-]+)$/);
  if (!match) {
    return { ok: false, res: apiError(401, 'missing_api_key', 'Send your key as: Authorization: Bearer vk_live_...') };
  }

  const db = adminClient();
  const { data: key, error } = await db
    .from('api_keys')
    .select('id, buyer_id, scopes, revoked_at')
    .eq('key_hash', hashKey(match[1]))
    .maybeSingle();

  if (error) return { ok: false, res: apiError(500, 'server_error', 'Could not verify API key.') };
  if (!key || key.revoked_at) return { ok: false, res: apiError(401, 'invalid_api_key', 'API key is invalid or revoked.') };
  if (!(key.scopes as string[]).includes(scope)) {
    return { ok: false, res: apiError(403, 'insufficient_scope', `This key does not have the "${scope}" scope.`) };
  }

  const rate = checkRate(key.id);
  if (!rate.ok) {
    return {
      ok: false,
      res: apiError(429, 'rate_limited', `Too many requests. Retry in ${rate.retryAfter}s.`, {
        'Retry-After': String(rate.retryAfter),
      }),
    };
  }

  // Usage tracking must never fail a request.
  try {
    const path = new URL(req.url).pathname;
    await Promise.all([
      db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', key.id),
      db.from('api_request_logs').insert({ api_key_id: key.id, method: req.method, path }),
    ]);
  } catch {
    /* ignore */
  }

  return { ok: true, buyerId: key.buyer_id as string, keyId: key.id as string };
}

export const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function parseLimit(req: Request): number {
  const raw = parseInt(new URL(req.url).searchParams.get('limit') || '20', 10);
  return Math.min(Math.max(Number.isFinite(raw) ? raw : 20, 1), 100);
}
