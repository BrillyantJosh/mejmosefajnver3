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
