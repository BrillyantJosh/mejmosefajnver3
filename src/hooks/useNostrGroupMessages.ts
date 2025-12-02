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

export interface GroupMessage {
  id: string;
  senderPubkey: string;
  text: string;
  timestamp: number;
  createdAt: number;
  phase: string;
}

export const useNostrGroupMessages = (
  processEventId: string | null,
  groupKeyHex: string | null
) => {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    console.log('💬 useNostrGroupMessages called with:', {
      processEventId: processEventId?.slice(0, 16) + '...',
      groupKeyHex: groupKeyHex?.slice(0, 16) + '...',
      hasGroupKey: !!groupKeyHex,
      groupKeyLength: groupKeyHex?.length,
      hasRelays: !!parameters?.relays
    });

    if (!processEventId || !groupKeyHex || !parameters?.relays) {
      console.warn('⚠️ useNostrGroupMessages: Missing required parameters');
      setIsLoading(false);
      return;
    }

    const pool = new SimplePool();
    const groupKeyBytes = hexToBytes(groupKeyHex);

    const decryptMessage = (event: Event): GroupMessage | null => {
      try {
        console.log('🔐 Decrypting message:', {
          eventId: event.id.slice(0, 16),
          eventPubkey: event.pubkey.slice(0, 16)
        });

        // Derive NIP-44 conversation key from GROUP KEY + message pubkey
        const conversationKey = nip44.v2.utils.getConversationKey(
          groupKeyBytes,
          event.pubkey
        );

        const decryptedContent = nip44.v2.decrypt(event.content, conversationKey);
        const messageData = JSON.parse(decryptedContent);
        
        // Extract phase from tags
        const phaseTag = event.tags.find((tag) => tag[0] === 'phase');
        const phase = phaseTag ? phaseTag[1] : 'unknown';
        
        // Extract sender pubkey from tags
        const senderTag = event.tags.find(
          (tag) => tag[0] === 'p' && tag[2] === 'sender'
        );
        const senderPubkey = senderTag ? senderTag[1] : event.pubkey;
        
        console.log('✅ Message decrypted:', {
          text: messageData.text.substring(0, 30) + '...',
          timestamp: messageData.timestamp
        });

        return {
          id: event.id,
          senderPubkey: senderPubkey,
          text: messageData.text,
          timestamp: messageData.timestamp,
          createdAt: event.created_at,
          phase: phase
        };
      } catch (decryptError) {
        console.error('❌ Failed to decrypt/parse message:', {
          eventId: event.id.slice(0, 16),
          error: decryptError instanceof Error ? decryptError.message : 'Unknown error'
        });
        return null;
      }
    };

    const setupMessagesAndSubscription = async () => {
      try {
        // Capture timestamp at the START to avoid missing messages during fetch
        const subscriptionSince = Math.floor(Date.now() / 1000) - 5; // 5 seconds buffer
        console.log('🕐 Subscription will start from timestamp:', subscriptionSince);

        // Step 1: Fetch existing messages
        console.log('🔍 Fetching existing KIND 87046 messages...');
        
        const filter: Filter = {
          kinds: [87046],
          '#e': [processEventId],
          limit: 500
        };

        const events = await pool.querySync(parameters.relays, filter);
        console.log(`📦 Found ${events.length} existing message events`);

        // Decrypt existing messages
        const decryptedMessages: GroupMessage[] = [];
        for (const event of events) {
          const msg = decryptMessage(event);
          if (msg) decryptedMessages.push(msg);
        }

        // Sort by timestamp
        decryptedMessages.sort((a, b) => a.timestamp - b.timestamp);
        setMessages(decryptedMessages);
        setIsLoading(false);

        // Step 2: Subscribe to new messages in real-time
        console.log('🔔 Setting up real-time subscription from timestamp:', subscriptionSince);
        
        const sub = pool.subscribeMany(
          parameters.relays,
          [{
            kinds: [87046],
            '#e': [processEventId],
            since: subscriptionSince
          }] as any,
          {
            onevent(event: Event) {
              console.log('📬 New message received in real-time:', {
                eventId: event.id.slice(0, 16),
                created_at: event.created_at,
                relay: 'unknown'
              });
              const msg = decryptMessage(event);
              if (msg) {
                setMessages(prev => {
                  // Check if message already exists
                  if (prev.some(m => m.id === msg.id)) {
                    console.log('⚠️ Message already exists, skipping');
                    return prev;
                  }
                  // Add new message and sort
                  console.log('✅ Adding new message to state:', msg.text.substring(0, 30));
                  const updated = [...prev, msg];
                  updated.sort((a, b) => a.timestamp - b.timestamp);
                  return updated;
                });
              }
            },
            oneose() {
              console.log('✅ Real-time subscription established (EOSE received)');
            }
          }
        );

        // Cleanup function
        return () => {
          console.log('🔌 Closing subscription and pool...');
          sub.close();
          pool.close(parameters.relays);
        };
      } catch (error) {
        console.error('❌ Error in setupMessagesAndSubscription:', error);
        setIsLoading(false);
      }
    };

    const cleanup = setupMessagesAndSubscription();

    return () => {
      cleanup.then(cleanupFn => {
        if (cleanupFn) cleanupFn();
      });
    };
  }, [processEventId, groupKeyHex, parameters?.relays]);

  return { messages, isLoading };
};
