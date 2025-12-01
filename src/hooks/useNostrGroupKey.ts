import { useState, useEffect } from 'react';
import { SimplePool, Filter, nip44 } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

export const useNostrGroupKey = (
  processId: string | null,
  userPubkey: string | null,
  userPrivateKeyHex: string | null,
  forceRefresh: boolean = false
) => {
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    if (!processId || !userPubkey || !userPrivateKeyHex || !parameters?.relays) {
      console.log('🔍 useNostrGroupKey: Missing required params', {
        hasProcessId: !!processId,
        hasUserPubkey: !!userPubkey,
        hasPrivateKey: !!userPrivateKeyHex,
        hasRelays: !!parameters?.relays
      });
      setIsLoading(false);
      return;
    }

    const fetchGroupKey = async () => {
      console.log('🔍 Looking for group key:', {
        processId,
        userPubkey: userPubkey.substring(0, 16) + '...',
        forceRefresh
      });

      // Check localStorage cache first
      const cacheKey = `group_key_own:${processId}`;
      const cached = localStorage.getItem(cacheKey);
      
      if (cached && !forceRefresh) {
        console.log('✅ Group key loaded from cache:', cached.substring(0, 20) + '...');
        setGroupKey(cached);
        setIsLoading(false);
        return;
      }

      if (forceRefresh && cached) {
        console.log('⚠️ Force refresh - ignoring cached key');
      }

      const pool = new SimplePool();
      
      try {
        console.log('Fetching KIND 87045 (group key) for process:', processId);
        
        const filter: Filter = {
          kinds: [87045],
          '#e': [processId],
          '#p': [userPubkey]
        };

        const events = await pool.querySync(parameters.relays, filter);
        
        console.log(`Found ${events.length} group key events`);

        for (const event of events) {
          try {
            // Check if user is receiver
            const receiverTag = event.tags.find(
              (tag) => tag[0] === 'p' && tag[2] === 'receiver' && tag[1] === userPubkey
            );
            
            if (!receiverTag) {
              console.log('User is not receiver in event:', event.id);
              continue;
            }

            // Get sender pubkey
            const senderTag = event.tags.find(
              (tag) => tag[0] === 'p' && tag[2] === 'sender'
            );
            
            if (!senderTag) {
              console.log('No sender tag in event:', event.id);
              continue;
            }

            const senderPubkey = senderTag[1];

            // DECRYPT GROUP KEY using user's private key + sender's public key
            const privateKeyBytes = hexToBytes(userPrivateKeyHex);
            const conversationKey = nip44.v2.utils.getConversationKey(
              privateKeyBytes,  // User's private key
              senderPubkey      // Sender's public key
            );

            const decryptedGroupKey = nip44.v2.decrypt(event.content, conversationKey);
            
            console.log('✅ Group key decrypted:', decryptedGroupKey.substring(0, 16) + '...');
            
            // Cache the group key
            localStorage.setItem(cacheKey, decryptedGroupKey);
            
            setGroupKey(decryptedGroupKey);
            break;
          } catch (decryptError) {
            console.warn('Failed to decrypt group key from event:', event.id, decryptError);
          }
        }
        
      } catch (error) {
        console.error('Error fetching group key:', error);
      } finally {
        setIsLoading(false);
        pool.close(parameters.relays);
      }
    };

    fetchGroupKey();
  }, [processId, userPubkey, userPrivateKeyHex, parameters?.relays, forceRefresh]);

  const clearCache = () => {
    if (processId) {
      const cacheKey = `group_key_own:${processId}`;
      localStorage.removeItem(cacheKey);
      console.log('🗑️ Group key cache cleared for process:', processId);
    }
  };

  return { groupKey, isLoading, clearCache };
};
