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
  const [decryptionFailed, setDecryptionFailed] = useState(false);
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
        let successCount = 0;
        let failedCount = 0;
        
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
            
            successCount++;
            console.log('✅ Message decrypted:', messageData.text.substring(0, 30) + '...');
          } catch (decryptError) {
            failedCount++;
            console.warn('Failed to decrypt/parse message:', event.id, decryptError);
          }
        }

        // Sort by timestamp
        decryptedMessages.sort((a, b) => a.timestamp - b.timestamp);
        
        console.log(`📊 Decryption results: ${successCount} success, ${failedCount} failed out of ${events.length} total`);
        
        // If all messages failed to decrypt, the group key is likely invalid
        if (events.length > 0 && successCount === 0) {
          console.error('❌ ALL messages failed to decrypt - group key is likely invalid or cached incorrectly');
          setDecryptionFailed(true);
        } else {
          setDecryptionFailed(false);
        }
        
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

  return { messages, isLoading, decryptionFailed };
};
