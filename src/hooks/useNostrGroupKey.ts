import { useState, useEffect } from 'react';
import { SimplePool, Filter, Event, nip44 } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

export const useNostrGroupKey = (
  processEventId: string | null,
  userPubkey: string | null,
  userPrivateKeyHex: string | null
) => {
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    if (!processEventId || !userPubkey || !userPrivateKeyHex || !parameters?.relays) {
      setIsLoading(false);
      return;
    }

    // Check localStorage cache first
    const cacheKey = `group_key_own:${processEventId}`;
    const cachedKey = localStorage.getItem(cacheKey);
    if (cachedKey) {
      console.log('✅ Using cached group key for process:', processEventId);
      setGroupKey(cachedKey);
      setIsLoading(false);
      return;
    }

    const fetchGroupKey = async () => {
      const pool = new SimplePool();
      
      try {
        console.log('Fetching KIND 87045 (group key) for process:', processEventId);
        
        const filter: Filter = {
          kinds: [87045],
          '#e': [processEventId],
          '#p': [userPubkey],
          limit: 50
        };

        const events = await pool.querySync(parameters.relays, filter);
        
        console.log(`Found ${events.length} group key events (KIND 87045)`);

        for (const event of events) {
          try {
            // Check if user is a receiver
            const receiverTag = event.tags.find(
              (tag) => tag[0] === 'p' && tag[2] === 'receiver' && tag[1] === userPubkey
            );
            
            if (!receiverTag) {
              console.log('User is not receiver in event:', event.id);
              continue;
            }

            // Find sender pubkey
            const senderTag = event.tags.find(
              (tag) => tag[0] === 'p' && tag[2] === 'sender'
            );
            
            if (!senderTag) {
              console.warn('No sender tag found in event:', event.id);
              continue;
            }

            const senderPubkey = senderTag[1];
            
            console.log('Decrypting group key from sender:', senderPubkey.slice(0, 8));

            // Decrypt group key using NIP-44
            const privateKeyBytes = hexToBytes(userPrivateKeyHex);
            const conversationKey = nip44.v2.utils.getConversationKey(
              privateKeyBytes,
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
