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
          className="w-full px-4 py-2 rounded-lg border bg-background"
        />
      </div>

      {conversations.map((conv) => (
        <Card
          key={conv.id}
          className={`p-4 cursor-pointer transition-colors hover:bg-accent/50 ${
            selectedId === conv.id ? 'border-primary bg-accent/30' : ''
          }`}
          onClick={() => onSelect(conv.id)}
        >
          <div className="flex items-start justify-between mb-2">
            <h3 className="font-semibold">{conv.title}</h3>
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{conv.lastActivity}</span>
            </div>
          </div>
          
          <div className="space-y-1 text-sm text-muted-foreground">
            <p><span className="font-medium">Initiator:</span> {conv.initiator}</p>
            <p><span className="font-medium">Facilitator:</span> {conv.facilitator}</p>
            <p><span className="font-medium">Participants:</span> {conv.participants.join(', ')}</p>
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
