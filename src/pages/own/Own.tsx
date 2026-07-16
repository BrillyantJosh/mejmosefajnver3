import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import ConversationList from "@/components/own/ConversationList";
import ChatView from "@/components/own/ChatView";
import OwnSelfMatrix from "@/components/own/OwnSelfMatrix";
import OwnFullMatrix from "@/components/own/OwnFullMatrix";
import OwnParticipantDetail from "@/components/own/OwnParticipantDetail";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrOpenProcesses } from "@/hooks/useNostrOpenProcesses";
import { useNostrGroupKey } from "@/hooks/useNostrGroupKey";
import { useNostrGroupMessages } from "@/hooks/useNostrGroupMessages";
import { useNostrProcessExitState, PROCESS_EXIT_KIND } from "@/hooks/useNostrProcessExitState";
import { useNostrProcessPauseState, useNostrProcessPauseStatesBulk, PROCESS_PAUSE_KIND } from "@/hooks/useNostrProcessPauseState";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { useLang } from "@/i18n/I18nContext";
import { finalizeEvent, nip44 } from "nostr-tools";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLashHistory } from "@/hooks/useLashHistory";
import { useNostrLash } from "@/hooks/useNostrLash";
import { useNostrUnpaidLashes } from "@/hooks/useNostrUnpaidLashes";
import { useSupabaseLashCounts } from "@/hooks/useSupabaseLashCounts";

// Storage: local Express server
const OWN_API_URL = import.meta.env.VITE_API_URL ?? '';
const DM_AUDIO_BUCKET = "dm-audio";
const DM_IMAGES_BUCKET = "dm-images";

// Helper to convert hex string to Uint8Array
const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

// Short preview of a message for the "replying to" quote. Detects media from the
// raw (decrypted) text encoding (audio:/image:); otherwise truncates the text.
const ownReplySnippet = (rawText: string): string => {
  const t = (rawText || '').trim();
  if (t.startsWith('audio:')) return '🎤 Voice message';
  if (t.startsWith('image:')) return '🖼 Photo';
  return t.length > 80 ? t.slice(0, 80) + '…' : t;
};

