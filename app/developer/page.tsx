'use client';

// app/developer/page.tsx
// Developer portal: create/revoke API keys and read the docs. Uses the same shell as the other buyer pages.

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import BuyerShell from '../components/BuyerShell';
import { supabase } from '../lib/supabaseClient';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  requests_24h: number;
}

const SCOPES = [
  { id: 'rfqs:read', label: 'Read RFQs' },
  { id: 'rfqs:write', label: 'Create RFQ requests' },
  { id: 'orders:read', label: 'Read purchase orders' },
];

const ENDPOINTS = [
  { method: 'GET', path: '/api/v1/rfqs', scope: 'rfqs:read', desc: 'List your RFQs. Query: limit (1-100), status.' },
  { method: 'POST', path: '/api/v1/rfqs', scope: 'rfqs:write', desc: 'Request quotes for a product. Returns 202 while suppliers are contacted.' },
  { method: 'GET', path: '/api/v1/rfqs/{id}', scope: 'rfqs:read', desc: 'Get one RFQ.' },
  { method: 'GET', path: '/api/v1/purchase-orders', scope: 'orders:read', desc: 'List purchase orders. Query: limit, status.' },
  { method: 'GET', path: '/api/v1/purchase-orders/{id}', scope: 'orders:read', desc: 'Get one purchase order, including payment and delivery status.' },
];

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Never');

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 text-[11px] leading-relaxed text-slate-300 overflow-x-auto">
        {code}
      </pre>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label="Copy"
        className="absolute top-2 right-2 text-slate-500 hover:text-emerald-400 p-1 transition"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export default function DeveloperPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['rfqs:read', 'orders:read']);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [base, setBase] = useState('https://your-domain.com');

  useEffect(() => setBase(window.location.origin), []);

  const authHeaders = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' };
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/developer/keys', { headers: await authHeaders() });
      const json = await res.json();
      if (res.ok) setKeys(json.data || []);
      else setError(json?.error?.message || 'Could not load keys.');
    } catch {
      setError('Could not load keys.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      const res = await fetch('/api/developer/keys', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ name, scopes }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message || 'Could not create key.');
        return;
      }
      setNewKey(json.key);
      setName('');
      load();
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm('Revoke this key? Any app using it will stop working immediately.')) return;
    await fetch(`/api/developer/keys?id=${id}`, { method: 'DELETE', headers: await authHeaders() });
    load();
  };

  const toggleScope = (id: string) =>
    setScopes((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const curlList = `curl ${base}/api/v1/rfqs \\\n  -H "Authorization: Bearer vk_live_YOUR_KEY"`;
  const curlCreate = `curl -X POST ${base}/api/v1/rfqs \\\n  -H "Authorization: Bearer vk_live_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"product":"Black Steel Pipe 2 inch (6m)","quantity":100,"delivery_location":"Lagos"}'`;
  const sampleResponse = `{\n  "object": "list",\n  "data": [\n    {\n      "rfq_id": "0772a187-f5de-4c40-8850-a2dc9fefddc2",\n      "title": "80 PVC drainage pipe 4 Inch - Lagos",\n      "delivery_location": "Lagos",\n      "status": "open",\n      "created_at": "2026-10-19T06:16:34Z"\n    }\n  ]\n}`;
  const errorShape = `{ "error": { "code": "invalid_api_key", "message": "API key is invalid or revoked." } }`;

  const activeKeys = keys.filter((k) => !k.revoked_at);

  return (
    <BuyerShell
      active="developer"
      title="Developer API"
      subtitle="Plug Velrenta's RFQ and purchase order engine into your own app, ERP or storefront."
    >
      {/* New key reveal */}
      {newKey && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 mb-6">
          <p className="text-sm font-bold text-emerald-300">Copy your new key now</p>
          <p className="text-xs text-slate-400 mt-1">For security we only store a hash. You won't be able to see it again.</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white">{newKey}</code>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(newKey);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg px-3.5 py-2 transition"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={() => setNewKey(null)} className="text-xs text-slate-400 hover:text-white px-2 transition">
              Done
            </button>
          </div>
        </div>
      )}

      {/* Keys */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 mb-6">
        <div className="px-4 py-3.5 border-b border-slate-800">
          <h2 className="text-sm font-bold text-white">API keys</h2>
        </div>

        <form onSubmit={create} className="p-4 border-b border-slate-800 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Key name, e.g. Hardware store ERP"
              maxLength={60}
              className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
            />
            <button
              type="submit"
              disabled={creating || name.trim().length < 2 || scopes.length === 0}
              className="inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs transition"
            >
              <Plus className="w-4 h-4" /> {creating ? 'Creating...' : 'Create key'}
            </button>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {SCOPES.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" checked={scopes.includes(s.id)} onChange={() => toggleScope(s.id)} className="accent-emerald-500" />
                {s.label} <span className="text-slate-600">({s.id})</span>
              </label>
            ))}
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </form>

        {loading ? (
          <div className="p-6 text-xs text-slate-500">Loading keys...</div>
        ) : activeKeys.length === 0 ? (
          <div className="p-10 text-center">
            <KeyRound className="w-6 h-6 text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-300">No API keys yet</p>
            <p className="text-xs text-slate-500 mt-1">Create one above to start calling the API.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800/70">
            {activeKeys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{k.name}</p>
                  <p className="text-xs text-slate-500 mt-1 truncate">
                    <code className="text-slate-400">{k.key_prefix}••••••••</code> · {k.scopes.join(', ')}
                  </p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Last used: {fmt(k.last_used_at)} · {k.requests_24h} calls in 24h
                  </p>
                </div>
                <button
                  onClick={() => revoke(k.id)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 border border-slate-700 hover:border-red-500/50 hover:text-red-400 rounded-lg px-3 py-2 transition shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Docs */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 mb-6">
        <div className="px-4 py-3.5 border-b border-slate-800">
          <h2 className="text-sm font-bold text-white">Quickstart</h2>
        </div>
        <div className="p-4 space-y-4 text-xs text-slate-400 leading-relaxed">
          <p>
            Base URL: <code className="text-slate-200">{base}/api/v1</code>. Authenticate every request with your key in the{' '}
            <code className="text-slate-200">Authorization</code> header. Keys only ever see data belonging to the account that created them.
            Limit: 60 requests per minute per key.
          </p>
          <CodeBlock code={curlList} />
          <CodeBlock code={sampleResponse} />
          <p>Ask Velrenta to source quotes for a product (the agent contacts suppliers, then the RFQ shows up in the list above):</p>
          <CodeBlock code={curlCreate} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 mb-6">
        <div className="px-4 py-3.5 border-b border-slate-800">
          <h2 className="text-sm font-bold text-white">Endpoints</h2>
        </div>
        <ul className="divide-y divide-slate-800/70">
          {ENDPOINTS.map((e) => (
            <li key={e.method + e.path} className="px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                    e.method === 'GET'
                      ? 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  }`}
                >
                  {e.method}
                </span>
                <code className="text-xs text-white">{e.path}</code>
                <span className="text-[11px] text-slate-600">scope: {e.scope}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">{e.desc}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 mb-6">
        <div className="px-4 py-3.5 border-b border-slate-800">
          <h2 className="text-sm font-bold text-white">Errors</h2>
        </div>
        <div className="p-4 space-y-3 text-xs text-slate-400 leading-relaxed">
          <p>Errors use standard HTTP status codes (400, 401, 403, 404, 429, 5xx) and this body:</p>
          <CodeBlock code={errorShape} />
        </div>
      </section>
    </BuyerShell>
  );
}
