import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { getProxiedImageUrl } from '@/lib/imageProxy';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
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

export const useNostrProfilesCacheBulk = (pubkeys: string[]) => {
  const { parameters } = useSystemParameters();
  const [profiles, setProfiles] = useState<Map<string, CachedProfile>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  const relays = parameters?.relays || DEFAULT_RELAYS;

  const fetchProfiles = useCallback(async (hexIds: string[]) => {
    if (hexIds.length === 0) {
      setIsLoading(false);
      return;
    }

    console.log('🔍 useNostrProfilesCacheBulk called with', hexIds.length, 'pubkeys');
    setIsLoading(true);

    try {
      // 1. Fetch all profiles from Supabase cache in one query
      const { data: cachedProfiles, error } = await supabase
        .from('nostr_profiles')
        .select('*')
        .in('nostr_hex_id', hexIds);

      if (error) {
        console.error('Error fetching cached profiles:', error);
      }

      console.log('💾 Found in cache:', cachedProfiles?.length || 0);

      const profileMap = new Map<string, CachedProfile>();
      const now = Date.now();
      const missingPubkeys: string[] = [];
      const stalePubkeys: string[] = [];

      // 2. Check cache status for each pubkey
      hexIds.forEach(pubkey => {
        const cached = cachedProfiles?.find(p => p.nostr_hex_id === pubkey);
        
        if (!cached) {
          missingPubkeys.push(pubkey);
        } else {
          const cacheAge = now - new Date(cached.last_fetched_at).getTime();
          const isStale = cacheAge > CACHE_VALIDITY_HOURS * 60 * 60 * 1000;
          
          // Apply proxy to cached picture URLs
          profileMap.set(pubkey, {
            ...cached,
            picture: getProxiedImageUrl(cached.picture)
          });
          
          if (isStale) {
            stalePubkeys.push(pubkey);
          }
        }
      });

      console.log('⚠️ Missing:', missingPubkeys.length, '| Stale:', stalePubkeys.length);

      // Return cached profiles immediately
      setProfiles(profileMap);

      // 3. Fetch missing and stale profiles from Nostr
      const pubkeysToFetch = [...missingPubkeys, ...stalePubkeys];
      
      if (pubkeysToFetch.length > 0) {
        console.log('📡 Fetching from Nostr:', pubkeysToFetch.length, 'pubkeys');
        const pool = new SimplePool();
        
        try {
          const events = await Promise.race([
            pool.querySync(relays, {
              kinds: [0],
              authors: pubkeysToFetch,
            }),
            new Promise<any[]>((_, reject) => 
              setTimeout(() => reject(new Error('Bulk profile fetch timeout')), 15000)
            )
          ]);

          console.log('✅ Fetched', events.length, 'KIND 0 events from relays');

          // Deduplicate events - keep only the newest event for each pubkey
          const latestEvents = new Map<string, any>();
          events.forEach((event: any) => {
            const existing = latestEvents.get(event.pubkey);
            if (!existing || event.created_at > existing.created_at) {
              latestEvents.set(event.pubkey, event);
            }
          });

          console.log(`🔄 Deduplicated from ${events.length} to ${latestEvents.size} unique profiles`);

          const freshProfiles: any[] = [];

          latestEvents.forEach((event) => {
            try {
              const content = JSON.parse(event.content);
              const originalPicture = content.picture;
              
              const freshProfile = {
                nostr_hex_id: event.pubkey,
                full_name: content.name,
                display_name: content.display_name,
                picture: getProxiedImageUrl(originalPicture),
                about: content.about,
                lana_wallet_id: content.lanaWalletID,
                raw_metadata: content,
                last_fetched_at: new Date().toISOString(),
              };
              
              // Save original URL to database
              freshProfiles.push({
                nostr_hex_id: event.pubkey,
                full_name: content.name,
                display_name: content.display_name,
                picture: originalPicture, // Original URL for DB
                about: content.about,
                lana_wallet_id: content.lanaWalletID,
                raw_metadata: content,
                last_fetched_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
              
              // Use proxied URL for UI
              profileMap.set(event.pubkey, freshProfile);
            } catch (error) {
              console.error('Error parsing profile:', error);
            }
          });

          // Update UI with fresh profiles
          setProfiles(new Map(profileMap));

          // 4. Batch update to Supabase
          if (freshProfiles.length > 0) {
            console.log('💾 Upserting', freshProfiles.length, 'profiles to DB');
            const { error: upsertError } = await supabase
              .from('nostr_profiles')
              .upsert(freshProfiles, { onConflict: 'nostr_hex_id' });

            if (upsertError) {
              console.error('❌ Upsert error:', upsertError);
            } else {
              console.log('✅ Successfully upserted', freshProfiles.length, 'profiles');
            }
          }
        } catch (error) {
          console.error('Error fetching from Nostr:', error);
        } finally {
          pool.close(relays);
        }
      }
    } catch (error) {
      console.error('Error in bulk profile fetch:', error);
    } finally {
      setIsLoading(false);
    }
  }, [relays]);

  useEffect(() => {
    fetchProfiles(pubkeys);
  }, [pubkeys.join(','), fetchProfiles]);

  return { profiles, isLoading };
};
