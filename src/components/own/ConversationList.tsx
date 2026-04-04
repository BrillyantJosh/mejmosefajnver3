import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Conversation {
  id: string;
  title: string;
  initiator: string;
  facilitator: string;
  participants: string[];
  guests: string[];
  status: string;
  phase?: string;
  lastActivity: string;
}

interface ConversationListProps {
  conversations: Conversation[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

const PHASE_STYLES: Record<string, { label: string; emoji: string; color: string; bg: string; bgCard: string }> = {
  opening:    { label: 'Opening',    emoji: '⚪', color: 'text-gray-600 dark:text-gray-400',    bg: 'bg-gray-500/10 border-gray-500/20',    bgCard: '' },
  reflection: { label: 'Reflection', emoji: '🟣', color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', bgCard: 'bg-purple-500/5' },
  alignment:  { label: 'Alignment',  emoji: '🟢', color: 'text-green-600 dark:text-green-400',  bg: 'bg-green-500/10 border-green-500/20',  bgCard: 'bg-green-500/5' },
  change:     { label: 'Change',     emoji: '🔵', color: 'text-blue-600 dark:text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/20',    bgCard: 'bg-blue-500/5' },
  closing:    { label: 'Closing',    emoji: '⚪', color: 'text-gray-600 dark:text-gray-400',    bg: 'bg-gray-500/10 border-gray-500/20',    bgCard: '' },
  resolution: { label: 'Resolution', emoji: '🟢', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', bgCard: 'bg-emerald-500/5' },
};

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

      {conversations.map((conv) => {
        const phaseInfo = PHASE_STYLES[conv.phase || ''] || PHASE_STYLES.opening;
        return (
          <Card
            key={conv.id}
            className={`p-3 md:p-4 cursor-pointer transition-colors hover:bg-accent/50 active:scale-[0.98] ${
              selectedId === conv.id ? 'border-orange-500 bg-orange-500/15' : ''
            } ${phaseInfo.bgCard}`}
            onClick={() => onSelect(conv.id)}
          >
            <div className="flex flex-col gap-2 mb-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-sm md:text-base leading-snug flex-1">{conv.title}</h3>
              </div>
              <span className="text-xs text-muted-foreground">{conv.lastActivity}</span>
            </div>

            <div className="space-y-1 text-xs md:text-sm text-muted-foreground">
              <p className="truncate"><span className="font-medium">Initiator:</span> {conv.initiator}</p>
              {conv.facilitator && (
                <p className="truncate"><span className="font-medium">Facilitator:</span> {conv.facilitator}</p>
              )}
              {conv.participants.length > 0 && (
                <p className="truncate"><span className="font-medium">Participants:</span> {conv.participants.join(', ')}</p>
              )}
              {conv.guests.length > 0 && (
                <p className="truncate"><span className="font-medium">Guests:</span> {conv.guests.join(', ')}</p>
              )}
            </div>

            <div className="mt-2">
              <Badge className={`text-xs border ${phaseInfo.bg} ${phaseInfo.color}`}>
                {phaseInfo.emoji} {phaseInfo.label}
              </Badge>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
