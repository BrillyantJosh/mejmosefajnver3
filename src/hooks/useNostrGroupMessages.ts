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

    const fetchMessages = async () => {
      const pool = new SimplePool();
      
      try {
        console.log('🔍 Fetching KIND 87046 (messages) for:', {
          processEventId: processEventId.slice(0, 16) + '...',
          groupKeyHex: groupKeyHex.slice(0, 16) + '...'
        });
        
        // Fetch only KIND 87046 messages
        const filter: Filter = {
          kinds: [87046],
          '#e': [processEventId],
          limit: 500
        };

        const events = await pool.querySync(parameters.relays, filter);
        
        console.log(`📦 Found ${events.length} message events (KIND 87046)`);
        
        if (events.length === 0) {
          console.warn('⚠️ No KIND 87046 messages found for this process');
        }

        // Decrypt and process messages
        const decryptedMessages: GroupMessage[] = [];
        
        for (const event of events) {
          try {
            console.log('🔐 Decrypting message:', {
              eventId: event.id.slice(0, 16),
              eventPubkey: event.pubkey.slice(0, 16),
              groupKeyUsed: groupKeyHex.slice(0, 16) + '...',
              encryptedContentPreview: event.content.substring(0, 50) + '...'
            });

            // For existing OWN ▲ messages, derive NIP-44 conversation key from GROUP KEY + message pubkey
            const groupKeyBytes = hexToBytes(groupKeyHex);
            const conversationKey = nip44.v2.utils.getConversationKey(
              groupKeyBytes,
              event.pubkey
            );

            const decryptedContent = nip44.v2.decrypt(event.content, conversationKey);
            const messageData = JSON.parse(decryptedContent);
            
            // Extract phase from tags
            const phaseTag = event.tags.find((tag) => tag[0] === 'phase');
            const phase = phaseTag ? phaseTag[1] : 'unknown';
            
            // Extract sender pubkey from tags (for display purposes only)
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
            
            console.log('✅ Message decrypted:', {
              text: messageData.text.substring(0, 30) + '...',
              timestamp: messageData.timestamp,
              senderPubkey: senderPubkey.slice(0, 16)
            });
          } catch (decryptError) {
            console.error('❌ Failed to decrypt/parse message:', {
              eventId: event.id.slice(0, 16),
              eventPubkey: event.pubkey.slice(0, 16),
              groupKeyUsed: groupKeyHex.slice(0, 16) + '...',
              error: decryptError instanceof Error ? decryptError.message : 'Unknown error',
              tags: event.tags
            });
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
