import { useState, useEffect, useCallback, useMemo } from 'react';
import { SimplePool, Event, finalizeEvent } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { toast } from '@/hooks/use-toast';
import { nip04Encrypt, nip04Decrypt } from '@/lib/nostr-nip04';
import { supabase } from '@/integrations/supabase/client';
import { useNostrProfilesCacheBulk } from './useNostrProfilesCacheBulk';

// Helper: Hex to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

// Helper: Uint8Array to Hex
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Default fallback relays (only LANA relays)
const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

interface DirectMessage {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  decryptedContent?: string;
  isOwn: boolean;
  isRead?: boolean;
}

interface Conversation {
  pubkey: string;
  messages: DirectMessage[];
  lastMessage?: DirectMessage;
  unreadCount: number;
}

export function useNostrDMs() {
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const [conversations, setConversations] = useState<Map<string, Conversation>>(new Map());
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [totalEvents, setTotalEvents] = useState(0);
  const [readStatuses, setReadStatuses] = useState<Map<string, boolean>>(new Map());
  const pool = useMemo(() => new SimplePool(), []);
  
  // Get relays from system parameters or use default
  const RELAYS = useMemo(() => {
    if (systemParameters?.relays && systemParameters.relays.length > 0) {
      console.log('📡 Using relays from KIND 38888:', systemParameters.relays);
      return systemParameters.relays;
    }
    console.log('📡 Using default LANA relays');
    return DEFAULT_RELAYS;
  }, [systemParameters?.relays]);

  // Get all conversation pubkeys for bulk profile fetching
  const conversationPubkeys = useMemo(() => 
    Array.from(conversations.keys()),
    [conversations]
  );

  // Use bulk profile cache
  const { profiles: cachedProfiles, isLoading: profilesLoading } = useNostrProfilesCacheBulk(conversationPubkeys);

  const decryptMessage = useCallback(async (event: Event, theirPubkey: string): Promise<string> => {
    if (!session?.nostrPrivateKey) return '';
    
    try {
      console.log('🔓 Attempting decrypt:', {
        eventId: event.id.slice(0, 8),
        eventAuthor: event.pubkey.slice(0, 8),
        myPubkey: session.nostrHexId.slice(0, 8),
        theirPubkey: theirPubkey.slice(0, 8),
        encryptedPreview: event.content.slice(0, 30) + '...'
      });
      
      // Use custom NIP-04 decrypt
      const privateKeyHex = typeof session.nostrPrivateKey === 'string' 
        ? session.nostrPrivateKey
        : bytesToHex(session.nostrPrivateKey);
        
      const decrypted = await nip04Decrypt(
        event.content,
        privateKeyHex,
        theirPubkey
      );
      
      console.log('✅ Decrypt success:', decrypted.slice(0, 20) + '...');
      return decrypted;
    } catch (error) {
      console.error('❌ Decrypt failed:', {
        error: error instanceof Error ? error.message : 'Unknown',
        eventId: event.id.slice(0, 8),
        eventAuthor: event.pubkey.slice(0, 8),
        recipientTag: event.tags.find(t => t[0] === 'p')?.[1]?.slice(0, 8),
        myPubkey: session.nostrHexId.slice(0, 8)
      });
      return `[Cannot decrypt - wrong key]`;
    }
  }, [session?.nostrPrivateKey, session?.nostrHexId]);

  // Save message to DB for instant loading
  const saveMessageToDB = useCallback(async (event: Event, theirPubkey: string, decryptedContent: string) => {
    try {
      const { error } = await supabase
        .from('direct_messages')
        .upsert({
          event_id: event.id,
          sender_pubkey: event.pubkey,
          recipient_pubkey: theirPubkey,
          content: event.content,
          decrypted_content: decryptedContent,
          created_at: new Date(event.created_at * 1000).toISOString(),
          kind: event.kind,
          tags: event.tags as any,
          raw_event: event as any
        } as any, { 
          onConflict: 'event_id',
          ignoreDuplicates: true 
        });
      
      if (error && !error.message.includes('duplicate')) {
        console.error('❌ Error saving message to DB:', error);
      }
    } catch (error) {
      console.error('❌ Exception in saveMessageToDB:', error);
    }
  }, []);

  // Load messages from DB for instant display
  const loadMessagesFromDB = useCallback(async () => {
    if (!session?.nostrHexId) return;
    
    console.log('⚡ Loading messages from DB for instant display...');
    
    try {
      const { data: messages, error } = await supabase
        .from('direct_messages')
        .select('*')
        .or(`sender_pubkey.eq.${session.nostrHexId},recipient_pubkey.eq.${session.nostrHexId}`)
        .order('created_at', { ascending: true });
      
      if (error) {
        console.error('❌ Error loading from DB:', error);
        return;
      }
      
      console.log('✅ Loaded', messages.length, 'messages from DB');
      
      // Group messages into conversations
      const conversationsMap = new Map<string, Conversation>();
      
      for (const msg of messages) {
        const contactPubkey = msg.sender_pubkey === session.nostrHexId 
          ? msg.recipient_pubkey 
          : msg.sender_pubkey;
        
        if (!conversationsMap.has(contactPubkey)) {
          conversationsMap.set(contactPubkey, { 
            pubkey: contactPubkey, 
            messages: [],
            unreadCount: 0
          });
        }
        
        const isOwn = msg.sender_pubkey === session.nostrHexId;
        const isRead = isOwn ? true : (readStatuses.get(msg.event_id) ?? false);
        
        conversationsMap.get(contactPubkey)!.messages.push({
          id: msg.event_id,
          pubkey: msg.sender_pubkey,
          content: msg.content,
          decryptedContent: msg.decrypted_content || undefined,
          created_at: new Date(msg.created_at).getTime() / 1000,
          isOwn,
          isRead
        });
      }
      
      // Calculate unread counts and set last messages
      conversationsMap.forEach((conversation, pubkey) => {
        conversation.messages.sort((a, b) => a.created_at - b.created_at);
        conversation.lastMessage = conversation.messages[conversation.messages.length - 1];
        conversation.unreadCount = conversation.messages.filter(m => !m.isOwn && !m.isRead).length;
      });
      
      setConversations(conversationsMap);
      setLoading(false);
      console.log('✅ Instant load complete -', conversationsMap.size, 'conversations ready');
    } catch (error) {
      console.error('❌ Exception in loadMessagesFromDB:', error);
      setLoading(false);
    }
  }, [session?.nostrHexId, readStatuses]);


  // Supabase read status functions
  const saveMessageReadStatus = useCallback(async (
    userNostrId: string,
    messageEventId: string,
    senderPubkey: string,
    conversationPubkey: string,
    isOwn: boolean
  ) => {
    if (isOwn) return; // Don't track own messages
    
    try {
      const { error } = await supabase
        .from('dm_read_status')
        .upsert({
          user_nostr_id: userNostrId,
          message_event_id: messageEventId,
          sender_pubkey: senderPubkey,
          conversation_pubkey: conversationPubkey,
          is_read: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_nostr_id,message_event_id',
          ignoreDuplicates: false
        });
        
      if (error) {
        console.error('❌ Error saving read status:', error);
      }
    } catch (error) {
      console.error('❌ Exception in saveMessageReadStatus:', error);
    }
  }, []);

  const markMessagesAsReadInDB = useCallback(async (
    userNostrId: string,
    conversationPubkey: string
  ) => {
    try {
      const { error } = await supabase
        .from('dm_read_status')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_nostr_id', userNostrId)
        .eq('conversation_pubkey', conversationPubkey)
        .eq('is_read', false);
        
      if (error) {
        console.error('❌ Error marking messages as read:', error);
      } else {
        console.log('✅ Marked messages as read for conversation:', conversationPubkey.slice(0, 8));
      }
    } catch (error) {
      console.error('❌ Exception in markMessagesAsReadInDB:', error);
    }
  }, []);

  const loadReadStatuses = useCallback(async (userNostrId: string) => {
    try {
      const { data, error } = await supabase
        .from('dm_read_status')
        .select('message_event_id, is_read')
        .eq('user_nostr_id', userNostrId);
        
      if (error) {
        console.error('❌ Error loading read statuses:', error);
        return new Map<string, boolean>();
      }
      
      const statusMap = new Map<string, boolean>();
      data?.forEach(status => {
        statusMap.set(status.message_event_id, status.is_read);
      });
      
      console.log('📖 Loaded read statuses:', statusMap.size);
      return statusMap;
    } catch (error) {
      console.error('❌ Exception in loadReadStatuses:', error);
      return new Map<string, boolean>();
    }
  }, []);

  const deleteReadStatus = useCallback(async (
    userNostrId: string,
    messageEventId: string
  ) => {
    try {
      const { error } = await supabase
        .from('dm_read_status')
        .delete()
        .eq('user_nostr_id', userNostrId)
        .eq('message_event_id', messageEventId);
        
      if (error) {
        console.error('❌ Error deleting read status:', error);
      }
    } catch (error) {
      console.error('❌ Exception in deleteReadStatus:', error);
    }
  }, []);

  // Load read statuses on mount
  useEffect(() => {
    if (!session?.nostrHexId) return;
    
    const loadStatuses = async () => {
      const statuses = await loadReadStatuses(session.nostrHexId);
      setReadStatuses(statuses);
    };
    
    loadStatuses();
  }, [session?.nostrHexId, loadReadStatuses]);

  const processMessage = useCallback(async (event: Event) => {
    if (!session?.nostrHexId) return;

    const isOwn = event.pubkey === session.nostrHexId;
    const recipientPubkey = event.tags.find(tag => tag[0] === 'p')?.[1] || '';
    const otherPubkey = isOwn ? recipientPubkey : event.pubkey;

    if (!otherPubkey) {
      console.warn('⚠️ No other pubkey found for event:', event.id);
      return;
    }

    // Check if this message is actually for me
    const isForMe = isOwn || recipientPubkey === session.nostrHexId;
    if (!isForMe) {
      console.log('⏭️  Skipping event - not for me:', {
        eventId: event.id.slice(0, 8),
        author: event.pubkey.slice(0, 8),
        recipient: recipientPubkey?.slice(0, 8),
        myPubkey: session.nostrHexId.slice(0, 8)
      });
      return;
    }

    console.log('📝 Processing message:', {
      eventId: event.id.slice(0, 8),
      isOwn,
      author: event.pubkey.slice(0, 8),
      recipient: recipientPubkey?.slice(0, 8),
      otherPubkey: otherPubkey.slice(0, 8)
    });

    const decryptedContent = await decryptMessage(event, otherPubkey);

    // Save to DB for instant loading next time
    await saveMessageToDB(event, otherPubkey, decryptedContent);

    // Save read status in database (only for received messages)
    if (!isOwn && session.nostrHexId) {
      await saveMessageReadStatus(
        session.nostrHexId,
        event.id,
        event.pubkey,
        otherPubkey,
        isOwn
      );
    }

    // Get read status from map (own messages are always "read")
    const isRead = isOwn ? true : (readStatuses.get(event.id) ?? false);

    const message: DirectMessage = {
      id: event.id,
      pubkey: event.pubkey,
      content: event.content,
      created_at: event.created_at,
      decryptedContent,
      isOwn,
      isRead
    };

    setConversations(prev => {
      const newConversations = new Map(prev);
      const existing = newConversations.get(otherPubkey) || {
        pubkey: otherPubkey,
        messages: [],
        unreadCount: 0
      };

      // Check if message already exists
      if (existing.messages.some(m => m.id === message.id)) {
        return prev;
      }

      const updatedMessages = [...existing.messages, message].sort(
        (a, b) => a.created_at - b.created_at
      );

      // Calculate unread count from actual read status
      const unreadCount = updatedMessages.filter(m => !m.isOwn && !m.isRead).length;

      newConversations.set(otherPubkey, {
        ...existing,
        messages: updatedMessages,
        lastMessage: updatedMessages[updatedMessages.length - 1],
        unreadCount
      });

      return newConversations;
    });
  }, [session?.nostrHexId, decryptMessage, readStatuses, saveMessageReadStatus, saveMessageToDB]);

  useEffect(() => {
    if (!session?.nostrHexId || !session?.nostrPrivateKey) {
      setLoading(false);
      return;
    }

    let isSubscribed = true;
    let cleanupFn: (() => void) | undefined;

    const loadMessages = async () => {
      // Step 1: INSTANT LOAD from DB
      await loadMessagesFromDB();
      
      // Step 2: BACKGROUND SYNC from Nostr relays
      console.log('🔌 Connecting to Nostr relays for background sync...');
      console.log('📍 Your Nostr ID:', session.nostrHexId);
      console.log('📡 Relays:', RELAYS);
      setConnected(true);

      try {
        // Step 1: Query historical messages (last 30 days)
        const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
        
        console.log('📥 Fetching historical messages...');
        
        // Query sent messages
        const sentFilter = {
          kinds: [4],
          authors: [session.nostrHexId],
          since: thirtyDaysAgo
        };
        
        console.log('🔍 Query sent filter:', sentFilter);
        
        const sentPromise = Promise.race([
          pool.querySync(RELAYS, sentFilter),
          new Promise<Event[]>((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), 10000)
          )
        ]);

        // Query received messages
        const receivedFilter = {
          kinds: [4],
          '#p': [session.nostrHexId],
          since: thirtyDaysAgo
        };
        
        console.log('🔍 Query received filter:', receivedFilter);
        
        const receivedPromise = Promise.race([
          pool.querySync(RELAYS, receivedFilter),
          new Promise<Event[]>((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), 10000)
          )
        ]);

        const [sentEvents, receivedEvents] = await Promise.all([
          sentPromise.catch(err => {
            console.error('❌ Sent query failed:', err);
            return [];
          }),
          receivedPromise.catch(err => {
            console.error('❌ Received query failed:', err);
            return [];
          })
        ]);

        console.log('📨 Sent events:', sentEvents.length);
        console.log('📨 Received events:', receivedEvents.length);

        // Process all historical messages
        const allEvents = [...sentEvents, ...receivedEvents];
        console.log('📊 Total events to process:', allEvents.length);
        
        for (const event of allEvents) {
          if (isSubscribed) {
            setTotalEvents(prev => prev + 1);
            await processMessage(event);
          }
        }

        console.log('✅ Historical messages synced from Nostr');

        // Step 2: Subscribe to new messages (real-time)
        if (!isSubscribed) return;
        
        const now = Math.floor(Date.now() / 1000);
        console.log('🔔 Subscribing to real-time updates from:', new Date(now * 1000).toISOString());

        // Subscribe to new sent messages
        const sentSub = pool.subscribeMany(
          RELAYS,
          [{
            kinds: [4],
            authors: [session.nostrHexId],
            since: now
          }] as any,
          {
            onevent(event) {
              if (isSubscribed) {
                console.log('📤 New sent DM:', event.id);
                setTotalEvents(prev => prev + 1);
                processMessage(event);
              }
            }
          }
        );

        // Subscribe to new received messages
        const receivedSub = pool.subscribeMany(
          RELAYS,
          [{
            kinds: [4],
            '#p': [session.nostrHexId],
            since: now
          }] as any,
          {
            onevent(event) {
              if (isSubscribed) {
                console.log('📨 New received DM:', event.id);
                setTotalEvents(prev => prev + 1);
                processMessage(event);
              }
            }
          }
        );

        console.log('✅ Subscribed to real-time updates');

        // Set cleanup function
        cleanupFn = () => {
          console.log('🔌 Closing subscriptions...');
          sentSub.close();
          receivedSub.close();
        };

      } catch (error) {
        console.error('❌ Error loading messages:', error);
        setLoading(false);
      }
    };

    loadMessages();

    return () => {
      isSubscribed = false;
      setConnected(false);
      if (cleanupFn) cleanupFn();
    };
  }, [session?.nostrHexId, session?.nostrPrivateKey, processMessage, pool, loadMessagesFromDB, RELAYS]);

  // Supabase Realtime subscription for instant DB updates
  useEffect(() => {
    if (!session?.nostrHexId) return;

    console.log('🔔 Setting up Supabase Realtime subscription...');

    // Subscribe to NEW messages in DB
    const messagesChannel = supabase
      .channel('direct-messages-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages'
        },
        async (payload) => {
          console.log('⚡ NEW message from Supabase DB:', payload);
          const newMsg = payload.new as any;
          
          // Check if this message involves current user
          const isForMe = newMsg.sender_pubkey === session.nostrHexId || 
                          newMsg.recipient_pubkey === session.nostrHexId;
          
          if (!isForMe) {
            console.log('⏭️  Skipping DB event - not for me');
            return;
          }
          
          // Convert to DirectMessage format
          const contactPubkey = newMsg.sender_pubkey === session.nostrHexId 
            ? newMsg.recipient_pubkey 
            : newMsg.sender_pubkey;
          
          const isOwn = newMsg.sender_pubkey === session.nostrHexId;
          const isRead = isOwn ? true : (readStatuses.get(newMsg.event_id) ?? false);
          
          const message: DirectMessage = {
            id: newMsg.event_id,
            pubkey: newMsg.sender_pubkey,
            content: newMsg.content,
            decryptedContent: newMsg.decrypted_content || undefined,
            created_at: new Date(newMsg.created_at).getTime() / 1000,
            isOwn,
            isRead
          };
          
          // Update conversations state
          setConversations(prev => {
            const newConversations = new Map(prev);
            const existing = newConversations.get(contactPubkey) || {
              pubkey: contactPubkey,
              messages: [],
              unreadCount: 0
            };

            // Check if message already exists (prevent duplicates)
            if (existing.messages.some(m => m.id === message.id)) {
              console.log('⏭️  Message already exists in UI');
              return prev;
            }

            const updatedMessages = [...existing.messages, message].sort(
              (a, b) => a.created_at - b.created_at
            );

            const unreadCount = updatedMessages.filter(m => !m.isOwn && !m.isRead).length;

            newConversations.set(contactPubkey, {
              ...existing,
              messages: updatedMessages,
              lastMessage: updatedMessages[updatedMessages.length - 1],
              unreadCount
            });

            console.log('✅ UI updated from Supabase realtime');
            return newConversations;
          });
        }
      )
      .subscribe();

    // Subscribe to READ STATUS updates
    const readStatusChannel = supabase
      .channel('dm-read-status-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'dm_read_status',
          filter: `user_nostr_id=eq.${session.nostrHexId}`
        },
        (payload) => {
          console.log('📖 Read status updated from Supabase:', payload);
          const updatedStatus = payload.new as any;
          
          // Update read statuses map
          setReadStatuses(prev => {
            const newMap = new Map(prev);
            newMap.set(updatedStatus.message_event_id, updatedStatus.is_read);
            return newMap;
          });
          
          // Update conversation unread counts
          setConversations(prev => {
            const newConversations = new Map(prev);
            const conversation = newConversations.get(updatedStatus.conversation_pubkey);
            
            if (conversation) {
              const updatedMessages = conversation.messages.map(msg => 
                msg.id === updatedStatus.message_event_id 
                  ? { ...msg, isRead: updatedStatus.is_read }
                  : msg
              );
              
              const unreadCount = updatedMessages.filter(m => !m.isOwn && !m.isRead).length;
              
              newConversations.set(updatedStatus.conversation_pubkey, {
                ...conversation,
                messages: updatedMessages,
                unreadCount
              });
            }
            
            return newConversations;
          });
        }
      )
      .subscribe();

    console.log('✅ Supabase Realtime subscriptions active');

    // Cleanup
    return () => {
      console.log('🔌 Closing Supabase Realtime subscriptions...');
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(readStatusChannel);
    };
  }, [session?.nostrHexId, readStatuses]);

  const sendMessage = useCallback(async (recipientPubkey: string, message: string) => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast({
        title: 'Error',
        description: 'Not authenticated',
        variant: 'destructive'
      });
      return;
    }

    try {
      console.log('🔐 Encrypting message to:', recipientPubkey.slice(0, 8) + '...');
      
      // Use custom NIP-04 encrypt
      const privateKeyHex = typeof session.nostrPrivateKey === 'string' 
        ? session.nostrPrivateKey
        : bytesToHex(session.nostrPrivateKey);
      
      const encrypted = await nip04Encrypt(
        message,
        privateKeyHex,
        recipientPubkey
      );

      console.log('✍️ Signing event...');
      const privKeyBytes = typeof session.nostrPrivateKey === 'string' 
        ? hexToBytes(session.nostrPrivateKey)
        : session.nostrPrivateKey;
      
      const event = finalizeEvent({
        kind: 4,
        content: encrypted,
        tags: [['p', recipientPubkey]],
        created_at: Math.floor(Date.now() / 1000)
      }, privKeyBytes);

      console.log('📡 Publishing DM to', RELAYS.length, 'relays:', RELAYS);
      
      // Publish to each relay individually with detailed logging
      const publishResults = await Promise.allSettled(
        RELAYS.map(async (relay) => {
          try {
            console.log(`🔄 Publishing to ${relay}...`);
            const publishPromises = pool.publish([relay], event);
            
            // Wait for publish with timeout
            await Promise.race([
              publishPromises[0], // Only one promise since we're publishing to one relay
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Publish timeout after 8s')), 8000)
              )
            ]);
            
            console.log(`✅ Successfully published DM to ${relay}`);
            return { relay, success: true };
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            console.error(`❌ Failed to publish DM to ${relay}:`, errorMsg);
            return { relay, success: false, error: errorMsg };
          }
        })
      );

      const successResults = publishResults.filter(
        r => r.status === 'fulfilled' && (r.value as any).success
      );
      const failedResults = publishResults.filter(
        r => r.status === 'rejected' || (r.status === 'fulfilled' && !(r.value as any).success)
      );
      
      const successCount = successResults.length;
      console.log(`✅ DM published to ${successCount}/${RELAYS.length} relays`);
      
      if (failedResults.length > 0) {
        console.warn('⚠️ Failed relays:', failedResults.map(r => 
          r.status === 'fulfilled' ? (r.value as any).relay : 'unknown'
        ));
      }
      
      // Add to local state immediately
      await processMessage(event);

      // Only show error toast if all relays failed
      if (successCount === 0) {
        toast({
          title: 'Warning',
          description: 'Message sent locally but failed to reach relays',
          variant: 'destructive'
        });
      }
      // Success case: no toast, silent success
    } catch (error) {
      console.error('❌ Error sending message:', error);
      toast({
        title: 'Error',
        description: 'Failed to send message',
        variant: 'destructive'
      });
    }
  }, [session, pool, processMessage, RELAYS]);

  const deleteMessage = useCallback(async (messageId: string, conversationPubkey: string) => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast({
        title: 'Error',
        description: 'Not authenticated',
        variant: 'destructive'
      });
      return;
    }

    try {
      console.log('🗑️  Deleting message:', messageId.slice(0, 8) + '...');
      
      const privKeyBytes = typeof session.nostrPrivateKey === 'string' 
        ? hexToBytes(session.nostrPrivateKey)
        : session.nostrPrivateKey;
      
      // Create KIND 5 deletion event
      const deletionEvent = finalizeEvent({
        kind: 5,
        content: 'Message deleted by user',
        tags: [['e', messageId]],
        created_at: Math.floor(Date.now() / 1000)
      }, privKeyBytes);

      console.log('📡 Publishing deletion to', RELAYS.length, 'relays:', RELAYS);
      
      // Publish deletion event to each relay individually
      const publishResults = await Promise.allSettled(
        RELAYS.map(async (relay) => {
          try {
            console.log(`🔄 Publishing deletion to ${relay}...`);
            const publishPromises = pool.publish([relay], deletionEvent);
            await Promise.race([
              publishPromises[0], // Only one promise since we're publishing to one relay
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Deletion timeout after 8s')), 8000)
              )
            ]);
            
            console.log(`✅ Successfully published deletion to ${relay}`);
            return { relay, success: true };
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            console.error(`❌ Failed to publish deletion to ${relay}:`, errorMsg);
            return { relay, success: false, error: errorMsg };
          }
        })
      );

      const successResults = publishResults.filter(
        r => r.status === 'fulfilled' && (r.value as any).success
      );
      const failedResults = publishResults.filter(
        r => r.status === 'rejected' || (r.status === 'fulfilled' && !(r.value as any).success)
      );
      
      const successCount = successResults.length;
      console.log(`✅ Deletion published to ${successCount}/${RELAYS.length} relays`);
      
      if (failedResults.length > 0) {
        console.warn('⚠️ Failed relays:', failedResults.map(r => 
          r.status === 'fulfilled' ? (r.value as any).relay : 'unknown'
        ));
      }
      
      // Delete read status from database
      if (session.nostrHexId) {
        await deleteReadStatus(session.nostrHexId, messageId);
      }
      
      // Remove from local state
      setConversations(prev => {
        const newConversations = new Map(prev);
        const conversation = newConversations.get(conversationPubkey);
        
        if (conversation) {
          const updatedMessages = conversation.messages.filter(m => m.id !== messageId);
          
          if (updatedMessages.length > 0) {
            newConversations.set(conversationPubkey, {
              ...conversation,
              messages: updatedMessages,
              lastMessage: updatedMessages[updatedMessages.length - 1]
            });
          } else {
            // Remove conversation if no messages left
            newConversations.delete(conversationPubkey);
          }
        }
        
        return newConversations;
      });

      if (successCount > 0) {
        toast({
          title: 'Success',
          description: 'Message deleted'
        });
      } else {
        toast({
          title: 'Warning',
          description: 'Message deleted locally but failed to reach relays',
          variant: 'destructive'
        });
      }
    } catch (error) {
      console.error('❌ Error deleting message:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete message',
        variant: 'destructive'
      });
    }
  }, [session, pool, RELAYS, deleteReadStatus]);

  const markAsRead = useCallback(async (pubkey: string) => {
    if (!session?.nostrHexId) return;
    
    // Mark messages as read in database
    await markMessagesAsReadInDB(session.nostrHexId, pubkey);
    
    // Update local state
    setConversations(prev => {
      const newConversations = new Map(prev);
      const conversation = newConversations.get(pubkey);
      
      if (conversation) {
        // Mark all received messages as read
        const updatedMessages = conversation.messages.map(msg => ({
          ...msg,
          isRead: true
        }));
        
        newConversations.set(pubkey, {
          ...conversation,
          messages: updatedMessages,
          unreadCount: 0
        });
        
        // Update read statuses in memory
        const newReadStatuses = new Map(readStatuses);
        conversation.messages.forEach(msg => {
          if (!msg.isOwn) {
            newReadStatuses.set(msg.id, true);
          }
        });
        setReadStatuses(newReadStatuses);
      }
      
      return newConversations;
    });
    
    console.log('✅ Marked conversation as read:', pubkey.slice(0, 8));
  }, [session, readStatuses, markMessagesAsReadInDB]);

  return {
    conversations: Array.from(conversations.values()).sort((a, b) => {
      const aTime = a.lastMessage?.created_at || 0;
      const bTime = b.lastMessage?.created_at || 0;
      return bTime - aTime;
    }),
    profiles: cachedProfiles,
    loading: loading || profilesLoading,
    connected,
    sendMessage,
    deleteMessage,
    markAsRead,
    totalEvents,
    relayCount: RELAYS.length
  };
}
