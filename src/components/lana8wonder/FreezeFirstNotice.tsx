import { useNavigate } from 'react-router-dom';
import { ExternalLink, Snowflake } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/I18nContext';
import lana8wonderTranslations, { type Lana8WonderKey } from '@/i18n/modules/lana8wonder';
import type { FreezeNotice, FreezeNoticeStep } from '@/lib/lana8wonderFreezeNotice';

const KNOWN_REASONS = new Set([
  'frozen_max_cap',
  'frozen_l8w',
  'frozen_too_wild',
  'frozen_unreg_Lanas',
  'frozen_own_person',
  'frozen',
]);

interface FreezeFirstNoticeProps {
  notice: FreezeNotice;
  /** wallet address → the plan's account number, so people read "Account 3". */
  accountByWallet: Map<string, number>;
}

/**
 * "Unfreeze first, then cash out" — in that order, with the button that goes
 * to the one place able to lift each freeze.
 *
 * Shown only when a wallet of the PLAN is held. A frozen wallet elsewhere does
 * not stop a Lana8Wonder cash-out, and saying it does would send someone on an
 * errand that changes nothing here.
 */
export default function FreezeFirstNotice({ notice, accountByWallet }: FreezeFirstNoticeProps) {
  const { t } = useTranslation(lana8wonderTranslations);
  const navigate = useNavigate();

  if (notice.scope !== 'account' && notice.scope !== 'plan') return null;

  const reasonText = (reason: string) =>
    t((KNOWN_REASONS.has(reason)
      ? `plan.freezeFirst.reason.${reason}`
      : 'plan.freezeFirst.reason.other') as Lana8WonderKey);

  const actionText = (step: FreezeNoticeStep) =>
    t(step.resolution.kind === 'self'
      ? 'plan.freezeFirst.action.self'
      : step.resolution.kind === 'own-process'
        ? 'plan.freezeFirst.action.own'
        : 'plan.freezeFirst.action.registrar');

  const hintText = (step: FreezeNoticeStep) => {
    if (step.resolution.kind === 'own-process') return t('plan.freezeFirst.hint.own');
    if (step.resolution.kind === 'registrar') return t('plan.freezeFirst.hint.registrar');
    return t(step.reason === 'frozen_l8w'
      ? 'plan.freezeFirst.hint.frozen_l8w'
      : 'plan.freezeFirst.hint.frozen_max_cap');
  };

  const accountsText = (wallets: string[]) =>
    wallets
      .map(w => accountByWallet.get(w))
      .filter((id): id is number => typeof id === 'number')
      .sort((a, b) => a - b)
      .map(id => t('plan.freezeFirst.account', { id: String(id) }))
      .join(', ');

  const numbered = notice.steps.length > 1;

  return (
    <Alert className="border-blue-500/50 bg-blue-500/10">
      <Snowflake className="h-4 w-4 text-blue-500" />
      <AlertTitle className="text-blue-800 dark:text-blue-300 text-base">
        {t(notice.scope === 'account' ? 'plan.freezeFirst.title.account' : 'plan.freezeFirst.title.plan')}
      </AlertTitle>
      <AlertDescription className="text-blue-900/80 dark:text-blue-200/80 space-y-3">
        <p>
          {notice.scope === 'account'
            ? t('plan.freezeFirst.lead.account')
            : t('plan.freezeFirst.lead.plan', {
                frozen: String(notice.frozenPlanWallets),
                total: String(notice.planWallets),
              })}
        </p>

        <ol className="space-y-3">
          {notice.steps.map((step, index) => {
            const accounts = notice.scope === 'plan' ? accountsText(step.wallets) : '';
            return (
              <li
                key={step.reason}
                className="rounded-md border border-blue-500/30 bg-background/60 p-3 space-y-2"
              >
                <div className="text-sm">
                  {numbered && (
                    <span className="font-semibold">{t('plan.freezeFirst.step', { n: String(index + 1) })} · </span>
                  )}
                  <span className="font-semibold">{reasonText(step.reason)}</span>
                  {accounts && (
                    <span className="block text-xs opacity-80">
                      {t('plan.freezeFirst.appliesTo', { accounts })}
                    </span>
                  )}
                </div>
                <p className="text-xs opacity-90">{hintText(step)}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-blue-500/50 text-blue-700 dark:text-blue-300 hover:bg-blue-500/10"
                  onClick={() => {
                    if (step.resolution.external) window.open(step.resolution.href, '_blank', 'noopener,noreferrer');
                    else navigate(step.resolution.href);
                  }}
                >
                  <Snowflake className="h-4 w-4 mr-2" />
                  {actionText(step)}
                  {step.resolution.external && <ExternalLink className="h-3 w-3 ml-2 opacity-70" />}
                </Button>
              </li>
            );
          })}
        </ol>

        <p className="text-sm font-medium">{t('plan.freezeFirst.afterwards')}</p>
      </AlertDescription>
    </Alert>
  );
}
