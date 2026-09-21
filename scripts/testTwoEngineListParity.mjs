/**
 * Does a phone see the same list as a laptop?
 *
 * The bug this guards against is silent: nostr-tools invents an EOSE 4.4 s
 * after a subscription opens, closes it and DISCARDS every event still queued
 * behind it. A laptop drains that queue inside the window; a phone does not.
 * On 21. 9. 2026 the Eco Point catalogue showed 140 offers in Chromium and
 * 20, 35 or 73 in WebKit from the same relays in the same second, with no
 * error anywhere — so nothing but a two-engine comparison can catch it.
 *
 * Each route is loaded twice AT THE SAME TIME — Chromium at 1440px, WebKit as
 * an iPhone 13 — and two things are compared:
 *   · how many events the page actually received, per kind;
 *   · which lines it then rendered (digits blanked, so a clock or a locale's
 *     thousands separator is not mistaken for a missing item).
 * Nothing is ever published: every non-GET leaving the page is stubbed.
 *
 * Needs the app running with its own server, built against it:
 *   VITE_API_URL=http://localhost:3099 npm run build
 *   PORT=3099 npm start
 *   node scripts/testTwoEngineListParity.mjs
 * BASE, ROUTES and SETTLE override the defaults.
 */
import { chromium, webkit, devices } from 'playwright';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const BASE = process.env.BASE || 'http://localhost:3099';
const SETTLE = Number(process.env.SETTLE || 9000);
const secret = generateSecretKey();
const me = getPublicKey(secret);
const now = Math.floor(Date.now() / 1000);

const session = {
  lanaPrivateKey: 'x', walletId: 'w', nostrHexId: me, nostrNpubId: nip19.npubEncode(me),
  nostrPrivateKey: Buffer.from(secret).toString('hex'),
  profileLang: 'en', profileLangAt: now, profileEventAt: now, profileCountry: 'SI',
  expiresAt: Date.now() + 3600_000,
};

const ROUTES = (process.env.ROUTES || [
  '/food-corner',
  '/social/feed',
  '/social/rooms',
  '/events/online',
  '/events/past',
  '/plan15',
  '/own/search',
  '/lash/pay',
  '/unconditional-financing/requests',
  '/lana-aligns-world/align',
].join(',')).split(',').filter(Boolean);

/**
 * What the page rendered — the part of it that is the LIST.
 *
 * Counting every number or every element would compare the layout, which is
 * meant to differ between a 1440px window and a phone (and picks up clocks and
 * locale formatting besides). What must not differ is which items are on the
 * page, so this collects the links that carry an item's identity — an event's
 * d-tag, a listing id, a person's pubkey — and the pictures those items bring.
 */
const domSignature = () => {
  const norm = (t) =>
    t
      .replace(/\d+/g, '#')
      // WebKit writes "Sep", Chromium "Sept" for the same date.
      .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z.]*/gi, 'MON')
      .replace(/\s+/g, ' ')
      .trim();

  // Text the design deliberately shows at one width and not another —
  // `hidden sm:inline` on a button label, a header that collapses on a phone.
  // Excluded on BOTH sides, so what is left is the list itself.
  const responsive = new Set();
  for (const el of document.querySelectorAll('[class]')) {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/(?:^|\s)(?:hidden|(?:sm|md|lg|xl):(?:inline|block|flex|grid|hidden|table|inline-block))/.test(cls)) {
      const t = norm(el.textContent || '');
      if (t) responsive.add(t);
    }
  }

  const root = document.querySelector('main') || document.body;
  const lines = [...new Set((root.innerText || '').split('\n').map(norm).filter(Boolean))]
    .filter((l) => !responsive.has(l))
    .sort();

  return {
    lines,
    lineCount: lines.length,
    itemImages: document.querySelectorAll('img[src*="/api/storage/"], img[src*="blossom"]').length,
  };
};

async function visit(engine, route) {
  const isPhone = engine.name === 'webkit-iphone13';
  const browser = await engine.type.launch({ headless: true });
  const ctx = await browser.newContext(
    isPhone
      ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
      : { viewport: { width: 1440, height: 900 } },
  );
  await ctx.addInitScript((s) => {
    try {
      localStorage.clear();
      localStorage.setItem('lana_user_session', JSON.stringify(s));
      localStorage.setItem('pwa-install-dismissed', 'true');
    } catch { /* private mode */ }
  }, session);

  // Reads go out; nothing is ever published from a test.
  await ctx.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.pathname === '/api/functions/query-nostr-events') return route.continue();
    if (!local) return ['GET', 'HEAD'].includes(method) ? route.continue() : route.abort();
    if (url.pathname.startsWith('/api/') && method !== 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });

  const byKind = new Map();
  let reads = 0;
  ctx.on('response', async (res) => {
    if (!res.url().includes('/api/functions/query-nostr-events')) return;
    reads++;
    try {
      const body = await res.json();
      for (const e of body.events || []) byKind.set(e.kind, (byKind.get(e.kind) || 0) + 1);
    } catch { /* body already gone */ }
  });

  const errors = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });

  await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => errors.push('goto: ' + e.message));
  await page.waitForTimeout(SETTLE);
  const dom = await page.evaluate(domSignature).catch(() => null);
  await browser.close();

  return { reads, byKind: Object.fromEntries([...byKind].sort((a, b) => a[0] - b[0])), dom, errors };
}

