/**
 * The notice on /discount/sell and /bef/sell, as words: which sentence one
 * firm, two, three or none get, in English and Slovenian — both lana.discount's
 * own wording, word for word (Slovenian "LAN"/"LANE" and the formal "vi", as
 * Brilly asked for "ta isti popravek") — and that German, Hungarian and Italian
 * are whole; that the whole card, the line about past sales included, speaks
 * one language; what a broken answer from the server becomes, and that both
 * pages show the notice — nothing links to lana.discount/offer any more, every
 * firm's link opens in a new tab.
 *   npm run test:sell-moved
 *
 * Pure: no React, no browser, no network. Carries over what lana.discount's
 * src/components/SellingMovedNotice.test.tsx (1996af0) asserts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sellingMovedTranslations, { type SellingMovedKey } from '../i18n/modules/sellingMoved';
import discountTranslations from '../i18n/modules/discount';
import befTranslations from '../i18n/modules/bef';
import { SUPPORTED_LANGS } from '../i18n/types';
import {
  BEF_DIRECTORY_URL, closingStop, leadKey, nameParts, noticeWords, pastSalesParts, readBuyingDealers, registerKey, translatorFor,
  type BuyingDealer, type BuyingDealersAnswer,
} from './sellingMoved';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** lana.discount (1996af0), checked out next to this repo — compared with when it is there. */
const LANA_DISCOUNT = path.resolve(ROOT, '../lana-coin-discount-closed');
const lanaDiscountFile = (rel: string) => path.join(LANA_DISCOUNT, rel);
const lanaDiscountMissing = (rel: string) => !fs.existsSync(lanaDiscountFile(rel)) && `lana-coin-discount-closed/${rel} not found next to this repo`;

const KROG = 'Krog menjave, trgovanje in kroženje vrednosti d.o.o.';
const RAVENA = 'Ravena Plus d.o.o.';
const en = translatorFor(sellingMovedTranslations, 'en');
const sl = translatorFor(sellingMovedTranslations, 'sl');

const firm = (name: string, host: string, slug = host.split('.')[0]): BuyingDealer => ({
  slug, name, host, website: `https://${host}/`, registerUrl: `https://${host}/prijava`, sellUrl: `https://${host}/ko-kreacija/prodaj`,
  eventId: '1'.repeat(64), signedAt: '2026-10-08T10:00:00.000Z',
});
const TWO_FIRMS: BuyingDealersAnswer = {
  status: 'read', readAt: '2026-10-08T12:00:00.000Z', staleSince: null, directoryUrl: BEF_DIRECTORY_URL,
  buyers: [firm(KROG, 'krogmenjave.com', 'krog-menjave'), firm(RAVENA, 'ravenaplus.com', 'ravena-plus')],
};
const NO_FIRM: BuyingDealersAnswer = { status: 'unknown', readAt: null, staleSince: null, directoryUrl: BEF_DIRECTORY_URL, buyers: [] };

/* ── the sentences ───────────────────────────────────────────────────────── */

