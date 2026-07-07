// Checks whether a LanaCoin wallet address is REGISTERED with the Registrar.
// Proxies to the server's /check-wallet-registration endpoint (lanawatch).
// Used by PLAN15 to enforce that only UNREGISTERED wallets are used.

const API_URL = import.meta.env.VITE_API_URL ?? '';

export type WalletRegistrationStatus = 'registered' | 'unregistered' | 'error';

export async function checkWalletRegistration(walletId: string): Promise<WalletRegistrationStatus> {
  try {
    const res = await fetch(`${API_URL}/api/functions/check-wallet-registration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_id: walletId }),
    });
    const data = await res.json();
    if (data.registered === true) return 'registered';
    if (data.registered === false) return 'unregistered';
    return 'error';
  } catch {
    return 'error';
  }
}
