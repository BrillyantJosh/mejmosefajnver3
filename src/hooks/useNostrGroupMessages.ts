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
  isPublic: boolean;
}

export const useNostrGroupMessages = (
  processEventId: string | null,
  userPubkey: string | null,
  userPrivateKeyHex: string | null
) => {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    if (!processEventId || !userPubkey || !userPrivateKeyHex || !parameters?.relays) {
      setIsLoading(false);
      return;
    }

    const fetchMessages = async () => {
      const pool = new SimplePool();
      
      try {
        console.log('Fetching KIND 87045 & 87046 (messages) for process:', processEventId);
        
        // Fetch both private (87045) and public (87046) messages
        const filter: Filter = {
          kinds: [87045, 87046],
          '#e': [processEventId],
          limit: 500
        };

        const events = await pool.querySync(parameters.relays, filter);
        
        console.log(`Found ${events.length} message events (87045 + 87046)`);

        // Decrypt and process messages
        const decryptedMessages: GroupMessage[] = [];
        
        for (const event of events) {
          try {
            const isPublic = event.kind === 87046;
            let messageText: string;
            
            if (isPublic) {
              // Public message - content is plain text
              messageText = event.content;
            } else {
              // Private message - decrypt with NIP-44
              // Check if user is a recipient
              const isRecipient = event.tags.some(t => t[0] === 'p' && t[1] === userPubkey);
              
              if (!isRecipient) {
                console.log('User is not a recipient of message:', event.id);
                continue;
              }
              
              // Decrypt using NIP-44 between sender and receiver
              const conversationKey = nip44.v2.utils.getConversationKey(
                hexToBytes(userPrivateKeyHex),
                event.pubkey
              );
              
              messageText = nip44.v2.decrypt(event.content, conversationKey);
            }
            
            decryptedMessages.push({
              id: event.id,
              senderPubkey: event.pubkey,
              text: messageText,
              timestamp: event.created_at,
              createdAt: event.created_at,
              isPublic
            });
          } catch (decryptError) {
            console.warn('Failed to decrypt/parse message:', event.id, decryptError);
          }
        }

        // Sort by timestamp
        decryptedMessages.sort((a, b) => a.timestamp - b.timestamp);
        
        console.log(`Successfully processed ${decryptedMessages.length} messages`);
        setMessages(decryptedMessages);
        
      } catch (error) {
        console.error('Error fetching group messages:', error);
      } finally {
        setIsLoading(false);
        pool.close(parameters.relays);
      }
    };

    fetchMessages();
  }, [processEventId, userPubkey, userPrivateKeyHex, parameters?.relays]);

  return { messages, isLoading };
};
