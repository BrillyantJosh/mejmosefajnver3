import { Card } from "@/components/ui/card";
import { AudioPlayer } from "@/components/AudioPlayer";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  sender: string;
  role?: string;
  timestamp: string;
  type: 'text' | 'audio';
  content?: string;
  audioUrl?: string;
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
      title={isCurrentUser ? `${lashCount} LASH` : (isLashed ? "Že LASHano" : "Pošlji LASH")}
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
        <div className="text-xs text-muted-foreground mb-1">
          {sender}{role && ` (${role})`} • {timestamp}
        </div>
        <div className={`flex items-center gap-2 ${isCurrentUser ? 'flex-row-reverse' : ''}`}>
          {showLashButton && <LashButton />}
          <Card className={`p-3 max-w-md w-full ${isCurrentUser ? 'bg-green-500/20 border-green-500/30' : 'bg-muted/50'}`}>
            <AudioPlayer audioUrl={audioUrl} />
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col mb-4 ${isCurrentUser ? 'items-end' : 'items-start'}`}>
      <div className="text-xs text-muted-foreground mb-1">
        {sender}{role && ` (${role})`} • {timestamp}
      </div>
      <div className={`flex items-center gap-2 ${isCurrentUser ? 'flex-row-reverse' : ''}`}>
        {showLashButton && <LashButton />}
        <Card className={`p-3 max-w-md ${isCurrentUser ? 'bg-green-500/20 border-green-500/30' : 'bg-muted/50'}`}>
          <p className="text-sm">{content}</p>
        </Card>
      </div>
    </div>
  );
}
