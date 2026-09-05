/**
 * Where a frozen wallet can actually be unfrozen.
 *
 * The wallet page used to end at a disabled button reading "Sending Disabled —
 * Wallet Frozen", and an alert saying "contact your registrar" with nothing to
 * click. Both are true and neither helps.
 *
 * The destination is NOT the same for every freeze, and getting that wrong is
 * not a cosmetic error. The registrar's resolve page asks a max-cap wallet to
 * donate its ENTIRE balance to unfreeze; sending someone whose freeze came from
 * the self-responsibility process there would invite them to give away their
 * money for a freeze that page cannot lift anyway. So each reason points at the
 * one place that can actually resolve it, and where nothing self-service
 * exists, it says so rather than inventing a button.
 */

const REGISTRAR = 'https://lanatrace.us';

export type FreezeResolution = {
  /** 'self' = the person can resolve it themselves right now. */
  kind: 'self' | 'registrar' | 'own-process';
  /** Absolute for the registrar, in-app path for the OWN process. */
  href: string;
  label: string;
  /** One line saying what happens there, so the button is not a leap of faith. */
  hint: string;
  external: boolean;
};

export function freezeResolution(freezeStatus: string, walletId: string): FreezeResolution {
  switch (freezeStatus) {
    // Both of these the registrar can lift once the person settles up, and the
    // same page handles them — it reads the wallet type from the address.
    case 'frozen_max_cap':
      return {
        kind: 'self',
        href: `${REGISTRAR}/wallets/resolve-max-cap?wallet=${encodeURIComponent(walletId)}`,
        label: 'Unfreeze this wallet',
        hint: 'Resolve the balance cap at the registrar',
        external: true,
      };
    case 'frozen_l8w':
      return {
        kind: 'self',
        href: `${REGISTRAR}/wallets/resolve-max-cap?wallet=${encodeURIComponent(walletId)}`,
        label: 'Unfreeze this wallet',
        hint: 'Pay the amount due at the registrar',
        external: true,
      };

    // Lifted by the facilitator inside the process, never by the registrar.
    // A button to lanatrace.us here would be a wrong errand.
    case 'frozen_own_person':
      return {
        kind: 'own-process',
        href: '/own',
        label: 'Open your process',
        hint: 'This freeze is lifted in the self-responsibility process, not by the registrar',
        external: false,
      };

    // Everything the registrar decides case by case: suspicious activity, an
    // account-wide freeze, unregistered LANA over the threshold, and anything
    // new we have not seen yet.
    default:
      return {
        kind: 'registrar',
        href: `${REGISTRAR}/frozen-wallets`,
        label: 'Check with the registrar',
        hint: 'This freeze is reviewed by the registrar',
        external: true,
      };
  }
}
