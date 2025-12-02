import { useState, useEffect } from 'react';
import { SimplePool, Filter, Event, nip44 } from 'nostr-tools';

 
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

  const LANA_RELAYS = [
    'wss://relay.lanavault.space',
    'wss://relay.lanacoin-eternity.com',
    'wss://relay.lanaheartvoice.com',
    'wss://relay.lovelana.org'
  ];

  const getRelays = (): string[] => {
    try {
      const storedParams = sessionStorage.getItem('lana_system_params');
      if (storedParams) {
        const params = JSON.parse(storedParams);
        if (params.relays && Array.isArray(params.relays) && params.relays.length > 0) {
          console.log('📡 Using relays from session:', params.relays);
          return params.relays;
        }
      }
    } catch (error) {
      console.error('❌ Error parsing stored system params:', error);
    }

    console.log('📡 Using fallback LANA relays:', LANA_RELAYS);
    return LANA_RELAYS;
  };

  useEffect(() => {
    console.log('💬 useNostrGroupMessages mounted with:', {
      processEventId: processEventId?.slice(0, 16) + '...',
      groupKeyHex: groupKeyHex?.slice(0, 16) + '...',
      hasGroupKey: !!groupKeyHex,
    });

    if (!processEventId || !groupKeyHex) {
      console.warn('⚠️ useNostrGroupMessages: Missing processEventId or groupKeyHex');
      setIsLoading(false);
      setMessages([]);
      return;
    }

    setIsLoading(true);
    setMessages([]);

    const relays = getRelays();
    if (!relays || relays.length === 0) {
      console.error('❌ useNostrGroupMessages: No relays configured');
      setIsLoading(false);
      return;
    }

    console.log('🏗️ Creating SimplePool instance...');
    const pool = new SimplePool();
    const groupKeyBytes = hexToBytes(groupKeyHex);

    const decryptMessage = (event: Event): GroupMessage | null => {
      try {
        console.log('🔐 Decrypting message:', {
          eventId: event.id.slice(0, 16),
          eventPubkey: event.pubkey.slice(0, 16),
        });

        const conversationKey = nip44.v2.utils.getConversationKey(
          groupKeyBytes,
          event.pubkey
        );

        const decryptedContent = nip44.v2.decrypt(event.content, conversationKey);
        const messageData = JSON.parse(decryptedContent);

        const phaseTag = event.tags.find((tag) => tag[0] === 'phase');
        const phase = phaseTag ? phaseTag[1] : 'unknown';

        const senderTag = event.tags.find(
          (tag) => tag[0] === 'p' && tag[2] === 'sender'
        );
        const senderPubkey = senderTag ? senderTag[1] : event.pubkey;

        console.log('✅ Message decrypted:', {
          text: messageData.text?.substring(0, 30) + '...',
          timestamp: messageData.timestamp,
        });

        return {
          id: event.id,
          senderPubkey,
          text: messageData.text,
          timestamp: messageData.timestamp,
          createdAt: event.created_at,
          phase,
        };
      } catch (decryptError) {
        console.error('❌ Failed to decrypt/parse message:', {
          eventId: event.id.slice(0, 16),
          error: decryptError instanceof Error ? decryptError.message : 'Unknown error',
        });
        return null;
      }
    };

    let sub: any = null;

    try {
      console.log('🔔 Setting up real-time subscription for KIND 87046 messages on relays:', relays);
      console.log('🔍 Filter:', { kinds: [87046], '#e': [processEventId] });

      sub = pool.subscribeMany(
        relays,
        {
          kinds: [87046],
          '#e': [processEventId],
        },
        {
          onevent(event: Event) {
            console.log('📬 New message received in real-time:', {
              eventId: event.id.slice(0, 16),
              created_at: event.created_at,
              kind: event.kind,
            });
            const msg = decryptMessage(event);
            if (msg) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === msg.id)) {
                  console.log('⚠️ Message already exists, skipping');
                  return prev;
                }
                console.log('✅ Adding new message to state:', msg.text.substring(0, 30));
                const updated = [...prev, msg];
                updated.sort((a, b) => a.timestamp - b.timestamp);
                return updated;
              });
            }
          },
          oneose() {
            console.log('✅ Real-time subscription established (EOSE received)');
            setIsLoading(false);
          },
        }
      );

      console.log('✅ Subscription created successfully');
    } catch (error) {
      console.error('❌ Failed to create subscription:', error);
      setIsLoading(false);
    }

    return () => {
      console.log('🔌 Closing subscription and pool...');
      if (sub) {
        sub.close();
      }
      pool.close(relays);
    };
  }, [processEventId, groupKeyHex]);

  return { messages, isLoading };
};
