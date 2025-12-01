import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Send, MessageCircle } from "lucide-react";
import ChatMessage from "./ChatMessage";
import OwnAudioRecorder from "./OwnAudioRecorder";

interface Message {
  id: string;
  sender: string;
  timestamp: string;
  type: 'text' | 'audio';
  content?: string;
  audioUrl?: string;
}

interface ChatViewProps {
  conversationTitle?: string;
  conversationStatus?: string;
  processEventId?: string;
  senderPubkey?: string;
  messages?: Message[];
  onBack: () => void;
  onSendAudio?: (audioPath: string) => Promise<void>;
  isLoading?: boolean;
}

export default function ChatView({ 
  conversationTitle, 
  conversationStatus,
  processEventId,
  senderPubkey,
  messages = [], 
  onBack,
  onSendAudio,
  isLoading = false
}: ChatViewProps) {
  const [messageText, setMessageText] = useState("");

  if (!conversationTitle) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <MessageCircle className="w-20 h-20 text-muted-foreground/30 mb-4" />
        <h3 className="text-xl font-semibold mb-2">Select a conversation</h3>
        <p className="text-muted-foreground">Choose a process from the list to view messages</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <Card className="p-4 mb-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">{conversationTitle}</h2>
              {conversationStatus && (
                <Badge variant="secondary" className="text-xs">
                  {conversationStatus}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4">
        <div className="space-y-2 pb-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading messages...
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No messages yet
            </div>
          ) : (
            messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                sender={msg.sender}
                timestamp={msg.timestamp}
                type={msg.type}
                content={msg.content}
                audioUrl={msg.audioUrl}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <Card className="p-4 sticky bottom-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Type a message..."
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            className="flex-1 px-4 py-2 rounded-lg border bg-background"
          />
          {processEventId && senderPubkey && onSendAudio && (
            <OwnAudioRecorder 
              processEventId={processEventId}
              senderPubkey={senderPubkey}
              onSendAudio={onSendAudio}
              compact
            />
          )}
          <Button size="icon" className="bg-cyan-500 hover:bg-cyan-600">
            <Send className="w-5 h-5" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
