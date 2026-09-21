import { useState, useEffect } from 'react';
import { Filter, Event, nip44 } from 'nostr-tools';
import { queryEventsViaServer } from '@/lib/relayReadViaServer';
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

        // Through this app's server — see src/lib/relayReadViaServer.ts. The key itself
        // stays sealed to this person; only the envelope travels.
        const events = await queryEventsViaServer<Event>(filter as Record<string, unknown>, { label: 'group keys (KIND 87045)' });
        
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

            // Decrypt group key using NIP-44 exactly as per OWN ▲ spec
            const privateKeyBytes = hexToBytes(userPrivateKeyHex);
            console.log('🔬 Group key decryption key lengths:', {
              privateKeyHexLength: userPrivateKeyHex.length,
              privateKeyBytesLength: privateKeyBytes.length,
              senderPubkeyLength: senderPubkey.length,
            });

            const conversationKey = nip44.v2.utils.getConversationKey(
              privateKeyBytes,
              senderPubkey
            );

            const decryptedGroupKey = nip44.v2.decrypt(event.content, conversationKey);

            if (!isValidGroupKey(decryptedGroupKey)) {
              console.warn('❌ Decrypted group key has invalid format:', {
                length: decryptedGroupKey.length,
                preview: decryptedGroupKey.substring(0, 16) + '...',
              });
              continue;
            }

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
      }
    };

    fetchGroupKey();
  }, [processEventId, userPubkey, userPrivateKeyHex, parameters?.relays]);

  return { groupKey, isLoading };
};
