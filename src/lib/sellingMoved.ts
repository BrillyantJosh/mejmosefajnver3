/**
 * WHERE SELLING WENT — the pure half of the notice on /discount/sell and
 * /bef/sell (src/components/discount/SellingMovedNotice.tsx): what the server
 * answers, taken apart defensively, and which sentence a number of firms gets.
 *
 * Lana.discount no longer buys LANA (8 Oct 2026). Brilly: "napiši da sta
 * odkup Lan prevzela firme Krog Menjave ali Ravena Plus (beri iz Relayjev in
 * naj se uporabniki pri enem od podjetji registrirajo)", and for this app the
 * same day: "naredi ta isti popravek za prodajo tudi na strani
 * https://app.mejmosefajn.org/discount/sell preko katere uporabniki isto jih
 * preusmer na ta podjetja" (Brilly, 8. 10. 2026). The firms come from GET
 * /api/buying-dealers (server/lib/buyingDealers.ts), never from this file.
 *
 * No React and no import.meta.env here, so node:test runs it as it is
 * (src/lib/sellingMoved.test.ts); the fetch lives in
 * src/hooks/useBuyingDealers.ts. A port of lana.discount src/lib/sellingClosed.ts
 * readBuyingDealers and of the wording rules in its SellingMovedNotice.tsx
 * (1996af0).
 */
import type { SellingMovedKey } from '../i18n/modules/sellingMoved';

/** Where the companies are listed when no firm can be named here. A real route of BEF Explorer. */
export const BEF_DIRECTORY_URL = 'https://befexplorer.com/companies';

/** One firm, as GET /api/buying-dealers names it (server/lib/buyingDealers.ts BuyingDealer). */
export interface BuyingDealer {
  slug: string;
  name: string;
  host: string;
  website: string;
  /** Registration and sign-in at the firm: https://<host>/prijava. */
  registerUrl: string;
  /** The firm's own page for selling LANA to it: https://<host>/ko-kreacija/prodaj. */
  sellUrl: string;
  eventId: string;
  signedAt: string;
}

export interface BuyingDealersAnswer {
  status: 'read' | 'stale' | 'unknown';
  readAt: string | null;
  staleSince: string | null;
  directoryUrl: string;
  buyers: BuyingDealer[];
}

/** A link this page will put in an href: https, to the firm's own host, nothing else. */
const linkOnHost = (url: unknown, host: string): url is string => {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === host && !u.username && !u.password;
  } catch {
    return false;
  }
};

/**
 * The server's answer, taken apart defensively: a firm is shown only when its
 * name is text and every link points at https on its own host. Anything that
 * does not hold up is dropped, never repaired; a whole answer that does not
 * hold up is "unknown" with no firm. Only the fields the page uses are kept.
 */
export function readBuyingDealers(data: unknown): BuyingDealersAnswer {
  const d = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const directoryUrl = typeof d.directoryUrl === 'string' && /^https:\/\/[^/\s]+/.test(d.directoryUrl) ? d.directoryUrl : BEF_DIRECTORY_URL;
  const buyers: BuyingDealer[] = [];
  for (const raw of Array.isArray(d.buyers) ? d.buyers : []) {
    const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (typeof b.name !== 'string' || b.name.trim() === '' || typeof b.host !== 'string' || b.host === '') continue;
    if (!linkOnHost(b.registerUrl, b.host) || !linkOnHost(b.sellUrl, b.host) || !linkOnHost(b.website, b.host)) continue;
    buyers.push({
      slug: typeof b.slug === 'string' ? b.slug : '',
      name: b.name.trim(),
      host: b.host,
      website: b.website as string,
      registerUrl: b.registerUrl as string,
      sellUrl: b.sellUrl as string,
      eventId: typeof b.eventId === 'string' ? b.eventId : '',
      signedAt: typeof b.signedAt === 'string' ? b.signedAt : '',
    });
  }
  const status = d.status === 'read' || d.status === 'stale' ? d.status : 'unknown';
  return {
    status,
    readAt: typeof d.readAt === 'string' ? d.readAt : null,
    staleSince: typeof d.staleSince === 'string' ? d.staleSince : null,
    directoryUrl,
    buyers: status === 'unknown' ? [] : buyers,
  };
}

