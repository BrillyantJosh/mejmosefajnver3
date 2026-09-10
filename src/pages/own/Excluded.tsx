import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, Ban } from 'lucide-react';
import { useExclusions } from '@/hooks/useExclusions';
import { useNostrProfilesCacheBulk } from '@/hooks/useNostrProfilesCacheBulk';
import { useLang } from '@/i18n/I18nContext';

/**
 * People a commission has excluded, and why.
 *
 * ACTIVE ONLY, deliberately. A withdrawn or lapsed decision is over, and a
 * list that kept showing it would go on punishing after the community stopped
 * — the page would become a permanent record of who once was out, which is
 * exactly what a withdrawal is meant to end.
 *
 * The stated ground is shown in full. An exclusion without its reason is just
 * a name on a list, and that is the shape this must never take.
 */
export default function Excluded() {
  const lang = useLang();
  const en = lang === 'en';
  const { exclusions, isLoading } = useExclusions();

  const pubkeys = useMemo(() => exclusions.map((e) => e.personHex), [exclusions]);
  const { profiles } = useNostrProfilesCacheBulk(pubkeys);

  const nameOf = (hex: string) =>
    profiles[hex]?.display_name || profiles[hex]?.name || `${hex.slice(0, 8)}…${hex.slice(-4)}`;

  const fmt = (unix: number) =>
    new Date(unix * 1000).toLocaleDateString(en ? 'en-GB' : 'sl-SI', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

  return (
    <div className="space-y-4 px-4 md:px-0">
      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <p className="text-sm text-muted-foreground">
          {en
            ? 'People a commission of facilitators has excluded from the community, with the ground stated in the decision. Only exclusions that still stand are listed — a withdrawn or lapsed one is over and is not kept here.'
            : 'Osebe, ki jih je komisija fasilitatorjev izključila iz skupnosti, skupaj z razlogom iz odločitve. Prikazane so samo izključitve, ki še veljajo — umaknjena ali potekla je končana in se tu ne hrani.'}
        </p>
      </div>

      {isLoading ? (
        <div className="py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
      ) : exclusions.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <p className="text-muted-foreground">
            {en ? 'Nobody is currently excluded' : 'Trenutno ni nihče izključen'}
          </p>
        </CardContent></Card>
      ) : (
        exclusions.map((ex) => (
          <Card key={ex.eventId} className="border-red-500/30">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={profiles[ex.personHex]?.picture} />
                    <AvatarFallback>{nameOf(ex.personHex).slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{nameOf(ex.personHex)}</p>
                    <p className="text-xs text-muted-foreground">
                      {en ? 'Excluded on' : 'Izključen dne'} {fmt(ex.since)}
                      {ex.untilSplit != null && (
                        <> · {en ? `up to SPLIT ${ex.untilSplit}` : `do SPLITA ${ex.untilSplit}`}</>
                      )}
                    </p>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="shrink-0 gap-1 border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
                >
                  <Ban className="h-3 w-3" />
                  {en ? 'Excluded' : 'Izključen'}
                </Badge>
              </div>

              {ex.reason ? (
                <p className="whitespace-pre-wrap border-t border-border pt-3 text-sm leading-relaxed text-foreground">
                  {ex.reason}
                </p>
              ) : (
                <p className="border-t border-border pt-3 text-sm italic text-muted-foreground">
                  {en
                    ? 'The stated ground could not be read from the decision.'
                    : 'Razloga iz odločitve ni bilo mogoče prebrati.'}
                </p>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