describe('the heading and the paragraph', () => {
  it('two firms — English, as lana.discount says it', () => {
    const w = noticeWords(en, [KROG, RAVENA]);
    assert.equal(w.title, `The purchase of LANA has been taken over by ${KROG} and ${RAVENA}`);
    assert.equal(w.paragraph, 'LANA can no longer be sold on Lana.discount. To sell your LANA, register with one of the two companies.');
    assert.deepEqual(w.names, [{ joint: null, name: KROG }, { joint: ' and ', name: RAVENA }]);
  });

  it('two firms — Slovenian, as Brilly asked and lana.discount says it: the verb agrees with two, "in" between the names', () => {
    const w = noticeWords(sl, [KROG, RAVENA]);
    assert.equal(w.title, `Odkup LAN sta prevzeli podjetji ${KROG} in ${RAVENA}`);
    assert.equal(w.paragraph, 'Na Lana.discount LAN ni več mogoče prodati. Če želite prodati svoje LANE, se registrirajte pri enem od obeh podjetij.');
  });

  it('one firm — "je prevzelo podjetje", "pri tem podjetju"', () => {
    const w = noticeWords(sl, [RAVENA]);
    assert.equal(w.title, `Odkup LAN je prevzelo podjetje ${RAVENA}`);
    assert.equal(w.paragraph, 'Na Lana.discount LAN ni več mogoče prodati. Če želite prodati svoje LANE, se registrirajte pri tem podjetju.');
    assert.equal(noticeWords(en, [RAVENA]).paragraph, 'LANA can no longer be sold on Lana.discount. To sell your LANA, register with this company.');
  });

  it('three firms — "so prevzela podjetja", "A, B in C", "pri enem od teh podjetij"', () => {
    const w = noticeWords(sl, ['Alfa d.o.o.', 'Beta d.o.o.', 'Gama']);
    assert.equal(w.title, 'Odkup LAN so prevzela podjetja Alfa d.o.o., Beta d.o.o. in Gama.');
    assert.equal(w.paragraph, 'Na Lana.discount LAN ni več mogoče prodati. Če želite prodati svoje LANE, se registrirajte pri enem od teh podjetij.');
    assert.equal(noticeWords(en, ['A', 'B', 'C']).title, 'The purchase of LANA has been taken over by A, B and C.');
  });

  it('a full stop after the last name — never a second one after "d.o.o."', () => {
    assert.equal(noticeWords(sl, ['Ravena Plus']).title, 'Odkup LAN je prevzelo podjetje Ravena Plus.');
    assert.equal(noticeWords(sl, [RAVENA]).title.endsWith('d.o.o.'), true);
    assert.equal(noticeWords(sl, [RAVENA]).title.endsWith('d.o.o..'), false);
    assert.equal(closingStop(['x d.o.o. ']), '');
    assert.equal(closingStop(['x']), '.');
  });

  it('no firm can be named — "other companies", and register on BEF Explorer', () => {
    const w = noticeWords(sl, []);
    assert.equal(w.lead, null);
    assert.equal(w.title, 'Odkup LAN so prevzela druga podjetja.');
    assert.equal(w.paragraph, 'Na Lana.discount LAN ni več mogoče prodati. Če želite prodati svoje LANE, se registrirajte pri enem od podjetij, navedenih na BEF Explorerju.');
    assert.equal(noticeWords(en, []).title, 'The purchase of LANA has been taken over by other companies.');
  });

  it('while loading: no count is named — "other companies", and the register sentence waits', () => {
    const w = noticeWords(sl, [], true);
    assert.equal(w.title, 'Odkup LAN so prevzela druga podjetja.');
    assert.equal(w.paragraph, 'Na Lana.discount LAN ni več mogoče prodati.');
    assert.equal(sl('moved.loading'), 'Berem podjetja z relejev Lana …');
    assert.equal(en('moved.loading'), 'Reading the companies from the Lana relays…');
  });

  it('which key for which count', () => {
    assert.deepEqual([0, 1, 2, 3, 7].map(leadKey), ['moved.lead.many', 'moved.lead.one', 'moved.lead.two', 'moved.lead.many', 'moved.lead.many']);
    assert.deepEqual([0, 1, 2, 3, 7].map(registerKey), ['moved.register.none', 'moved.register.one', 'moved.register.two', 'moved.register.many', 'moved.register.many']);
    assert.deepEqual(nameParts(['A', 'B', 'C'], 'in').map((p) => p.joint), [null, ', ', ' in ']);
  });

  it('every language reads whole: Hungarian puts the names after a colon', () => {
    const hu = translatorFor(sellingMovedTranslations, 'hu');
    assert.equal(noticeWords(hu, [KROG, RAVENA]).title, `A LANA felvásárlását átvették: ${KROG} és ${RAVENA}`);
    const de = translatorFor(sellingMovedTranslations, 'de');
    assert.equal(noticeWords(de, [RAVENA]).title, `Der Ankauf von LANA wurde übernommen von ${RAVENA}`);
    const it_ = translatorFor(sellingMovedTranslations, 'it');
    assert.equal(noticeWords(it_, ['A', 'B']).title, 'L’acquisto di LANA è stato rilevato da A e B.');
  });
});

/* ── the dictionary ──────────────────────────────────────────────────────── */

