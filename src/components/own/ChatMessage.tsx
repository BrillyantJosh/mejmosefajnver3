import { Card } from "@/components/ui/card";
import { AudioPlayer } from "@/components/AudioPlayer";

interface ChatMessageProps {
  sender: string;
  timestamp: string;
  type: 'text' | 'audio';
  content?: string;
  audioUrl?: string;
  isCurrentUser?: boolean;
}

export default function ChatMessage({ sender, timestamp, type, content, audioUrl, isCurrentUser = false }: ChatMessageProps) {
  if (type === 'audio' && audioUrl) {
    return (
      <div className={`flex flex-col mb-4 ${isCurrentUser ? 'items-end' : 'items-start'}`}>
        <div className="text-xs text-muted-foreground mb-1">
          {sender} • {timestamp}
        </div>
        <Card className={`p-3 max-w-md w-full ${isCurrentUser ? 'bg-green-500/20 border-green-500/30' : 'bg-muted/50'}`}>
          <AudioPlayer audioUrl={audioUrl} />
        </Card>
      </div>
    );
  }

  return (
    <div className={`flex flex-col mb-4 ${isCurrentUser ? 'items-end' : 'items-start'}`}>
      <div className="text-xs text-muted-foreground mb-1">
        {sender} • {timestamp}
      </div>
      <Card className={`p-3 max-w-md ${isCurrentUser ? 'bg-green-500/20 border-green-500/30' : 'bg-muted/50'}`}>
        <p className="text-sm">{content}</p>
      </Card>
    </div>
  );
}
