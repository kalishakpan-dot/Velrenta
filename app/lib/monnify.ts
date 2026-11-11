// Server-only Monnify client.
import crypto from 'crypto';

const BASE = (process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com').replace(/\/$/, '');
let cached: { token: string; exp: number } | null = null;

// Cloudflare (in front of Monnify) can block requests that look like bare bots.
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; VelrentaPortal/1.0)',
  Accept: 'application/json',
};

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

// Reads the reply as text first so we never lose the real body, then tries JSON.
async function readReply(res: Response) {
  const raw = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* not JSON */
  }
  return { raw, json };
}

// Turns a failed reply into a short, readable message (no giant HTML in the UI).
function failMessage(label: string, status: number, raw: string, json: any): string {
  const isHtml = raw.trimStart().startsWith('<');
  if (isHtml) {
    const ray = raw.match(/Ray ID:\s*<strong[^>]*>([^<]+)</i)?.[1];
    return `${label} blocked by firewall (${status})${ray ? `, Ray ID ${ray}` : ''}`;
  }
  return `${label} failed: ${status} ${json?.responseMessage || raw.slice(0, 300)}`;
}

async function getToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 30_000) return cached.token;
  const basic = Buffer.from(`${need('MONNIFY_API_KEY')}:${need('MONNIFY_SECRET_KEY')}`).toString('base64');
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { ...COMMON_HEADERS, Authorization: `Basic ${basic}` },
    cache: 'no-store',
  });
  const { raw, json } = await readReply(res);
  if (!res.ok || !json?.requestSuccessful) {
    console.error(`Monnify auth -> ${res.status}`, raw.slice(0, 500));
    throw new Error(failMessage('Monnify auth', res.status, raw, json));
  }
  cached = {
    token: json.responseBody.accessToken,
    exp: Date.now() + Number(json.responseBody.expiresIn || 300) * 1000,
  };
  return cached.token;
}

async function call(path: string, init: { method?: string; body?: unknown } = {}) {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    method: init.method || 'GET',
    headers: {
      ...COMMON_HEADERS,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });

  const { raw, json } = await readReply(res);

  if (!res.ok || !json?.requestSuccessful) {
    // If the token was rejected, drop it so the next call logs in again.
    if (res.status === 401) cached = null;
    console.error(`Monnify ${path} -> ${res.status}`, raw.slice(0, 500));
    throw new Error(failMessage(`Monnify ${path}`, res.status, raw, json));
  }
  return json.responseBody;
}

export interface InitArgs {
  amount: number;
  customerName: string;
  customerEmail: string;
  paymentReference: string;
  paymentDescription: string;
  redirectUrl: string;
  metaData?: Record<string, string>;
}

// Creates the transaction and returns a hosted checkout link (card + bank transfer).
export function initTransaction(a: InitArgs) {
  return call('/api/v1/merchant/transactions/init-transaction', {
    method: 'POST',
    body: {
      amount: a.amount,
      customerName: a.customerName,
      customerEmail: a.customerEmail,
      paymentReference: a.paymentReference,
      paymentDescription: a.paymentDescription,
      currencyCode: 'NGN',
      contractCode: need('MONNIFY_CONTRACT_CODE'),
      redirectUrl: a.redirectUrl,
      paymentMethods: ['CARD', 'ACCOUNT_TRANSFER'],
      metaData: a.metaData,
    },
  });
}

// Generates a one-off bank account number for an initialised transaction.
export function initBankTransfer(transactionReference: string) {
  return call('/api/v1/merchant/bank-transfer/init-payment', {
    method: 'POST',
    body: { transactionReference },
  });
}

export function getTransactionStatus(transactionReference: string) {
  return call(`/api/v2/transactions/${encodeURIComponent(transactionReference)}`);
}

// Monnify signs the raw webhook body with HMAC-SHA512 using your secret key.
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac('sha512', need('MONNIFY_SECRET_KEY')).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}