/**
 * The description an OWN process was opened with — as it should be READ.
 *
 * The description lives in the KIND 37044 event's `content`, which nothing in
 * this app had ever looked at, so opening a process showed only its title.
 *
 * `content` arrives in two shapes, both live on the relays today:
 *
 *   "Process initiated: <title>"                 ← selfresponsible.life stamps
 *                                                  this and nothing else
 *   "Process initiated: <title>\n\n<the real description>"
 *   "<the real description>"                     ← no stamp at all
 *
 * That first line is the title again, which the reader already has in the
 * heading right above it. Five of the thirteen live processes contain nothing
 * else, and in three more the stamped title is a STALE one (the title tag was
 * edited afterwards) — printing it would show people the wrong subject. So the
 * stamp line goes, and whatever follows is the description.
 */

/** Written by selfresponsible.life (CreateProcessDialog, TakeOverCaseDialog). */
const OPENING_STAMP = /^process initiated:/i;

/** A NIP-04 payload ends in ?iv=… — ciphertext must never reach a reader. */
const ENCRYPTED = /\?iv=[A-Za-z0-9+/=]+$/;

export function processDescription(content: string | null | undefined): string {
  const text = (content || '').trim();
  if (!text) return '';
  if (ENCRYPTED.test(text)) return '';
  if (!OPENING_STAMP.test(text)) return text;

  // Drop the stamp line only. No newline means the stamp was the whole content,
  // which leaves nothing to show.
  const firstBreak = text.indexOf('\n');
  return firstBreak === -1 ? '' : text.slice(firstBreak + 1).trim();
}

/**
 * Whether to fold the description behind a "show more".
 *
 * Deliberately a fixed rule rather than a measurement: a sticky header measures
 * differently before and after the webfont lands, and a toggle that appears and
 * disappears under the reader is worse than one that is occasionally shown for
 * a description that would just have fitted.
 *
 * Every real description on the relays (349–1044 characters, most carrying
 * tables across many lines) folds; every stamped title does not.
 */
export const DESCRIPTION_FOLD_CHARS = 160;

export function descriptionNeedsFolding(description: string): boolean {
  return description.length > DESCRIPTION_FOLD_CHARS || description.includes('\n');
}

/**
 * The description to show, given both events.
 *
 * The CASE (KIND 87044) holds what the initiator actually wrote — the reason
 * the process was opened. The process record (KIND 37044) usually holds only
 * the stamped title. So the case wins whenever it says anything, and the
 * process record is the fallback for the few cases the relays cannot produce.
 */
export function pickProcessDescription(
  caseContent: string | null | undefined,
  processContent: string | null | undefined
): string {
  return processDescription(caseContent) || processDescription(processContent);
}
