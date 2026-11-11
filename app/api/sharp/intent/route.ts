// app/api/sharp/intent/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const query = body?.query;
  const categories = body?.categories;
  const url = process.env.N8N_INTENT_WEBHOOK_URL;

  if (
    !url ||
    typeof query !== 'string' ||
    query.trim().length < 3 ||
    query.length > 300 ||
    !Array.isArray(categories) ||
    categories.length === 0 ||
    categories.length > 60
  ) {
    return NextResponse.json({ intent: null });
  }

  // Only pass id and name, nothing else
  const cleanCats = categories
    .filter((c: any) => c && typeof c.id === 'string' && typeof c.name === 'string')
    .map((c: any) => ({ id: c.id.slice(0, 60), name: c.name.slice(0, 80) }));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sharp-secret': process.env.N8N_INTENT_SECRET || '',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ query: query.trim(), categories: cleanCats }),
      signal: ctrl.signal,
    });
    if (!r.ok) return NextResponse.json({ intent: null });
    const intent = await r.json();
    return NextResponse.json({ intent });
  } catch {
    return NextResponse.json({ intent: null });
  } finally {
    clearTimeout(timer);
  }
}