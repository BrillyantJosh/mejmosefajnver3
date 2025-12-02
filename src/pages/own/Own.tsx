import { useState, useEffect } from "react";
import ConversationList from "@/components/own/ConversationList";
import ChatView from "@/components/own/ChatView";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrOpenProcesses } from "@/hooks/useNostrOpenProcesses";
import { useNostrGroupKey } from "@/hooks/useNostrGroupKey";
import { useNostrGroupMessages } from "@/hooks/useNostrGroupMessages";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";

const SUPABASE_PUBLIC_URL = import.meta.env.VITE_SUPABASE_URL as string;
const DM_AUDIO_BUCKET = "dm-audio";

export default function Own() {
  const { session } = useAuth();
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

  // Format messages for display
  const formattedMessages = messages.map(msg => {
    const text = msg.text.trim();

    // 1) New structure: "audio:<relative-path>"
    if (text.startsWith("audio:")) {
      const path = text.slice("audio:".length).trim();

      const audioUrl = path.startsWith("http")
        ? path
        : `${SUPABASE_PUBLIC_URL}/storage/v1/object/public/${DM_AUDIO_BUCKET}/${path}`;

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
      };
    }
    
    return {
      id: msg.id,
      sender: profiles.get(msg.senderPubkey)?.full_name || msg.senderPubkey.slice(0, 8),
      timestamp: new Date(msg.timestamp * 1000).toLocaleString(),
      type: 'text' as const,
      content: msg.text
    };
  });

  if (processesLoading) {
    return (
      <div className="h-[calc(100vh-200px)] flex items-center justify-center">
        <p className="text-muted-foreground">Loading processes...</p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-200px)]">
      {!selectedProcessId ? (
        // Conversation List - full width when no chat selected
        <div className="overflow-y-auto h-full max-w-2xl mx-auto">
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
              // TODO: Send encrypted audio message to Nostr
              console.log('🎵 Sending OWN audio:', audioPath);
            }}
            isLoading={keyLoading || messagesLoading}
          />
        </div>
      )}
    </div>
  );
}
