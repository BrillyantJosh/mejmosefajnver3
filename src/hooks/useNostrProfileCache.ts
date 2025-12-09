import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com',
];

const CACHE_VALIDITY_HOURS = 24;

export interface CachedProfile {
  nostr_hex_id: string;
  full_name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  lana_wallet_id?: string;
  last_fetched_at: string;
}

export const useNostrProfileCache = (pubkey: string | null) => {
  const { parameters } = useSystemParameters();
  const [profile, setProfile] = useState<CachedProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const relays = parameters?.relays || DEFAULT_RELAYS;

  const fetchFromNostr = useCallback(async (hexId: string): Promise<CachedProfile | null> => {
    const pool = new SimplePool();
    
    try {
      const events = await Promise.race([
        pool.querySync(relays, {
          kinds: [0],
          authors: [hexId],
        }),
        new Promise<any[]>((_, reject) => 
          setTimeout(() => reject(new Error('Profile fetch timeout')), 10000)
        )
      ]);

      if (events.length > 0) {
        const event = events[0];
        try {
          const content = JSON.parse(event.content);
          return {
            nostr_hex_id: event.pubkey,
            full_name: content.name,
            display_name: content.display_name,
            picture: content.picture,
            about: content.about,
            lana_wallet_id: content.lanaWalletID,
            last_fetched_at: new Date().toISOString(),
          };
        } catch (error) {
          console.error('Error parsing profile:', error);
        }
      }
      return null;
    } catch (error) {
      console.error('Error fetching from Nostr:', error);
      return null;
    } finally {
      pool.close(relays);
    }
  }, [relays]);

  const saveToCache = useCallback(async (profileData: CachedProfile) => {
    try {
      const { error } = await supabase
        .from('nostr_profiles')
        .upsert({
          nostr_hex_id: profileData.nostr_hex_id,
          full_name: profileData.full_name,
          display_name: profileData.display_name,
          picture: profileData.picture,
          about: profileData.about,
          lana_wallet_id: profileData.lana_wallet_id,
          last_fetched_at: profileData.last_fetched_at,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'nostr_hex_id' });

      if (error) {
        console.error('Error saving to cache:', error);
      }
    } catch (error) {
      console.error('Error in saveToCache:', error);
    }
  }, []);

  const fetchProfile = useCallback(async (hexId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. Check Supabase cache first
      const { data: cachedProfile, error: cacheError } = await supabase
        .from('nostr_profiles')
        .select('*')
        .eq('nostr_hex_id', hexId)
        .single();

      if (cacheError && cacheError.code !== 'PGRST116') {
        console.error('Cache fetch error:', cacheError);
      }

      const now = Date.now();
      const cacheAge = cachedProfile 
        ? now - new Date(cachedProfile.last_fetched_at).getTime()
        : Infinity;
      const isStale = cacheAge > CACHE_VALIDITY_HOURS * 60 * 60 * 1000;

      // 2. If cache hit and fresh, return immediately
      if (cachedProfile && !isStale) {
        setProfile(cachedProfile);
        setIsLoading(false);
        return;
      }

      // 3. If stale, return cache but refresh in background
      if (cachedProfile && isStale) {
        setProfile(cachedProfile);
        setIsLoading(false);
        
        // Background refresh
        fetchFromNostr(hexId).then(freshProfile => {
          if (freshProfile) {
            setProfile(freshProfile);
            saveToCache(freshProfile);
          }
        });
        return;
      }

      // 4. Cache miss - fetch from Nostr
      const freshProfile = await fetchFromNostr(hexId);
      if (freshProfile) {
        setProfile(freshProfile);
        await saveToCache(freshProfile);
      } else {
        setError('Profile not found');
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [fetchFromNostr, saveToCache]);

  useEffect(() => {
    if (pubkey) {
      fetchProfile(pubkey);
    } else {
      setProfile(null);
    }
  }, [pubkey, fetchProfile]);

  return { profile, isLoading, error, refetch: () => pubkey && fetchProfile(pubkey) };
};
