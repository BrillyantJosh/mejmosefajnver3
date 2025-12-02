import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings } from "lucide-react";

interface Conversation {
  id: string;
  title: string;
  initiator: string;
  facilitator: string;
  participants: string[];
  status: string;
  lastActivity: string;
}

interface ConversationListProps {
  conversations: Conversation[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

export default function ConversationList({ conversations, selectedId, onSelect }: ConversationListProps) {
  return (
    <div className="space-y-3">
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search conversations..."
          className="w-full px-4 py-2.5 rounded-lg border bg-background text-base"
        />
      </div>

      {conversations.map((conv) => (
        <Card
          key={conv.id}
          className={`p-3 md:p-4 cursor-pointer transition-colors hover:bg-accent/50 active:scale-[0.98] ${
            selectedId === conv.id ? 'border-primary bg-accent/30' : ''
          }`}
          onClick={() => onSelect(conv.id)}
        >
          <div className="flex flex-col gap-2 mb-2">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-sm md:text-base leading-snug flex-1">{conv.title}</h3>
              <Settings className="w-4 h-4 text-muted-foreground shrink-0" />
            </div>
            <span className="text-xs text-muted-foreground">{conv.lastActivity}</span>
          </div>
          
          <div className="space-y-1 text-xs md:text-sm text-muted-foreground">
            <p className="truncate"><span className="font-medium">Initiator:</span> {conv.initiator}</p>
            <p className="truncate"><span className="font-medium">Facilitator:</span> {conv.facilitator}</p>
            <p className="truncate"><span className="font-medium">Participants:</span> {conv.participants.join(', ')}</p>
          </div>

          <div className="mt-2">
            <Badge variant="secondary" className="text-xs">
              {conv.status}
            </Badge>
          </div>
        </Card>
      ))}
    </div>
  );
}