export default function Own() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const navigate = useNavigate();
  const [selectedProcessId, setSelectedProcessId] = useState<string>();
  // Overseer (facilitator/guest) view: which participant's detail is open on the
  // right (null = show the chat). Reset whenever the process changes.
  const [matrixParticipant, setMatrixParticipant] = useState<string | null>(null);
  // Subject's own detailed view (Podrobni pogled) replacing the chat pane.
  const [selfDetail, setSelfDetail] = useState(false);
  useEffect(() => { setMatrixParticipant(null);
    setSelfDetail(false); }, [selectedProcessId]);
  
  // LASH state
  const [lashedEvents, setLashedEvents] = useState<Set<string>>(new Set());
  const [lashingMessageId, setLashingMessageId] = useState<string>();
  const { fetchUserLashes, addLash } = useLashHistory();
  const { giveLash } = useNostrLash();
  const { incrementUnpaidCount } = useNostrUnpaidLashes();

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

  // Exit / Re-enter (KIND 87055) state for the selected process
  const { exitEvents, isExited } = useNostrProcessExitState(
    selectedProcess?.processEventId || null,
    session?.nostrHexId || null
  );
  // Participants and the initiator may exit (not the facilitator or guest)
  const canExit = selectedProcess?.userRole === 'participant' || selectedProcess?.userRole === 'initiator';

  // Facilitator pause / reopen (KIND 87056) state for the selected process
  const { pauseEvents, isLocked, lockedUntil, isLoading: pauseLoading } = useNostrProcessPauseState(
    selectedProcess?.processEventId || null,
    selectedProcess?.facilitator || null
  );
  // Only the facilitator may pause / reopen the process
  const canPause = selectedProcess?.userRole === 'facilitator';
  const en = useLang() === 'en';

  // Get message IDs for LASH counts from Supabase
  const messageIds = messages.map(m => m.id);
  const { lashCounts } = useSupabaseLashCounts(messageIds);

  // Collect all unique pubkeys for profile fetching
  const allPubkeys = processes.length > 0 
    ? Array.from(new Set([
        ...processes.flatMap(p => [p.initiator, p.facilitator, ...p.participants, ...p.guests]),
        ...messages.map(m => m.senderPubkey)
      ]))
    : [];

  // Fetch profiles
  const { profiles } = useNostrProfilesCacheBulk(allPubkeys);

  // Fetch user's lash history when messages change
  useEffect(() => {
    if (messages.length > 0 && session?.nostrHexId) {
      const messageIds = messages.map(m => m.id);
      fetchUserLashes(messageIds).then(lashedSet => {
        setLashedEvents(lashedSet);
      });
    }
  }, [messages, session?.nostrHexId, fetchUserLashes]);

  // Handle LASH on a message
  const handleGiveLash = useCallback(async (messageId: string, recipientPubkey: string) => {
    if (!session?.nostrHexId || !session?.lanaWalletID) {
      toast.error("Please configure your wallet first");
      return;
    }

    // Check if already lashed
    if (lashedEvents.has(messageId)) {
      toast.info("You already LASHed this message");
      return;
    }

    // Get recipient wallet from profile
    const recipientProfile = profiles.get(recipientPubkey);
    const recipientWallet = recipientProfile?.lana_wallet_id;
    
    if (!recipientWallet) {
      toast.error("Recipient has no wallet configured");
      return;
    }

    setLashingMessageId(messageId);

    // Optimistic update
    setLashedEvents(prev => new Set([...prev, messageId]));

    try {
      // Save to Supabase first
      const saved = await addLash(messageId);
      if (!saved) {
        // Rollback
        setLashedEvents(prev => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
        toast.error("Failed to save LASH");
        return;
      }

      // Send LASH to Nostr
      const result = await giveLash({
        postId: messageId,
        recipientPubkey,
        recipientWallet,
        amount: "1",
        memo: "LASH for OWN message"
      });

      if (result.success) {
        incrementUnpaidCount();
        toast.success("LASH sent!");
      } else {
        // Rollback on Nostr failure
        setLashedEvents(prev => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
        toast.error(result.error || "Failed to send LASH");
      }
    } catch (error) {
      console.error("LASH error:", error);
      // Rollback
      setLashedEvents(prev => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
      toast.error("Failed to send LASH");
    } finally {
      setLashingMessageId(undefined);
    }
  }, [session, profiles, lashedEvents, addLash, giveLash, incrementUnpaidCount]);

  // Pause state for EVERY listed process (one relay subscription), so the list
  // cards can show a "paused until …" notice without opening each process.
  const pauseStatuses = useNostrProcessPauseStatesBulk(
    processes.map(p => ({ processEventId: p.processEventId, facilitator: p.facilitator }))
  );

  // Format conversations for display
  const conversations = processes.map(process => ({
    id: process.id,
    title: process.title,
    initiator: profiles.get(process.initiator)?.full_name || process.initiator.slice(0, 8),
    facilitator: profiles.get(process.facilitator)?.full_name || process.facilitator.slice(0, 8),
    participants: process.participants.map(p =>
      profiles.get(p)?.full_name || p.slice(0, 8)
    ),
    guests: process.guests.map(g =>
      profiles.get(g)?.full_name || g.slice(0, 8)
    ),
    status: process.phase,
    phase: process.phase,
    lastActivity: new Date(process.openedAt * 1000).toLocaleDateString(),
    pausedUntil: pauseStatuses.get(process.processEventId)?.lockedUntil ?? null,
  }));

  // Send OWN message (text or audio). replyTo = event id of the message being
  // replied to (kept INSIDE the encrypted payload, never as a public e-tag).
  const sendOwnMessage = async (content: string, replyTo?: string): Promise<boolean> => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId || !groupKey || !selectedProcess) {
      toast.error("Missing authentication or group key");
      return false;
    }

    if (!parameters?.relays || parameters.relays.length === 0) {
      toast.error("No relays configured");
      return false;
    }

    // Fail closed while the process is paused (or while the pause state is still
    // resolving) so a stale-UI send can't slip a message through the silence.
    if (isLocked) {
      toast.error(en ? 'The process is paused — you cannot post' : 'Proces je v premoru — objavljanje ni mogoče');
      return false;
    }
    if (pauseLoading) {
      toast.error(en ? 'One moment — checking the process state…' : 'Trenutek — preverjam stanje procesa …');
      return false;
    }

    try {
      console.log('📤 Sending OWN message:', {
        processId: selectedProcess.processEventId.slice(0, 16) + '...',
        contentPreview: content.substring(0, 50) + (content.length > 50 ? '...' : ''),
        groupKeyHex: groupKey.slice(0, 16) + '...'
      });

      // 1. Prepare message payload
      const messagePayload: {
        text: string;
        timestamp: number;
        replyTo?: string;
        replyToSender?: string;
        replyToSnippet?: string;
      } = {
        text: content.trim(),
        timestamp: Math.floor(Date.now() / 1000)
      };
      if (replyTo) {
        messagePayload.replyTo = replyTo;
        // Embed the quote (sender + snippet) IN the encrypted payload so every
        // recipient renders it identically — without needing the original message
        // loaded/decrypted on their side.
        const target = messages.find(m => m.id === replyTo);
        if (target) {
          messagePayload.replyToSender =
            profiles.get(target.senderPubkey)?.full_name || target.senderPubkey.slice(0, 8);
          messagePayload.replyToSnippet = ownReplySnippet(target.text);
        }
      }

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

      // 4. Publish to relays via server-side endpoint (more reliable than browser SimplePool)
      // ⚠️ Browser-side SimplePool WebSocket connections are unreliable for larger payloads
      // (audio references, etc.) — server-side publish handles relay connections properly.
      const { data: publishData, error: publishError } = await supabase.functions.invoke(
        'publish-dm-event',
        { body: { event: signedEvent } }
      );

      if (publishError) {
        console.error('❌ Server publish error:', publishError);
      }

      const successCount = publishData?.publishedTo || 0;
      const totalRelays = publishData?.totalRelays || 0;
      console.log(`✅ Published to ${successCount}/${totalRelays} relays`);

      // Queue as fallback in case primary publish missed some relays
      supabase.functions
        .invoke('queue-relay-event', {
          body: { signedEvent, userPubkey: session.nostrHexId },
        })
        .catch(() => {}); // silent fallback

      if (successCount > 0) {
        toast.success("Message sent");
        return true;
      } else {
        // Even if publish-dm-event reported 0, the queue-relay-event fallback may still deliver
        console.warn('⚠️ Primary publish reported 0 relays, relying on queue fallback');
        toast.success("Message queued");
        return true;
      }
    } catch (error) {
      console.error('❌ Error sending OWN message:', error);
      toast.error("Failed to send message");
      return false;
    }
  };

  // Publish a KIND 87055 exit/re-enter event (signed by the user, public). The
  // Exit flow has its own 2-step page; this helper backs the inline Re-enter
  // button on the gated view. Mirrors the sendOwnMessage publish path but
  // unencrypted (the registrar + all participants must read it).
  const publishExitEvent = async (action: 'exit' | 'enter', statement: string): Promise<boolean> => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId || !selectedProcess) {
      toast.error("Missing authentication");
      return false;
    }
    try {
      const tags: string[][] = [
        ['e', selectedProcess.processEventId, '', 'process'],
        ['a', `37044:${selectedProcess.initiator}:${selectedProcess.id}`],
        ['action', action],
        ['client', 'lana-own'],
      ];
      if (selectedProcess.initiator) tags.push(['p', selectedProcess.initiator, '', 'initiator']);
      if (selectedProcess.facilitator) tags.push(['p', selectedProcess.facilitator, '', 'facilitator']);

      const signedEvent = finalizeEvent({
        kind: PROCESS_EXIT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: statement.trim(),
      }, hexToBytes(session.nostrPrivateKey));

      await supabase.functions.invoke('publish-dm-event', { body: { event: signedEvent } });
      supabase.functions
        .invoke('queue-relay-event', { body: { signedEvent, userPubkey: session.nostrHexId } })
        .catch(() => {});
      return true;
    } catch (error) {
      console.error('❌ Error publishing exit/enter event:', error);
      return false;
    }
  };

  // Publish a KIND 87056 pause/reopen event (signed by the facilitator, public).
  // 'pause' carries an `until` unix timestamp after which the process auto-reopens;
  // 'resume' reopens early. Unencrypted so every participant can read the lock.
  const publishPauseEvent = async (action: 'pause' | 'resume', until: number, note = ''): Promise<boolean> => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId || !selectedProcess) {
      toast.error("Missing authentication");
      return false;
    }
    try {
      const tags: string[][] = [
        ['e', selectedProcess.processEventId, '', 'process'],
        ['a', `37044:${selectedProcess.initiator}:${selectedProcess.id}`],
        ['action', action],
        ['client', 'lana-own'],
      ];
      if (action === 'pause') tags.push(['until', String(until)]);
      if (selectedProcess.initiator) tags.push(['p', selectedProcess.initiator, '', 'initiator']);
      if (selectedProcess.facilitator) tags.push(['p', selectedProcess.facilitator, '', 'facilitator']);

      const signedEvent = finalizeEvent({
        kind: PROCESS_PAUSE_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: note.trim(),
      }, hexToBytes(session.nostrPrivateKey));

      await supabase.functions.invoke('publish-dm-event', { body: { event: signedEvent } });
      supabase.functions
        .invoke('queue-relay-event', { body: { signedEvent, userPubkey: session.nostrHexId } })
        .catch(() => {});
      return true;
    } catch (error) {
      console.error('❌ Error publishing pause/reopen event:', error);
      return false;
    }
  };

  // Helper to determine user role in process
  const getUserRole = (pubkey: string): string => {
    if (!selectedProcess) return '';
    if (pubkey === selectedProcess.initiator) return 'Initiator';
    if (pubkey === selectedProcess.facilitator) return 'Facilitator';
    if (selectedProcess.participants.includes(pubkey)) return 'Participant';
    if (selectedProcess.guests.includes(pubkey)) return 'Guest';
    return '';
  };

  // Format messages for display
  const formattedMessages = messages.map(msg => {
    const text = msg.text.trim();
    const userRole = getUserRole(msg.senderPubkey);

    // 1) New structure: "audio:<path>|dur:<seconds>|transcript:<text>"
    if (text.startsWith("audio:")) {
      const raw = text.slice("audio:".length).trim();

      // Extract transcript (always last field, greedy match)
      let beforeTranscript = raw;
      let transcript: string | undefined;
      const transcriptIdx = raw.indexOf('|transcript:');
      if (transcriptIdx !== -1) {
        transcript = raw.slice(transcriptIdx + '|transcript:'.length);
        beforeTranscript = raw.slice(0, transcriptIdx);
      }

      // Parse optional duration metadata: "path|dur:45"
      let path = beforeTranscript;
      let audioDuration: number | undefined;
      const durMatch = beforeTranscript.match(/^(.+)\|dur:(\d+)$/);
      if (durMatch) {
        path = durMatch[1];
        audioDuration = parseInt(durMatch[2], 10);
      }

      const audioUrl = path.startsWith("http")
        ? path
        : `${OWN_API_URL}/api/storage/${DM_AUDIO_BUCKET}/${path}`;

      console.log("🎵 Audio message detected:", {
        originalText: text.length > 50 ? text.substring(0, 50) + "..." : text,
        audioPath: path,
        audioUrl,
        audioDuration,
        hasTranscript: !!transcript,
      });

      return {
        id: msg.id,
        sender: profiles.get(msg.senderPubkey)?.full_name || msg.senderPubkey.slice(0, 8),
        senderPubkey: msg.senderPubkey,
        role: userRole,
        timestamp: new Date(msg.timestamp * 1000).toLocaleString(),
        type: "audio" as const,
        audioUrl,
        audioDuration,
        transcript,
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
        senderPubkey: msg.senderPubkey,
        role: userRole,
        timestamp: new Date(msg.timestamp * 1000).toLocaleString(),
        type: "audio" as const,
        audioUrl,
        isCurrentUser: msg.senderPubkey === session?.nostrHexId,
      };
    }

    // 3) Image message: "image:<relative-path>"
    if (text.startsWith("image:")) {
      const imagePath = text.slice("image:".length).trim();
      const imageUrl = imagePath.startsWith("http")
        ? imagePath
        : `${OWN_API_URL}/api/storage/${DM_IMAGES_BUCKET}/${imagePath}`;

      return {
        id: msg.id,
        sender: profiles.get(msg.senderPubkey)?.full_name || msg.senderPubkey.slice(0, 8),
        senderPubkey: msg.senderPubkey,
        role: userRole,
        timestamp: new Date(msg.timestamp * 1000).toLocaleString(),
        type: "image" as const,
        imageUrl,
        isCurrentUser: msg.senderPubkey === session?.nostrHexId,
      };
    }

    return {
      id: msg.id,
      sender: profiles.get(msg.senderPubkey)?.full_name || msg.senderPubkey.slice(0, 8),
      senderPubkey: msg.senderPubkey,
      role: userRole,
      timestamp: new Date(msg.timestamp * 1000).toLocaleString(),
      type: 'text' as const,
      content: msg.text,
      isCurrentUser: msg.senderPubkey === session?.nostrHexId,
    };
  });

  // Build "X has exited / re-entered the process" system lines from KIND 87055
  // events and merge them with the real messages, sorted chronologically.
  // (formattedMessages is 1:1 with messages, so the raw numeric timestamp for
  // each real message comes from messages[i].timestamp.)
  const messageById = new Map(messages.map(m => [m.id, m]));
  const realMessages = formattedMessages.map((fm, i) => {
    const raw = messages[i];
    const base = { ...fm, _sortTs: raw.timestamp };
    if (!raw.replyTo) return base;
    // Prefer the quote embedded in the message itself (works for everyone, no
    // dependency on having the original loaded); fall back to resolving it from
    // local history for older replies that predate the embedded preview.
    const target = messageById.get(raw.replyTo);
    return {
      ...base,
      replyTo: raw.replyTo,
      repliedToSender:
        raw.replyToSender
        ?? (target ? (profiles.get(target.senderPubkey)?.full_name || target.senderPubkey.slice(0, 8)) : undefined),
      repliedToSnippet:
        raw.replyToSnippet
        ?? (target ? ownReplySnippet(target.text) : 'Replied message'),
    };
  });
  const systemMessages = exitEvents.map(ev => {
    const name = profiles.get(ev.authorPubkey)?.full_name || ev.authorPubkey.slice(0, 8);
    const verb = ev.action === 'exit' ? 'has exited the process' : 'has re-entered the process';
    return {
      id: ev.id,
      sender: name,
      senderPubkey: ev.authorPubkey,
      role: '',
      timestamp: new Date(ev.createdAt * 1000).toLocaleString(),
      type: 'system' as const,
      systemText: `${name} ${verb}`,
      isCurrentUser: false,
      _sortTs: ev.createdAt,
    };
  });
  // "Facilitator paused / reopened the process" system lines from KIND 87056.
  const pauseSystemMessages = pauseEvents.map(ev => {
    const when = ev.until ? new Date(ev.until * 1000).toLocaleString() : '';
    const text = ev.action === 'pause'
      ? (en ? `The facilitator paused the process — closed until ${when}` : `Fasilitator je dal premor — proces zaprt do ${when}`)
      : (en ? 'The facilitator reopened the process' : 'Fasilitator je znova odprl proces');
    return {
      id: ev.id,
      sender: '',
      senderPubkey: ev.authorPubkey,
      role: '',
      timestamp: new Date(ev.createdAt * 1000).toLocaleString(),
      type: 'system' as const,
      systemText: text,
      isCurrentUser: false,
      _sortTs: ev.createdAt,
    };
  });
  const allMessages = [...realMessages, ...systemMessages, ...pauseSystemMessages].sort((a, b) => a._sortTs - b._sortTs);

  if (processesLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-muted-foreground">Loading processes...</p>
      </div>
    );
  }

  // Assessed SUBJECTS (participants AND the initiator — both go through the
  // reflection→alignment→change arc, so the beings assess both) see their OWN
  // matrix beside the chat. NOTE: useNostrOpenProcesses resolves role by
  // priority (initiator before participant), so someone who is both is tagged
  // 'initiator' — hence we must accept both here. The facilitator/guests are
  // not assessed; their tailored views come next. The case root matches the
  // beings' 87047/37045 #e reference (strip the own: prefix if present —
  // idempotent when processEventId is already the root).
  const isSubjectView = !!selectedProcessId
    && (selectedProcess?.userRole === 'participant' || selectedProcess?.userRole === 'initiator');
  // Overseers (facilitator / guest) get the WHOLE participant×being matrix on
  // the left + a per-participant timeline on the right.
  const isOverseerView = !!selectedProcessId
    && (selectedProcess?.userRole === 'facilitator' || selectedProcess?.userRole === 'guest');
  const caseRoot = selectedProcess?.processEventId
    ? (selectedProcess.processEventId.startsWith('own:') ? selectedProcess.processEventId.slice(4) : selectedProcess.processEventId)
    : null;
  // The overseer matrix lists only the actual PARTICIPANTS of the process. The
  // initiator appears iff they are ALSO tagged a participant (i.e. they too are
  // going through the process) — a pure initiator who merely opened the case is
  // not a subject and is not listed.
  const subjectList = selectedProcess
    ? Array.from(new Set(selectedProcess.participants.filter(Boolean)))
    : [];
  const nameOfPk = (pk: string) => profiles.get(pk)?.display_name || profiles.get(pk)?.full_name || pk.slice(0, 8);

  const chatViewEl = selectedProcess ? (
    <ChatView
      conversationTitle={selectedProcess?.title}
      conversationStatus={selectedProcess?.status}
      processEventId={selectedProcess?.processEventId}
      senderPubkey={session?.nostrHexId}
      messages={allMessages}
      phase={selectedProcess?.phase}
      isExited={isExited}
      canExit={canExit}
      onExit={() => selectedProcess && navigate(`/own/exit/${encodeURIComponent(selectedProcess.id)}`)}
      onReEnter={async () => {
        const ok = await publishExitEvent('enter', '');
        if (ok) toast.success('You have re-entered the process');
        else toast.error('Failed to re-enter the process');
      }}
      isLocked={isLocked}
      lockedUntil={lockedUntil || undefined}
      canPause={canPause}
      onPause={async (until: number, note: string) => {
        const ok = await publishPauseEvent('pause', until, note);
        if (ok) toast.success(en ? 'Process paused' : 'Proces v premoru');
        else toast.error(en ? 'Failed to pause the process' : 'Premor ni uspel');
      }}
      onReopen={async () => {
        const ok = await publishPauseEvent('resume', 0);
        if (ok) toast.success(en ? 'Process reopened' : 'Proces znova odprt');
        else toast.error(en ? 'Failed to reopen the process' : 'Odpiranje ni uspelo');
      }}
      onBack={() => setSelectedProcessId(undefined)}
      onSendAudio={async (audioPath: string, replyTo?: string) => {
        return await sendOwnMessage(audioPath, replyTo);
      }}
      onSendMessage={async (text: string, replyTo?: string) => {
        return await sendOwnMessage(text, replyTo);
      }}
      isLoading={keyLoading || messagesLoading}
      lashedEventIds={lashedEvents}
      onGiveLash={handleGiveLash}
      lashingMessageId={lashingMessageId}
      lashCounts={lashCounts}
    />
  ) : null;

  // Fixed single-screen height for the list + the plain (non-participant) chat.
  // The participant view stacks matrix-over-chat on mobile (page scrolls) and
  // becomes two side-by-side full-height columns on desktop.
  const twoColView = isSubjectView || isOverseerView;
  const outerHeight = !selectedProcessId || !twoColView
    ? "h-[calc(100dvh-220px)] md:h-[calc(100dvh-210px)]"
    : "md:h-[calc(100dvh-210px)]";

  return (
    <div className={outerHeight}>
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
      ) : isSubjectView ? (
        // Assessed subject (participant / initiator): the condensed three-
        // pillar cross-section on the left; the right shows the chat, or the
        // participant's OWN detailed view via "Podrobni pogled".
        <div className="flex flex-col md:flex-row md:gap-4 md:h-full">
          <div className="w-full md:w-[340px] md:shrink-0 md:h-full md:overflow-y-auto mb-4 md:mb-0 px-4 md:px-0">
            <OwnSelfMatrix
              caseRoot={caseRoot}
              participantPubkey={session?.nostrHexId || ''}
              phase={selectedProcess?.phase}
              onAnalyzeOthers={caseRoot ? () => navigate(`/own/matrix?process=${encodeURIComponent(caseRoot)}`) : undefined}
              onOpenDetail={() => setSelfDetail(true)}
            />
          </div>
          <div className="w-full md:flex-1 md:min-w-0 h-[calc(100dvh-260px)] md:h-full">
            {selfDetail && session?.nostrHexId ? (
              <OwnParticipantDetail
                caseRoot={caseRoot}
                participantPubkey={session.nostrHexId}
                participantName={nameOfPk(session.nostrHexId)}
                phase={selectedProcess?.phase}
                onBack={() => setSelfDetail(false)}
              />
            ) : (
              chatViewEl
            )}
          </div>
        </div>
      ) : isOverseerView ? (
        // Facilitator / guest: full participant×being matrix on the left; the
        // right shows the chat, or a chosen participant's timeline via "Več".
        <div className="flex flex-col md:flex-row md:gap-4 md:h-full">
          <div className="w-full md:w-[360px] md:shrink-0 md:h-full md:overflow-y-auto mb-4 md:mb-0 px-4 md:px-0">
            <OwnFullMatrix
              caseRoot={caseRoot}
              participants={subjectList}
              phase={selectedProcess?.phase}
              selectedParticipant={matrixParticipant}
              onSelect={setMatrixParticipant}
            />
          </div>
          <div className="w-full md:flex-1 md:min-w-0 h-[calc(100dvh-260px)] md:h-full">
            {matrixParticipant ? (
              <OwnParticipantDetail
                caseRoot={caseRoot}
                participantPubkey={matrixParticipant}
                participantName={nameOfPk(matrixParticipant)}
                phase={selectedProcess?.phase}
                onBack={() => setMatrixParticipant(null)}
              />
            ) : (
              chatViewEl
            )}
          </div>
        </div>
      ) : (
        // Fallback — plain full-width chat (all known roles are handled above).
        <div className="h-full">
          {chatViewEl}
        </div>
      )}
    </div>
  );
}