describe('the dictionary', () => {
  const dict = sellingMovedTranslations as unknown as Record<string, Record<string, string> | undefined>;
  const keys = Object.keys(sellingMovedTranslations.en) as SellingMovedKey[];

  it('English, Slovenian, German, Hungarian and Italian — every key, no other, never empty', () => {
    for (const lang of SUPPORTED_LANGS) {
      const words = dict[lang];
      assert.ok(words, `${lang} is there`);
      assert.deepEqual(Object.keys(words!).sort(), [...keys].sort(), lang);
      for (const key of keys) assert.ok(words![key].trim() !== '', `${lang} ${key}`);
    }
  });

  it('German, Hungarian and Italian are their own words, never English', () => {
    for (const lang of ['de', 'hu', 'it']) {
      const english = keys.filter((key) => dict[lang]![key] === sellingMovedTranslations.en[key]);
      assert.deepEqual(english, [], lang);
    }
  });

  it('Slovenian is the wording Brilly asked for: "LAN"/"LANE", the formal "vi", "Prodaj LANE"', () => {
    const text = Object.values(sellingMovedTranslations.sl!).join(' ');
    // One voice in the whole card, its line about past sales included.
    assert.ok(!/(^|[\s,])(želiš|registriraj|tvoje|tvoj|ti)([\s,.]|$)/i.test(text), 'no informal "ti"');
    assert.ok(!/\bLANA\b/.test(text), 'LAN / LANE, never LANA');
    assert.equal(sl('moved.button.sell'), 'Prodaj LANE');
    assert.equal(sl('moved.button.register'), 'Registracija in prijava');
    assert.equal(sl('moved.closed'), 'Na Lana.discount LAN ni več mogoče prodati.');
  });

  it('Slovenian is lana.discount’s own wording, word for word (when lana.discount is at hand)', { skip: lanaDiscountMissing('src/components/SellingMovedNotice.tsx') }, () => {
    const notice = fs.readFileSync(lanaDiscountFile('src/components/SellingMovedNotice.tsx'), 'utf8');
    const start = notice.indexOf('export const NOTICE_TEXT');
    const block = notice.slice(notice.indexOf('\n  sl: {', start), notice.indexOf('\n  en: {', start));
    assert.ok(block.length > 100, 'NOTICE_TEXT.sl found');
    const theirs = (field: string) => new RegExp(`\\n\\s*${field}:\\s*'([^']*)'`).exec(block)?.[1];
    const pairs: [string, SellingMovedKey][] = [
      ['one', 'moved.lead.one'], ['two', 'moved.lead.two'], ['many', 'moved.lead.many'], ['and', 'moved.and'],
      ['titleNone', 'moved.titleNone'], ['closed', 'moved.closed'],
      ['registerOne', 'moved.register.one'], ['registerTwo', 'moved.register.two'], ['registerMany', 'moved.register.many'],
      ['registerNone', 'moved.register.none'], ['register', 'moved.button.register'], ['sell', 'moved.button.sell'],
      ['directory', 'moved.directory'], ['loading', 'moved.loading'], ['source', 'moved.source'],
    ];
    for (const [field, key] of pairs) assert.equal(sellingMovedTranslations.sl![key], theirs(field), field);
  });

  it('the line about past sales: every language has it, with the tab’s name in it exactly once', () => {
    for (const lang of SUPPORTED_LANGS) {
      const sentence = dict[lang]!['moved.pastSales'];
      assert.equal(sentence.split('{tab}').length, 2, lang);
      assert.ok(!/\{(?!tab\})/.test(sentence), `${lang}: no other placeholder`);
    }
  });

  it('no npub, no link to lana.discount/offer — anywhere in the notice’s words', () => {
    for (const lang of SUPPORTED_LANGS) {
      const text = JSON.stringify(dict[lang]);
      assert.ok(!/npub/i.test(text), lang);
      assert.ok(!/lana\.discount\/offer/i.test(text), lang);
    }
  });

  it('English is lana.discount’s own wording, word for word (when lana.discount is at hand)', { skip: lanaDiscountMissing('src/copy.ts') }, () => {
    const copy = fs.readFileSync(lanaDiscountFile('src/copy.ts'), 'utf8');
    const block = copy.slice(copy.indexOf('export const SELLING_MOVED'));
    const theirs = (field: string) => new RegExp(`\\n\\s*${field}:\\s*'([^']*)'`).exec(block)?.[1];
    const pairs: [string, SellingMovedKey][] = [
      ['titleLead', 'moved.lead.two'], ['and', 'moved.and'], ['titleNone', 'moved.titleNone'], ['closed', 'moved.closed'],
      ['registerOne', 'moved.register.one'], ['registerTwo', 'moved.register.two'], ['registerMany', 'moved.register.many'],
      ['registerNone', 'moved.register.none'], ['register', 'moved.button.register'], ['sell', 'moved.button.sell'],
      ['directory', 'moved.directory'], ['loading', 'moved.loading'], ['source', 'moved.source'],
    ];
    for (const [field, key] of pairs) assert.equal(sellingMovedTranslations.en[key], theirs(field), field);
  });
});