/**
 * Two differences that are NOT a shorter list, each named so that a new one
 * cannot hide behind them. Whatever a rule removes is printed.
 */
const KNOWN = [
  {
    why: 'the relay picker is a desktop side panel; the phone collapses it',
    test: (l) => /^(Relays|Select Ours|#\/# selected)$/.test(l) || /relay\.|nos\.lol|nostr\.wine|External Relays|Our Relays/.test(l),
  },
  {
    why: 'Chromium and WebKit write the same moment differently ("MON #, #:# PM" vs "# MON at #:#")',
    test: (l) => /^Order until:/.test(l),
  },
];

const engines = [
  { name: 'chromium-desktop', type: chromium },
  { name: 'webkit-iphone13', type: webkit },
];

let mismatches = 0;
for (const route of ROUTES) {
  // Both engines at once, so a relay that gains an event between the two runs
  // cannot be mistaken for a list the phone failed to read.
  const pair = await Promise.all(engines.map((e) => visit(e, route)));
  const results = Object.fromEntries(engines.map((e, i) => [e.name, pair[i]]));
  const a = results['chromium-desktop'];
  const b = results['webkit-iphone13'];

  const kinds = [...new Set([...Object.keys(a.byKind), ...Object.keys(b.byKind)])].sort((x, y) => x - y);
  const kindLines = kinds.map((k) => {
    const same = a.byKind[k] === b.byKind[k];
    if (!same) mismatches++;
    return `      ${same ? '✓' : '✗'} kind ${k}: chromium ${a.byKind[k] ?? 0}, iPhone ${b.byKind[k] ?? 0}`;
  });

  let setAside = '';
  if (a.dom && b.dom) {
    const excused = [];
    const keep = (l) => {
      const rule = KNOWN.find((r) => r.test(l));
      if (rule) { excused.push([l, rule.why]); return false; }
      return true;
    };
    const onlyA = a.dom.lines.filter((l) => !b.dom.lines.includes(l));
    const onlyB = b.dom.lines.filter((l) => !a.dom.lines.includes(l));
    const keptA = onlyA.filter(keep);
    const keptB = onlyB.filter(keep);
    a.dom = { ...a.dom, lines: a.dom.lines.filter((l) => !onlyA.includes(l) || keptA.includes(l)) };
    b.dom = { ...b.dom, lines: b.dom.lines.filter((l) => !onlyB.includes(l) || keptB.includes(l)) };
    if (excused.length) {
      const whys = [...new Set(excused.map(([, w]) => w))];
      setAside = `   (${excused.length} line(s) set aside: ${whys.join('; ')})`;
    }
  }
  const domKeys = a.dom && b.dom ? ['lines', 'itemImages'] : [];
  const domDiff = domKeys.filter((k) => JSON.stringify(a.dom[k]) !== JSON.stringify(b.dom[k]));

  console.log(`\n── ${route}`);
  console.log(`   reads: chromium ${a.reads}, iPhone ${b.reads}`);
  if (kinds.length === 0) console.log('      (no relay read on this route)');
  kindLines.forEach((l) => console.log(l));
  if (domKeys.length) {
    // Layout differs by design between a 1440px window and a phone; only the
    // numbers printed on the page and the item counts are compared as data.
    const material = domDiff;
    console.log(`   dom: ${material.length === 0 ? `✓ same ${a.dom.lineCount} lines, ${a.dom.itemImages} pictures` : '✗ differs in ' + material.join(', ')}`);
    if (material.length) {
      material.forEach((k) => {
        const av = a.dom[k], bv = b.dom[k];
        if (Array.isArray(av)) {
          const onlyA = av.filter((x) => !bv.includes(x));
          const onlyB = bv.filter((x) => !av.includes(x));
          console.log(`      chromium has ${av.length} lines, iPhone ${bv.length}`);
          console.log(`      only on chromium (${onlyA.length}): ${onlyA.slice(0, 30).map((x) => JSON.stringify(x.slice(0, 80))).join(', ')}`);
          console.log(`      only on iPhone   (${onlyB.length}): ${onlyB.slice(0, 30).map((x) => JSON.stringify(x.slice(0, 80))).join(', ')}`);
        } else {
          console.log(`      chromium ${k}: ${av} | iPhone ${k}: ${bv}`);
        }
      });
      mismatches++;
    }
  }
  if (setAside) console.log(setAside);
  const errs = [...new Set([...a.errors, ...b.errors])].filter((e) => !/favicon|manifest|sw\.js|Download the React/i.test(e));
  if (errs.length) console.log('   console: ' + errs.slice(0, 3).join(' | '));
}

console.log(mismatches === 0 ? '\n✅ every route: the phone saw what the laptop saw' : `\n❌ ${mismatches} difference(s)`);
process.exit(mismatches === 0 ? 0 : 1);
