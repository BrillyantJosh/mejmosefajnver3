import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InFlightCashOut } from '@/lib/cashOutDue';

const API_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * What these wallets have recently sent, as recorded by the server at the
 * moment it broadcast each transaction.
 *
 * This is the half of the double-cash-out fix that a browser cannot provide:
 * a transfer made on a phone has to be known to a laptop opened a minute
 * later, so the record lives on the server and not in localStorage.
 *
 * `resolved` distinguishes "the server says nothing is on its way" from "the
 * server could not be asked". The caller must not read silence as clearance.
 */
export function useRecentSends(walletIds: string[]) {
  const [sends, setSends] = useState<Record<string, InFlightCashOut>>({});
  const [resolved, setResolved] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // A new array identity on every render would restart the request forever.
  const key = useMemo(
    () => Array.from(new Set(walletIds.filter(Boolean))).sort().join(','),
    [walletIds]
  );
  const keyRef = useRef(key);
  keyRef.current = key;

  const refresh = useCallback(() => setReloadToken(n => n + 1), []);

  useEffect(() => {
    if (!key) {
      setSends({});
      setResolved(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `${API_URL}/api/cashouts/recent?wallets=${encodeURIComponent(key)}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        const mapped: Record<string, InFlightCashOut> = {};
        for (const [walletId, row] of Object.entries<any>(data?.sends || {})) {
          mapped[walletId] = {
            walletId,
            amount: Number(row?.amountLana) || 0,
            txid: String(row?.txid || ''),
            sentAt: Number(row?.createdAt) || 0,
          };
        }
        setSends(mapped);
        setResolved(true);
      } catch (err) {
        if (cancelled) return;
        console.error('Could not read recent sends:', err);
        setSends({});
        setResolved(false);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, reloadToken]);

  return { sends, resolved, isLoading, refresh };
}
