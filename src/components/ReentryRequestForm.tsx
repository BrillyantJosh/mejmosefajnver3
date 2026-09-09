import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Lock, Check } from 'lucide-react';
import { useTranslation } from '@/i18n/I18nContext';
import { frozenDict } from '@/i18n/modules/frozen';
import { publishReentryRequest, findOwnReentryRequest, type ReentryAnswers } from '@/lib/reentryRequest';
import { getPublicKey } from 'nostr-tools';

/**
 * The four answers, written by the person and sent as KIND 87059.
 *
 * No field is required and no length is checked. Someone answering honestly may
 * answer briefly, and a form that argues with them about word count would turn
 * the one act left to them into another thing done wrong. Sending is refused
 * only when every field is empty — that is not an application, it is a misclick.
 *
 * ONE REQUEST PER PERSON. Once sent, the form is replaced by what they wrote:
 * they can read it back, and there is nothing more to send. Repeated
 * applications would turn a moment of reflection into a thing to keep pressing,
 * which is the opposite of what was asked of them.
 */
const hexToBytesLocal = (hex: string): Uint8Array => {
  const a = new Uint8Array(hex.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return a;
};

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
  const [existing, setExisting] = useState<
    { id: string; submittedAt: number; answers?: ReentryAnswers; note?: string } | null
  >(null);
  const [looking, setLooking] = useState(true);

  // Their own words, read back. They can open them because NIP-44 derives one
  // conversation key from either side of the pair.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await findOwnReentryRequest({
          pubkey: getPublicKey(hexToBytesLocal(privateKeyHex)),
          privateKeyHex,
          relays,
        });
        if (!cancelled) setExisting(found);
      } finally {
        if (!cancelled) setLooking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [privateKeyHex, relays]);

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

  const fieldsOf = (a?: ReentryAnswers) => [
    { label: t('frozen.q1'), value: a?.why_here },
    { label: t('frozen.q2'), value: a?.what_i_create },
    { label: t('frozen.q3'), value: a?.is_it_consistent },
    { label: t('frozen.q4'), value: a?.willing_to_change },
  ];

  if (looking) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('frozen.loadingOwn')}
      </div>
    );
  }

  // One request per person. Once sent, this becomes a place to read it back —
  // there is no second form, because repeated applications would turn a moment
  // of reflection into a thing to keep pressing.
  if (existing) {
    const when = new Date(existing.submittedAt * 1000).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    return (
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <Check className="h-4 w-4 text-primary" />
          {t('frozen.alreadySent', { date: when })}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t('frozen.alreadySentNote')}
        </p>

        {existing.answers && (
          <div className="mt-5 space-y-4 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('frozen.yourAnswers')}
            </p>
            {fieldsOf(existing.answers).map((f, i) => (
              <div key={i}>
                <p className="text-xs text-muted-foreground">{i + 1}. {f.label}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {f.value?.trim() || (
                    <span className="italic text-muted-foreground">{t('frozen.emptyAnswer')}</span>
                  )}
                </p>
              </div>
            ))}
            {existing.note?.trim() && (
              <p className="whitespace-pre-wrap border-t border-border pt-3 text-sm leading-relaxed">
                {existing.note}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

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
