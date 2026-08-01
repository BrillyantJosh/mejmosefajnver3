/**
 * ❄️ — one person is frozen in this process (KIND 87057).
 *
 * ONE component, deliberately. The silence copy is duplicated across four
 * files in this folder and has already drifted once; a sanction that reads
 * differently depending on which screen you are looking at is worse than one
 * that reads plainly everywhere. Every surface renders this.
 *
 * Cold blue, never the amber of the beings' silence: one is a decision someone
 * made about this person, the other is the beings stepping back to leave room.
 */
import { Badge } from '@/components/ui/badge';
import type { PersonFreezeState } from '@/lib/ownFreeze';

const fmtDate = (unix: number | null | undefined, en: boolean): string => {
  if (!unix || !Number.isFinite(unix)) return '';
  return new Date(unix * 1000).toLocaleDateString(en ? 'en-GB' : 'sl-SI', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
};

/** "Zamrznjen · do SPLITA 10" — and never an invented end for an open freeze. */
export const freezeLabel = (state: PersonFreezeState, en: boolean): string => {
  const n = state.decidedBy?.untilSplit;
  const word = en ? 'Frozen' : 'Zamrznjen';
  if (n == null) return word;
  return en ? `${word} · up to SPLIT ${n}` : `${word} · do SPLITA ${n}`;
};

/** The chip that goes next to a person's name. */
export const FreezeBadge = ({ state, en }: { state: PersonFreezeState | undefined | null; en: boolean }) => {
  if (!state?.frozen) return null;
  const reason = state.decidedBy?.reason || '';
  const on = fmtDate(state.decidedBy?.effectiveAt, en);
  return (
    <Badge
      variant="outline"
      title={[on && (en ? `Frozen on ${on}` : `Zamrznjen dne ${on}`), reason].filter(Boolean).join(' — ')}
      className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30 text-[10px] py-0 shrink-0"
    >
      ❄️ {freezeLabel(state, en)}
    </Badge>
  );
};

/**
 * The full notice, for surfaces with room for the reason.
 *
 * The date always comes from `effective_at`, never from when the notice
 * reached a relay.
 */
export const FreezeNotice = ({ state, en }: { state: PersonFreezeState | undefined | null; en: boolean }) => {
  if (!state?.frozen) return null;
  const n = state.decidedBy?.untilSplit;
  const on = fmtDate(state.decidedBy?.effectiveAt, en);
  const reason = state.decidedBy?.reason || '';
  return (
    <div className="rounded-md border border-blue-500/30 bg-blue-500/[0.06] px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 font-semibold text-blue-700 dark:text-blue-400">
        <span aria-hidden="true">❄️</span>
        <span>{en ? 'The facilitator froze this person' : 'Fasilitator je to osebo zamrznil'}</span>
      </div>
      <p className="mt-1 text-muted-foreground">
        {n == null
          ? (en ? 'Open-ended — it holds until a facilitator lifts it.' : 'Za nedoločen čas — velja, dokler je fasilitator ne odpravi.')
          : (en ? `It holds up to SPLIT ${n}, and ends by itself as that round opens.` : `Velja do SPLITA ${n} in sama preneha, ko vstopimo v ta krog.`)}
        {on && (en ? ` Frozen on ${on}.` : ` Zamrznjen dne ${on}.`)}
      </p>
      {reason && <p className="mt-1 italic text-blue-800 dark:text-blue-300">{reason}</p>}
    </div>
  );
};
