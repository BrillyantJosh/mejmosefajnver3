import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Lock, Check } from 'lucide-react';
import { useTranslation } from '@/i18n/I18nContext';
import { frozenDict } from '@/i18n/modules/frozen';
import { publishReentryRequest, type ReentryAnswers } from '@/lib/reentryRequest';

/**
 * The four answers, written by the person and sent as KIND 87059.
 *
 * No field is required and no length is checked. Someone answering honestly may
 * answer briefly, and a form that argues with them about word count would turn
 * the one act left to them into another thing done wrong. Sending is refused
 * only when every field is empty — that is not an application, it is a misclick.
 */
export const ReentryRequestForm = ({
  privateKeyHex,
  relays,
  violationEventId,
  onSent,
}: {
  privateKeyHex: string;
  relays: string[];
  violationEventId?: string;
  onSent: () => void;
}) => {
  const { t } = useTranslation(frozenDict);
  const [answers, setAnswers] = useState<ReentryAnswers>({
    why_here: '', what_i_create: '', is_it_consistent: '', willing_to_change: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const set = (k: keyof ReentryAnswers) => (e: React.ChangeEvent<HTMLTextAreaElement>) =>
    setAnswers((a) => ({ ...a, [k]: e.target.value }));

  const anything = Object.values(answers).some((v) => v.trim().length > 0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await publishReentryRequest({ privateKeyHex, relays, answers, violationEventId });
      setSent(true);
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <Check className="h-4 w-4 text-primary" />
          {t('frozen.sent')}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('frozen.sentNote')}</p>
      </div>
    );
  }

  const fields: { key: keyof ReentryAnswers; label: string }[] = [
    { key: 'why_here', label: t('frozen.q1') },
    { key: 'what_i_create', label: t('frozen.q2') },
    { key: 'is_it_consistent', label: t('frozen.q3') },
    { key: 'willing_to_change', label: t('frozen.q4') },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">{t('frozen.apply')}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('frozen.applyIntro')}</p>

      <p className="mt-3 flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{t('frozen.applyPrivacy')} {t('frozen.applyShort')}</span>
      </p>

      <div className="mt-5 space-y-5">
        {fields.map((f, i) => (
          <div key={f.key} className="space-y-2">
            <Label htmlFor={`re-${f.key}`} className="flex gap-2 text-sm font-normal leading-relaxed">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {i + 1}
              </span>
              <span>{f.label}</span>
            </Label>
            <Textarea
              id={`re-${f.key}`}
              value={answers[f.key]}
              onChange={set(f.key)}
              disabled={busy}
              className="min-h-[90px]"
            />
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {t('frozen.sendFailed')}: {error}
        </p>
      )}

      <Button onClick={submit} disabled={busy || !anything} className="mt-5 w-full sm:w-auto">
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {busy ? t('frozen.submitting') : t('frozen.submit')}
      </Button>
    </div>
  );
};
