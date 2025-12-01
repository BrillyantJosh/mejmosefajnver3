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
  processId: string | null,
  userPubkey: string | null,
  userPrivateKeyHex: string | null
) => {
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    if (!processId || !userPubkey || !userPrivateKeyHex || !parameters?.relays) {
      setIsLoading(false);
      return;
    }

    const fetchGroupKey = async () => {
      // Check localStorage cache
      const cacheKey = `group_key_own:${processId}`;
      const cachedKey = localStorage.getItem(cacheKey);
      
      if (cachedKey) {
        console.log('Using cached group key for process:', processId);
        setGroupKey(cachedKey);
        setIsLoading(false);
        return;
      }

      const pool = new SimplePool();
      
      try {
        console.log('Fetching KIND 87045 (group key) for process:', processId);
        
        const filter: Filter = {
          kinds: [87045],
          '#e': [processId],
          '#p': [userPubkey],
          limit: 10
        };

        const events = await pool.querySync(parameters.relays, filter);
        
        console.log(`Found ${events.length} KIND 87045 events`);

        // Find the event where user is receiver
        const keyEvent = events.find((event: Event) => {
          const receiverTag = event.tags.find(t => t[0] === 'p' && t[2] === 'receiver');
          return receiverTag?.[1] === userPubkey;
        });

        if (!keyEvent) {
          console.error('No group key found for this user');
          setIsLoading(false);
          return;
        }

        // Find sender pubkey
        const senderTag = keyEvent.tags.find(t => t[0] === 'p' && t[2] === 'sender');
        const senderPubkey = senderTag?.[1] || keyEvent.pubkey;

        console.log('Decrypting group key from sender:', senderPubkey);

        // Decrypt using NIP-44
        const conversationKey = nip44.v2.utils.getConversationKey(
          hexToBytes(userPrivateKeyHex),
          senderPubkey
        );
        
        const decryptedGroupKey = nip44.v2.decrypt(keyEvent.content, conversationKey);
        
        console.log('Group key decrypted successfully');
        
        // Cache the key
        localStorage.setItem(cacheKey, decryptedGroupKey);
        setGroupKey(decryptedGroupKey);
        
      } catch (error) {
        console.error('Error fetching/decrypting group key:', error);
      } finally {
        setIsLoading(false);
        pool.close(parameters.relays);
      }
    };

    fetchGroupKey();
  }, [processId, userPubkey, userPrivateKeyHex, parameters?.relays]);

  return { groupKey, isLoading };
};
