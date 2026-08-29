/**
 * "Which SPLIT did I enter at?" — answered on the holder's own plan page, so
 * nobody has to go and read a ledger transaction to find out.
 *
 * The SPLIT number is the whole answer, so it is the whole headline. Everything
 * that supports it — the reference price, the premium the plan started above
 * it, when that SPLIT began, the plan's own starting price — is true and stays
 * one click away, but a holder who only wants the number should not have to
 * read past it.
 *
 * The number needs the published KIND 38888 price ladder. When that cannot be
 * read or contradicts itself, this card says so plainly AND says that the
 * holder's plan is not what is wrong, because the two are easily confused and
 * only one of them is. A wrong SPLIT number would tell someone a false story
 * about their own money.
 */
import { useState } from 'react';
import { ChevronDown, LogIn } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  const [open, setOpen] = useState(false);

  const reading = resolveEntry({ plan, splitPrices, splitHistory, currentSplit, fxRate });
  if (reading.plan === 'unreadable') return null;

  const { terms, ladder } = reading;

  const price = (n: number) =>
    n.toLocaleString(lang, { minimumFractionDigits: 5, maximumFractionDigits: 8 });
  // A round premium should read "30 %", not "30,00 %" — the point of this card
  // is plainness. Fractions are still shown when a premium actually has them.
  const percent = (n: number) =>
    n.toLocaleString(lang, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

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
      <CardHeader className="p-4 md:p-6 pb-0">
        <CardTitle className="text-sm md:text-base font-medium text-muted-foreground flex items-center gap-2">
          <LogIn className="h-4 w-4 flex-shrink-0" />
          {t('entry.title')}
        </CardTitle>
      </CardHeader>

      <CardContent className="p-4 md:p-6 pt-2 md:pt-3">
        {ladder.status === 'determined' ? (
          <>
            <p className="text-xs md:text-sm text-muted-foreground">{t('entry.splitLabel')}</p>
            <p className="mt-0.5 text-4xl md:text-6xl font-bold tracking-tight leading-none">
              {t('entry.splitValue', { split: ladder.split })}
            </p>
          </>
        ) : (
          <>
            <p className="text-lg md:text-xl font-semibold">{t('entry.undetermined')}</p>
            <p className="mt-1 text-xs md:text-sm text-muted-foreground">{t('entry.planIsSound')}</p>
          </>
        )}

        <Collapsible open={open} onOpenChange={setOpen} className="mt-4">
          <CollapsibleTrigger className="flex items-center gap-1 text-xs md:text-sm text-muted-foreground hover:text-foreground transition-colors">
            {t('entry.details')}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>

          <CollapsibleContent className="pt-3 space-y-1.5 text-xs md:text-sm text-muted-foreground">
            {ladder.status === 'determined' ? (
              <>
                <p>
                  {t('entry.referencePrice', {
                    price: price(ladder.splitPrice),
                    currency: terms.currency,
                  })}
                </p>
                <p>
                  {ladder.premiumPercent < 0.005
                    ? t('entry.premiumNone')
                    : t('entry.premium', { percent: percent(ladder.premiumPercent) })}
                </p>
                {ladder.happenedAt !== null && (
                  <p>
                    {t('entry.splitBegan', {
                      split: ladder.split,
                      // 'medium' rather than a long month: Slovenian needs the
                      // genitive ("2. julija"), which Intl's standalone month
                      // name does not give, and the abbreviated form sidesteps
                      // the same declension trap in Hungarian.
                      date: new Date(ladder.happenedAt * 1000).toLocaleDateString(lang, {
                        dateStyle: 'medium',
                      }),
                    })}
                  </p>
                )}
              </>
            ) : (
              <>
                {reasonKey && <p>{t(reasonKey)}</p>}
                <p>{t('entry.noGuess')}</p>
              </>
            )}

            <p className="flex items-baseline justify-between gap-3 flex-wrap pt-1">
              <span>{t('entry.startPrice')}</span>
              <span className="font-mono font-semibold text-foreground">
                {t('entry.perLana', { price: price(terms.startPrice), currency: terms.currency })}
              </span>
            </p>
            <p>{t('entry.subtitle')}</p>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
};

export default EntrySplitCard;
