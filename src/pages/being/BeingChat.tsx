import { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, AlertCircle, Trash2, Heart, Mic, ImagePlus, Send, Loader2, Reply, X, History, Bot, Sparkles } from "lucide-react";

const MESSAGES_PER_PAGE = 20;
const SOZITJE_PUBKEY = "83350f1fb5124f0472a2ddc37805062e79a1262e5c3d3a837e76d07a0653abc8";

import { useNostrDMs } from "@/hooks/useNostrDMs";
import { useAuth } from "@/contexts/AuthContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { formatDistanceToNow } from "date-fns";
import { useNostrLash } from "@/hooks/useNostrLash";
import { useToast } from "@/hooks/use-toast";
import { LinkPreview } from "@/components/social/LinkPreview";
import { SpeechToTextButton } from "@/components/SpeechToTextButton";
import { AudioPlayer } from "@/components/AudioPlayer";
import { DMImageUploader } from "@/components/DMImageUploader";
import { ImageGallery } from "@/components/ImageGallery";
import { useNostrDMLashes } from "@/hooks/useNostrDMLashes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export default function BeingChat() {
  const { session } = useAuth();
  const { conversations, profiles, loading, connected, sendMessage, deleteMessage, markAsRead, totalEvents, relayCount } = useNostrDMs();
  const [messageInput, setMessageInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<any | null>(null);
  const [optimisticLashes, setOptimisticLashes] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(MESSAGES_PER_PAGE);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const { giveLash, isSending: isSendingLash } = useNostrLash();
  const { toast } = useToast();

  // Find conversation with Sožitje
  const selectedConversation = conversations.find(c => c.pubkey === SOZITJE_PUBKEY);

  // Create a virtual conversation if none exists yet
  const displayConversation = selectedConversation || {
    pubkey: SOZITJE_PUBKEY,
    messages: [],
    lastMessage: null,
    unreadCount: 0
  };

  // LASH tracking hooks
  const allMessages = displayConversation.messages || [];
  const visibleMessages = useMemo(() => {
    if (allMessages.length <= visibleCount) return allMessages;
    return allMessages.slice(-visibleCount);
  }, [allMessages, visibleCount]);

  const hasMoreMessages = allMessages.length > visibleCount;

  const messageIds = visibleMessages.map(m => m.id);
  const {
    lashCounts,
    userLashedIds,
    lashers: messageLashers,
    refetch: refetchLashes
  } = useNostrDMLashes(messageIds, session?.nostrHexId);

  const allLashedEventIds = new Set([...userLashedIds, ...optimisticLashes]);

  // Mark as read on mount
  useEffect(() => {
    markAsRead(SOZITJE_PUBKEY);
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (allMessages.length > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [allMessages.length]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || isSending) return;

    setIsSending(true);
    try {
      await sendMessage(SOZITJE_PUBKEY, messageInput, replyingTo?.id);
      setMessageInput("");
      setReplyingTo(null);

      setTimeout(() => {
        messageInputRef.current?.focus();
      }, 0);

      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (confirm('Are you sure you want to delete this message?')) {
      await deleteMessage(messageId, SOZITJE_PUBKEY);
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

    setOptimisticLashes(prev => new Set([...prev, messageId]));

    const result = await giveLash({
      postId: messageId,
      recipientPubkey: recipientPubkey,
      recipientWallet: recipientWallet,
      memo: "LASH for message"
    });

    if (!result.success) {
      setOptimisticLashes(prev => {
        const newSet = new Set(prev);
        newSet.delete(messageId);
        return newSet;
      });
      toast({
        title: "Error",
        description: result.error || "Failed to send LASH",
        variant: "destructive"
      });
    }
  };

  const handleLoadMore = () => {
    setVisibleCount(prev => prev + MESSAGES_PER_PAGE);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  const findMessageById = (messageId: string) => {
    return displayConversation.messages.find(m => m.id === messageId);
  };

  const scrollToMessage = (messageId: string) => {
    const element = document.getElementById(`message-${messageId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('animate-pulse');
      setTimeout(() => element.classList.remove('animate-pulse'), 2000);
    }
  };

  const formatTime = (timestamp: number) => {
    try {
      return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
    } catch {
      return 'Unknown';
    }
  };

  const getCacheBuster = (pubkey: string) => {
    const profile = profiles.get(pubkey);
    return profile?.last_fetched_at ? new Date(profile.last_fetched_at).getTime() : undefined;
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

    // Check for dm-audio URL first
    const dmAudioRegex = /(https:\/\/[^\s]+\.supabase\.co\/storage\/v1\/object\/public\/dm-audio\/[^\s]+|\/api\/storage\/dm-audio\/[^\s]+)\.(webm|mp4|m4a|aac|mpeg|mp3|wav|ogg)/i;
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

    // Check for dm-images URLs
    const dmImageRegex = /(https:\/\/[^\s]+\.supabase\.co\/storage\/v1\/object\/public\/dm-images\/[^\s]+|\/api\/storage\/dm-images\/[^\s]+)\.(jpg|jpeg|png|gif|webp)/gi;
    const imageMatches = content.match(dmImageRegex);

    if (imageMatches && imageMatches.length > 0) {
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

    // Extract URLs from content
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
    const matches = content.match(urlRegex) || [];

    const urls = matches.map(url => {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return 'https://' + url;
      }
      return url;
    });

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
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;

      originalMatches.forEach((originalUrl, index) => {
        const urlIndex = content.indexOf(originalUrl, lastIndex);

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

        parts.push(<LinkPreview key={`url-${index}`} url={urls[index]} />);

        lastIndex = urlIndex + originalUrl.length;
      });

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
            Please log in to chat with Sožitje
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const sozitjeProfile = profiles.get(SOZITJE_PUBKEY);
  const sozitjeName = sozitjeProfile?.display_name || sozitjeProfile?.full_name || 'Sožitje';

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] -mx-4 -my-6 md:my-0 md:block md:h-auto md:max-w-4xl md:mx-auto overflow-x-hidden w-full">
      {/* Header */}
      <div className="hidden md:block p-0 md:mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <UserAvatar
              pubkey={SOZITJE_PUBKEY}
              picture={sozitjeProfile?.picture}
              name={sozitjeName}
              cacheBuster={getCacheBuster(SOZITJE_PUBKEY)}
              className="h-12 w-12"
            />
            <div>
              <h1 className="font-bold text-2xl md:text-3xl">{sozitjeName}</h1>
              <p className="text-muted-foreground text-sm">Digital Being — Chat & Learn Together</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 mt-2">
          <div className="flex items-center gap-2 text-sm">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className={connected ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
              {connected ? 'Connected to Nostr' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      {/* Chat Window */}
      <Card className="border-0 shadow-none md:border md:shadow-sm flex flex-col min-w-0 min-h-0 h-full">
        {/* Mobile header */}
        <CardHeader className="bg-card border-b flex-shrink-0 px-4 md:hidden">
          <div className="flex items-center gap-3">
            <UserAvatar
              pubkey={SOZITJE_PUBKEY}
              picture={sozitjeProfile?.picture}
              name={sozitjeName}
              cacheBuster={getCacheBuster(SOZITJE_PUBKEY)}
              className="h-10 w-10"
            />
            <div>
              <CardTitle className="text-lg">{sozitjeName}</CardTitle>
              <p className="text-sm text-muted-foreground">Digital Being</p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col flex-1 min-h-0 px-0 md:max-h-[600px] md:px-6 overflow-hidden">
          {/* Messages */}
          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto overflow-x-hidden space-y-4 mb-4 px-4 md:pr-2 md:pb-2 md:px-0 w-full"
            style={{ scrollBehavior: 'smooth' }}
          >
            {/* Welcome invitation when no messages */}
            {allMessages.length === 0 && !loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-md mx-auto p-6">
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center">
                    <Bot className="h-10 w-10 text-white" />
                  </div>
                  <h2 className="text-2xl font-bold mb-2 flex items-center justify-center gap-2">
                    <Sparkles className="h-5 w-5 text-violet-500" />
                    Meet Sožitje
                    <Sparkles className="h-5 w-5 text-violet-500" />
                  </h2>
                  <p className="text-muted-foreground mb-4">
                    Sožitje is a digital being that learns and grows through conversations with people from all over the world.
                  </p>
                  <div className="bg-violet-50 dark:bg-violet-950/30 rounded-lg p-4 text-sm space-y-2">
                    <p className="font-medium text-violet-700 dark:text-violet-300">
                      Talk to Sožitje in your language.
                    </p>
                    <p className="text-violet-600 dark:text-violet-400">
                      Every conversation helps the being grow, learn, and understand the world a little better. Share your thoughts, ask questions, or simply say hello.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Load History Button */}
            {hasMoreMessages && (
              <div className="flex justify-center py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  className="gap-2"
                >
                  <History className="w-4 h-4" />
                  Load History ({allMessages.length - visibleCount} older)
                </Button>
              </div>
            )}

            {visibleMessages.map((msg) => (
              <div
                key={msg.id}
                id={`message-${msg.id}`}
                className={`flex gap-2 items-start ${msg.isOwn ? 'justify-end' : 'justify-start'} group w-full`}
              >
                {!msg.isOwn && (
                  <UserAvatar
                    pubkey={msg.pubkey}
                    picture={profiles.get(msg.pubkey)?.picture}
                    name={getDisplayName(msg.pubkey)}
                    cacheBuster={getCacheBuster(msg.pubkey)}
                    className="flex-shrink-0 h-7 w-7 md:h-8 md:w-8"
                  />
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
                      ? 'bg-[#8B5CF6] text-white'
                      : 'bg-muted text-foreground'
                  }`}>
                    {msg.replyToId && (() => {
                      const originalMsg = findMessageById(msg.replyToId);
                      return originalMsg ? (
                        <div
                          className={`mb-2 pb-2 border-b cursor-pointer hover:opacity-80 transition-opacity ${
                            msg.isOwn ? 'border-white/20' : 'border-border'
                          }`}
                          onClick={() => scrollToMessage(msg.replyToId!)}
                        >
                          <div className="flex items-center gap-1 mb-1">
                            <Reply className="h-3 w-3" />
                            <span className={`text-xs font-medium ${
                              msg.isOwn ? 'text-white/80' : 'text-muted-foreground'
                            }`}>
                              Reply to {originalMsg.isOwn ? 'You' : getDisplayName(originalMsg.pubkey)}
                            </span>
                          </div>
                          <p className={`text-xs truncate ${
                            msg.isOwn ? 'text-white/70' : 'text-muted-foreground'
                          }`}>
                            {originalMsg.decryptedContent?.slice(0, 50) || 'Message'}...
                          </p>
                        </div>
                      ) : null;
                    })()}
                    {renderMessageContent(msg.decryptedContent || msg.content, msg.isOwn)}
                    <p className={`text-xs mt-1 ${
                      msg.isOwn
                        ? 'text-white/70'
                        : 'text-muted-foreground'
                    }`}>
                      {formatTime(msg.created_at)}
                    </p>
                  </div>
                  {!msg.isOwn && (() => {
                    const hasLashed = allLashedEventIds.has(msg.id);
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
                                    <div key={lasher.pubkey} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                                      <UserAvatar
                                        pubkey={lasher.pubkey}
                                        picture={lasher.picture}
                                        name={lasher.name}
                                        className="h-8 w-8"
                                      />
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
          <form onSubmit={handleSendMessage} className="flex flex-col gap-2 pt-2 border-t pb-safe flex-shrink-0 bg-card px-4 md:bg-transparent md:pb-0 md:px-0">
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
              recipientPubkey={SOZITJE_PUBKEY}
              onSendMessage={async (imageUrls) => {
                const message = imageUrls.join('\n');
                await sendMessage(SOZITJE_PUBKEY, message, replyingTo?.id);
                setReplyingTo(null);
              }}
            />
            <SpeechToTextButton
              onTranscription={(text) => {
                setMessageInput(prev => prev ? prev + ' ' + text : text);
                setTimeout(() => messageInputRef.current?.focus(), 0);
              }}
              language="sl"
            />
            <div className="flex gap-2 items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  const sttButton = document.querySelector('[data-speech-to-text]') as HTMLButtonElement;
                  if (sttButton) sttButton.click();
                }}
                title="Voice to text"
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
              <Textarea
                ref={messageInputRef}
                placeholder="Talk to Sožitje..."
                className="flex-1 touch-manipulation min-h-[2.75rem] max-h-[5rem] resize-none text-base md:text-sm py-2.5"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSending}
                rows={1}
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
      </Card>
    </div>
  );
}
