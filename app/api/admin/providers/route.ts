// app/api/admin/providers/route.ts
// Admin: manage Sharp Sharp (My Plug) providers.
// List providers + services + requests + message threads, create a provider (login + profile + first service),
// edit, verify/suspend, reset password, manage services, cancel/release requests, message a provider, delete.

import { NextResponse } from 'next/server';
import { adminDb, requireAdmin } from '../../../lib/adminServer';

export const dynamic = 'force-dynamic';

const phoneNorm = (raw: unknown) => {
  const d = String(raw || '').replace(/\D/g, '');
  if (/^0\d{10}$/.test(d)) return `234${d.slice(1)}`;
  if (/^234\d{10}$/.test(d)) return d;
  return null;
};
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const numOrNull = (v: unknown) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const parseAreas = (v: unknown) =>
  Array.from(
    new Set((Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean))
  ).slice(0, 12);

const TYPES = ['individual', 'shop'];
const UNITS = ['job', 'hour', 'day', 'item'];
const SETUP_HINT = 'Run admin-providers-setup.sql in the Supabase SQL Editor first.';

// True if this login is also used elsewhere (supplier, rider, or buyer-side records).
async function loginInUse(uid: string) {
  for (const t of ['suppliers', 'riders']) {
    const { data } = await adminDb.from(t).select('id').eq('user_id', uid).limit(1);
    if (data?.length) return true;
  }
  for (const t of ['purchase_orders', 'rfqs', 'dispatch_errands', 'service_requests']) {
    const { count } = await adminDb.from(t).select('*', { count: 'exact', head: true }).eq('buyer_id', uid);
    if (count) return true;
  }
  return false;
}

