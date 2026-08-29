/**
 * "When did I enter, and on what terms?" — answered on the holder's own plan
 * page, so nobody has to go and read a ledger transaction to find out.
 *
 * The starting price and what 100 units of the holder's currency came to at it
 * are read straight out of their own plan, so they are always shown. The SPLIT
 * number additionally needs the published KIND 38888 price ladder; when that
 * cannot be read or contradicts itself, this card says so in plain words
 * instead of showing a nearest guess. A wrong SPLIT number would tell someone
 * a false story about their own money.
 */
import { LogIn } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n/I18nContext';
import lana8wonderTranslations from '@/i18n/modules/lana8wonder';
import { resolveEntry, type PlanLike, type SplitPriceRow, type SplitHistoryRow } from '@/lib/splitEntry';

interface EntrySplitCardProps {
  plan: PlanLike | null;
  splitPrices: SplitPriceRow[] | null;
  splitHistory: SplitHistoryRow[] | null;
  currentSplit: number | null;
  fxRate: number | null;
}

const EntrySplitCard = ({ plan, splitPrices, splitHistory, currentSplit, fxRate }: EntrySplitCardProps) => {
  const { t, lang } = useTranslation(lana8wonderTranslations);

  const reading = resolveEntry({ plan, splitPrices, splitHistory, currentSplit, fxRate });
  if (reading.plan === 'unreadable') return null;

  const { terms, ladder } = reading;

  const price = (n: number) =>
    n.toLocaleString(lang, { minimumFractionDigits: 5, maximumFractionDigits: 8 });
  const amount = (n: number) =>
    n.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const reasonKey = (() => {
    switch (ladder.status) {
      case 'no-parameters':
        return 'entry.reason.noParameters' as const;
      case 'no-ladder':
        return 'entry.reason.noLadder' as const;
      case 'ladder-inconsistent':
        return ladder.reason === 'contradicts-fx'
          ? ('entry.reason.inconsistentFx' as const)
          : ('entry.reason.inconsistentDoubling' as const);
      case 'no-match':
        return 'entry.reason.noMatch' as const;
      default:
        return null;
    }
  })();

  return (
    <Card className="border-primary/40">
      <CardHeader className="p-4 md:p-6 pb-2 md:pb-3">
        <CardTitle className="text-lg md:text-xl flex items-center gap-2">
          <LogIn className="h-5 w-5 flex-shrink-0" />
          {t('entry.title')}
        </CardTitle>
        <CardDescription className="text-xs md:text-sm">{t('entry.subtitle')}</CardDescription>
      </CardHeader>

      <CardContent className="p-4 md:p-6 pt-0 space-y-4">
        {ladder.status === 'determined' ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 md:p-4 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs md:text-sm text-muted-foreground">{t('entry.splitLabel')}</span>
              <Badge variant="default" className="text-sm md:text-base px-2.5 py-0.5">
                {t('entry.splitValue', { split: ladder.split })}
              </Badge>
            </div>
            <p className="text-xs md:text-sm text-muted-foreground">
              {t('entry.referencePrice', {
                price: price(ladder.splitPrice),
                currency: terms.currency,
              })}
            </p>
            <p className="text-xs md:text-sm text-muted-foreground">
              {ladder.premiumPercent < 0.005
                ? t('entry.premiumNone')
                : t('entry.premium', { percent: amount(ladder.premiumPercent) })}
            </p>
            {ladder.happenedAt !== null && (
              <p className="text-xs md:text-sm text-muted-foreground">
                {t('entry.splitBegan', {
                  split: ladder.split,
                  // 'medium' rather than a long month: Slovenian needs the
                  // genitive ("2. julija"), which Intl's standalone month name
                  // does not give, and the abbreviated form sidesteps the same
                  // declension trap in Hungarian.
                  date: new Date(ladder.happenedAt * 1000).toLocaleDateString(lang, {
                    dateStyle: 'medium',
                  }),
                })}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-muted-foreground/30 bg-muted/40 p-3 md:p-4 space-y-1.5">
            <p className="text-sm md:text-base font-semibold">{t('entry.undetermined')}</p>
            {reasonKey && <p className="text-xs md:text-sm text-muted-foreground">{t(reasonKey)}</p>}
            <p className="text-xs md:text-sm text-muted-foreground">{t('entry.noGuess')}</p>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <span className="text-xs md:text-sm text-muted-foreground">{t('entry.startPrice')}</span>
            <span className="font-mono text-sm md:text-base font-semibold">
              {t('entry.perLana', { price: price(terms.startPrice), currency: terms.currency })}
            </span>
          </div>
          <p className="text-xs md:text-sm text-muted-foreground">
            {t('entry.hundredBuys', {
              currency: terms.currency,
              lana: amount(terms.lanaPerHundred),
            })}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default EntrySplitCard;
