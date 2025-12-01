import { useState, useEffect } from 'react';
import { SimplePool, Filter, Event, nip44 } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export const useNostrGroupKey = (
  processEventId: string | null,
  userPubkey: string | null,
  userPrivateKeyHex: string | null
) => {
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    console.log('🔑 useNostrGroupKey called with:', {
      processEventId: processEventId?.slice(0, 16) + '...',
      userPubkey: userPubkey?.slice(0, 16) + '...',
      hasPrivateKey: !!userPrivateKeyHex,
      hasRelays: !!parameters?.relays
    });

    if (!processEventId || !userPubkey || !userPrivateKeyHex || !parameters?.relays) {
      console.warn('⚠️ useNostrGroupKey: Missing required parameters');
      setIsLoading(false);
      return;
    }

    // Check localStorage cache first
    const cacheKey = `group_key_own:${processEventId}`;
    const cachedKey = localStorage.getItem(cacheKey);
    
    // Validate cached key format (must be 64 hex chars)
    const isValidGroupKey = (key: string): boolean => {
      return /^[0-9a-fA-F]{64}$/.test(key);
    };
    
    if (cachedKey) {
      if (isValidGroupKey(cachedKey)) {
        console.log('✅ Using valid cached group key for process:', processEventId.slice(0, 16));
        setGroupKey(cachedKey);
        setIsLoading(false);
        return;
      } else {
        console.warn('⚠️ Invalid cached group key format, removing and fetching fresh');
        localStorage.removeItem(cacheKey);
      }
    }

    const fetchGroupKey = async () => {
      const pool = new SimplePool();
      
      try {
        console.log('🔍 Fetching KIND 87045 (group key) for:', {
          processEventId: processEventId.slice(0, 16) + '...',
          userPubkey: userPubkey.slice(0, 16) + '...',
          relays: parameters.relays
        });
        
        const filter: Filter = {
          kinds: [87045],
          '#e': [processEventId],
          '#p': [userPubkey],
          limit: 50
        };

        const events = await pool.querySync(parameters.relays, filter);
        
        console.log(`📦 Found ${events.length} group key events (KIND 87045)`);

        if (events.length === 0) {
          console.warn('⚠️ No KIND 87045 events found - user may not have access to this process');
        }

        for (const event of events) {
          console.log('🔐 Processing group key event:', {
            eventId: event.id.slice(0, 16),
            eventPubkey: event.pubkey.slice(0, 16),
            tags: event.tags
          });
          try {
            // Check if user is a receiver
            const receiverTag = event.tags.find(
              (tag) => tag[0] === 'p' && tag[2] === 'receiver' && tag[1] === userPubkey
            );
            
            if (!receiverTag) {
              console.log('❌ User is not receiver in event:', event.id.slice(0, 16));
              continue;
            }
            
            console.log('✓ User is valid receiver');

            // Find sender pubkey
            const senderTag = event.tags.find(
              (tag) => tag[0] === 'p' && tag[2] === 'sender'
            );
            
            if (!senderTag) {
              console.warn('❌ No sender tag found in event:', event.id.slice(0, 16));
              continue;
            }

            const senderPubkey = senderTag[1];
            
            console.log('🔓 Attempting to decrypt group key from sender:', senderPubkey.slice(0, 16));

            // Decrypt group key using NIP-44 (hex strings, type assertion for library compatibility)
            const conversationKey = nip44.v2.utils.getConversationKey(
              userPrivateKeyHex as any,  // hex string (TypeScript expects Uint8Array but accepts hex string)
              senderPubkey
            );
            
            const decryptedGroupKey = nip44.v2.decrypt(event.content, conversationKey);
            
            console.log('✅ Group key decrypted successfully:', decryptedGroupKey.substring(0, 16) + '...');
            
            // Cache in localStorage
            localStorage.setItem(cacheKey, decryptedGroupKey);
            
            setGroupKey(decryptedGroupKey);
            break;
            
          } catch (decryptError) {
            console.warn('Failed to decrypt group key from event:', event.id, decryptError);
          }
        }
        
        if (!groupKey && events.length === 0) {
          console.warn('No group key events found - user may not have access to this chat');
        }
        
      } catch (error) {
        console.error('Error fetching group key:', error);
      } finally {
        setIsLoading(false);
        pool.close(parameters.relays);
      }
    };

    fetchGroupKey();
  }, [processEventId, userPubkey, userPrivateKeyHex, parameters?.relays]);

  return { groupKey, isLoading };
};
