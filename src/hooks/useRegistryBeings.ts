import { useState, useEffect } from 'react';

export interface RegistryBeing {
  pubkey: string;
  name: string;
  domain: string;
  displayName: string;
  picture: string | null;
  about: string;
  website: string;
  status: string;
  lastSeenAt: number;
  creatorPubkey: string | null;
  creatorName: string;
}

const API_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * The canonical list of digital beings (from the Lana.is monitor, resolved to
 * their Nostr pubkeys server-side). New beings on the monitor appear here
 * automatically, so /being no longer needs each being added by hand.
 */
export function useRegistryBeings() {
  const [registryBeings, setRegistryBeings] = useState<RegistryBeing[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/beings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && Array.isArray(d?.beings)) setRegistryBeings(d.beings);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setIsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { registryBeings, isLoading };
}
