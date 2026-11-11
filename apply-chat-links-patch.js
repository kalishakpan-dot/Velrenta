// apply-chat-links-patch.js
// Run from the project root (the folder that contains "app"):
//   node apply-chat-links-patch.js
//
// 1) app/page.tsx       -> links in chat replies become tappable ("Open My Plug", "Open Errand")
// 2) app/sharp/page.tsx -> /sharp?q=... pre-fills the search so the AI starts right away
//
// A backup of each file is saved next to it as <file>.before-chatlinks.bak

const fs = require('fs');
const path = require('path');

const DASH = path.join('app', 'page.tsx');
const SHARP = path.join('app', 'sharp', 'page.tsx');

/* ---------- New code for the dashboard chat ---------- */

const NEW_LINK_CODE = String.raw`// Links inside chat replies. Velrenta pages open inside the app, anything else opens in a new tab.
const URL_RE = /(https?:\/\/[^\s<>"]+)/g;

const INTERNAL_LINKS: Record<string, string> = {
  '/sharp': 'Open My Plug',
  '/dispatch': 'Open Errand',
  '/marketplace': 'Open Marketplace',
  '/rfqs': 'Open RFQs',
  '/pos': 'Open Purchase orders',
  '/tracking': 'Open Order tracking',
};

function renderLink(raw: string, key: string): React.ReactNode {
  // Keep trailing punctuation (like a full stop) outside the link.
  const m = raw.match(/^(.*?)([.,;:!?)\]*_]*)$/);
  const url = m ? m[1] : raw;
  const trail = m ? m[2] : '';
  const linkClass =
    'font-semibold text-emerald-400 hover:text-emerald-300 underline underline-offset-2 break-all';

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return <span key={key}>{raw}</span>;
  }

  const p = u.pathname.replace(/\/+$/, '') || '/';
  const label = INTERNAL_LINKS[p];

  if (label) {
    return (
      <span key={key}>
        <Link href={p + u.search + u.hash} className={linkClass}>
          {label} &rarr;
        </Link>
        {trail}
      </span>
    );
  }

  return (
    <span key={key}>
      <a href={url} target="_blank" rel="noreferrer" className={linkClass}>
        {url}
      </a>
      {trail}
    </span>
  );
}

// WhatsApp-style inline formatting: *bold*, _italic_ (and tolerates **bold**).
function formatPlain(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={keyPrefix + '-b2-' + i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <strong key={keyPrefix + '-b1-' + i}>{part.slice(1, -1)}</strong>;
    }
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
      return <em key={keyPrefix + '-i-' + i}>{part.slice(1, -1)}</em>;
    }
    return <span key={keyPrefix + '-t-' + i}>{part}</span>;
  });
}

// Links are pulled out first so underscores or asterisks inside a URL are never treated as formatting.
function renderInlineFormatting(text: string, keyPrefix: string): React.ReactNode[] {
  return text
    .split(URL_RE)
    .flatMap((chunk, i) =>
      /^https?:\/\//.test(chunk)
        ? [renderLink(chunk, keyPrefix + '-u' + i)]
        : formatPlain(chunk, keyPrefix + '-c' + i)
    );
}`;

/* ---------- New code for My Plug ---------- */

const NEW_PREFILL_CODE = String.raw`/* Opened from the dashboard chat with /sharp?q=...: prefill the search so the AI starts right away */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const q = (params.get('q') || '').trim().slice(0, 300);
      if (q) {
        setQuery(q);
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch {
      /* ignore */
    }
  }, []);`;

/* ---------- Helpers ---------- */

function load(file) {
  if (!fs.existsSync(file)) {
    throw new Error('Cannot find ' + file + '. Run this from the project root (the folder that contains "app").');
  }
  const raw = fs.readFileSync(file, 'utf8');
  return { raw, crlf: raw.includes('\r\n'), text: raw.replace(/\r\n/g, '\n') };
}

function save(file, f, text) {
  fs.writeFileSync(file + '.before-chatlinks.bak', f.raw);
  fs.writeFileSync(file, f.crlf ? text.replace(/\n/g, '\r\n') : text);
}

function run(name, fn) {
  try {
    fn();
  } catch (e) {
    console.log('FAILED  ' + name + ': ' + e.message);
    process.exitCode = 1;
  }
}

/* ---------- 1) Dashboard chat ---------- */

run('Dashboard chat links', () => {
  const f = load(DASH);
  if (f.text.includes('const INTERNAL_LINKS')) {
    console.log('SKIPPED Dashboard chat links (already patched)');
    return;
  }
  const start = f.text.indexOf('// WhatsApp-style inline formatting');
  const end = f.text.indexOf('function renderMessageBody');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('could not find the chat formatting code in ' + DASH + '. Nothing was changed.');
  }
  if (!f.text.includes("import Link from 'next/link'")) {
    throw new Error("app/page.tsx does not import Link from 'next/link'. Nothing was changed.");
  }
  const out = f.text.slice(0, start) + NEW_LINK_CODE + '\n\n' + f.text.slice(end);
  save(DASH, f, out);
  console.log('PATCHED Dashboard chat links -> ' + DASH);
});

/* ---------- 2) My Plug prefill ---------- */

run('My Plug prefill', () => {
  const f = load(SHARP);
  if (f.text.includes('Opened from the dashboard chat')) {
    console.log('SKIPPED My Plug prefill (already patched)');
    return;
  }
  const marker = '/* AI agent: after the buyer stops typing for 700ms, ask n8n what they need */';
  const at = f.text.indexOf(marker);
  if (at === -1) {
    throw new Error('could not find the AI search block in ' + SHARP + '. Nothing was changed.');
  }
  const out = f.text.slice(0, at) + NEW_PREFILL_CODE + '\n\n  ' + f.text.slice(at);
  save(SHARP, f, out);
  console.log('PATCHED My Plug prefill -> ' + SHARP);
});