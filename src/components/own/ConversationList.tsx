import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";
import { useState } from "react";
import { useLang } from "@/i18n/I18nContext";
import { descriptionNeedsFolding } from "@/lib/processDescription";

interface Conversation {
  id: string;
  title: string;
  initiator: string;
  facilitators: string[];
  participants: string[];
  guests: string[];
  /** Why the initiator opened it, from the KIND 87044 case event. */
  description?: string;
  status: string;
  phase?: string;
  lastActivity: string;
  pausedUntil?: number | null; // unix seconds — set while the facilitator has paused it
  paused?: boolean;            // the 37044 status itself says paused (may carry no end date)
  /** How many people in this case are frozen (KIND 87057). 0 = nobody, or unverified. */
  frozenCount?: number;
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
  const en = useLang() === 'en';
  // Which cards have had their description opened. Folded by default so the
  // list stays scannable — one live case runs to 1645 characters.
  const [openDescriptions, setOpenDescriptions] = useState<Set<string>>(new Set());
  const toggleDescription = (id: string) =>
    setOpenDescriptions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
            } ${(conv.pausedUntil || conv.paused) ? 'ring-1 ring-amber-400/60' : ''} ${phaseInfo.bgCard}`}
            onClick={() => onSelect(conv.id)}
          >
            <div className="flex flex-col gap-2 mb-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-sm md:text-base leading-snug flex-1">{conv.title}</h3>
              </div>
              <span className="text-xs text-muted-foreground">{conv.lastActivity}</span>
            </div>

            <div className="space-y-1 text-xs md:text-sm text-muted-foreground">
              <p className="break-words"><span className="font-medium">Initiator:</span> {conv.initiator}</p>
              {conv.facilitators.length > 0 && (
                <p className="break-words"><span className="font-medium">{conv.facilitators.length > 1 ? 'Facilitators' : 'Facilitator'}:</span> {conv.facilitators.join(', ')}</p>
              )}
              {conv.participants.length > 0 && (
                <p className="break-words"><span className="font-medium">Participants:</span> {conv.participants.join(', ')}</p>
              )}
              {conv.guests.length > 0 && (
                <p className="break-words"><span className="font-medium">Guests:</span> {conv.guests.join(', ')}</p>
              )}
            </div>

            {/* What the initiator wrote when opening the case. */}
            {conv.description && (
              <div className="mt-2 text-xs md:text-sm text-muted-foreground">
                <p
                  className={`whitespace-pre-wrap break-words ${
                    openDescriptions.has(conv.id)
                      ? 'max-h-56 overflow-y-auto pr-1'
                      : descriptionNeedsFolding(conv.description)
                        ? 'line-clamp-3'
                        : ''
                  }`}
                >
                  {conv.description}
                </p>
                {descriptionNeedsFolding(conv.description) && (
                  <button
                    type="button"
                    // The card itself opens the process — reading the reason
                    // in place must not do that too.
                    onClick={(e) => { e.stopPropagation(); toggleDescription(conv.id); }}
                    className="mt-0.5 text-xs font-medium text-primary hover:underline"
                  >
                    {openDescriptions.has(conv.id)
                      ? (en ? 'Show less' : 'Pokaži manj')
                      : (en ? 'Show more' : 'Pokaži več')}
                  </button>
                )}
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge className={`text-xs border ${phaseInfo.bg} ${phaseInfo.color}`}>
                {phaseInfo.emoji} {phaseInfo.label}
              </Badge>
              {/* Beside the pause, never instead of it: a process can be paused
                  AND hold a frozen person, and hiding one behind the other
                  reads as though the other had been lifted. */}
              {!!conv.frozenCount && (
                <Badge className="text-xs gap-1 border bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950 dark:text-blue-300">
                  <span aria-hidden="true">❄️</span>
                  {conv.frozenCount === 1
                    ? (en ? '1 person frozen' : '1 zamrznjen')
                    : (en ? `${conv.frozenCount} people frozen` : `${conv.frozenCount} zamrznjenih`)}
                </Badge>
              )}
              {(conv.pausedUntil || conv.paused) && (
                <Badge className="text-xs gap-1 border bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300">
                  <Lock className="w-3 h-3" />
                  {conv.pausedUntil
                    ? (en
                      ? `Paused until ${new Date(conv.pausedUntil * 1000).toLocaleString()}`
                      : `V premoru do ${new Date(conv.pausedUntil * 1000).toLocaleString()}`)
                    : (en ? 'Paused' : 'V premoru')}
                </Badge>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
