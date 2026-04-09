import { useState } from "react";
import { Card } from "@/components/ui/card";
import { AudioPlayer } from "@/components/AudioPlayer";
import { Heart, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

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
        <p className="text-sm text-muted-foreground italic whitespace-pre-wrap break-words mt-2">
          {text}
        </p>
      )}
    </div>
  );
}

interface ChatMessageProps {
  sender: string;
  role?: string;
  timestamp: string;
  type: 'text' | 'audio' | 'image';
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
  lashCount = 0
}: ChatMessageProps) {
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

  if (type === 'audio' && audioUrl) {
    return (
      <div className={`flex flex-col mb-4 ${isCurrentUser ? 'items-end' : 'items-start'}`}>
        <div className="text-xs text-muted-foreground mb-1 max-w-[calc(100vw-4rem)] truncate">
          {sender}{role && ` (${role})`} • {timestamp}
        </div>
        <div className={`flex items-center gap-1.5 max-w-[calc(100vw-3rem)] ${isCurrentUser ? 'flex-row-reverse' : ''}`}>
          {showLashButton && <LashButton />}
          <Card className={`p-2 md:p-3 flex-1 min-w-0 ${isCurrentUser ? 'bg-green-500/20 border-green-500/30' : 'bg-muted/50'}`}>
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
          {showLashButton && <LashButton />}
          <Card className={`p-1 md:p-2 ${isCurrentUser ? 'bg-green-500/20 border-green-500/30' : 'bg-muted/50'}`}>
            <a href={imageUrl} target="_blank" rel="noopener noreferrer">
              <img
                src={imageUrl}
                alt="Shared image"
                className="max-w-[280px] sm:max-w-sm rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
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
        {showLashButton && <LashButton />}
        <Card className={`p-2 md:p-3 max-w-[85vw] md:max-w-md ${isCurrentUser ? 'bg-green-500/20 border-green-500/30' : 'bg-muted/50'}`}>
          <p className="text-sm break-words">{content}</p>
        </Card>
      </div>
    </div>
  );
}
