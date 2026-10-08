import { useEffect, useState } from 'react';
import { readBuyingDealers, type BuyingDealersAnswer } from '@/lib/sellingMoved';

const API_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * The firms that buy LANA now, read once per page from this app's own server
 * (GET /api/buying-dealers — server/routes/buyingDealers.ts, which reads them
 * from the relays of the verified KIND 38888). `null` while the request runs;
 * a failed request is an "unknown" answer with no firm, so the page still says
 * lana.discount no longer buys and points at BEF Explorer's list of companies.
 * Every answer goes through readBuyingDealers(): a firm whose links are not
 * https on its own host is never shown.
 */
export function useBuyingDealers(): BuyingDealersAnswer | null {
  const [answer, setAnswer] = useState<BuyingDealersAnswer | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/buying-dealers`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive) setAnswer(readBuyingDealers(data));
      })
      .catch(() => {
        if (alive) setAnswer(readBuyingDealers(null));
      });
    return () => {
      alive = false;
    };
  }, []);

  return answer;
}
