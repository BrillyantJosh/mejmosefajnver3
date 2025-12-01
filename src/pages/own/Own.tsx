import { useState } from "react";
import ConversationList from "@/components/own/ConversationList";
import ChatView from "@/components/own/ChatView";

// Mock data
const mockConversations = [
  {
    id: "1",
    title: "Test 2",
    initiator: "IggyLes",
    facilitator: "Brilly(ant) Josh",
    participants: ["FoxyMo", "GasZorro", "IggyLes", "Rokson"],
    status: "opening",
    lastActivity: "5 days ago"
  },
  {
    id: "2",
    title: "Project Alpha",
    initiator: "JohnDoe",
    facilitator: "JaneSmith",
    participants: ["Alice", "Bob", "Charlie"],
    status: "active",
    lastActivity: "2 hours ago"
  }
];

const mockMessages = [
  {
    id: "1",
    sender: "Brilly(ant) Josh",
    timestamp: "5 days ago",
    type: "audio" as const,
    audioDuration: "0:00:00"
  },
  {
    id: "2",
    sender: "Brilly(ant) Josh",
    timestamp: "5 days ago",
    type: "audio" as const,
    audioDuration: "0:00:00"
  },
  {
    id: "3",
    sender: "Brilly(ant) Josh",
    timestamp: "1 day ago",
    type: "audio" as const,
    audioDuration: "0:00:00"
  }
];

export default function Own() {
  const [selectedConversationId, setSelectedConversationId] = useState<string>();

  const selectedConversation = mockConversations.find(
    (c) => c.id === selectedConversationId
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-[400px_1fr] gap-4 h-[calc(100vh-200px)]">
      {/* Conversation List */}
      <div className={`overflow-y-auto ${selectedConversationId ? 'hidden md:block' : ''}`}>
        <h2 className="text-xl font-semibold mb-4">Messages</h2>
        <ConversationList
          conversations={mockConversations}
          selectedId={selectedConversationId}
          onSelect={setSelectedConversationId}
        />
      </div>

      {/* Chat View */}
      <div className={`${!selectedConversationId ? 'hidden md:block' : ''}`}>
        <ChatView
          conversationTitle={selectedConversation?.title}
          conversationStatus={selectedConversation?.status}
          messages={selectedConversationId ? mockMessages : []}
          onBack={() => setSelectedConversationId(undefined)}
        />
      </div>
    </div>
  );
}
