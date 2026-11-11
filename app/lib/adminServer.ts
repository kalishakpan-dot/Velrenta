// app/lib/adminServer.ts
// SERVER ONLY. Never import this from a 'use client' file.
// Uses the service-role key, which bypasses Row Level Security.

import { createClient } from '@supabase/supabase-js';

export const adminDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export interface AdminUser {
  id: string;
  email: string | null;
}

// Reads the signed-in user's token from the request, then checks the admins table.
// Returns null when the caller is not a signed-in admin.
export async function requireAdmin(req: Request): Promise<AdminUser | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const { data, error } = await adminDb.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: row } = await adminDb
    .from('admins')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle();

  return row ? { id: data.user.id, email: data.user.email ?? null } : null;
}

export async function isAdminUser(userId: string): Promise<boolean> {
  const { data } = await adminDb.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
  return !!data;
}