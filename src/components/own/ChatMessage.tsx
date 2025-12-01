import { Card } from "@/components/ui/card";
import { AudioPlayer } from "@/components/AudioPlayer";

interface ChatMessageProps {
  sender: string;
  timestamp: string;
  type: 'text' | 'audio';
  content?: string;
  audioUrl?: string;
}

export default function ChatMessage({ sender, timestamp, type, content, audioUrl }: ChatMessageProps) {
  if (type === 'audio' && audioUrl) {
    return (
      <div className="flex flex-col items-end mb-4">
        <div className="text-xs text-muted-foreground mb-1">
          {sender} • {timestamp}
        </div>
        <Card className="bg-accent/50 p-3 max-w-md w-full">
          <AudioPlayer audioUrl={audioUrl} />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start mb-4">
      <div className="text-xs text-muted-foreground mb-1">
        {sender} • {timestamp}
      </div>
      <Card className="bg-accent p-3 max-w-md">
        <p className="text-sm">{content}</p>
      </Card>
    </div>
  );
}
