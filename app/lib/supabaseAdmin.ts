// Server-only. Never import this from a 'use client' file.
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let admin: SupabaseClient | null = null;

export function getAdmin(): SupabaseClient {
  if (!admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return admin;
}