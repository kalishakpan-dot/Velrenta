// app/lib/adminSuppliers.ts
// SERVER ONLY. Called from app/api/admin/action/route.ts AFTER requireAdmin() has passed.
// Creates supplier logins, links logins to existing suppliers, and resets passwords.

import { NextResponse } from 'next/server';
import { adminDb } from './adminServer';

const LEVELS = ['basic', 'verified', 'trusted'];
const PRODUCT_STATUSES = ['available', 'limited', 'unavailable'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const ok = (extra: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...extra });
const cleanEmail = (v: unknown) => String(v || '').trim().toLowerCase();

// Creates the sign-in account. email_confirm skips the confirmation email, so the supplier can log in immediately.
async function createLogin(
  email: string,
  password: string,
  contactName: string
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await adminDb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { contact_name: contactName, role: 'supplier' },
  });
  if (error || !data?.user) {
    const msg = error?.message || '';
    if (/already|registered|exists/i.test(msg)) {
      return { error: 'An account with this email already exists. Use a different email.' };
    }
    return { error: msg || 'Could not create the login.' };
  }
  return { id: data.user.id };
}

// Returns a response if the action belongs to this file, otherwise null.
export async function handleSupplierAction(body: any): Promise<NextResponse | null> {
  try {
    switch (body?.action) {
      case 'create_supplier': {
        const company_name = String(body.company_name || '').trim();
        const contact_name = String(body.contact_name || '').trim();
        const email = cleanEmail(body.email);
        const password = String(body.password || '');
        const phone = String(body.phone || '').replace(/[\s-]/g, '');

        if (!company_name) return fail('Enter the company name.');
        if (!contact_name) return fail('Enter a contact name.');
        if (!EMAIL_RE.test(email)) return fail('Enter a valid email address.');
        if (password.length < 8) return fail('Password must be at least 8 characters.');
        if (phone && !/^\+?\d{10,15}$/.test(phone)) return fail('Enter a valid phone number, for example +2348012345678.');

        const { data: dup } = await adminDb.from('suppliers').select('id').eq('email', email).limit(1);
        if (dup && dup.length > 0) return fail('A supplier with this email already exists.');

        const login = await createLogin(email, password, contact_name);
        if ('error' in login) return fail(login.error);

        const { error: insErr } = await adminDb.from('suppliers').insert({
          user_id: login.id,
          company_name,
          contact_name,
          email,
          phone: phone || null,
          city: String(body.city || '').trim() || null,
          country: 'Nigeria',
          payment_terms: String(body.payment_terms || '').trim() || null,
          verification_status: body.verified === false ? 'unverified' : 'verified',
          verification_level: LEVELS.includes(body.level) ? body.level : 'basic',
        });
        if (insErr) {
          // Don't leave an orphan login behind if the supplier row could not be saved.
          await adminDb.auth.admin.deleteUser(login.id);
          return fail(insErr.message);
        }
        return ok({ user_id: login.id });
      }

      case 'create_supplier_login': {
        const id = body.id;
        const password = String(body.password || '');
        if (!id) return fail('Supplier not found.');
        if (password.length < 8) return fail('Password must be at least 8 characters.');

        const { data: sup } = await adminDb
          .from('suppliers')
          .select('id, user_id, email, contact_name')
          .eq('id', id)
          .maybeSingle();
        if (!sup) return fail('Supplier not found.');
        if (sup.user_id) return fail('This supplier already has a login.');

        const email = cleanEmail(body.email || sup.email);
        if (!EMAIL_RE.test(email)) return fail('Enter a valid email address.');

        const login = await createLogin(email, password, sup.contact_name || '');
        if ('error' in login) return fail(login.error);

        const { error } = await adminDb.from('suppliers').update({ user_id: login.id, email }).eq('id', id);
        if (error) {
          await adminDb.auth.admin.deleteUser(login.id);
          return fail(error.message);
        }
        return ok({ user_id: login.id });
      }

      case 'reset_supplier_password': {
        const id = body.id;
        const password = String(body.password || '');
        if (!id) return fail('Supplier not found.');
        if (password.length < 8) return fail('Password must be at least 8 characters.');

        const { data: sup } = await adminDb.from('suppliers').select('user_id').eq('id', id).maybeSingle();
        if (!sup?.user_id) return fail('This supplier has no login yet. Create one first.');

        const { error } = await adminDb.auth.admin.updateUserById(sup.user_id, { password });
        if (error) return fail(error.message);
        return ok();
      }

      case 'save_supplier_product': {
        const supplier_id = body.supplier_id;
        if (!supplier_id) return fail('Supplier not found.');

        const num = (v: unknown) => (v === '' || v === null || v === undefined ? NaN : Number(v));
        const price = num(body.price);
        if (!Number.isFinite(price) || price <= 0) return fail('Enter a price greater than 0.');
        const moq = num(body.minimum_order_quantity ?? 1);
        if (!Number.isFinite(moq) || moq < 0) return fail('Minimum order quantity must be 0 or more.');
        const qty = num(body.available_quantity);
        if (!Number.isFinite(qty) || qty < 0) return fail('Enter the available quantity (0 or more).');
        const lead = num(body.lead_time_days);
        if (!Number.isInteger(lead) || lead < 0) return fail('Lead time must be a whole number of days.');

        const fields = {
          price,
          currency: 'NGN',
          minimum_order_quantity: moq,
          available_quantity: qty,
          lead_time_days: lead,
          availability_status: PRODUCT_STATUSES.includes(body.availability_status) ? body.availability_status : 'available',
        };

        if (body.id) {
          const { data, error } = await adminDb
            .from('supplier_products')
            .update({ ...fields, updated_at: new Date().toISOString() })
            .eq('id', body.id)
            .eq('supplier_id', supplier_id)
            .select('id');
          if (error) return fail(error.message);
          if (!data || data.length === 0) return fail('Product listing not found.');
          return ok();
        }

        const product_id = body.product_id;
        if (!product_id) return fail('Choose a product.');
        const { data: sup } = await adminDb.from('suppliers').select('id').eq('id', supplier_id).maybeSingle();
        if (!sup) return fail('Supplier not found.');
        const { data: prod } = await adminDb.from('products').select('id').eq('id', product_id).maybeSingle();
        if (!prod) return fail('That product is not in the catalog.');
        const { data: dup } = await adminDb
          .from('supplier_products')
          .select('id')
          .eq('supplier_id', supplier_id)
          .eq('product_id', product_id)
          .limit(1);
        if (dup && dup.length > 0) return fail('This supplier already lists that product. Edit it instead.');

        const { error } = await adminDb.from('supplier_products').insert({ supplier_id, product_id, ...fields, specifications: {} });
        if (error) return fail(error.message);
        return ok();
      }

      case 'delete_supplier_product': {
        if (!body.id) return fail('Product listing not found.');
        const { error } = await adminDb.from('supplier_products').delete().eq('id', body.id);
        if (error) return fail(error.message);
        return ok();
      }

      default:
        return null;
    }
  } catch (err: any) {
    console.error('Supplier admin action error:', err);
    return fail(err?.message || 'Something went wrong.', 500);
  }
}