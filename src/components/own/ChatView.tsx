import { useState, useMemo, useRef, useLayoutEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Send, MessageCircle, History, ImagePlus, Camera, Loader2, LogOut, X, Pause, Lock } from "lucide-react";
import ChatMessage from "./ChatMessage";
import OwnAudioRecorder from "./OwnAudioRecorder";
import PauseProcessDialog from "./PauseProcessDialog";
import { ownSupabase } from "@/lib/ownSupabaseClient";
import { formatResumeDate } from "@/hooks/useOwnAssessments";
import { useLang } from "@/i18n/I18nContext";
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
  repliedToTranscript?: string;
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
  // Facilitator pause / reopen props
  isLocked?: boolean;
  lockedUntil?: number; // unix seconds
  // The beings' silence toward the LOGGED-IN person (KIND 37045). Nothing like
  // the facilitator pause: it is about one participant, everyone else keeps
  // writing, and it is care rather than a sanction.
  // KIND 87057 — the facilitator froze THIS reader. A sanction, unlike the
  // silence above: someone decided it about them, and only a facilitator (or
  // the named SPLIT arriving) lifts it. Only a SPLIT-bounded freeze reaches
  // this component as `true`; an open-ended one is shown on the matrices but
  // never closes the composer.
  isFrozenForMe?: boolean;
  freezeUntilSplit?: number | null;
  freezeReason?: string;
  freezeEffectiveAt?: number | null;   // unix seconds — the DATE, never created_at
  isSilencedForMe?: boolean;
  silenceWaiting?: number;   // how many beings are waiting…
  silenceTotal?: number;     // …of how many that published about me
  silenceResumeAt?: string | null; // ISO 8601 STRING (not unix seconds); null = no end named
  canPause?: boolean;
  onPause?: (until: number, note: string) => Promise<void>;
  onReopen?: () => Promise<void>;
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
  isLocked = false,
  lockedUntil,
  isFrozenForMe = false,
  freezeUntilSplit = null,
  freezeReason = '',
  freezeEffectiveAt = null,
  isSilencedForMe = false,
  silenceWaiting = 0,
  silenceTotal = 0,
  silenceResumeAt = null,
  canPause = false,
  onPause,
  onReopen,
  lashedEventIds = new Set(),
  onGiveLash,
  lashingMessageId,
  lashCounts = new Map()
}: ChatViewProps) {
  const en = useLang() === 'en';
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isReEntering, setIsReEntering] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(MESSAGES_PER_PAGE);
  // The message currently being replied to (null = not replying)
  const [replyingTo, setReplyingTo] = useState<{ id: string; sender: string; snippet: string } | null>(null);
  const [recorderActive, setRecorderActive] = useState(false); // recording/preview → give the recorder the full input row

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

  const handleReopen = async () => {
    if (!onReopen) return;
    setIsReopening(true);
    try {
      await onReopen();
    } finally {
      setIsReopening(false);
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

  // Clicking a quote jumps to the message it quotes. If that message is older
  // than the visible window, expand the window first — otherwise the quote is
  // a dead end ("which recording was this?").
  const flashMessage = (el: HTMLElement) => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-primary/60', 'rounded-lg');
    setTimeout(() => el.classList.remove('ring-2', 'ring-primary/60', 'rounded-lg'), 1800);
  };
  const scrollToMessage = (id?: string) => {
    if (!id) return;
    const el = document.getElementById(`m-${id}`);
    if (el) { flashMessage(el); return; }
    const idx = messages.findIndex((m) => m.id === id);
    if (idx < 0) return;                       // not in local history at all
    setVisibleCount((prev) => Math.max(prev, messages.length - idx + 3));
    setTimeout(() => {
      const later = document.getElementById(`m-${id}`);
      if (later) flashMessage(later);
    }, 150);
  };

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

  // Slovene needs the genitive month ("do 4. avgusta"), which is why this goes
  // through formatResumeDate instead of toLocaleDateString. null = the beings
  // named no end, and the sentence switches to the open-ended form.
  const silenceWhen = formatResumeDate(silenceResumeAt, en ? 'en' : 'sl');

  return (
    <div className={`flex flex-col h-full ${currentPhase.bgFull}`}>
      {/* Header — title + phase badge on ONE compact line (the old separate
          phase banner is gone to free vertical room for messages; the phase
          description is on the badge tooltip). */}
      <Card className="px-3 py-2.5 mb-0 sticky top-0 z-10">
        <div className="flex items-center gap-2 md:gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0 h-8 w-8">
            <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 md:gap-3 flex-wrap">
              <h2 className="text-base md:text-lg font-semibold truncate min-w-0">{conversationTitle}</h2>
              <Badge
                title={currentPhase.description}
                className={`text-xs shrink-0 ${currentPhase.bg} ${currentPhase.color} border`}
              >
                {currentPhase.emoji} {currentPhase.label}
              </Badge>
              {isLocked && (
                <Badge className="text-xs shrink-0 gap-1 bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-950 dark:text-amber-300">
                  <Lock className="w-3 h-3" />
                  {en ? 'Paused' : 'V premoru'}
                </Badge>
              )}
              {/* Beside Paused, never instead of it: a process can be paused
                  AND hold a frozen person, and hiding one behind the other
                  would make the reader think the other had been lifted. */}
              {isFrozenForMe && (
                <Badge className="text-xs shrink-0 gap-1 bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-950 dark:text-blue-300">
                  <span aria-hidden="true">❄️</span>
                  {freezeUntilSplit != null
                    ? (en ? `Frozen · up to SPLIT ${freezeUntilSplit}` : `Zamrznjen · do SPLITA ${freezeUntilSplit}`)
                    : (en ? 'Frozen' : 'Zamrznjen')}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Card>

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
                <div key={msg.id} id={`m-${msg.id}`} className="transition-shadow">
                <ChatMessage
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
                  repliedToTranscript={msg.repliedToTranscript}
                  onQuoteClick={msg.replyTo ? () => scrollToMessage(msg.replyTo) : undefined}
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
                </div>
              ))}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Input — two different things can take the composer away, and they are
          never merged:
            · the facilitator's pause (below) stops EVERYONE, and the
              facilitator can lift it;
            · the beings' silence stops ONLY this reader, nobody lifts it by
              hand, and it is not a sanction.
          Either way the whole composer (text + audio + image) is replaced by a
          notice and the messages above stay readable. The pause is checked
          first: it is process-wide and carries the Reopen button. */}
      {isLocked ? (
        <Card className="p-4 sticky bottom-0">
          <div className="flex flex-col items-center text-center gap-2">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <Lock className="h-5 w-5" />
              <span className="font-semibold">{en ? 'Process paused' : 'Proces v premoru'}</span>
            </div>
            <p className="text-sm text-muted-foreground max-w-sm">
              {en
                ? `The facilitator paused the process. No one can post — you can still read. It reopens${lockedUntil ? ' on ' + new Date(lockedUntil * 1000).toLocaleString() : ' soon'}.`
                : `Fasilitator je dal premor. Nihče ne more objavljati — lahko pa še vedno bereš. Proces se znova odpre${lockedUntil ? ' ' + new Date(lockedUntil * 1000).toLocaleString() : ' kmalu'}.`}
            </p>
            {canPause && onReopen && (
              <Button onClick={handleReopen} disabled={isReopening} size="sm" className="mt-1">
                {isReopening ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{en ? 'Reopening…' : 'Odpiram…'}</>
                ) : (
                  en ? 'Reopen now' : 'Znova odpri zdaj'
                )}
              </Button>
            )}
          </div>
        </Card>
      ) : isFrozenForMe ? (
        /* Frozen by the facilitator. Cold blue and ❄️, deliberately NOT the
           amber of the silence: one is a sanction someone decided about this
           person, the other is the beings stepping back to leave room. Two
           different things must not wear the same colour. Reading stays open. */
        <Card className="p-4 sticky bottom-0 border-blue-500/30 bg-blue-500/[0.06]">
          <div className="flex flex-col items-center text-center gap-2">
            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
              <span className="text-lg leading-none">❄️</span>
              <span className="font-semibold">
                {en ? 'You are frozen in this process' : 'V tem procesu si zamrznjen'}
              </span>
              {freezeUntilSplit != null && (
                <span className="text-xs font-normal opacity-80">
                  {en ? `up to SPLIT ${freezeUntilSplit}` : `do SPLITA ${freezeUntilSplit}`}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground max-w-md">
              {en
                ? `The facilitator froze you${freezeEffectiveAt ? ` on ${new Date(freezeEffectiveAt * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}. You can still read everything — you can write again${freezeUntilSplit != null ? ` as SPLIT ${freezeUntilSplit} opens` : ' once the freeze is lifted'}.`
                : `Fasilitator te je zamrznil${freezeEffectiveAt ? ` ${new Date(freezeEffectiveAt * 1000).toLocaleDateString('sl-SI', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}. Vse lahko še naprej bereš — pišeš lahko spet${freezeUntilSplit != null ? `, ko vstopimo v SPLIT ${freezeUntilSplit}` : ', ko bo zamrznitev odpravljena'}.`}
            </p>
            {freezeReason && (
              <p className="text-sm text-blue-800 dark:text-blue-300 max-w-md italic">{freezeReason}</p>
            )}
            {/* 87057 is a process-level fact. Saying nothing here would let the
                reader assume the obvious wrong thing about their money. */}
            <p className="text-xs text-muted-foreground max-w-md">
              {en
                ? 'This is about your standing in this process — whether any wallet is frozen is answered only by the registrar.'
                : 'To je dejstvo o tvojem položaju v tem procesu — ali je katera denarnica zamrznjena, odgovori izključno registrar.'}
            </p>
          </div>
        </Card>
      ) : isSilencedForMe ? (
        /* The beings' silence toward THIS reader. Calm amber + 🤲, the same
           marks the matrix and the self view use for it — no red, no warning
           triangle: the beings stepped back to leave room, they did not
           punish. Reading stays fully open. */
        <Card className="p-4 sticky bottom-0 border-amber-500/30 bg-amber-500/[0.06]">
          <div className="flex flex-col items-center text-center gap-2">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <span className="text-lg leading-none">🤲</span>
              <span className="font-semibold">
                {en ? 'The beings are waiting in silence' : 'Bitja čakajo v tišini'}
              </span>
              {/* Never speak in the plural for beings that released nobody: one
                  being still waiting is enough to hold the composer, and the
                  count is what every other silence surface already prints. */}
              {silenceTotal > 0 && silenceWaiting < silenceTotal && (
                <span className="text-xs font-normal opacity-80">
                  ({silenceWaiting}/{silenceTotal})
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground max-w-md">
              {en
                ? `The beings noticed an emotional outburst that damages relationships, and chose silence so you have room to turn inward. You can still read everything — you can write again ${silenceWhen ? `on ${silenceWhen}` : 'once the beings speak'}.`
                : `Bitja so zaznala čustven izbruh, ki ruši odnose, in izbrala tišino, da imaš prostor za pogled vase. Vse lahko še naprej bereš — pišeš lahko spet${silenceWhen ? ` ${silenceWhen}` : ', ko bitja znova spregovorijo'}.`}
            </p>
          </div>
        </Card>
      ) : (
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
          {/* Audio recorder + Image upload (+ Exit). While recording/previewing the
              recorder takes the whole row (image/Exit hidden) so its wide UI doesn't
              overflow and break the mobile layout. */}
          <div className="flex items-center gap-2">
            {processEventId && senderPubkey && onSendAudio && (
              <OwnAudioRecorder
                processEventId={processEventId}
                senderPubkey={senderPubkey}
                onSendAudio={handleSendMedia}
                onActiveChange={setRecorderActive}
                compact
              />
            )}
            {!recorderActive && processEventId && senderPubkey && onSendAudio && (
              <ImageUploadButton
                processEventId={processEventId}
                senderPubkey={senderPubkey}
                onSendImage={handleSendMedia}
              />
            )}
            {!recorderActive && canExit && !isExited && onExit && (
              <Button
                variant="outline"
                size="sm"
                onClick={onExit}
                className="shrink-0 whitespace-nowrap px-2 md:px-3 text-destructive border-destructive/40 hover:bg-destructive/10"
              >
                <LogOut className="w-4 h-4 mr-1.5" />
                Exit
              </Button>
            )}
            {!recorderActive && canPause && onPause && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPauseDialogOpen(true)}
                className="shrink-0 whitespace-nowrap px-2 md:px-3 text-amber-600 border-amber-400/50 hover:bg-amber-500/10"
              >
                <Pause className="w-4 h-4 mr-1.5" />
                {en ? 'Pause' : 'Premor'}
              </Button>
            )}
          </div>
          {/* Text input row — hidden while recording/previewing audio (the recorder has
              its own Send/Discard) so the input area isn't crowded on mobile. */}
          {!recorderActive && (
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
          )}
        </div>
      </Card>
      )}
      </>
      )}

      <PauseProcessDialog
        open={pauseDialogOpen}
        onOpenChange={setPauseDialogOpen}
        onConfirm={async (until, note) => { if (onPause) await onPause(until, note); }}
        en={en}
      />
    </div>
  );
}
