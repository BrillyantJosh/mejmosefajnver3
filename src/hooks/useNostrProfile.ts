import { useState, useEffect, useCallback } from 'react';
import { SimplePool, Event, finalizeEvent } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface NostrProfile {
  // Standard fields
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  website?: string;
  nip05?: string;
  
  // Payment & Location
  payment_link?: string;
  location?: string;
  country?: string;
  currency?: string;
  latitude?: number;
  longitude?: number;
  
  // LanaCoins specific
  lanoshi2lash?: string;
  lanaWalletID?: string;
  whoAreYou?: string;
  orgasmic_profile?: string;
  statement_of_responsibility?: string;
  
  // Payment Methods (new)
  payment_methods?: Array<{
    id: string;
    scope: 'collect' | 'payout' | 'both';
    country: string;
    scheme: string;
    currency: string;
    label: string;
    fields: Record<string, any>;
    verified?: boolean;
    primary?: boolean;
    privacy?: {
      redact_last4?: boolean;
    };
  }>;
  preferred_payout?: string;
  preferred_collect?: string;
  
  // Legacy Banking (deprecated)
  bankName?: string;
  bankAddress?: string;
  bankSWIFT?: string;
  bankAccount?: string;
  
  // Tags
  language?: string; // For backwards compatibility
  interests?: string[]; // t tags
  intimateInterests?: string[]; // o tags
  lang?: string; // Language tag
}

export const useNostrProfile = () => {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);

  const relays = parameters?.relays || [];

  const fetchProfile = useCallback(async () => {
    if (!session?.nostrHexId || relays.length === 0) {
      setIsLoading(false);
      return;
    }

    const pool = new SimplePool();
    
    try {
      console.log('Fetching KIND 0 profile for:', session.nostrHexId);
      
      const event = await Promise.race([
        pool.get(relays, {
          kinds: [0],
          authors: [session.nostrHexId],
          limit: 1
        }),
        new Promise<Event | null>((_, reject) => 
          setTimeout(() => reject(new Error('Profile fetch timeout')), 10000)
        )
      ]) as Event | null;

      if (event && event.content) {
        try {
          const content = JSON.parse(event.content);
          
          // Extract tags
          const langTag = event.tags.find(t => t[0] === 'lang')?.[1];
          const interestTags = event.tags.filter(t => t[0] === 't').map(t => t[1]);
          const intimateTags = event.tags.filter(t => t[0] === 'o').map(t => t[1]);
          
          setProfile({
            ...content,
            lang: langTag,
            interests: interestTags,
            intimateInterests: intimateTags
          });
          
          console.log('Profile loaded:', content);
        } catch (error) {
          console.error('Failed to parse profile content:', error);
        }
      } else {
        // No profile found from relay - use session fallback if available
        console.log('No profile from relay, checking session fallback...');
        if (session?.profileName || session?.profileDisplayName || session?.profileLang) {
          console.log('Using session fallback for profile');
          setProfile({
            name: session.profileName,
            display_name: session.profileDisplayName,
            lang: session.profileLang,
            currency: session.profileCurrency,
          });
        }
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      // On error, also use session fallback
      if (session?.profileName || session?.profileDisplayName || session?.profileLang) {
        console.log('Using session fallback after error');
        setProfile({
          name: session.profileName,
          display_name: session.profileDisplayName,
          lang: session.profileLang,
          currency: session.profileCurrency,
        });
      }
    } finally {
      setIsLoading(false);
      pool.close(relays);
    }
  }, [session?.nostrHexId, relays]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const publishProfile = async (profileData: NostrProfile): Promise<{ success: boolean; error?: string }> => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      return { success: false, error: 'Not authenticated' };
    }

    if (!profileData.lang) {
      return { success: false, error: 'Language is required' };
    }

    if (!profileData.statement_of_responsibility) {
      return { success: false, error: 'You must explicitly accept unconditional self-responsibility before saving your profile.' };
    }

    if (profileData.statement_of_responsibility.length < 10) {
      return { success: false, error: 'Statement of responsibility must be at least 10 characters' };
    }

    if (relays.length === 0) {
      return { success: false, error: 'No relays available' };
    }

    setIsPublishing(true);
    const pool = new SimplePool();

    try {
      // Prepare content (exclude tags fields)
      const { interests, intimateInterests, lang, ...content } = profileData;
      
      // Prepare tags
      const tags: string[][] = [
        ['lang', lang]
      ];
      
      if (interests && interests.length > 0) {
        interests.forEach(interest => {
          if (interest.trim()) {
            tags.push(['t', interest.trim()]);
          }
        });
      }
      
      if (intimateInterests && intimateInterests.length > 0) {
        intimateInterests.forEach(interest => {
          if (interest.trim()) {
            tags.push(['o', interest.trim()]);
          }
        });
      }

      // Create and sign event
      const eventTemplate = {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: JSON.stringify(content),
        pubkey: session.nostrHexId
      };

      const privateKeyBytes = new Uint8Array(
        session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );

      const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);

      console.log('Publishing profile to relays:', relays);

      // Publish to all relays with timeout
      try {
        const publishPromises = pool.publish(relays, signedEvent);
        
        // Wait for all relays to respond (or timeout after 10 seconds)
        const results = await Promise.race([
          Promise.allSettled(publishPromises),
          new Promise<any[]>((resolve) => 
            setTimeout(() => resolve([]), 10000)
          )
        ]);

        // Count successful publishes
        const successful = Array.isArray(results) 
          ? results.filter(r => r.status === 'fulfilled').length 
          : 0;
        
        const failed = Array.isArray(results)
          ? results.filter(r => r.status === 'rejected').length
          : 0;

        console.log(`📡 Published to ${successful}/${relays.length} relays (${failed} failed)`);
        
        // Log failed relays for debugging
        if (failed > 0) {
          results.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.warn(`❌ Relay ${relays[index]} failed:`, result.reason);
            }
          });
        }

        if (successful === 0) {
          throw new Error('Failed to publish to any relay. Check relay connections.');
        }

        console.log('✅ Profile published successfully');
      } catch (publishError) {
        console.error('❌ Publish error:', publishError);
        throw publishError;
      }

      // Update local state
      setProfile(profileData);
      return { success: true };
    } catch (error) {
      console.error('Error publishing profile:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    } finally {
      setIsPublishing(false);
      pool.close(relays);
    }
  };

  return {
    profile,
    isLoading,
    isPublishing,
    publishProfile,
    refetch: fetchProfile
  };
};
