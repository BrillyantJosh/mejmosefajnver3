/**
 * The little bit of formatting people actually put in an OWN case description.
 *
 * Rendered with `whitespace-pre-wrap` the text kept its line breaks but nothing
 * else: bullets showed as a literal "*", tab-separated figures collapsed, and
 * paragraphs ran together. This turns the raw text into a structure the
 * renderer can lay out properly.
 *
 * Scope comes from the eight real case texts on the relays, not from guesswork:
 * blank-line paragraphs (3), http links (2), "*" bullets (1) and tab-separated
 * rows (1). No bold, headings or numbered lists appear anywhere, so none are
 * invented here — but "-" and "•" are accepted as bullets because that is what
 * the next person will type.
 *
 * Output is a STRUCTURE, never markup. Nothing here produces HTML, so a case
 * description — which is public, relay-hosted text written by someone else —
 * can never inject anything into the page.
 */

export type RichSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; href: string; text: string };

export type RichBlock =
  | { kind: 'paragraph'; lines: RichSegment[][] }
  | { kind: 'list'; items: RichSegment[][] }
  | { kind: 'table'; rows: RichSegment[][][] };

const BULLET = /^\s*[*\-•]\s+(.*)$/;
/** Only http(s). Never javascript:, data: or anything else clickable. */
const LINK = /https?:\/\/[^\s<>"')\]]+/g;

/** Split one line into plain text and links, in order. */
export function parseSegments(line: string): RichSegment[] {
  const out: RichSegment[] = [];
  let last = 0;
  for (const m of line.matchAll(LINK)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: 'text', text: line.slice(last, start) });
    // Trailing sentence punctuation is not part of the address.
    const raw = m[0].replace(/[.,;:!?]+$/, '');
    out.push({ kind: 'link', href: raw, text: raw });
    last = start + raw.length;
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) });
  return out.length ? out : [{ kind: 'text', text: line }];
}

export function parseRichText(input: string | null | undefined): RichBlock[] {
  const text = (input || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];

  const blocks: RichBlock[] = [];
  let paragraph: RichSegment[][] = [];
  let list: RichSegment[][] = [];
  let table: RichSegment[][][] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', lines: paragraph });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: 'list', items: list });
    list = [];
  };
  const flushTable = () => {
    if (table.length) blocks.push({ kind: 'table', rows: table });
    table = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushTable(); };

  for (const line of text.split('\n')) {
    if (!line.trim()) { flushAll(); continue; }

    const bullet = line.match(BULLET);
    if (bullet) {
      flushParagraph(); flushTable();
      list.push(parseSegments(bullet[1].trim()));
      continue;
    }

    if (line.includes('\t')) {
      flushParagraph(); flushList();
      table.push(line.split('\t').map((cell) => parseSegments(cell.trim())));
      continue;
    }

    flushList(); flushTable();
    paragraph.push(parseSegments(line));
  }

  flushAll();
  return blocks;
}
