import { useState } from "react";
import { useLang } from "@/i18n/I18nContext";
import { Card } from "@/components/ui/card";
import { AudioPlayer } from "@/components/AudioPlayer";
import { Heart, FileText, ChevronDown, ChevronUp, Reply } from "lucide-react";
import { cn } from "@/lib/utils";
import TranslateButton from "@/components/own/TranslateButton";

/** Extract YouTube video ID from any youtube.com / youtu.be URL, or null. */
function getYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Find the first YouTube URL in a string, or null. */
function findYouTubeUrl(text: string): string | null {
  const urlMatch = text.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\S+|youtu\.be\/\S+)/i);
  return urlMatch?.[0] ?? null;
}

interface YouTubeEmbedProps { videoId: string }
function YouTubeEmbed({ videoId }: YouTubeEmbedProps) {
  return (
    <div className="mt-2 rounded-lg overflow-hidden border border-border/50">
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <iframe
          className="absolute top-0 left-0 w-full h-full"
          src={`https://www.youtube.com/embed/${videoId}`}
          title="YouTube video"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </div>
  );
}

function TranscriptToggle({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 pt-2 border-t border-border/50">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        <FileText className="h-3.5 w-3.5 flex-shrink-0" />
        <span>Transcription</span>
        {open ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
      </button>
      {open && (
        <>
          <p className="text-sm text-muted-foreground italic whitespace-pre-wrap break-words mt-2">
            {text}
          </p>
          <TranslateButton text={text} />
        </>
      )}
    </div>
  );
}

interface ChatMessageProps {
  sender: string;
  role?: string;
  timestamp: string;
  type: 'text' | 'audio' | 'image' | 'system';
  content?: string;
  audioUrl?: string;
  audioDuration?: number;
  transcript?: string;
  imageUrl?: string;
  isCurrentUser?: boolean;
  messageId?: string;
  isLashed?: boolean;
  onLash?: () => void;
  isLashing?: boolean;
  lashCount?: number;
  onReply?: () => void;
  repliedToSender?: string;
  repliedToSnippet?: string;
  repliedToTranscript?: string;
  onQuoteClick?: () => void;
}

export default function ChatMessage({
  sender,
  role,
  timestamp,
  type,
  content,
  audioUrl,
  audioDuration,
  transcript,
  imageUrl,
  isCurrentUser = false,
  messageId,
  isLashed = false,
  onLash,
  isLashing = false,
  lashCount = 0,
  onReply,
  repliedToSender,
  repliedToSnippet,
  repliedToTranscript,
  onQuoteClick
}: ChatMessageProps) {
  const en = useLang() === 'en';
  const [quoteTranscriptOpen, setQuoteTranscriptOpen] = useState(false);

  // System lines (e.g. "X has exited the process") — centered, no avatar/role/LASH.
  if (type === 'system') {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-muted-foreground bg-muted/50 rounded-full px-3 py-1 text-center">
          {content}
        </span>
      </div>
    );
  }

  // Show LASH button for all messages - disabled for own messages but shows count
  const showLashButton = messageId && (onLash || lashCount > 0);
  const canLash = !isCurrentUser && onLash;

  const LashButton = () => (
    <button
      onClick={canLash ? onLash : undefined}
      disabled={!canLash || isLashing || isLashed}
      className={cn(
        "p-1.5 rounded-full transition-all flex items-center gap-1",
        isLashed 
          ? "text-green-500" 
          : isCurrentUser
            ? "text-muted-foreground cursor-default"
            : "text-muted-foreground hover:text-green-500",
        isLashing && "opacity-50 cursor-not-allowed",
        !canLash && !isCurrentUser && "cursor-not-allowed"
      )}
      title={isCurrentUser ? `${lashCount} LASH` : (isLashed ? "Already LASHed" : "Send LASH")}
    >
      <Heart 
        className={cn(
          "w-4 h-4 transition-all",
          isLashed && "fill-green-500"
        )} 
      />
      {lashCount > 0 && (
        <span className="text-xs">{lashCount}</span>
      )}
    </button>
  );

  const ReplyButton = () => (
    <button
      onClick={onReply}
      className="p-1.5 rounded-full text-muted-foreground hover:text-primary transition-all flex items-center"
      title="Reply"
    >
      <Reply className="w-4 h-4" />
    </button>
  );

  // Heart + Reply stacked VERTICALLY in a narrow column so they don't eat the
  // horizontal width of the bubble (which was cutting off audio players).
  const ActionButtons = () =>
    (showLashButton || onReply) ? (
      <div className="flex flex-col items-center gap-0.5 self-center shrink-0">
        {showLashButton && <LashButton />}
        {onReply && <ReplyButton />}
      </div>
    ) : null;

  // Quoted block shown at the top of a bubble when this message is a reply.
  // Clicking it jumps to the quoted message (a bare "🎤 Voice message" told you
  // nothing about WHICH recording); a voice quote also offers its transcript
  // right here, without leaving the reply.
  const QuotedReply = () => {
    if (!repliedToSender && !repliedToSnippet) return null;
    const clickable = !!onQuoteClick;
    return (
      <div className="mb-1.5 border-l-2 border-primary/50 pl-2 py-0.5 max-w-full">
        <div
          role={clickable ? 'button' : undefined}
          tabIndex={clickable ? 0 : undefined}
          onClick={onQuoteClick}
          onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onQuoteClick?.(); } } : undefined}
          className={clickable ? 'cursor-pointer hover:opacity-80 transition-opacity' : undefined}
          title={clickable ? (en ? 'Jump to the quoted message' : 'Skoči na citirano sporočilo') : undefined}
        >
          {repliedToSender && (
            <p className="text-[11px] font-medium text-primary/80 truncate">{repliedToSender}</p>
          )}
          <p className="text-xs text-muted-foreground/80 truncate">{repliedToSnippet}</p>
        </div>
        {repliedToTranscript && (
          <>
            <button
              type="button"
              onClick={() => setQuoteTranscriptOpen((v) => !v)}
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <FileText className="h-3 w-3" />
              {en ? 'Transcript' : 'Transkript'}
              <ChevronDown className={`h-3 w-3 transition-transform ${quoteTranscriptOpen ? 'rotate-180' : ''}`} />
            </button>
            {quoteTranscriptOpen && (
              <p className="text-[11px] text-muted-foreground/90 whitespace-pre-wrap mt-0.5 max-h-40 overflow-y-auto">
                {repliedToTranscript}
              </p>
            )}
          </>
        )}
      </div>
    );
  };

  if (type === 'audio' && audioUrl) {
    return (
      <div className={`flex flex-col mb-4 ${isCurrentUser ? 'items-end' : 'items-start'}`}>
        <div className="text-xs text-muted-foreground mb-1 max-w-[calc(100vw-4rem)] truncate">
          {sender}{role && ` (${role})`} • {timestamp}
        </div>
        <div className={`flex items-center gap-1.5 max-w-[calc(100vw-3rem)] ${isCurrentUser ? 'flex-row-reverse' : ''}`}>
          <ActionButtons />
          <Card className={`p-2 md:p-3 flex-1 min-w-0 md:max-w-2xl lg:max-w-4xl xl:max-w-6xl ${isCurrentUser ? 'bg-green-500/20 border-green-500/30' : 'bg-muted/50'}`}>
            <QuotedReply />
            <AudioPlayer audioUrl={audioUrl} initialDuration={audioDuration} />
            {transcript && <TranscriptToggle text={transcript} />}
          </Card>
        </div>
      </div>
    );
  }

  if (type === 'image' && imageUrl) {
    return (
      <div className={`flex flex-col mb-4 ${isCurrentUser ? 'items-end' : 'items-start'}`}>
        <div className="text-xs text-muted-foreground mb-1 max-w-[calc(100vw-4rem)] truncate">
          {sender}{role && ` (${role})`} • {timestamp}
        </div>
        <div className={`flex items-center gap-1.5 max-w-[calc(100vw-3rem)] ${isCurrentUser ? 'flex-row-reverse' : ''}`}>
          <ActionButtons />
          <Card className={`p-1 md:p-2 ${isCurrentUser ? 'bg-green-500/20 border-green-500/30' : 'bg-muted/50'}`}>
            <QuotedReply />
            <a href={imageUrl} target="_blank" rel="noopener noreferrer">
              <img
                src={imageUrl}
                alt="Shared image"
                className="max-w-[280px] sm:max-w-md md:max-w-lg lg:max-w-2xl rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                loading="lazy"
              />
            </a>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col mb-4 ${isCurrentUser ? 'items-end' : 'items-start'}`}>
      <div className="text-xs text-muted-foreground mb-1 max-w-[calc(100vw-4rem)] truncate">
        {sender}{role && ` (${role})`} • {timestamp}
      </div>
      <div className={`flex items-center gap-1.5 max-w-[calc(100vw-3rem)] ${isCurrentUser ? 'flex-row-reverse' : ''}`}>
        <ActionButtons />
        <Card className={`p-2 md:p-3 max-w-[85vw] md:max-w-2xl lg:max-w-4xl xl:max-w-6xl ${isCurrentUser ? 'bg-green-500/20 border-green-500/30' : 'bg-muted/50'}`}>
          <QuotedReply />
          {(() => {
            const ytUrl = content ? findYouTubeUrl(content) : null;
            const ytId = ytUrl ? getYouTubeId(ytUrl) : null;
            if (ytId) {
              // Render text with the YouTube URL as a clickable link, then embed below
              const parts = content!.split(ytUrl!);
              return (
                <>
                  <p className="text-sm break-words whitespace-pre-wrap">
                    {parts[0]}
                    <a
                      href={ytUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline break-all"
                    >
                      {ytUrl}
                    </a>
                    {parts.slice(1).join(ytUrl!)}
                  </p>
                  <YouTubeEmbed videoId={ytId} />
                </>
              );
            }
            return <p className="text-sm break-words whitespace-pre-wrap">{content}</p>;
          })()}
          {content && content.trim() && <TranslateButton text={content} />}
        </Card>
      </div>
    </div>
  );
}