/* ── what the server answers, taken apart ────────────────────────────────── */

describe('readBuyingDealers', () => {
  it('keeps a good answer as it is — a stale one too', () => {
    assert.deepEqual(readBuyingDealers(TWO_FIRMS), TWO_FIRMS);
    const stale = { ...TWO_FIRMS, status: 'stale', staleSince: '2026-10-08T12:10:00.000Z' };
    assert.deepEqual(readBuyingDealers(stale).buyers.map((b) => b.name), [KROG, RAVENA]);
    assert.equal(readBuyingDealers(stale).status, 'stale');
  });

  it('drops a firm whose link is javascript:, http, on another host or carries credentials — and one with no name', () => {
    const good = firm('Good d.o.o.', 'good.com');
    const answer = readBuyingDealers({
      ...TWO_FIRMS,
      buyers: [
        { ...firm('Evil', 'evil.com'), registerUrl: 'javascript:alert(1)' },
        { ...firm('Plain', 'plain.com'), sellUrl: 'http://plain.com/ko-kreacija/prodaj' },
        { ...firm('Elsewhere', 'elsewhere.com'), sellUrl: 'https://phish.example/ko-kreacija/prodaj' },
        { ...firm('Creds', 'creds.com'), website: 'https://user:pw@creds.com/' },
        { ...firm('   ', 'blank.com') },
        { ...firm('NoHost', 'nohost.com'), host: undefined },
        'not a firm',
        null,
        good,
      ],
    });
    assert.deepEqual(answer.buyers, [good]);
  });

  it('carries only the fields the page uses — an admin key or bank account the server might send is not kept', () => {
    const answer = readBuyingDealers({ ...TWO_FIRMS, buyers: [{ ...TWO_FIRMS.buyers[0], admins: ['a'.repeat(64)], iban: 'SI56191000000123438' }] });
    assert.deepEqual(Object.keys(answer.buyers[0]).sort(), ['eventId', 'host', 'name', 'registerUrl', 'sellUrl', 'signedAt', 'slug', 'website']);
  });

  it('nonsense, a failed request, or "unknown" — no firm at all, and BEF Explorer’s list', () => {
    for (const nonsense of ['nonsense', null, undefined, 42, [], { status: 'read', buyers: 'x' }]) {
      const a = readBuyingDealers(nonsense);
      assert.equal(a.buyers.length, 0);
      assert.equal(a.directoryUrl, BEF_DIRECTORY_URL);
    }
    assert.deepEqual(readBuyingDealers('nonsense'), NO_FIRM);
    assert.deepEqual(readBuyingDealers({ ...TWO_FIRMS, status: 'whatever' }).buyers, []);
    assert.equal(readBuyingDealers({ ...TWO_FIRMS, directoryUrl: 'javascript:alert(1)' }).directoryUrl, BEF_DIRECTORY_URL);
  });
});

/* ── the pages ───────────────────────────────────────────────────────────── */

