import { useState, useMemo, useRef, useLayoutEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Send, MessageCircle, History, ImagePlus, Camera, Loader2, LogOut, X } from "lucide-react";
import ChatMessage from "./ChatMessage";
import OwnAudioRecorder from "./OwnAudioRecorder";
import { ownSupabase } from "@/lib/ownSupabaseClient";
import { toast } from "sonner";

const MESSAGES_PER_PAGE = 20;
const API_URL = import.meta.env.VITE_API_URL ?? '';

function ImageUploadButton({ processEventId, senderPubkey, onSendImage }: {
  processEventId: string;
  senderPubkey: string;
  onSendImage: (path: string) => Promise<boolean>;
}) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const albumInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image too large (max 10MB)');
      return;
    }

    setUploading(true);
    try {
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(7);
      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `${timestamp}_${randomStr}.${ext}`;
      const filePath = `${senderPubkey}-${processEventId}/${fileName}`;

      const { error } = await ownSupabase.storage
        .from('dm-images')
        .upload(filePath, file, { contentType: file.type, cacheControl: '3600', upsert: false });

      if (error) {
        toast.error(error.message || 'Image upload failed');
        return;
      }

      const sent = await onSendImage(`image:${filePath}`);
      if (sent) {
        toast.success('Image sent');
      } else {
        toast.error('Failed to send image');
      }
    } catch (err) {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (albumInputRef.current) albumInputRef.current.value = '';
    }
  };

  return (
    <>
      {/* Camera capture (mobile: opens camera directly) */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileSelect}
      />
      {/* Album/gallery picker (no capture = shows file picker) */}
      <input
        ref={albumInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      {uploading ? (
        <Button size="icon" variant="ghost" disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
        </Button>
      ) : (
        <>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => cameraInputRef.current?.click()}
            title="Take photo"
          >
            <Camera className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => albumInputRef.current?.click()}
            title="Choose from album"
          >
            <ImagePlus className="h-4 w-4" />
          </Button>
        </>
      )}
    </>
  );
}

interface Message {
  id: string;
  sender: string;
  senderPubkey?: string;
  timestamp: string;
  type: 'text' | 'audio' | 'image' | 'system';
  content?: string;
  systemText?: string;
  audioUrl?: string;
  audioDuration?: number;
  transcript?: string;
  imageUrl?: string;
  isCurrentUser?: boolean;
  replyTo?: string;
  repliedToSender?: string;
  repliedToSnippet?: string;
}

interface ChatViewProps {
  conversationTitle?: string;
  conversationStatus?: string;
  processEventId?: string;
  senderPubkey?: string;
  messages?: Message[];
  phase?: string;
  onBack: () => void;
  onSendAudio?: (audioPath: string, replyTo?: string) => Promise<boolean>;
  onSendMessage?: (text: string, replyTo?: string) => Promise<boolean>;
  isLoading?: boolean;
  // Exit / Re-enter props
  isExited?: boolean;
  canExit?: boolean;
  onExit?: () => void;
  onReEnter?: () => Promise<void>;
  // LASH props
  lashedEventIds?: Set<string>;
  onGiveLash?: (messageId: string, recipientPubkey: string) => Promise<void>;
  lashingMessageId?: string;
  lashCounts?: Map<string, number>;
}

