import { useMemo } from 'react';
import { useNostrKind0Profiles } from './useNostrKind0Profiles';

export interface ProfileSearchResult {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  location?: string;
  lanaWalletID?: string;
}

/**
 * Searches the local indexed Kind-0 profile DB the same way the Transparency
 * Profiles page does: load ALL profiles once, then filter client-side using
 * word-AND matching against `name | display_name | location | about | pubkey`.
 *
 * This is intentionally identical to /transparency/profiles so chat / rooms /
 * room invites behave the same way.
 *
 * @param query   Free-form search string (case-insensitive, multi-word)
 * @param minLen  Minimum query length before any results are returned (default 2)
 */
export function useProfileSearch(query: string, minLen: number = 2) {
  const { profiles, isLoading } = useNostrKind0Profiles();

  const results = useMemo<ProfileSearchResult[]>(() => {
    const trimmed = query.trim();
    if (trimmed.length < minLen) return [];

    const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    return profiles.filter((p) => {
      const searchable = [
        p.name, p.display_name, p.location, p.about, p.pubkey,
      ].filter(Boolean).join(' ').toLowerCase();
      return words.every((word) => searchable.includes(word));
    });
  }, [profiles, query, minLen]);

  return { results, isLoading };
}