describe('both Sell pages show the notice', () => {
  const notice = read('src/components/discount/SellingMovedNotice.tsx');
  const discountSell = read('src/pages/discount/DiscountSell.tsx');
  const befSell = read('src/pages/bef/BefSell.tsx');
  const befLayout = read('src/pages/bef/BefLayout.tsx');
  const hook = read('src/hooks/useBuyingDealers.ts');

  it('/discount/sell: the notice as the page’s h1, and its line about past sales under the Transactions tab as the module labels it', () => {
    assert.match(discountSell, /<SellingMovedNotice headingLevel="h1" pastSalesTab=\{\{ label: t\("layout\.nav\.transactions"\), lang: tabLang \}\} \/>/);
    assert.match(discountSell, /const tabLang = discountTranslations\[lang\] \? lang : "en";/);
    const said = (lang: string, tabLang: string) => {
      const p = pastSalesParts(translatorFor(sellingMovedTranslations, lang), (discountTranslations as unknown as Record<string, Record<string, string>>)[tabLang]['layout.nav.transactions']);
      return `${p.before}${p.tab}${p.after}`;
    };
    // English: the line /discount/sell had before, word for word.
    assert.equal(said('en', 'en'), 'Your past sales and payouts stay here, under Transactions.');
    assert.equal(said('sl', 'sl'), 'Vaše pretekle prodaje in izplačila ostanejo tukaj, pod Transakcije.');
  });

  it('/discount/sell for a German, Hungarian or Italian reader: the line in their language, naming the tab as it shows — in English', () => {
    assert.equal(discountTranslations.de, undefined, 'the Lana Discount module has no German (if it gets one, the tab is German too)');
    for (const lang of ['de', 'hu', 'it']) {
      const t = translatorFor(sellingMovedTranslations, lang);
      const p = pastSalesParts(t, 'Transactions');
      assert.equal(p.tab, 'Transactions', lang);
      assert.notEqual(`${p.before}{tab}${p.after}`, sellingMovedTranslations.en['moved.pastSales'], `${lang} is its own sentence`);
    }
    assert.equal((() => { const p = pastSalesParts(translatorFor(sellingMovedTranslations, 'de'), 'Transactions'); return `${p.before}${p.tab}${p.after}`; })(),
      'Ihre bisherigen Verkäufe und Auszahlungen bleiben hier, unter Transactions.');
    // A sentence without {tab}: said as it is, no label.
    assert.deepEqual(pastSalesParts(() => 'Nothing to name.', 'Transactions'), { before: 'Nothing to name.', tab: '', after: '' });
  });

  it('one card, one language: the card carries lang, the line about past sales is inside it, only the tab’s name carries its own', () => {
    assert.match(notice, /<section\s+data-testid="selling-moved"\s+lang=\{lang\}/);
    assert.equal((notice.match(/\blang=\{/g) ?? []).length, 2, 'the card, and the tab’s name');
    assert.match(notice, /<span lang=\{pastSalesTab\.lang\}>\{pastSales\.tab\}<\/span>/);
    const body = notice.slice(notice.indexOf('<section'), notice.indexOf('</section>'));
    assert.ok(body.includes('data-testid="past-sales"'), 'the line is inside the card');
    assert.ok(!/footer|sell\.moved\.note/.test(notice + discountSell), 'no line handed in from the module in its own language');
  });

  it('/bef/sell: the same notice, an h2 under BefLayout’s h1', () => {
    assert.match(befSell, /<SellingMovedNotice headingLevel="h2" \/>/);
  });

  it('the BEF Sell tab is the in-app page: no external href, no lana.discount', () => {
    const sellTab = /\{ title: t\("nav\.sell"\), path: "\/bef\/sell"[^}]*\}/.exec(befLayout)?.[0] ?? '';
    assert.equal(sellTab, '{ title: t("nav.sell"), path: "/bef/sell", icon: Tag }');
    assert.ok(!/BEF_SELL_URL/.test(befLayout + befSell));
  });

  it('nothing on either page, or in their dictionaries, sends anyone to lana.discount/offer', () => {
    const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const [name, text] of Object.entries({ notice, discountSell, befSell, befLayout, hook })) {
      assert.ok(!/lana\.discount\/offer/.test(code(text)), name);
    }
    for (const dict of [discountTranslations, befTranslations] as unknown as Record<string, Record<string, string>>[]) {
      assert.ok(!/lana\.discount\/offer|Submit an offer|Selling happens on/i.test(JSON.stringify(dict)));
      for (const words of Object.values(dict)) assert.ok(!Object.keys(words).some((k) => /^sell\.(title|body|cta)$|^sell\.moved\.(title|body|cta)$/.test(k)));
    }
  });

  it('every link opens in a new tab, with no opener and no referrer; no form, no field, no key', () => {
    const anchors = notice.match(/<a\b[^>]*>/g) ?? [];
    assert.equal(anchors.length, 4, 'website, register, sell, directory');
    for (const a of anchors) assert.match(a, /target="_blank"\s+rel="noopener noreferrer"/);
    assert.ok(!/<form|<input|<Input|WIF|privateKey|nsec/i.test(notice));
  });

  it('the firms come from this app’s own server, through readBuyingDealers', () => {
    assert.match(hook, /fetch\(`\$\{API_URL\}\/api\/buying-dealers`\)/);
    // The answer, and a failed request, both go through it.
    assert.equal((hook.match(/setAnswer\(readBuyingDealers\(/g) ?? []).length, 2);
    assert.ok(!/setAnswer\((?!readBuyingDealers)/.test(hook));
  });
});
