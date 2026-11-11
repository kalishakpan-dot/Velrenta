// app/api/admin/broadcasts/route.ts
// Admin-only. Sends a notification to many users at once, lists past sends,
// and can unsend one. Every call re-checks the admins table.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

/* ── Edit this block if your notifications table uses different column names ── */
const NOTIFICATIONS_TABLE = 'notifications';
const COL = {
  user: 'user_id',
  title: 'title',
  body: 'message',
  type: 'type',
  link: 'link',
  read: 'read',
};
const typeFor = (kind: string) => `broadcast_${kind}`; // e.g. broadcast_news, so the bell can pick an icon
/* ────────────────────────────────────────────────────────────────────────────── */

const KINDS = ['news', 'announcement', 'alert', 'offer'];
const AUDIENCES = ['buyers', 'suppliers', 'all'];

async function requireAdmin(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  const user = data?.user;
  if (!user) return null;
  const { data: row } = await db.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  return row ? user : null;
}

// Who should receive it. Buyers: buyers.id is the auth user id. Suppliers: suppliers.user_id.
async function recipients(audience: string, verifiedOnly: boolean): Promise<string[]> {
  const ids = new Set<string>();

  if (audience === 'buyers' || audience === 'all') {
    let q = db.from('buyers').select('id, verification_status');
    if (verifiedOnly) q = q.eq('verification_status', 'verified');
    const { data, error } = await q;
    if (error) throw error;
    (data || []).forEach((r: { id: string }) => r.id && ids.add(r.id));
  }

  if (audience === 'suppliers' || audience === 'all') {
    let q = db.from('suppliers').select('user_id, verification_status').not('user_id', 'is', null);
    if (verifiedOnly) q = q.eq('verification_status', 'verified');
    const { data, error } = await q;
    if (error) throw error;
    (data || []).forEach((r: { user_id: string | null }) => r.user_id && ids.add(r.user_id));
  }

  return [...ids];
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });

  const url = new URL(req.url);

  // ?count=1&audience=buyers&verified_only=1 → how many people would get it
  if (url.searchParams.get('count')) {
    const audience = url.searchParams.get('audience') || 'all';
    if (!AUDIENCES.includes(audience)) return NextResponse.json({ error: 'Bad audience' }, { status: 400 });
    try {
      const list = await recipients(audience, url.searchParams.get('verified_only') === '1');
      return NextResponse.json({ count: list.length });
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: 'Could not count recipients' }, { status: 500 });
    }
  }

  const { data, error } = await db.from('broadcasts').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) {
    // Table missing → tell the UI to show the setup hint
    return NextResponse.json({ broadcasts: [], ready: false });
  }
  return NextResponse.json({ broadcasts: data || [], ready: true });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const title = String(b.title || '').trim().slice(0, 80);
  const body = String(b.body || '').trim().slice(0, 500);
  const kind = KINDS.includes(b.kind) ? b.kind : 'announcement';
  const audience = AUDIENCES.includes(b.audience) ? b.audience : null;
  const verifiedOnly = !!b.verified_only;
  const link = String(b.link || '').trim().slice(0, 300) || null;

  if (!title) return NextResponse.json({ error: 'Add a title.' }, { status: 400 });
  if (!body) return NextResponse.json({ error: 'Write the message.' }, { status: 400 });
  if (!audience) return NextResponse.json({ error: 'Choose who should receive it.' }, { status: 400 });
  if (link && !/^(https?:\/\/|\/)/i.test(link))
    return NextResponse.json({ error: 'The link must start with https:// or /' }, { status: 400 });

  let ids: string[];
  try {
    ids = await recipients(audience, verifiedOnly);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Could not find recipients.' }, { status: 500 });
  }
  if (ids.length === 0) return NextResponse.json({ error: 'No one matches that audience yet.' }, { status: 400 });

  const { data: bc, error: bcErr } = await db
    .from('broadcasts')
    .insert({ title, body, kind, audience, verified_only: verifiedOnly, link, recipient_count: ids.length, created_by: admin.id })
    .select()
    .single();
  if (bcErr || !bc) {
    console.error(bcErr);
    return NextResponse.json({ error: 'Run admin-broadcasts.sql first, then try again.' }, { status: 500 });
  }

  // Fan out in chunks so a big audience never hits a request size limit
  for (let i = 0; i < ids.length; i += 500) {
    const rows = ids.slice(i, i + 500).map((uid) => ({
      [COL.user]: uid,
      [COL.title]: title,
      [COL.body]: body,
      [COL.type]: typeFor(kind),
      [COL.link]: link,
      [COL.read]: false,
      broadcast_id: bc.id,
    }));
    const { error } = await db.from(NOTIFICATIONS_TABLE).insert(rows);
    if (error) {
      console.error('Broadcast fan-out failed:', error);
      await db.from('broadcasts').delete().eq('id', bc.id); // cascades the notifications already written
      return NextResponse.json(
        { error: `Sending failed (${error.message}). Check the column names at the top of this route.` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true, broadcast: bc, sent: ids.length });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await db.from(NOTIFICATIONS_TABLE).delete().eq('broadcast_id', id);
  const { error } = await db.from('broadcasts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Could not unsend.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}