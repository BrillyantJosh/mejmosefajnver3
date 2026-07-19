// Only the LATEST opinion of each being (per participant) belongs in the
// focused view — that is what the being currently holds. Everything older is
// history and moves behind the Arhiv toggle, so the page reads as the present
// state instead of a pile of superseded verdicts.
//
// The input MUST be sorted newest-first; the first entry seen per
// being×participant is the current one.
export function splitLatestPerBeing<T extends { beingPubkey: string; participantPubkey: string }>(
  entriesNewestFirst: T[],
): { current: T[]; archive: T[] } {
  const seen = new Set<string>();
  const current: T[] = [];
  const archive: T[] = [];
  for (const e of entriesNewestFirst) {
    const key = `${e.beingPubkey}|${e.participantPubkey}`;
    if (seen.has(key)) archive.push(e);
    else { seen.add(key); current.push(e); }
  }
  return { current, archive };
}

// A being's most recent word can hang off an assessment that just moved into
// the archive (it published guidance, then re-assessed minutes later). In the
// focused view that word would vanish and the being would look silent — so the
// LATEST guidance of each being floats up onto that being's current opinion.
export function withFloatedGuidance<
  G extends { beingPubkey: string; participantPubkey: string; created_at: number },
  E extends { id: string; beingPubkey: string; participantPubkey: string },
>(nested: Map<string, G[]>, guidance: G[], currentEntries: E[]): Map<string, G[]> {
  const key = (x: { beingPubkey: string; participantPubkey: string }) =>
    `${String(x.beingPubkey).toLowerCase()}|${String(x.participantPubkey).toLowerCase()}`;
  const home = new Map<string, E>();
  for (const e of currentEntries) if (!home.has(key(e))) home.set(key(e), e);   // already latest-first
  const shown = new Set<G>();
  for (const e of currentEntries) for (const g of nested.get(e.id) || []) shown.add(g);
  const latest = new Map<string, G>();
  for (const g of guidance) {
    const k = key(g);
    const cur = latest.get(k);
    if (!cur || g.created_at > cur.created_at) latest.set(k, g);
  }
  const out = new Map(nested);
  for (const [k, g] of latest) {
    if (shown.has(g)) continue;                 // already visible under its own anchor
    const h = home.get(k);
    if (!h) continue;                           // this being has no visible opinion
    out.set(h.id, [...(out.get(h.id) || []), g]);
  }
  return out;
}

// What a nested 87048 entry IS — a direction only when the being actually
// computed one; otherwise its own kind (acceptance/space/reminder/…), so
// "Smer" never mislabels a being that is holding space in silence.
export function guidanceKindKey(g: { guidanceType?: string | null; direction?: string | null }): string {
  if (g?.direction) return "direction";
  const t = String(g?.guidanceType || "").toLowerCase().replace(/_/g, "-");
  if (t === "acceptance") return "acceptance";
  if (t === "space") return "space";
  if (t === "reminder") return "reminder";
  if (t === "moving-on") return "movingOn";
  if (t === "closing-call") return "closingCall";
  if (t === "pause") return "pause";
  if (t === "celebration" || t === "celebrate") return "celebration";
  return "guidance";
}
