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
    if (!processEventId || !groupKeyHex || !parameters?.relays) {
      setIsLoading(false);
      return;
    }

    const fetchMessages = async () => {
      const pool = new SimplePool();
      
      try {
        console.log('Fetching KIND 87046 (messages) for process:', processEventId);
        
        // Fetch messages (KIND 87046)
        const filter: Filter = {
          kinds: [87046],
          '#e': [processEventId],
          limit: 500
        };

        const events = await pool.querySync(parameters.relays, filter);
        
        console.log(`Found ${events.length} message events (KIND 87046)`);

        // Decrypt and process messages
        const decryptedMessages: GroupMessage[] = [];
        
        for (const event of events) {
          try {
            // DECRYPT MESSAGE using GROUP KEY + message author's pubkey
            const groupKeyBytes = hexToBytes(groupKeyHex);
            const conversationKey = nip44.v2.utils.getConversationKey(
              groupKeyBytes,  // Group key (acts as private key)
              event.pubkey    // Message author's public key
            );
            
            const decryptedContent = nip44.v2.decrypt(event.content, conversationKey);
            const messageData = JSON.parse(decryptedContent);
            
            // Get phase from tags
            const phaseTag = event.tags.find((tag) => tag[0] === 'phase');
            const phase = phaseTag ? phaseTag[1] : 'unknown';
            
            // Get sender pubkey from tags
            const senderTag = event.tags.find(
              (tag) => tag[0] === 'p' && tag[2] === 'sender'
            );
            const senderPubkey = senderTag ? senderTag[1] : event.pubkey;
            
            decryptedMessages.push({
              id: event.id,
              senderPubkey: senderPubkey,
              text: messageData.text,
              timestamp: messageData.timestamp,
              createdAt: event.created_at,
              phase: phase
            });
            
            console.log('✅ Message decrypted:', messageData.text.substring(0, 30) + '...');
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
  }, [processEventId, groupKeyHex, parameters?.relays]);

  return { messages, isLoading };
};
