import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

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
}

export const useNostrKind0Profiles = () => {
  const [profiles, setProfiles] = useState<Kind0Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    const fetchProfiles = async () => {
      if (!parameters?.relays || parameters.relays.length === 0) {
        console.warn('No relays available');
        setIsLoading(false);
        return;
      }

      const relays = parameters.relays;

      const pool = new SimplePool();
      
      try {
        const events = await pool.querySync(relays, {
          kinds: [0],
          limit: 100
        });

        const profileMap = new Map<string, Kind0Profile>();
        
        events.forEach((event: any) => {
          try {
            const content = JSON.parse(event.content);
            const existing = profileMap.get(event.pubkey);
            
            if (!existing || event.created_at > (existing as any).created_at) {
              profileMap.set(event.pubkey, {
                pubkey: event.pubkey,
                name: content.name,
                display_name: content.display_name,
                about: content.about,
                picture: content.picture,
                location: content.location,
                country: content.country,
                currency: content.currency,
                lanaWalletID: content.lanaWalletID,
                language: content.language,
              });
            }
          } catch (e) {
            console.error('Failed to parse profile:', e);
          }
        });

        setProfiles(Array.from(profileMap.values()));
      } catch (error) {
        console.error('Error fetching profiles:', error);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchProfiles();
  }, [parameters]);

  return { profiles, isLoading };
};
