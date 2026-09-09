import { AlertTriangle, Snowflake } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect } from 'react';
import { useTranslation, useLangControl } from '@/i18n/I18nContext';
import { frozenDict } from '@/i18n/modules/frozen';
import { specificGround, type FreezeVerdict } from '@/lib/ownFreezeGate';
import { ReentryRequestForm } from '@/components/ReentryRequestForm';

/**
 * Shown INSTEAD of the app when a commission decision stands.
 *
 * Deliberately a dead end: no navigation, nothing of the person's own content,
 * and no way past it. The point of the sanction is that the account is not
 * reachable, so this screen must not be a doorway with a nicer sign on it.
 */
export const FrozenOutScreen = ({
  verdict,
  onBack,
  signWith,
  relays,
}: {
  verdict: FreezeVerdict;
  onBack: () => void;
  /**
   * The person's own key, held in memory only so they can sign a re-entry
   * request. Never written to storage: they are signed out, and a sanction is
   * no reason to start keeping their key around.
   */
  signWith?: string;
  relays?: string[];
}) => {
  const { setLang } = useLangControl();

  // Apply the person's own language: they are signed out by the time this
  // renders, so nothing else still knows it.
  useEffect(() => {
    const l = verdict.lang;
    if (l && ['en', 'sl', 'de', 'hu', 'it'].includes(l)) setLang(l as 'en' | 'sl' | 'de' | 'hu' | 'it');
  }, [verdict.lang, setLang]);

  const { t } = useTranslation(frozenDict);

  const since =
    verdict.since && Number.isFinite(verdict.since)
      ? new Date(verdict.since * 1000).toLocaleDateString(undefined, {
          year: 'numeric', month: 'long', day: 'numeric',
        })
      : null;

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <Snowflake className="h-5 w-5 text-destructive" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-semibold sm:text-3xl">{t('frozen.title')}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('frozen.lead')}</p>
          </div>
        </div>

        {/* The commission's own words, or an honest note that they would not load. */}
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('frozen.reasonLabel')}
          </p>
          {specificGround(verdict.reason) ? (
            <p className="whitespace-pre-wrap text-[0.95rem] leading-relaxed text-foreground">
              {specificGround(verdict.reason)}
            </p>
          ) : (
            <p className="text-sm italic leading-relaxed text-muted-foreground">{t('frozen.noReason')}</p>
          )}
          <div className="mt-3 space-y-1 border-t border-destructive/20 pt-3 text-xs text-muted-foreground">
            {since && <p>{t('frozen.sinceLabel')}: {since}</p>}
            <p>{t('frozen.indefinite')}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">{t('frozen.returnTitle')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('frozen.returnIntro')}</p>

          <ol className="mt-4 space-y-3">
            {[t('frozen.q1'), t('frozen.q2'), t('frozen.q3'), t('frozen.q4')].map((q, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed text-foreground">{q}</span>
              </li>
            ))}
          </ol>

          <div className="mt-5 space-y-3 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
            <p>{t('frozen.principlesA')}</p>
            <p>{t('frozen.principlesB')}</p>
            <p className="border-l-2 border-primary/50 pl-3 font-medium text-foreground">
              {t('frozen.motto')}
            </p>
            <p>{t('frozen.principlesC')}</p>
            <p>{t('frozen.principlesD')}</p>
            <p>{t('frozen.principlesE')}</p>
          </div>
        </div>

        {/* The one act left to them. Without it a sanction has no route back. */}
        {signWith && relays && relays.length > 0 && (
          <ReentryRequestForm
            privateKeyHex={signWith}
            relays={relays}
            violationEventId={verdict.violationEventId}
            onSent={() => { /* the form shows its own confirmation */ }}
          />
        )}

        <Button variant="outline" onClick={onBack} className="w-full sm:w-auto">
          {t('frozen.back')}
        </Button>
      </div>
    </div>
  );
};
