import { CheckCircle2, Hand, Users, HelpCircle } from 'lucide-react';
import type { AlignmentTally } from '@/lib/alignmentTally';

interface TallyStripProps {
  tally?: AlignmentTally;
  /** False when no relay answered: silence is never printed as a row of zeros. */
  resolved: boolean;
  isLoading?: boolean;
  /** Voting closed — the numbers are the final word rather than a standing. */
  ended?: boolean;
  className?: string;
}

/**
 * The result of an alignment in one line, for a card in the list.
 *
 * The list used to stamp every finished alignment "Accepted" from a hardcoded
 * `const wasAccepted = true` — right by luck on nine of the ten live ones and
 * wrong on the tenth, which carries a resistance. Everything here is counted.
 */
export default function TallyStrip({ tally, resolved, isLoading, ended, className }: TallyStripProps) {
  if (isLoading) {
    return (
      <div className={`h-1.5 rounded-full bg-muted animate-pulse ${className || ''}`} />
    );
  }

  if (!resolved) {
    return (
      <div className={`flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground ${className || ''}`}>
        <HelpCircle className="h-3 w-3 shrink-0" />
        <span>Result not loaded — no relay answered</span>
      </div>
    );
  }

  const accepted = tally?.accepted.length ?? 0;
  const resisted = tally?.resisted.length ?? 0;
  const total = accepted + resisted;

  if (total === 0) {
    return (
      <div className={`flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground ${className || ''}`}>
        <Users className="h-3 w-3 shrink-0" />
        <span>{ended ? 'Nobody voted' : 'No votes yet'}</span>
      </div>
    );
  }

  const acceptedPct = Math.round((accepted / total) * 100);

  return (
    <div className={`space-y-1.5 ${className || ''}`}>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="bg-green-500" style={{ width: `${acceptedPct}%` }} />
        <div className="flex-1 bg-red-500" />
      </div>
      <div className="flex items-center gap-3 text-[10px] sm:text-xs">
        <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
          <CheckCircle2 className="h-3 w-3" />
          {accepted} accepted
        </span>
        {resisted > 0 && (
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
            <Hand className="h-3 w-3" />
            {resisted} resisted
          </span>
        )}
        <span className="text-muted-foreground ml-auto">
          {total} {total === 1 ? 'voice' : 'voices'}
        </span>
      </div>
    </div>
  );
}
