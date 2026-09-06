import { useMemo, useState } from 'react';
import { CheckCircle2, Hand, HelpCircle, Users, RefreshCw, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { useNostrProfilesCacheBulk } from '@/hooks/useNostrProfilesCacheBulk';
import type { AlignmentTally, AlignmentVote } from '@/lib/alignmentTally';

interface AlignmentResultsProps {
  tally?: AlignmentTally;
  /** False when no relay answered — an empty answer is not a result. */
  resolved: boolean;
  isLoading?: boolean;
  /** Voting has closed: these numbers are final, not a running standing. */
  ended: boolean;
  onRefresh?: () => void;
}

/** Names beyond this are behind a click; the largest live vote is 27 people. */
const SHOWN_BEFORE_FOLD = 8;

function formatWhen(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function shortKey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

interface VoteRowProps {
  vote: AlignmentVote;
  name?: string;
  picture?: string;
}

function VoteRow({ vote, name, picture }: VoteRowProps) {
  const resisted = vote.choice === 'resistance';
  return (
    <div className="flex items-start gap-2.5 py-2">
      <UserAvatar
        pubkey={vote.pubkey}
        picture={picture}
        name={name}
        className="h-8 w-8 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs sm:text-sm font-medium truncate max-w-[60vw] sm:max-w-none">
            {name || shortKey(vote.pubkey)}
          </span>
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 gap-1 ${
              resisted
                ? 'border-red-500/40 text-red-600 dark:text-red-400'
                : 'border-green-500/40 text-green-600 dark:text-green-400'
            }`}
          >
            {resisted ? <Hand className="h-2.5 w-2.5" /> : <CheckCircle2 className="h-2.5 w-2.5" />}
            {resisted ? 'Resisted' : 'Accepted'}
          </Badge>
          <span className="text-[10px] text-muted-foreground">{formatWhen(vote.createdAt)}</span>
        </div>
        {vote.comment && (
          <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground italic break-words whitespace-pre-line">
            "{vote.comment}"
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Who voted, how, and what they said about it.
 *
 * The proposal page carried no result at all: you could vote and never learn
 * what anyone else had decided, and the finished ones simply said "Accepted"
 * whether or not anybody had resisted. The votes were public on the relays the
 * whole time — this only reads them.
 */
export default function AlignmentResults({
  tally,
  resolved,
  isLoading,
  ended,
  onRefresh,
}: AlignmentResultsProps) {
  const [expanded, setExpanded] = useState(false);

  const accepted = useMemo(() => tally?.accepted ?? [], [tally]);
  const resisted = useMemo(() => tally?.resisted ?? [], [tally]);
  const total = accepted.length + resisted.length;

  // Resistance first: it is the rarer voice and the one that decides the
  // outcome, so it must never be buried under a page of acceptances.
  const ordered = useMemo(() => [...resisted, ...accepted], [resisted, accepted]);
  const shown = expanded ? ordered : ordered.slice(0, SHOWN_BEFORE_FOLD);

  const pubkeys = useMemo(() => ordered.map((v) => v.pubkey), [ordered]);
  const { profiles } = useNostrProfilesCacheBulk(pubkeys);

  const nameOf = (pubkey: string) => {
    const p = profiles.get(pubkey);
    return p?.display_name || p?.full_name || undefined;
  };

  return (
    <Card className="mb-4 sm:mb-6">
      <CardHeader className="p-3 sm:p-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm sm:text-base flex items-center gap-1.5 sm:gap-2">
            <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            {ended ? 'Final result' : 'Result so far'}
          </CardTitle>
          {onRefresh && (
            <Button variant="ghost" size="sm" onClick={onRefresh} className="h-7 w-7 p-0">
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-3 sm:p-4 pt-0">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-2 rounded-full bg-muted animate-pulse" />
            <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
          </div>
        ) : !resolved ? (
          <div className="flex items-start gap-2 text-xs sm:text-sm text-muted-foreground">
            <HelpCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              The votes could not be read — no relay answered. This is not a result of zero;
              please try again in a moment.
            </p>
          </div>
        ) : total === 0 ? (
          <p className="text-xs sm:text-sm text-muted-foreground">
            {ended ? 'Nobody voted on this alignment.' : 'Nobody has voted yet.'}
          </p>
        ) : (
          <>
            {/* The outcome in one sentence, before any numbers */}
            <p className="text-sm sm:text-base font-medium mb-3">
              {resisted.length > 0 ? (
                <span className="text-red-600 dark:text-red-400">
                  {resisted.length === 1 ? 'One person resisted' : `${resisted.length} people resisted`}
                  {accepted.length > 0 && `, ${accepted.length} accepted`}
                </span>
              ) : (
                <span className="text-green-600 dark:text-green-400">
                  {ended ? 'Aligned' : 'Aligning'} — {accepted.length}{' '}
                  {accepted.length === 1 ? 'person accepted' : 'people accepted'}, nobody resisted
                </span>
              )}
            </p>

            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted mb-2">
              <div
                className="bg-green-500"
                style={{ width: `${Math.round((accepted.length / total) * 100)}%` }}
              />
              <div className="flex-1 bg-red-500" />
            </div>

            <div className="flex items-center gap-4 text-xs sm:text-sm mb-3">
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {accepted.length} accepted
              </span>
              <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                <Hand className="h-3.5 w-3.5" />
                {resisted.length} resisted
              </span>
              <span className="text-muted-foreground ml-auto">
                {total} {total === 1 ? 'voice' : 'voices'}
              </span>
            </div>

            {!ended && (
              <p className="text-[10px] sm:text-xs text-muted-foreground mb-2">
                Voting is still open, so this can still change.
              </p>
            )}

            <div className="divide-y divide-border/60 border-t border-border/60">
              {shown.map((vote) => (
                <VoteRow
                  key={vote.id}
                  vote={vote}
                  name={nameOf(vote.pubkey)}
                  picture={profiles.get(vote.pubkey)?.picture}
                />
              ))}
            </div>

            {ordered.length > SHOWN_BEFORE_FOLD && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full text-xs sm:text-sm"
                onClick={() => setExpanded((open) => !open)}
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 mr-1.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
                {expanded
                  ? 'Show fewer'
                  : `Show all ${ordered.length} ${ordered.length === 1 ? 'voice' : 'voices'}`}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
