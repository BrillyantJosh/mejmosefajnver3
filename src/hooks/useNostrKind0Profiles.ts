import { useState, useEffect, useCallback } from 'react';

interface Kind0Profile {
  pubkey: string;
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  location?: string;
  country?: string;
  currency?: string;
  lanaWalletID?: string;
  language?: string;
  created_at?: number; // Unix timestamp when profile was created/updated
}

const API_URL = import.meta.env.VITE_API_URL ?? '';

export const useNostrKind0Profiles = () => {
  const [profiles, setProfiles] = useState<Kind0Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchProfiles = useCallback(async () => {
    try {
      // Fetch ALL profiles from the local DB — no relay limit
      const res = await fetch(`${API_URL}/api/functions/list-profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setProfiles(data.profiles || []);
      setLastRefreshed(new Date());
      console.log(`📋 Loaded ${data.total} profiles from DB`);
    } catch (error) {
      console.error('Error fetching profiles from DB:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** Trigger server-side relay discovery + reload profiles from DB */
  const triggerFullRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // 1. Trigger server-side discovery from relays
      await fetch(`${API_URL}/api/functions/discover-profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      // 2. Reload profiles from DB
      await fetchProfiles();
    } catch (error) {
      console.error('Error triggering full refresh:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchProfiles]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  return { profiles, isLoading, isRefreshing, lastRefreshed, refetch: fetchProfiles, triggerFullRefresh };
};
