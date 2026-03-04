import { useState, useEffect } from 'react';

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

  useEffect(() => {
    const fetchProfiles = async () => {
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
        console.log(`📋 Loaded ${data.total} profiles from DB`);
      } catch (error) {
        console.error('Error fetching profiles from DB:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProfiles();
  }, []);

  return { profiles, isLoading };
};