/* ── which sentence ──────────────────────────────────────────────────────── */

/** The words before the names: one firm, two, or more — Slovenian agrees the verb with the count. */
export function leadKey(count: number): SellingMovedKey {
  return count === 1 ? 'moved.lead.one' : count === 2 ? 'moved.lead.two' : 'moved.lead.many';
}

/** "register with this company" / "one of the two" / "one of these" / "one listed on BEF Explorer". */
export function registerKey(count: number): SellingMovedKey {
  return count <= 0 ? 'moved.register.none' : count === 1 ? 'moved.register.one' : count === 2 ? 'moved.register.two' : 'moved.register.many';
}

/** One name of the heading and what stands before it: nothing, ", " or " and ". */
export interface NamePart {
  joint: string | null;
  name: string;
}

/** "A", "A and B", "A, B and C" — the joints in the reader's language (`and` is the word itself). */
export function nameParts(names: string[], and: string): NamePart[] {
  return names.map((name, i) => ({
    joint: i === 0 ? null : i === names.length - 1 ? ` ${and} ` : ', ',
    name,
  }));
}

/** A full stop after the last name, unless it already ends in one ("Ravena Plus d.o.o."). */
export function closingStop(names: string[]): string {
  const last = names[names.length - 1];
  return last && last.trim().endsWith('.') ? '' : '.';
}

export interface NoticeWords {
  /** The words before the names, or null when no firm can be named. */
  lead: string | null;
  names: NamePart[];
  stop: string;
  /** The heading as plain text (the names are bold on the page). */
  title: string;
  /** "LANA can no longer be sold on Lana.discount." plus, once the firms are known, where to register. */
  paragraph: string;
}

/**
 * Everything the notice says, for a list of firm names. `loading`: the answer
 * has not come back yet — the heading says "other companies" and the register
 * sentence waits, so it never names a count it does not know.
 */
export function noticeWords(t: (key: SellingMovedKey) => string, names: string[], loading = false): NoticeWords {
  const closed = t('moved.closed');
  const paragraph = loading ? closed : `${closed} ${t(registerKey(names.length))}`;
  if (names.length === 0) {
    const none = t('moved.titleNone');
    return { lead: null, names: [], stop: '', title: none, paragraph };
  }
  const lead = t(leadKey(names.length));
  const parts = nameParts(names, t('moved.and'));
  const stop = closingStop(names);
  const title = `${lead} ${parts.map((p) => `${p.joint ?? ''}${p.name}`).join('')}${stop}`;
  return { lead, names: parts, stop, title, paragraph };
}

/** The line about past sales, around the Transactions tab's name. */
export interface PastSalesParts {
  before: string;
  /** The tab's label exactly as the Lana Discount module shows it — the page marks it with that label's own language. */
  tab: string;
  after: string;
}

/**
 * /discount/sell's line about past sales ("… stay here, under Transactions."),
 * in the notice's language, split where `{tab}` stands so the page can mark the
 * tab's label with the language it is really in: the Lana Discount module has
 * only English and Slovenian, so for a German, Hungarian or Italian reader the
 * label is English inside a German, Hungarian or Italian sentence. A sentence
 * without `{tab}` is said as it is, with no label.
 */
export function pastSalesParts(t: (key: SellingMovedKey) => string, tab: string): PastSalesParts {
  const sentence = t('moved.pastSales');
  const at = sentence.indexOf('{tab}');
  if (at < 0) return { before: sentence, tab: '', after: '' };
  return { before: sentence.slice(0, at), tab, after: sentence.slice(at + '{tab}'.length) };
}

/** A translator over one dictionary language, English filling a gap — what useTranslation() does, for tests and plain text. */
export function translatorFor(dict: { en: Record<SellingMovedKey, string> } & Partial<Record<string, Record<SellingMovedKey, string>>>, lang: string) {
  const words = dict[lang] ?? dict.en;
  return (key: SellingMovedKey) => words[key] ?? dict.en[key] ?? key;
}