export async function GET(req: Request) {
  if (!(await requireAdmin(req))) return bad('Not authorized', 401);
  const url = new URL(req.url);

  // One provider's message thread (also marks the provider's messages as read)
  const thread = url.searchParams.get('thread');
  if (thread) {
    const { data, error } = await adminDb
      .from('provider_admin_messages')
      .select('id, sender_role, body, created_at, read_at')
      .eq('provider_id', thread)
      .order('created_at', { ascending: true })
      .limit(300);
    if (error) return bad(error.message.includes('provider_admin_messages') ? SETUP_HINT : error.message, 500);
    await adminDb
      .from('provider_admin_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('provider_id', thread)
      .eq('sender_role', 'provider')
      .is('read_at', null);
    return NextResponse.json({ messages: data ?? [] });
  }

  // Small numbers for the sidebar badge
  if (url.searchParams.get('summary')) {
    const [p, m] = await Promise.all([
      adminDb.from('service_providers').select('*'),
      adminDb
        .from('provider_admin_messages')
        .select('id', { count: 'exact', head: true })
        .eq('sender_role', 'provider')
        .is('read_at', null),
    ]);
    const unverified = (p.data ?? []).filter((r: any) => !r.is_verified && !r.suspended).length;
    return NextResponse.json({ unverified, unread: m.error ? 0 : m.count || 0 });
  }

  const [prov, svc, cats, reqs, msgs] = await Promise.all([
    adminDb.from('service_providers').select('*').order('created_at', { ascending: false }),
    adminDb.from('provider_services').select('*').order('created_at', { ascending: false }),
    adminDb.from('service_categories').select('id, name, mode, sort_order').order('sort_order'),
    adminDb
      .from('service_requests')
      .select('*, service_categories(name), service_request_contacts(contact_name, contact_phone)')
      .order('created_at', { ascending: false })
      .limit(200),
    adminDb
      .from('provider_admin_messages')
      .select('provider_id, sender_role, body, created_at, read_at')
      .order('created_at', { ascending: false })
      .limit(1000),
  ]);
  if (prov.error) return bad(prov.error.message, 500);

  // Logins live in auth, so look the email up for each provider that has one.
  const providers = await Promise.all(
    (prov.data ?? []).map(async (p: any) => {
      let email: string | null = null;
      if (p.user_id) {
        const { data } = await adminDb.auth.admin.getUserById(p.user_id);
        email = data?.user?.email ?? null;
      }
      return { ...p, email };
    })
  );

  // Buyer names for the requests list
  const reqRows = (reqs.data ?? []) as any[];
  const buyerIds = Array.from(new Set(reqRows.map((r) => r.buyer_id).filter(Boolean)));
  const names = new Map<string, string>();
  if (buyerIds.length) {
    const { data: bs } = await adminDb.from('buyers').select('id, contact_name, company_name, email').in('id', buyerIds);
    (bs ?? []).forEach((b: any) => names.set(b.id, b.contact_name || b.company_name || b.email || 'Buyer'));
  }

  // Message threads: last message + unread count per provider
  const threads: Record<string, { last: string; last_at: string; last_role: string; unread: number }> = {};
  ((msgs.data ?? []) as any[]).forEach((m) => {
    const t = (threads[m.provider_id] ||= { last: m.body, last_at: m.created_at, last_role: m.sender_role, unread: 0 });
    if (m.sender_role === 'provider' && !m.read_at) t.unread++;
  });

  return NextResponse.json({
    providers,
    services: svc.data ?? [],
    categories: cats.data ?? [],
    requests: reqRows.map((r) => ({ ...r, buyer_name: r.buyer_id ? names.get(r.buyer_id) || null : null })),
    threads,
    messagesReady: !msgs.error,
    suspendReady: providers.length === 0 || 'suspended' in providers[0],
  });
}

export async function POST(req: Request) {
  if (!(await requireAdmin(req))) return bad('Not authorized', 401);
  const b = await req.json().catch(() => ({}));
  const id = String(b.id || '');

  const provider = async () =>
    (await adminDb.from('service_providers').select('id, user_id, display_name').eq('id', id).maybeSingle()).data;

  // Shared by create + update so both validate the same way.
  const profileFields = () => {
    const name = String(b.display_name || '').trim();
    const phone = phoneNorm(b.phone);
    const city = String(b.city || '').trim();
    if (name.length < 2) return { error: "Enter the provider's name." };
    if (!phone) return { error: 'Enter a valid Nigerian phone number.' };
    if (!city) return { error: 'Choose a city.' };
    return {
      fields: {
        display_name: name,
        provider_type: TYPES.includes(b.provider_type) ? b.provider_type : 'individual',
        phone,
        city,
        area: String(b.area || '').trim() || null,
        bio: String(b.bio || '').trim() || null,
        service_areas: parseAreas(b.service_areas),
        typical_arrival_minutes: numOrNull(b.typical_arrival_minutes),
        offers_emergency: !!b.offers_emergency,
        years_experience: numOrNull(b.years_experience),
      } as Record<string, unknown>,
    };
  };

  switch (b.action) {
    case 'create': {
      const p = profileFields();
      if (p.error) return bad(p.error);
      const email = String(b.email || '').trim().toLowerCase();
      const password = String(b.password || '');
      const wantsLogin = !!email || !!password;
      if (wantsLogin) {
        if (!/^\S+@\S+\.\S+$/.test(email)) return bad('Enter a valid email for the login.');
        if (password.length < 8) return bad('Password must be at least 8 characters.');
      }
      const catId = String(b.category_id || '');
      const title = String(b.service_title || '').trim();
      if (catId && !title) return bad('Describe the first service, or clear the category.');

      let userId: string | null = null;
      if (wantsLogin) {
        const { data: u, error: ue } = await adminDb.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { role: 'provider', full_name: p.fields!.display_name },
        });
        if (ue || !u?.user) return bad(ue?.message || 'Could not create the login.');
        userId = u.user.id;
      }

      const { data: created, error: re } = await adminDb
        .from('service_providers')
        .insert({ ...p.fields, user_id: userId, is_verified: true, is_online: false })
        .select('id')
        .single();
      if (re || !created) {
        if (userId) await adminDb.auth.admin.deleteUser(userId); // no orphan logins
        return bad(re?.message || 'Could not create the provider.', 500);
      }

      if (catId) {
        const { error: se } = await adminDb.from('provider_services').insert({
          provider_id: created.id,
          category_id: catId,
          title,
          price_from: numOrNull(b.price_from),
          price_unit: UNITS.includes(b.price_unit) ? b.price_unit : 'job',
        });
        if (se) return NextResponse.json({ ok: true, warning: `Provider created, but the first service was not saved: ${se.message}` });
      }
      return NextResponse.json({ ok: true, id: created.id });
    }

    case 'update': {
      if (!(await provider())) return bad('Provider not found.', 404);
      const p = profileFields();
      if (p.error) return bad(p.error);
      const acct = String(b.account_number || '').replace(/\D/g, '');
      const { error } = await adminDb
        .from('service_providers')
        .update({
          ...p.fields,
          bank_name: String(b.bank_name || '').trim() || null,
          account_name: String(b.account_name || '').trim() || null,
          account_number: acct || null,
        })
        .eq('id', id);
      return error ? bad(error.message, 500) : NextResponse.json({ ok: true });
    }

    case 'set_verified': {
      const { error } = await adminDb
        .from('service_providers')
        .update({ is_verified: !!b.verified, ...(b.verified ? {} : { is_online: false }) })
        .eq('id', id);
      return error ? bad(error.message, 500) : NextResponse.json({ ok: true });
    }

    case 'set_suspended': {
      const r = await provider();
      if (!r) return bad('Provider not found.', 404);
      const suspended = !!b.suspended;
      // Suspending hides the provider from buyers (unverified + offline) and bans the login.
      const { error } = await adminDb
        .from('service_providers')
        .update(
          suspended
            ? { suspended: true, is_verified: false, is_online: false }
            : { suspended: false, is_verified: true }
        )
        .eq('id', id);
      if (error) return bad(error.message.includes('suspended') ? SETUP_HINT : error.message, 500);
      if (r.user_id) await adminDb.auth.admin.updateUserById(r.user_id, { ban_duration: suspended ? '876000h' : 'none' });
      return NextResponse.json({ ok: true });
    }

    case 'set_password': {
      const r = await provider();
      const password = String(b.password || '');
      if (!r?.user_id) return bad('This provider has no login.');
      if (password.length < 8) return bad('Password must be at least 8 characters.');
      const { error } = await adminDb.auth.admin.updateUserById(r.user_id, { password });
      return error ? bad(error.message) : NextResponse.json({ ok: true });
    }

    case 'create_login': {
      const r = await provider();
      if (!r) return bad('Provider not found.', 404);
      if (r.user_id) return bad('This provider already has a login.');
      const email = String(b.email || '').trim().toLowerCase();
      const password = String(b.password || '');
      if (!/^\S+@\S+\.\S+$/.test(email)) return bad('Enter a valid email.');
      if (password.length < 8) return bad('Password must be at least 8 characters.');
      const { data: u, error: ue } = await adminDb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: 'provider', full_name: r.display_name },
      });
      if (ue || !u?.user) return bad(ue?.message || 'Could not create the login.');
      const { error } = await adminDb.from('service_providers').update({ user_id: u.user.id }).eq('id', id);
      if (error) {
        await adminDb.auth.admin.deleteUser(u.user.id);
        return bad(error.message, 500);
      }
      return NextResponse.json({ ok: true });
    }

    case 'delete': {
      const r = await provider();
      if (!r) return bad('Provider not found.', 404);
      const count = async (table: string, f: (q: any) => any) =>
        (await f(adminDb.from(table).select('*', { count: 'exact', head: true }).eq('provider_id', id))).count || 0;

      if (await count('service_requests', (q) => q.in('status', ['accepted', 'in_progress']))) {
        return bad('This provider has a job in progress. Wait until it is finished, or release it from the Requests tab.', 409);
      }
      if (!b.force) {
        const [jobs, reviews] = await Promise.all([
          count('service_requests', (q) => q),
          count('service_reviews', (q) => q),
        ]);
        if (jobs || reviews) {
          return NextResponse.json(
            {
              error: `This provider has ${jobs} request(s) and ${reviews} review(s) on record. Deleting removes their reviews and ratings. The requests stay, but lose the provider link. Requests still waiting on them are marked declined so buyers can pick someone else.`,
              needs_force: true,
            },
            { status: 409 }
          );
        }
      }

      await adminDb.from('service_requests').update({ status: 'declined' }).eq('provider_id', id).eq('status', 'requested');
      await adminDb.from('service_requests').update({ provider_id: null }).eq('provider_id', id); // keep request history
      await adminDb.from('service_reviews').delete().eq('provider_id', id);
      await adminDb.from('provider_services').delete().eq('provider_id', id);
      const { error } = await adminDb.from('service_providers').delete().eq('id', id); // messages cascade
      if (error) return bad(error.message, 500);

      let loginKept = false;
      if (r.user_id && b.delete_login) {
        if (await loginInUse(r.user_id)) loginKept = true;
        else loginKept = !!(await adminDb.auth.admin.deleteUser(r.user_id)).error;
      }
      return NextResponse.json({ ok: true, login_kept: loginKept });
    }

    case 'add_service': {
      if (!(await provider())) return bad('Provider not found.', 404);
      const title = String(b.title || '').trim();
      const catId = String(b.category_id || '');
      if (!catId || !title) return bad('Choose a category and add a title.');
      const { error } = await adminDb.from('provider_services').insert({
        provider_id: id,
        category_id: catId,
        title,
        description: String(b.description || '').trim() || null,
        price_from: numOrNull(b.price_from),
        price_unit: UNITS.includes(b.price_unit) ? b.price_unit : 'job',
      });
      return error ? bad(error.message, 500) : NextResponse.json({ ok: true });
    }

    case 'update_service': {
      const sid = String(b.service_id || '');
      const patch: Record<string, unknown> = {};
      if (typeof b.active === 'boolean') patch.active = b.active;
      if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim();
      if ('price_from' in b) patch.price_from = numOrNull(b.price_from);
      if (UNITS.includes(b.price_unit)) patch.price_unit = b.price_unit;
      if (!sid || !Object.keys(patch).length) return bad('Nothing to update.');
      const { error } = await adminDb.from('provider_services').update(patch).eq('id', sid);
      return error ? bad(error.message, 500) : NextResponse.json({ ok: true });
    }

    case 'delete_service': {
      const sid = String(b.service_id || '');
      if (!sid) return bad('Missing service.');
      const { error } = await adminDb.from('provider_services').delete().eq('id', sid);
      return error ? bad(error.message, 500) : NextResponse.json({ ok: true });
    }

    case 'cancel_request': {
      const rid = String(b.request_id || '');
      const { data, error } = await adminDb
        .from('service_requests')
        .update({ status: 'cancelled' })
        .eq('id', rid)
        .in('status', ['open', 'requested', 'accepted', 'in_progress'])
        .select('id');
      if (error) return bad(error.message, 500);
      return data?.length ? NextResponse.json({ ok: true }) : bad('That request can no longer be cancelled.');
    }

    case 'release_request': {
      // Take a request away from its provider and put it back on the open board for others.
      const rid = String(b.request_id || '');
      const { data, error } = await adminDb
        .from('service_requests')
        .update({ provider_id: null, status: 'open' })
        .eq('id', rid)
        .in('status', ['requested', 'accepted'])
        .select('id');
      if (error) return bad(error.message, 500);
      return data?.length ? NextResponse.json({ ok: true }) : bad('That request cannot be released.');
    }

    case 'send_message': {
      const text = String(b.body || '').trim().slice(0, 2000);
      if (!text) return bad('Type a message first.');
      if (!(await provider())) return bad('Provider not found.', 404);
      const { error } = await adminDb
        .from('provider_admin_messages')
        .insert({ provider_id: id, sender_role: 'admin', body: text });
      if (error) return bad(error.message.includes('provider_admin_messages') ? SETUP_HINT : error.message, 500);
      return NextResponse.json({ ok: true });
    }

    default:
      return bad('Unknown action.');
  }
}