export default function ChatView({ 
  conversationTitle, 
  conversationStatus,
  processEventId,
  senderPubkey,
  messages = [], 
  phase,
  onBack,
  onSendAudio,
  onSendMessage,
  isLoading = false,
  isExited = false,
  canExit = false,
  onExit,
  onReEnter,
  lashedEventIds = new Set(),
  onGiveLash,
  lashingMessageId,
  lashCounts = new Map()
}: ChatViewProps) {
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isReEntering, setIsReEntering] = useState(false);
  const [visibleCount, setVisibleCount] = useState(MESSAGES_PER_PAGE);
  // The message currently being replied to (null = not replying)
  const [replyingTo, setReplyingTo] = useState<{ id: string; sender: string; snippet: string } | null>(null);

  // Short preview of a message for the "replying to" bar (operates on the
  // already-formatted message: media is known from its type).
  const snippetForMessage = (m: Message): string => {
    if (m.type === 'audio') return '🎤 Voice message';
    if (m.type === 'image') return '🖼 Photo';
    const t = (m.content || '').trim();
    return t.length > 80 ? t.slice(0, 80) + '…' : t;
  };

  // Media (audio/image) send that injects the active reply + clears it on success
  const handleSendMedia = async (path: string): Promise<boolean> => {
    if (!onSendAudio) return false;
    const ok = await onSendAudio(path, replyingTo?.id);
    if (ok) setReplyingTo(null);
    return ok;
  };

  const handleReEnter = async () => {
    if (!onReEnter) return;
    setIsReEntering(true);
    try {
      await onReEnter();
    } finally {
      setIsReEntering(false);
    }
  };

  // Show only the last N messages (most recent)
  const visibleMessages = useMemo(() => {
    if (messages.length <= visibleCount) return messages;
    return messages.slice(-visibleCount);
  }, [messages, visibleCount]);

  const hasMoreMessages = messages.length > visibleCount;

  // Load History prepends older messages at the top of the scroll area. Browser
  // scroll-anchoring keeps the view pinned, so the new messages land above the
  // viewport and look like nothing happened. Capture the scroll position, then
  // after the older messages render, scroll up so they're actually revealed.
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const restoreScrollRef = useRef<{ height: number; top: number } | null>(null);
  const getViewport = () =>
    scrollAreaRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null;

  const handleLoadMore = () => {
    const vp = getViewport();
    if (vp) restoreScrollRef.current = { height: vp.scrollHeight, top: vp.scrollTop };
    setVisibleCount(prev => prev + MESSAGES_PER_PAGE);
  };

  useLayoutEffect(() => {
    const saved = restoreScrollRef.current;
    if (!saved) return;
    restoreScrollRef.current = null;
    const vp = getViewport();
    if (!vp) return;
    // Keeping the OLD scrollTop value (without compensating for the added height)
    // scrolls the viewport up by exactly the prepended height → the freshly loaded
    // older messages scroll into view above the previous position.
    vp.scrollTop = Math.max(0, saved.top);
  }, [visibleCount]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSendText = async () => {
    if (!messageText.trim() || !onSendMessage) return;

    setIsSending(true);
    const success = await onSendMessage(messageText.trim(), replyingTo?.id);
    if (success) {
      setMessageText("");
      setReplyingTo(null);
      // Reset textarea height back to single line
      if (textareaRef.current) {
        textareaRef.current.style.height = '40px';
      }
    }
    setIsSending(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  if (!conversationTitle) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <MessageCircle className="w-20 h-20 text-muted-foreground/30 mb-4" />
        <h3 className="text-xl font-semibold mb-2">Select a conversation</h3>
        <p className="text-muted-foreground">Choose a process from the list to view messages</p>
      </div>
    );
  }

  // Phase definitions with colors and descriptions
  const PHASE_INFO: Record<string, { label: string; emoji: string; color: string; bg: string; borderColor: string; bgFull: string; description: string }> = {
    opening: {
      label: 'Opening',
      emoji: '⚪',
      color: 'text-gray-600 dark:text-gray-400',
      bg: 'bg-gray-500/10 border-gray-500/20',
      borderColor: 'border-gray-300 dark:border-gray-700',
      bgFull: '',
      description: 'The facilitator delivers the introductory speech, setting the context and ground rules for the process.',
    },
    reflection: {
      label: 'Reflection',
      emoji: '🟣',
      color: 'text-purple-600 dark:text-purple-400',
      bg: 'bg-purple-500/10 border-purple-500/20',
      borderColor: 'border-purple-300 dark:border-purple-700',
      bgFull: 'bg-purple-500/5',
      description: 'Active emotional phase where all participants openly express their judgments and grievances without holding back.',
    },
    alignment: {
      label: 'Alignment',
      emoji: '🟢',
      color: 'text-green-600 dark:text-green-400',
      bg: 'bg-green-500/10 border-green-500/20',
      borderColor: 'border-green-300 dark:border-green-700',
      bgFull: 'bg-green-500/5',
      description: 'Each participant turns inward, continuing self-reflection until only gratitude remains toward the other person.',
    },
    change: {
      label: 'Change',
      emoji: '🔵',
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-500/10 border-blue-500/20',
      borderColor: 'border-blue-300 dark:border-blue-700',
      bgFull: 'bg-blue-500/5',
      description: 'Each participant clearly states what they will transform within themselves going forward.',
    },
    closing: {
      label: 'Closing',
      emoji: '⚪',
      color: 'text-gray-600 dark:text-gray-400',
      bg: 'bg-gray-500/10 border-gray-500/20',
      borderColor: 'border-gray-300 dark:border-gray-700',
      bgFull: '',
      description: 'The facilitator records the closing speech, summarizing the process outcomes.',
    },
    resolution: {
      label: 'Resolution',
      emoji: '🟢',
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-500/10 border-emerald-500/20',
      borderColor: 'border-emerald-300 dark:border-emerald-700',
      bgFull: 'bg-emerald-500/5',
      description: 'The facilitator formally concludes the process and makes responsibility decisions for each participant.',
    },
  };

  const currentPhase = PHASE_INFO[phase || ''] || PHASE_INFO.opening;

  return (
    <div className={`flex flex-col h-full ${currentPhase.bgFull}`}>
      {/* Header */}
      <Card className="p-3 md:p-4 mb-0 sticky top-0 z-10">
        <div className="flex items-center gap-2 md:gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 md:gap-3 flex-wrap">
              <h2 className="text-base md:text-lg font-semibold truncate min-w-0">{conversationTitle}</h2>
              <Badge className={`text-xs shrink-0 ${currentPhase.bg} ${currentPhase.color} border`}>
                {currentPhase.emoji} {currentPhase.label}
              </Badge>
            </div>
          </div>
        </div>
      </Card>

      {/* Phase Banner — always visible */}
      <div className={`mx-2 md:mx-4 mt-2 mb-3 rounded-lg border ${currentPhase.borderColor} ${currentPhase.bg} p-3`}>
        <div className="flex items-start gap-2">
          <span className="text-lg leading-none mt-0.5">{currentPhase.emoji}</span>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${currentPhase.color}`}>
              Phase: {currentPhase.label}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {currentPhase.description}
            </p>
          </div>
          {canExit && !isExited && onExit && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExit}
              className="shrink-0 whitespace-nowrap bg-background/80 text-destructive border-destructive/40 hover:bg-destructive/10"
            >
              <LogOut className="w-4 h-4 mr-1.5" />
              Exit
            </Button>
          )}
        </div>
      </div>

      {isExited ? (
        /* Exited view — process content + input hidden; only the notice + Re-enter */
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <LogOut className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">You have exited this process</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              You no longer see the process content. You can return at any time while the process is
              still open — re-entering unfreezes your wallets and cancels the deregistration.
            </p>
          </div>
          <Button onClick={handleReEnter} disabled={isReEntering || !onReEnter}>
            {isReEntering ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Re-entering...
              </>
            ) : (
              "Re-enter the process"
            )}
          </Button>
        </div>
      ) : (
      <>
      {/* Messages */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 px-2 md:px-4">
        <div className="space-y-2 pb-4">
          {isLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Loading messages...
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No messages yet
            </div>
          ) : (
            <>
              {/* Load History Button */}
              {hasMoreMessages && (
                <div className="flex justify-center py-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleLoadMore}
                    className="gap-2"
                  >
                    <History className="w-4 h-4" />
                    Load History ({messages.length - visibleCount} older)
                  </Button>
                </div>
              )}
              {visibleMessages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  sender={msg.sender}
                  timestamp={msg.timestamp}
                  type={msg.type}
                  content={msg.type === 'system' ? msg.systemText : msg.content}
                  audioUrl={msg.audioUrl}
                  audioDuration={msg.audioDuration}
                  transcript={msg.transcript}
                  imageUrl={msg.imageUrl}
                  isCurrentUser={msg.isCurrentUser}
                  messageId={msg.id}
                  repliedToSender={msg.repliedToSender}
                  repliedToSnippet={msg.repliedToSnippet}
                  onReply={
                    msg.type !== 'system'
                      ? () => setReplyingTo({ id: msg.id, sender: msg.sender, snippet: snippetForMessage(msg) })
                      : undefined
                  }
                  isLashed={lashedEventIds.has(msg.id)}
                  onLash={
                    !msg.isCurrentUser && msg.senderPubkey && onGiveLash
                      ? () => onGiveLash(msg.id, msg.senderPubkey!)
                      : undefined
                  }
                  isLashing={lashingMessageId === msg.id}
                  lashCount={lashCounts.get(msg.id) || 0}
                />
              ))}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <Card className="p-2 md:p-4 sticky bottom-0">
        <div className="flex flex-col gap-2">
          {/* Replying-to preview */}
          {replyingTo && (
            <div className="flex items-start gap-2 rounded-lg border-l-2 border-primary bg-muted/40 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-primary">Replying to {replyingTo.sender}</p>
                <p className="text-xs text-muted-foreground truncate">{replyingTo.snippet || '…'}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={() => setReplyingTo(null)}
                title="Cancel reply"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          {/* Audio recorder + Image upload */}
          <div className="flex items-center gap-2">
            {processEventId && senderPubkey && onSendAudio && (
              <OwnAudioRecorder
                processEventId={processEventId}
                senderPubkey={senderPubkey}
                onSendAudio={handleSendMedia}
                compact
              />
            )}
            {processEventId && senderPubkey && onSendAudio && (
              <ImageUploadButton
                processEventId={processEventId}
                senderPubkey={senderPubkey}
                onSendImage={handleSendMedia}
              />
            )}
          </div>
          {/* Text input row */}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              placeholder="Type a message... (Shift+Enter for new line)"
              value={messageText}
              onChange={(e) => {
                setMessageText(e.target.value);
                // Auto-resize
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendText();
                }
              }}
              disabled={isSending}
              rows={1}
              className="flex-1 min-w-0 px-3 py-2 rounded-lg border bg-background text-base resize-none"
              style={{ minHeight: '40px', maxHeight: '160px' }}
            />
            <Button
              size="icon"
              className="bg-cyan-500 hover:bg-cyan-600 shrink-0 h-10 w-10"
              onClick={handleSendText}
              disabled={!messageText.trim() || isSending}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>
      </>
      )}
    </div>
  );
}
