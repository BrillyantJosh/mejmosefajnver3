import { Card } from "@/components/ui/card";
import { Play } from "lucide-react";

interface ChatMessageProps {
  sender: string;
  timestamp: string;
  type: 'text' | 'audio';
  content?: string;
  audioDuration?: string;
}

export default function ChatMessage({ sender, timestamp, type, content, audioDuration = "0:00:00" }: ChatMessageProps) {
  if (type === 'audio') {
    return (
      <div className="flex flex-col items-end mb-4">
        <div className="text-xs text-muted-foreground mb-1">
          {sender} • {timestamp}
        </div>
        <Card className="bg-cyan-500/90 hover:bg-cyan-500 transition-colors border-none p-4 w-64">
          <div className="flex items-center gap-3 text-white">
            <button className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 transition-colors flex items-center justify-center">
              <Play className="w-5 h-5 fill-white" />
            </button>
            <div className="flex-1">
              <div className="h-1 bg-white/30 rounded-full mb-2">
                <div className="h-full w-0 bg-white rounded-full"></div>
              </div>
              <div className="text-sm">{audioDuration}</div>
            </div>
          </div>
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
