import { useState, useEffect } from "react";
import ConversationList from "@/components/own/ConversationList";
import ChatView from "@/components/own/ChatView";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrOpenProcesses } from "@/hooks/useNostrOpenProcesses";
import { useNostrGroupKey } from "@/hooks/useNostrGroupKey";
import { useNostrGroupMessages } from "@/hooks/useNostrGroupMessages";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { SimplePool, finalizeEvent, nip44 } from "nostr-tools";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { toast } from "sonner";
import { OWN_PROJECT_ID } from "@/lib/ownSupabaseClient";

// External Supabase project for OWN audio storage
const OWN_SUPABASE_URL = `https://${OWN_PROJECT_ID}.supabase.co`;
const DM_AUDIO_BUCKET = "dm-audio";

// Helper to convert hex string to Uint8Array
const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

export default function Own() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [selectedProcessId, setSelectedProcessId] = useState<string>();

  // TEMP: Clear all group key caches for debugging
  useEffect(() => {
    const keysToRemove = Object.keys(localStorage).filter(k => 
      k.startsWith('group_key_own:')
    );
    if (keysToRemove.length > 0) {
      keysToRemove.forEach(k => localStorage.removeItem(k));
      console.log('🧹 Cleared', keysToRemove.length, 'cached group keys for debugging');
    }
  }, []);

  // Fetch open processes
  const { processes, isLoading: processesLoading } = useNostrOpenProcesses(session?.nostrHexId || null);

  // Get selected process
  const selectedProcess = processes.find(p => p.id === selectedProcessId);

  // Step 1: Fetch group key for selected process
  const { groupKey, isLoading: keyLoading } = useNostrGroupKey(
    selectedProcess?.processEventId || null,
    session?.nostrHexId || null,
    session?.nostrPrivateKey || null
  );

  // Step 2: Fetch messages using the group key
  const { messages, isLoading: messagesLoading } = useNostrGroupMessages(
    selectedProcess?.processEventId || null,
    groupKey
  );

  // Collect all unique pubkeys for profile fetching
  const allPubkeys = processes.length > 0 
    ? Array.from(new Set([
        ...processes.flatMap(p => [p.initiator, p.facilitator, ...p.participants, ...p.guests]),
        ...messages.map(m => m.senderPubkey)
      ]))
    : [];

  // Fetch profiles
  const { profiles } = useNostrProfilesCacheBulk(allPubkeys);

  // Format conversations for display
  const conversations = processes.map(process => ({
    id: process.id,
    title: process.title,
    initiator: profiles.get(process.initiator)?.full_name || process.initiator.slice(0, 8),
    facilitator: profiles.get(process.facilitator)?.full_name || process.facilitator.slice(0, 8),
    participants: process.participants.map(p => 
      profiles.get(p)?.full_name || p.slice(0, 8)
    ),
    status: process.phase,
    lastActivity: new Date(process.openedAt * 1000).toLocaleDateString()
  }));

  // Send OWN message (text or audio)
  const sendOwnMessage = async (content: string): Promise<boolean> => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId || !groupKey || !selectedProcess) {
      toast.error("Missing authentication or group key");
      return false;
    }

    if (!parameters?.relays || parameters.relays.length === 0) {
      toast.error("No relays configured");
      return false;
    }

    try {
      console.log('📤 Sending OWN message:', {
        processId: selectedProcess.processEventId.slice(0, 16) + '...',
        contentPreview: content.substring(0, 50) + (content.length > 50 ? '...' : ''),
        groupKeyHex: groupKey.slice(0, 16) + '...'
      });

      // 1. Prepare message payload
      const messagePayload = {
        text: content.trim(),
        timestamp: Math.floor(Date.now() / 1000)
      };

      const plaintextJson = JSON.stringify(messagePayload);
      console.log('📝 Plaintext payload:', plaintextJson);

      // 2. Encrypt with NIP-44 v2
      // For KIND 87046: groupKey acts as private key, sender pubkey as public key
      const groupKeyBytes = hexToBytes(groupKey);
      const conversationKey = nip44.v2.utils.getConversationKey(
        groupKeyBytes,
        session.nostrHexId
      );

      const encryptedContent = nip44.v2.encrypt(plaintextJson, conversationKey);
      console.log('🔐 Encrypted content length:', encryptedContent.length);

      // 3. Create KIND 87046 event
      const privateKeyBytes = hexToBytes(session.nostrPrivateKey);
      
      const signedEvent = finalizeEvent({
        kind: 87046,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', selectedProcess.processEventId, '', 'process'],
          ['group', `own:${selectedProcess.processEventId}`],
          ['p', session.nostrHexId, '', 'sender'],
          ['encryption', 'nip44'],
          ['phase', selectedProcess.phase || 'unknown']
        ],
        content: encryptedContent
      }, privateKeyBytes);

      console.log('✍️ Event signed:', {
        id: signedEvent.id.slice(0, 16) + '...',
        kind: signedEvent.kind,
        pubkey: signedEvent.pubkey.slice(0, 16) + '...'
      });

      // 4. Publish to relays
      const pool = new SimplePool();
      const publishPromises = pool.publish(parameters.relays, signedEvent);

      const publishResults = await Promise.allSettled(
        Array.from(publishPromises).map((promise, index) => 
          Promise.race([
            promise.then(() => ({ relay: parameters.relays[index], success: true })),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 8000)
            )
          ])
        )
      );

      const successCount = publishResults.filter(r => r.status === 'fulfilled').length;
      console.log(`✅ Published to ${successCount}/${parameters.relays.length} relays`);

      if (successCount > 0) {
        toast.success("Message sent");
        return true;
      } else {
        toast.error("Failed to publish to any relay");
        return false;
      }
    } catch (error) {
      console.error('❌ Error sending OWN message:', error);
      toast.error("Failed to send message");
      return false;
    }
  };

  // Format messages for display
  const formattedMessages = messages.map(msg => {
    const text = msg.text.trim();

    // 1) New structure: "audio:<relative-path>"
    if (text.startsWith("audio:")) {
      const path = text.slice("audio:".length).trim();

      const audioUrl = path.startsWith("http")
        ? path
        : `${OWN_SUPABASE_URL}/storage/v1/object/public/${DM_AUDIO_BUCKET}/${path}`;

      console.log("🎵 Audio message detected:", {
        originalText: text.length > 50 ? text.substring(0, 50) + "..." : text,
        audioPath: path,
        audioUrl,
      });

      return {
        id: msg.id,
        sender: profiles.get(msg.senderPubkey)?.full_name || msg.senderPubkey.slice(0, 8),
        timestamp: new Date(msg.timestamp * 1000).toLocaleString(),
        type: "audio" as const,
        audioUrl,
        isCurrentUser: msg.senderPubkey === session?.nostrHexId,
      };
    }

    // 2) Old structure: full URL inside message content
    if (text.includes("supabase.co/storage/v1/object/public/dm-audio")) {
      const urlMatch = text.match(/https:\/\/[^\s]+/);
      const audioUrl = urlMatch ? urlMatch[0] : text;

      console.log("🎵 Legacy audio message detected:", {
        originalText: text.length > 50 ? text.substring(0, 50) + "..." : text,
        audioUrl,
      });

      return {
        id: msg.id,
        sender: profiles.get(msg.senderPubkey)?.full_name || msg.senderPubkey.slice(0, 8),
        timestamp: new Date(msg.timestamp * 1000).toLocaleString(),
        type: "audio" as const,
        audioUrl,
        isCurrentUser: msg.senderPubkey === session?.nostrHexId,
      };
    }
    
    return {
      id: msg.id,
      sender: profiles.get(msg.senderPubkey)?.full_name || msg.senderPubkey.slice(0, 8),
      timestamp: new Date(msg.timestamp * 1000).toLocaleString(),
      type: 'text' as const,
      content: msg.text,
      isCurrentUser: msg.senderPubkey === session?.nostrHexId,
    };
  });

  if (processesLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-muted-foreground">Loading processes...</p>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] md:h-[calc(100vh-200px)]">
      {!selectedProcessId ? (
        // Conversation List - full width when no chat selected
        <div className="overflow-y-auto h-full max-w-2xl mx-auto px-4 md:px-0">
          <h2 className="text-xl font-semibold mb-4">Messages</h2>
          {conversations.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No open processes found
            </p>
          ) : (
            <ConversationList
              conversations={conversations}
              selectedId={selectedProcessId}
              onSelect={setSelectedProcessId}
            />
          )}
        </div>
      ) : (
        // Chat View - full width when chat selected
        <div className="h-full">
          <ChatView
            conversationTitle={selectedProcess?.title}
            conversationStatus={selectedProcess?.phase}
            processEventId={selectedProcess?.processEventId}
            senderPubkey={session?.nostrHexId}
            messages={formattedMessages}
            onBack={() => setSelectedProcessId(undefined)}
            onSendAudio={async (audioPath: string) => {
              return await sendOwnMessage(audioPath);
            }}
            onSendMessage={async (text: string) => {
              return await sendOwnMessage(text);
            }}
            isLoading={keyLoading || messagesLoading}
          />
        </div>
      )}
    </div>
  );
}
