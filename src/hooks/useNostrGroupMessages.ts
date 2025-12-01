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
  phase: string;
  createdAt: number;
}

export const useNostrGroupMessages = (
  processId: string | null,
  groupKey: string | null
) => {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    if (!processId || !groupKey || !parameters?.relays) {
      setIsLoading(false);
      return;
    }

    const fetchMessages = async () => {
      const pool = new SimplePool();
      
      try {
        console.log('Fetching KIND 87046 (group messages) for process:', processId);
        
        const filter: Filter = {
          kinds: [87046],
          '#e': [processId],
          limit: 500
        };

        const events = await pool.querySync(parameters.relays, filter);
        
        console.log(`Found ${events.length} KIND 87046 events`);

        // Decrypt and process messages
        const decryptedMessages: GroupMessage[] = [];
        
        for (const event of events) {
          try {
            const phase = event.tags.find(t => t[0] === 'phase')?.[1] || 'opening';
            
            // Decrypt using NIP-44 with group key
            const conversationKey = nip44.v2.utils.getConversationKey(
              hexToBytes(groupKey),
              event.pubkey
            );
            
            const decrypted = nip44.v2.decrypt(event.content, conversationKey);
            const messageData = JSON.parse(decrypted);
            
            decryptedMessages.push({
              id: event.id,
              senderPubkey: event.pubkey,
              text: messageData.text,
              timestamp: messageData.timestamp || event.created_at,
              phase,
              createdAt: event.created_at
            });
          } catch (decryptError) {
            console.warn('Failed to decrypt message:', event.id, decryptError);
          }
        }

        // Sort by timestamp
        decryptedMessages.sort((a, b) => a.timestamp - b.timestamp);
        
        console.log(`Successfully decrypted ${decryptedMessages.length} messages`);
        setMessages(decryptedMessages);
        
      } catch (error) {
        console.error('Error fetching group messages:', error);
      } finally {
        setIsLoading(false);
        pool.close(parameters.relays);
      }
    };

    fetchMessages();
  }, [processId, groupKey, parameters?.relays]);

  return { messages, isLoading };
};
