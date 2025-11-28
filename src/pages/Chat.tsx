import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Search, AlertCircle, Trash2, ArrowLeft, Heart, Mic, ImagePlus, Send, Loader2, Reply, X } from "lucide-react";
import { useNostrDMs } from "@/hooks/useNostrDMs";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDistanceToNow } from "date-fns";
import NewChatDialog from "@/components/NewChatDialog";
import NewChatDrawer from "@/components/NewChatDrawer";
import { useNostrLash } from "@/hooks/useNostrLash";
import { useToast } from "@/hooks/use-toast";
import { LinkPreview } from "@/components/social/LinkPreview";
import { DMAudioRecorder } from "@/components/DMAudioRecorder";
import { AudioPlayer } from "@/components/AudioPlayer";
import { DMImageUploader } from "@/components/DMImageUploader";
import { ImageGallery } from "@/components/ImageGallery";
import { getProxiedImageUrl } from "@/lib/imageProxy";
import { useNostrUserLashes } from "@/hooks/useNostrUserLashes";
import { useNostrLashCounts } from "@/hooks/useNostrLashCounts";
import { useNostrMessageLashers } from "@/hooks/useNostrMessageLashers";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export default function Chat() {
  const { session } = useAuth();
  const location = useLocation();
  const { conversations, profiles, loading, connected, sendMessage, deleteMessage, markAsRead, totalEvents, relayCount } = useNostrDMs();
  const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<any | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const { giveLash, isSending: isSendingLash } = useNostrLash();
  const { toast } = useToast();

  const selectedConversation = conversations.find(c => c.pubkey === selectedPubkey);

  // Create a virtual conversation for new chats
  const displayConversation = selectedConversation || (selectedPubkey ? {
    pubkey: selectedPubkey,
    messages: [],
    lastMessage: null,
    unreadCount: 0
  } : null);

  // LASH tracking hooks
  const { lashedEventIds } = useNostrUserLashes();
  const messageIds = displayConversation?.messages.map(m => m.id) || [];
  const { lashCounts } = useNostrLashCounts(messageIds);
  const { messageLashers } = useNostrMessageLashers(messageIds);

  // Handle incoming pubkey from navigation (e.g., from Marketplace "Contact Seller")
  useEffect(() => {
    if (location.state?.conversationPubkey) {
      setSelectedPubkey(location.state.conversationPubkey);
      // Clear the state after using it
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Scroll to bottom when conversation opens
  useEffect(() => {
    if (selectedPubkey) {
      markAsRead(selectedPubkey);
      
      // Scroll to bottom after short delay (DOM needs to render)
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPubkey]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedPubkey || isSending) return;

    setIsSending(true);
    try {
      await sendMessage(selectedPubkey, messageInput, replyingTo?.id);
      setMessageInput("");
      setReplyingTo(null);
      
      // Auto-focus input field for immediate continued typing
      setTimeout(() => {
        messageInputRef.current?.focus();
      }, 0);
      
      // Scroll to bottom after sending
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!selectedPubkey) return;
    
    if (confirm('Are you sure you want to delete this message?')) {
      await deleteMessage(messageId, selectedPubkey);
    }
  };

  const handleGiveLash = async (messageId: string, recipientPubkey: string) => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast({
        title: "Error",
        description: "You must be logged in to give LASH",
        variant: "destructive"
      });
      return;
    }

    const recipientProfile = profiles.get(recipientPubkey);
    const recipientWallet = recipientProfile?.lana_wallet_id;

    if (!recipientWallet) {
      toast({
        title: "Error",
        description: "Recipient wallet not found",
        variant: "destructive"
      });
      return;
    }

    const result = await giveLash({
      postId: messageId,
      recipientPubkey: recipientPubkey,
      recipientWallet: recipientWallet,
      memo: "LASH for message"
    });

    if (result.success) {
      toast({
        title: "Success",
        description: "LASH sent successfully! ❤️"
      });
    } else {
      toast({
        title: "Error",
        description: result.error || "Failed to send LASH",
        variant: "destructive"
      });
    }
  };

  const handleBackToList = () => {
    setSelectedPubkey(null);
    setReplyingTo(null);
  };

  const findMessageById = (messageId: string) => {
    return displayConversation?.messages.find(m => m.id === messageId);
  };

  const scrollToMessage = (messageId: string) => {
    const element = document.getElementById(`message-${messageId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('animate-pulse');
      setTimeout(() => element.classList.remove('animate-pulse'), 2000);
    }
  };

  const filteredConversations = conversations.filter(conv => {
    if (!searchQuery) return true;
    const pubkeyShort = conv.pubkey.slice(0, 8);
    const lastMsg = conv.lastMessage?.decryptedContent || '';
    const profile = profiles.get(conv.pubkey);
    const displayName = profile?.display_name || profile?.full_name || '';
    
    return pubkeyShort.toLowerCase().includes(searchQuery.toLowerCase()) ||
           lastMsg.toLowerCase().includes(searchQuery.toLowerCase()) ||
           displayName.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const formatTime = (timestamp: number) => {
    try {
      return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
    } catch {
      return 'Unknown';
    }
  };

  const getInitials = (pubkey: string) => {
    const profile = profiles.get(pubkey);
    if (profile?.display_name) {
      const names = profile.display_name.split(' ');
      if (names.length >= 2) {
        return (names[0][0] + names[names.length - 1][0]).toUpperCase();
      }
      return profile.display_name.slice(0, 2).toUpperCase();
    }
    if (profile?.full_name) {
      return profile.full_name.slice(0, 2).toUpperCase();
    }
    return pubkey.slice(0, 2).toUpperCase();
  };

  const getAvatar = (pubkey: string) => {
    const profile = profiles.get(pubkey);
    if (!profile?.picture) return undefined;
    
    // Use proxied URL with cache busting based on profile fetch time
    const cacheBuster = profile.last_fetched_at ? new Date(profile.last_fetched_at).getTime() : Date.now();
    return getProxiedImageUrl(profile.picture, cacheBuster);
  };

  const getDisplayName = (pubkey: string) => {
    const profile = profiles.get(pubkey);
    return profile?.display_name || profile?.full_name || pubkey.slice(0, 12) + '...';
  };

  const getFullName = (pubkey: string) => {
    const profile = profiles.get(pubkey);
    if (profile?.display_name && profile?.full_name) {
      return `${profile.display_name} (@${profile.full_name})`;
    }
    return profile?.display_name || profile?.full_name || pubkey.slice(0, 16) + '...';
  };

  const truncatePubkey = (pubkey: string) => {
    return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`;
  };

  const formatLanoshis = (amount: string) => {
    try {
      const lanoshis = parseInt(amount);
      return (lanoshis / 100000000).toFixed(8);
    } catch {
      return '0.00000000';
    }
  };

  const getLastMessageDisplay = (content: string | undefined) => {
    if (!content) return 'No messages';
    
    // Check for dm-audio URL
    const dmAudioRegex = /https:\/\/[^\s]+\.supabase\.co\/storage\/v1\/object\/public\/dm-audio\/[^\s]+\.(webm|mp4|m4a|aac|mpeg|mp3|wav|ogg)/i;
    if (dmAudioRegex.test(content)) {
      return (
        <span className="flex items-center gap-1">
          <Mic className="h-3 w-3" />
          Audio message
        </span>
      );
    }
    
    // Check for dm-images URL
    const dmImageRegex = /https:\/\/[^\s]+\.supabase\.co\/storage\/v1\/object\/public\/dm-images\/[^\s]+\.(jpg|jpeg|png|gif|webp)/i;
    if (dmImageRegex.test(content)) {
      return (
        <span className="flex items-center gap-1">
          <ImagePlus className="h-3 w-3" />
          Image message
        </span>
      );
    }
    
    return content;
  };

  const extractYouTubeId = (text: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    return null;
  };

  const renderMessageContent = (content: string, isOwn: boolean) => {
    const youtubeId = extractYouTubeId(content);
    
    // Check for dm-audio URL first (highest priority)
    const dmAudioRegex = /https:\/\/[^\s]+\.supabase\.co\/storage\/v1\/object\/public\/dm-audio\/[^\s]+\.(webm|mp4|m4a|aac|mpeg|mp3|wav|ogg)/i;
    const dmAudioMatch = content.match(dmAudioRegex);
    
    if (dmAudioMatch) {
      const audioUrl = dmAudioMatch[0];
      const textBeforeAudio = content.substring(0, dmAudioMatch.index).trim();
      const textAfterAudio = content.substring(dmAudioMatch.index! + audioUrl.length).trim();
      
      return (
        <div className="space-y-2 max-w-full overflow-hidden">
          {textBeforeAudio && (
            <p className="text-sm break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
              {textBeforeAudio}
            </p>
          )}
          <div className="w-full max-w-full overflow-hidden">
            <AudioPlayer audioUrl={audioUrl} />
          </div>
          {textAfterAudio && (
            <p className="text-sm break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
              {textAfterAudio}
            </p>
          )}
        </div>
      );
    }
    
    // Check for dm-images URLs (multiple images separated by newlines)
    const dmImageRegex = /https:\/\/[^\s]+\.supabase\.co\/storage\/v1\/object\/public\/dm-images\/[^\s]+\.(jpg|jpeg|png|gif|webp)/gi;
    const imageMatches = content.match(dmImageRegex);
    
    if (imageMatches && imageMatches.length > 0) {
      // Check if content is ONLY image URLs
      const contentWithoutImages = content.replace(dmImageRegex, '').trim();
      
      return (
        <div className="space-y-2 max-w-full overflow-hidden">
          <div className="w-full max-w-full overflow-hidden">
            <ImageGallery urls={imageMatches} isOwn={isOwn} />
          </div>
          {contentWithoutImages && (
            <p className="text-sm break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
              {contentWithoutImages}
            </p>
          )}
        </div>
      );
    }
    
    // Extract URLs from content - including those without protocol
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
    const matches = content.match(urlRegex) || [];
    
    // Normalize URLs by adding https:// if missing
    const urls = matches.map(url => {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return 'https://' + url;
      }
      return url;
    });
    
    // Store original matches for text replacement
    const originalMatches = matches;
    
    if (youtubeId) {
      return (
        <div className="space-y-2 max-w-full overflow-hidden">
          <div className="w-full max-w-full overflow-hidden">
            <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
              <iframe
                className="absolute top-0 left-0 w-full h-full rounded-lg"
                src={`https://www.youtube.com/embed/${youtubeId}`}
                title="YouTube video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
          <p className="text-sm break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
            {content}
          </p>
        </div>
      );
    }
    
    // If there are non-YouTube URLs, render them with LinkPreview
    if (urls.length > 0) {
      // Split content by URLs to render text and link previews
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      
      originalMatches.forEach((originalUrl, index) => {
        const urlIndex = content.indexOf(originalUrl, lastIndex);
        
        // Add text before URL
        if (urlIndex > lastIndex) {
          const textBefore = content.substring(lastIndex, urlIndex);
          if (textBefore.trim()) {
            parts.push(
              <span key={`text-${index}`} className="text-sm break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
                {textBefore}
              </span>
            );
          }
        }
        
        // Add LinkPreview for URL (using normalized URL)
        parts.push(<LinkPreview key={`url-${index}`} url={urls[index]} />);
        
        lastIndex = urlIndex + originalUrl.length;
      });
      
      // Add remaining text after last URL
      if (lastIndex < content.length) {
        const textAfter = content.substring(lastIndex);
        if (textAfter.trim()) {
          parts.push(
            <span key="text-end" className="text-sm break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
              {textAfter}
            </span>
          );
        }
      }
      
      return <div className="space-y-2 max-w-full overflow-hidden">{parts}</div>;
    }
    
    return (
      <p className="text-sm break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
        {content}
      </p>
    );
  };

  if (!session) {
    return (
      <div className="max-w-7xl mx-auto">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please log in to access Direct Messages
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen md:block md:h-auto md:max-w-7xl md:mx-auto overflow-x-hidden w-full">
      <div className="hidden md:block p-0 md:mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-2xl md:text-3xl">Chat</h1>
            <p className="text-muted-foreground text-sm">Nostr Direct Messages</p>
          </div>
          <div>
            <NewChatDialog onSelectUser={(pubkey) => setSelectedPubkey(pubkey)} />
          </div>
        </div>
        <div className="flex items-center gap-4 mt-2">
          <div className="flex items-center gap-2 text-sm">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className={connected ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
              {connected ? 'Connected to Nostr' : 'Disconnected'}
            </span>
          </div>
          {process.env.NODE_ENV === 'development' && (
            <div className="text-xs text-muted-foreground border-l pl-4">
              Events: {totalEvents} | Relays: {relayCount} | Convos: {conversations.length}
              {session?.nostrHexId && <> | ID: {session.nostrHexId.slice(0, 8)}...</>}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3 md:px-4 flex-1 overflow-hidden w-full">
        {/* Conversations List - Hidden on mobile when chat is selected */}
        <Card className={`h-full md:col-span-1 border-0 shadow-none md:border md:shadow-sm min-w-0 flex flex-col ${selectedPubkey ? 'hidden md:block' : ''}`}>
          <CardHeader className="px-4 md:px-6">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Messages</CardTitle>
              <div className="md:hidden">
                <NewChatDrawer onSelectUser={(pubkey) => setSelectedPubkey(pubkey)} />
              </div>
            </div>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input 
                placeholder="Search conversations..." 
                className="pl-10 touch-manipulation h-12 text-base md:h-10 md:text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 overflow-y-auto px-0 flex-1 min-h-0 md:px-6 md:max-h-[600px] md:flex-none">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No conversations yet</p>
              </div>
            ) : (
              filteredConversations.map((conv) => (
                <div
                  key={conv.pubkey}
                  className={`rounded-lg hover:bg-secondary cursor-pointer transition-colors touch-manipulation p-4 md:p-3 ${
                    selectedPubkey === conv.pubkey ? 'bg-secondary' : ''
                  }`}
                  onClick={() => setSelectedPubkey(conv.pubkey)}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12 md:h-10 md:w-10">
                      <AvatarImage src={getAvatar(conv.pubkey)} alt={getDisplayName(conv.pubkey)} />
                      <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-white font-bold">
                        {getInitials(conv.pubkey)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start">
                        <p className="font-semibold truncate text-sm">
                          {getDisplayName(conv.pubkey)}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {conv.lastMessage && formatTime(conv.lastMessage.created_at)}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
                        {getLastMessageDisplay(conv.lastMessage?.decryptedContent)}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Chat Window - Hidden on mobile when no chat is selected */}
        <Card className={`md:col-span-2 border-0 shadow-none md:border md:shadow-sm flex flex-col min-w-0 h-full ${!selectedPubkey ? 'hidden md:block' : ''}`}>
          {displayConversation ? (
            <>
              <CardHeader className="sticky top-16 bg-card/95 backdrop-blur-sm z-10 border-b px-4 md:static md:bg-transparent md:backdrop-blur-none md:border-b-0 md:px-6">
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleBackToList}
                    className="mr-2 h-10 w-10 touch-manipulation md:hidden"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <Avatar className="h-12 w-12 md:h-10 md:w-10">
                    <AvatarImage src={getAvatar(displayConversation.pubkey)} alt={getFullName(displayConversation.pubkey)} />
                    <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-white font-bold">
                      {getInitials(displayConversation.pubkey)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle className="text-lg">
                      {getFullName(displayConversation.pubkey)}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {displayConversation.messages.length} messages
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col h-[calc(100vh-64px)] px-0 md:h-[calc(100vh-250px)] md:max-h-[600px] md:px-6 overflow-hidden">
                {/* Messages */}
                <div 
                  ref={messagesContainerRef}
                  className="flex-1 overflow-y-auto overflow-x-hidden space-y-4 mb-4 px-4 md:pr-2 md:pb-2 md:px-0 w-full"
                  style={{ scrollBehavior: 'smooth' }}
                >
                  {displayConversation.messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="text-center">
                        <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">Start a conversation</p>
                      </div>
                    </div>
                  ) : null}
                  {displayConversation.messages.map((msg) => (
                    <div 
                      key={msg.id}
                      id={`message-${msg.id}`}
                      className={`flex gap-2 items-start ${msg.isOwn ? 'justify-end' : 'justify-start'} group w-full`}
                    >
                      {!msg.isOwn && (
                        <Avatar className="flex-shrink-0 h-7 w-7 md:h-8 md:w-8">
                          <AvatarImage src={getAvatar(msg.pubkey)} alt={getDisplayName(msg.pubkey)} />
                          <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-white font-bold text-sm">
                            {getInitials(msg.pubkey)}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div className="flex items-start gap-1 max-w-[85%] md:max-w-[70%] min-w-0">
                        {msg.isOwn && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 h-7 w-7 md:h-8 md:w-8"
                              onClick={() => setReplyingTo(msg)}
                              title="Reply to message"
                            >
                              <Reply className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 h-7 w-7 md:h-8 md:w-8"
                              onClick={() => handleDeleteMessage(msg.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                        <div className={`rounded-lg p-3 overflow-hidden break-words max-w-full ${
                          msg.isOwn 
                            ? 'bg-primary text-primary-foreground' 
                            : 'bg-muted text-foreground'
                        }`}>
                          {msg.replyToId && (() => {
                            const originalMsg = findMessageById(msg.replyToId);
                            return originalMsg ? (
                              <div 
                                className={`mb-2 pb-2 border-b cursor-pointer hover:opacity-80 transition-opacity ${
                                  msg.isOwn ? 'border-primary-foreground/20' : 'border-border'
                                }`}
                                onClick={() => scrollToMessage(msg.replyToId!)}
                              >
                                <div className="flex items-center gap-1 mb-1">
                                  <Reply className="h-3 w-3" />
                                  <span className={`text-xs font-medium ${
                                    msg.isOwn ? 'text-primary-foreground/80' : 'text-muted-foreground'
                                  }`}>
                                    Reply to {originalMsg.isOwn ? 'You' : getDisplayName(originalMsg.pubkey)}
                                  </span>
                                </div>
                                <p className={`text-xs truncate ${
                                  msg.isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground'
                                }`}>
                                  {originalMsg.decryptedContent?.slice(0, 50) || 'Message'}...
                                </p>
                              </div>
                            ) : null;
                          })()}
                          {renderMessageContent(msg.decryptedContent || msg.content, msg.isOwn)}
                          <p className={`text-xs mt-1 ${
                            msg.isOwn 
                              ? 'text-primary-foreground/70' 
                              : 'text-muted-foreground'
                          }`}>
                            {formatTime(msg.created_at)}
                          </p>
                        </div>
                        {!msg.isOwn && (() => {
                          const hasLashed = lashedEventIds.has(msg.id);
                          const lashCount = lashCounts.get(msg.id) || 0;
                          const lashers = messageLashers.get(msg.id) || [];

                          return (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 h-7 w-7 md:h-8 md:w-8"
                                onClick={() => setReplyingTo(msg)}
                                title="Reply to message"
                              >
                                <Reply className="h-4 w-4" />
                              </Button>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={`opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 h-7 w-7 md:h-8 md:w-8 ${hasLashed ? 'opacity-100' : ''}`}
                                    onClick={(e) => {
                                      if (!hasLashed) {
                                        e.preventDefault();
                                        handleGiveLash(msg.id, msg.pubkey);
                                      }
                                    }}
                                    disabled={isSendingLash}
                                  >
                                    <Heart className={`h-4 w-4 ${hasLashed ? 'fill-red-500 text-red-500' : 'text-primary hover:fill-primary'}`} />
                                    {lashCount > 0 && (
                                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full h-4 w-4 flex items-center justify-center font-bold">
                                        {lashCount}
                                      </span>
                                    )}
                                  </Button>
                                </PopoverTrigger>
                                {hasLashed && lashers.length > 0 && (
                                  <PopoverContent className="w-80">
                                    <div className="space-y-3">
                                      <p className="font-semibold text-sm">LASHed by:</p>
                                      <div className="space-y-2 max-h-60 overflow-y-auto">
                                        {lashers.map((lasher) => (
                                          <div key={lasher.lashId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                                            <Avatar className="h-8 w-8">
                                              <AvatarImage src={lasher.picture ? getProxiedImageUrl(lasher.picture) : undefined} />
                                              <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-white text-xs">
                                                {lasher.name?.slice(0, 2).toUpperCase() || lasher.pubkey.slice(0, 2).toUpperCase()}
                                              </AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 min-w-0">
                                              <p className="text-sm font-medium truncate">
                                                {lasher.name || truncatePubkey(lasher.pubkey)}
                                              </p>
                                              <p className="text-xs text-muted-foreground">
                                                {formatLanoshis(lasher.amount)} LANA
                                              </p>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </PopoverContent>
                                )}
                              </Popover>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <form onSubmit={handleSendMessage} className="flex flex-col gap-2 pt-2 border-t pb-safe sticky bottom-0 bg-card px-4 md:static md:bg-transparent md:pb-0 md:px-0">
                  {/* Reply Preview */}
                  {replyingTo && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
                      <Reply className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">
                          Replying to {replyingTo.isOwn ? 'yourself' : getDisplayName(replyingTo.pubkey)}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {replyingTo.decryptedContent?.slice(0, 50) || 'Message'}...
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 flex-shrink-0"
                        onClick={() => setReplyingTo(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                  <DMImageUploader
                    recipientPubkey={displayConversation.pubkey}
                    onSendMessage={async (imageUrls) => {
                      const message = imageUrls.join('\n');
                      await sendMessage(displayConversation.pubkey, message, replyingTo?.id);
                      setReplyingTo(null);
                    }}
                  />
                  <DMAudioRecorder
                    recipientPubkey={displayConversation.pubkey}
                    onSendMessage={async (audioUrl) => {
                      await sendMessage(displayConversation.pubkey, audioUrl, replyingTo?.id);
                      setReplyingTo(null);
                    }}
                  />
                  <div className="flex gap-2 items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const audioRecorder = document.querySelector('[data-audio-recorder]') as HTMLButtonElement;
                        if (audioRecorder) audioRecorder.click();
                      }}
                      title="Record audio message"
                      className="touch-manipulation h-11 w-11 md:h-10 md:w-10"
                    >
                      <Mic className="h-5 w-5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const imageUploader = document.querySelector('[data-image-uploader]') as HTMLInputElement;
                        if (imageUploader) imageUploader.click();
                      }}
                      title="Add images"
                      className="touch-manipulation h-11 w-11 md:h-10 md:w-10"
                    >
                      <ImagePlus className="h-5 w-5" />
                    </Button>
                    <Input 
                      ref={messageInputRef}
                      placeholder="Type a message..." 
                      className="flex-1 touch-manipulation h-11 text-base md:h-10 md:text-sm"
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      disabled={isSending}
                    />
                    <Button 
                      type="submit" 
                      size="icon" 
                      disabled={!messageInput.trim() || isSending}
                      className="touch-manipulation h-11 w-11 md:h-10 md:w-10"
                    >
                      {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </>
          ) : (
            <div className="flex items-center justify-center h-[500px] text-muted-foreground">
              <div className="text-center">
                <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg">Select a conversation to start chatting</p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
