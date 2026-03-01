import { useState, useEffect } from 'react';

const CACHE_KEY = 'coingecko_lana_rate';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CachedRate {
  eur: number;
  ts: number;
}

export function useCoinGeckoRate() {
  const [rate, setRate] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check sessionStorage cache first
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed: CachedRate = JSON.parse(cached);
        if (Date.now() - parsed.ts < CACHE_TTL) {
          setRate(parsed.eur);
          setIsLoading(false);
          return;
        }
      }
    } catch {}

    const fetchRate = async () => {
      try {
        const res = await fetch('/api/functions/coingecko-lana-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const data = await res.json();

        if (data.success && typeof data.eur === 'number') {
          setRate(data.eur);
          setError(null);
          // Cache in sessionStorage
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ eur: data.eur, ts: Date.now() }));
        } else {
          throw new Error(data.error || 'Failed to fetch rate');
        }
      } catch (e: any) {
        console.error('CoinGecko rate fetch error:', e);
        setError(e.message || 'Failed to fetch market rate');
      } finally {
        setIsLoading(false);
      }
    };

    fetchRate();
  }, []);

  return { rate, isLoading, error };
}
