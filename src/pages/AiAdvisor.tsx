import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Bot, Send, User, Loader2, RefreshCw, Sparkles, ExternalLink, Coins, Mic, MicOff } from 'lucide-react';
import { useAiAdvisorContext } from '@/hooks/useAiAdvisorContext';
import { useAiAdvisorEvents } from '@/hooks/useAiAdvisorEvents';
import { useAiUsageThisMonth } from '@/hooks/useAiUsageThisMonth';
import { RecipientSelector } from '@/components/ai-advisor/RecipientSelector';
import { PaymentForm } from '@/components/ai-advisor/PaymentForm';
import { useNostrProfile } from '@/hooks/useNostrProfile';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { t, getTranslation } from '@/lib/aiAdvisorTranslations';
import { getExchangeRates } from '@/lib/currencyConversion';
import { getProxiedImageUrl } from '@/lib/imageProxy';
import { toast } from 'sonner';

interface MessagePart {
  type: 'text' | 'image' | 'link';
  content: string;
  alt?: string;
  url?: string;
}

const parseMessageContent = (content: string): MessagePart[] => {
  const parts: MessagePart[] = [];
  // Match markdown images ![alt](url) and markdown links [text](url)
  const combinedRegex = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = combinedRegex.exec(content)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) {
        parts.push({ type: 'text', content: text });
      }
    }
    
    if (match[1] !== undefined || match[2] !== undefined) {
      // Image: ![alt](url)
      parts.push({
        type: 'image',
        content: match[2],
        alt: match[1]
      });
    } else {
      // Link: [text](url)
      parts.push({
        type: 'link',
        content: match[3],
        url: match[4]
      });
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) {
      parts.push({ type: 'text', content: text });
    }
  }
  
  return parts.length > 0 ? parts : [{ type: 'text', content }];
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface PaymentIntent {
  recipient: string;
  amount: number;
  currency: string;
  sourceWallet: string;
}

interface SelectedRecipient {
  name: string;
  pubkey: string;
  walletId: string;
  walletType: string;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-advisor`;

// Web Speech API types
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

export default function AiAdvisor() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  
  const context = useAiAdvisorContext();
  const { eventsContext, isLoading: eventsLoading } = useAiAdvisorEvents();
  const { totalLana: aiUsageLana, isLoading: usageLoading } = useAiUsageThisMonth();
  const { parameters } = useSystemParameters();
  const { profile } = useNostrProfile();
  const { session } = useAuth();
  
  // Get user's nostr_hex_id and language from profile
  const nostrHexId = session?.nostrHexId || '';
  const userLanguage = profile?.lang || 'en';
  const trans = getTranslation(userLanguage);
  
  // Payment flow state
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<SelectedRecipient | null>(null);
  const [showRecipientSelector, setShowRecipientSelector] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  // Check for Web Speech API support
  const isSpeechSupported = typeof window !== 'undefined' && 
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  // Map user language to speech recognition language
  const getSpeechLanguage = useCallback((lang: string) => {
    const langMap: Record<string, string> = {
      'sl': 'sl-SI',
      'en': 'en-US',
      'de': 'de-DE',
      'hr': 'hr-HR',
      'hu': 'hu-HU',
      'it': 'it-IT',
      'es': 'es-ES',
      'pt': 'pt-PT',
    };
    return langMap[lang] || 'en-US';
  }, []);

  // Initialize speech recognition
  const startListening = useCallback(() => {
    if (!isSpeechSupported) {
      toast.error(userLanguage === 'sl' ? 'Glasovno prepoznavanje ni podprto v tem brskalniku' : 'Speech recognition not supported in this browser');
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = getSpeechLanguage(userLanguage);
    
    recognition.onstart = () => {
      setIsListening(true);
      console.log('🎤 Speech recognition started');
    };
    
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      let interimTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      
      if (finalTranscript) {
        setInput(prev => prev + finalTranscript);
      }
    };
    
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      if (event.error === 'not-allowed') {
        toast.error(userLanguage === 'sl' ? 'Dostop do mikrofona ni dovoljen' : 'Microphone access denied');
      }
    };
    
    recognition.onend = () => {
      setIsListening(false);
      console.log('🎤 Speech recognition ended');
    };
    
    recognitionRef.current = recognition;
    recognition.start();
  }, [isSpeechSupported, userLanguage, getSpeechLanguage]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const parsePaymentIntent = (content: string): PaymentIntent | null => {
    try {
      const jsonMatch = content.match(/\{[^}]*"action"\s*:\s*"payment"[^}]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.action === 'payment' && parsed.recipient && parsed.amount) {
          return {
            recipient: parsed.recipient,
            amount: parsed.amount,
            currency: parsed.currency || 'LANA',
            sourceWallet: parsed.sourceWallet || 'Main Wallet',
          };
        }
      }
    } catch (e) {
      // Not a payment intent
    }
    return null;
  };

  const sendMessage = async (overrideInput?: string) => {
    const messageContent = overrideInput || input.trim();
    if (!messageContent || isLoading) return;

    // Debug log: check what unconditional payments data we're sending
    console.log(`🔍 AI Advisor sendMessage: nostrHexId=${nostrHexId?.substring(0, 16)}..., unconditionalPayments.pendingCount=${context.unconditionalPayments?.pendingCount ?? 'N/A'}, pendingPayments.length=${context.unconditionalPayments?.pendingPayments?.length ?? 'N/A'}, context.isLoading=${context.isLoading}`);
    console.log(`💬 recentChats: totalChats=${context.recentChats?.totalChats ?? 'N/A'}, totalUnread=${context.recentChats?.totalUnread ?? 'N/A'}, hasNewMessages=${context.recentChats?.hasNewMessages ?? 'N/A'}`);

    const userMessage: Message = { role: 'user', content: messageContent };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    let assistantContent = '';

    try {
      // Prepare userProjects context with serializable data
      const userProjectsContext = context.userProjects ? {
        projectCount: context.userProjects.projectCount,
        totalRaised: context.userProjects.totalRaised,
        totalGoal: context.userProjects.totalGoal,
        overallPercentFunded: context.userProjects.overallPercentFunded,
        totalDonations: context.userProjects.totalDonations,
        fullyFundedCount: context.userProjects.fullyFundedCount,
        activeCount: context.userProjects.activeCount,
        draftCount: context.userProjects.draftCount,
        // User's own projects with donations
        myProjects: context.userProjects.projects.map(p => ({
          ...p,
          donations: context.userProjects?.getProjectDonations(p.id) || [],
        })),
        // ALL active projects for searching (without detailed donations to save tokens)
        allActiveProjects: context.userProjects.allActiveProjects,
        totalActiveProjectsCount: context.userProjects.allActiveProjects.length,
      } : null;

      const response = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
          context: {
            wallets: context.wallets,
            lana8Wonder: context.lana8Wonder,
            unconditionalPayments: context.unconditionalPayments,
            unpaidLashes: context.unpaidLashes,
            userProjects: userProjectsContext,
            events: eventsContext,
            recentChats: context.recentChats,
          },
          language: userLanguage,
          nostrHexId,
          usdToLanaRate: getExchangeRates()['USD'] || 270,
        }),
      });

      if (!response.ok) throw new Error('Failed to get AI response');
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';

      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantContent += content;
              setMessages(prev => {
                const newMessages = [...prev];
                const lastIndex = newMessages.length - 1;
                if (newMessages[lastIndex]?.role === 'assistant') {
                  newMessages[lastIndex] = { role: 'assistant', content: assistantContent };
                }
                return newMessages;
              });
            }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Check for payment intent
      const intent = parsePaymentIntent(assistantContent);
      if (intent) {
        setPaymentIntent(intent);
        setShowRecipientSelector(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get response');
      setMessages(prev => prev.filter((_, i) => i !== prev.length - 1 || prev[i].content !== ''));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleRecipientSelect = (recipient: SelectedRecipient) => {
    setSelectedRecipient(recipient);
    setShowRecipientSelector(false);
    setShowPaymentForm(true);
  };

  const handlePaymentComplete = (success: boolean, txHash?: string, error?: string) => {
    setShowPaymentForm(false);
    setPaymentIntent(null);
    setSelectedRecipient(null);
    
    if (success && txHash) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `${t('txSuccess', userLanguage)}\n\n${t('txHash', userLanguage)}: ${txHash}`,
      }]);
    } else if (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: t('txError', userLanguage, { error }),
      }]);
    }
  };

  const handlePaymentCancel = () => {
    setShowPaymentForm(false);
    setShowRecipientSelector(false);
    setPaymentIntent(null);
    setSelectedRecipient(null);
    setMessages(prev => [...prev, { role: 'assistant', content: t('paymentCancelled', userLanguage) }]);
  };

  const getSourceWallet = () => {
    if (!paymentIntent || !context.wallets?.details) return null;
    const wallet = context.wallets.details.find(
      w => w.walletType === paymentIntent.sourceWallet || w.walletType === 'Main Wallet'
    );
    return wallet || context.wallets.details.find(w => w.walletType === 'Wallet');
  };

  const sourceWallet = getSourceWallet();

  const getLanaAmount = () => {
    if (!paymentIntent) return 0;
    if (paymentIntent.currency === 'LANA') return paymentIntent.amount;
    const rate = parameters?.exchangeRates?.[paymentIntent.currency as 'EUR' | 'USD' | 'GBP'] || 0;
    return rate > 0 ? paymentIntent.amount / rate : 0;
  };

  // Localized suggested questions - include project questions if user has projects
  const suggestedQuestions = useMemo(() => {
    const baseQuestions = [trans.showBalances, trans.totalBalance];
    
    // Add project-related questions if user has projects
    if (context.userProjects && context.userProjects.projectCount > 0) {
      baseQuestions.push(trans.myProjects || 'Show my projects');
      baseQuestions.push(trans.projectDonations || 'Who donated to my projects?');
    } else {
      baseQuestions.push(trans.payBoris);
      baseQuestions.push(trans.sendFromMain);
    }
    
    return baseQuestions;
  }, [trans, context.userProjects]);

  if (showRecipientSelector && paymentIntent) {
    return (
      <div className="container max-w-4xl mx-auto p-4">
        <RecipientSelector
          searchQuery={paymentIntent.recipient}
          language={userLanguage}
          onSelect={handleRecipientSelect}
          onCancel={handlePaymentCancel}
        />
      </div>
    );
  }

  if (showPaymentForm && paymentIntent && selectedRecipient && sourceWallet) {
    return (
      <div className="container max-w-4xl mx-auto p-4">
        <PaymentForm
          recipientName={selectedRecipient.name}
          recipientWalletId={selectedRecipient.walletId}
          recipientWalletType={selectedRecipient.walletType}
          amount={getLanaAmount()}
          senderWalletId={sourceWallet.walletId}
          senderWalletBalance={sourceWallet.balance}
          currency={context.wallets?.currency || 'EUR'}
          language={userLanguage}
          onComplete={handlePaymentComplete}
          onCancel={handlePaymentCancel}
        />
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto px-2 sm:px-4 h-[calc(100vh-80px)] sm:h-[calc(100vh-120px)] flex flex-col">
      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="border-b flex-shrink-0 py-2 sm:py-4 px-3 sm:px-6">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="p-1.5 sm:p-2 rounded-full bg-primary/10 flex-shrink-0">
                <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base sm:text-lg truncate">{trans.aiAdvisor}</CardTitle>
                <p className="text-xs sm:text-sm text-muted-foreground truncate">{trans.askOrPay}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              {!usageLoading && aiUsageLana > 0 && (
                <Badge variant="outline" className="flex items-center gap-1 text-[10px] sm:text-xs px-1.5 sm:px-2">
                  <Coins className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                  <span className="hidden xs:inline">{aiUsageLana.toFixed(2)}</span>
                  <span className="xs:hidden">{aiUsageLana.toFixed(0)}</span>
                  <span className="hidden sm:inline">LANA</span>
                </Badge>
              )}
              {messages.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => { setMessages([]); setError(null); }} className="h-7 sm:h-8 px-2 sm:px-3">
                  <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline ml-2">{trans.newQuery}</span>
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
          <ScrollArea className="flex-1 p-2 sm:p-4" ref={scrollAreaRef}>
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-4 sm:py-8 px-2">
                <Bot className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground/50 mb-3 sm:mb-4" />
                <h3 className="font-medium mb-1 sm:mb-2 text-sm sm:text-base">{trans.howCanIHelp}</h3>
                <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6 max-w-md">
                  {trans.askOrSendPayment}
                </p>
                
                {/* Primary quick actions - most common questions */}
                <div className="flex flex-col sm:flex-row flex-wrap gap-2 justify-center mb-3 sm:mb-4 w-full max-w-lg">
                  <Button 
                    variant="default" 
                    size="sm" 
                    onClick={() => sendMessage(userLanguage === 'sl' ? 'Kaj je novega pri meni?' : 'What\'s new with me?')}
                    className="text-xs sm:text-sm w-full sm:w-auto"
                  >
                    {userLanguage === 'sl' ? '🔔 Kaj je novega pri meni?' : '🔔 What\'s new with me?'}
                  </Button>
                  <Button 
                    variant="default" 
                    size="sm" 
                    onClick={() => sendMessage(userLanguage === 'sl' ? 'Kaj je novega v Lana Svetu?' : 'What\'s new in Lana World?')}
                    className="text-xs sm:text-sm w-full sm:w-auto"
                  >
                    {userLanguage === 'sl' ? '🌍 Kaj je novega v Lana Svetu?' : '🌍 What\'s new in Lana World?'}
                  </Button>
                </div>
                
                {/* Secondary suggested questions */}
                <div className="flex flex-wrap gap-1.5 sm:gap-2 justify-center max-w-lg">
                  {suggestedQuestions.map((q, i) => (
                    <Button key={i} variant="outline" size="sm" onClick={() => { setInput(q); textareaRef.current?.focus(); }} className="text-[10px] sm:text-xs h-7 sm:h-8 px-2 sm:px-3">
                      {q}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3 sm:space-y-4">
                {messages.map((message, i) => (
                  <div key={i} className={cn("flex gap-2 sm:gap-3", message.role === 'user' ? 'justify-end' : 'justify-start')}>
                    {message.role === 'assistant' && (
                      <div className="flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Bot className="h-3 w-3 sm:h-4 sm:w-4 text-primary" />
                      </div>
                    )}
                    <div className={cn("max-w-[85%] sm:max-w-[80%] rounded-lg px-3 py-2 sm:px-4", message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                      {message.role === 'assistant' ? (
                        <div className="space-y-2">
                          {parseMessageContent(message.content).map((part, idx) => (
                            part.type === 'image' ? (
                              <img 
                                key={idx} 
                                src={getProxiedImageUrl(part.content)} 
                                alt={part.alt || 'Image'} 
                                className="rounded-lg max-w-full max-h-36 sm:max-h-48 object-cover"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                            ) : part.type === 'link' ? (
                              <a 
                                key={idx}
                                href={part.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline text-xs sm:text-sm"
                              >
                                {part.content}
                                <ExternalLink className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                              </a>
                            ) : (
                              <p key={idx} className="text-xs sm:text-sm whitespace-pre-wrap">{part.content}</p>
                            )
                          ))}
                          {message.content === '' && isLoading && (
                            <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                          )}
                        </div>
                      ) : (
                        <p className="text-xs sm:text-sm whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>
                    {message.role === 'user' && (
                      <div className="flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-primary flex items-center justify-center">
                        <User className="h-3 w-3 sm:h-4 sm:w-4 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {error && <div className="px-3 sm:px-4 py-2 bg-destructive/10 text-destructive text-xs sm:text-sm">{error}</div>}

          <div className="p-2 sm:p-4 border-t flex-shrink-0">
            <div className="flex gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isListening 
                  ? (userLanguage === 'sl' ? '🎤 Govori...' : '🎤 Listening...') 
                  : trans.askPlaceholder}
                className={cn(
                  "resize-none min-h-[40px] sm:min-h-[44px] max-h-24 sm:max-h-32 text-sm",
                  isListening && "border-primary ring-2 ring-primary/20"
                )}
                rows={1}
                disabled={isLoading}
              />
              {isSpeechSupported && (
                <Button 
                  onClick={toggleListening}
                  disabled={isLoading}
                  variant={isListening ? "destructive" : "outline"}
                  size="icon" 
                  className={cn(
                    "flex-shrink-0 h-10 w-10 sm:h-11 sm:w-11 transition-all",
                    isListening && "animate-pulse"
                  )}
                  title={isListening 
                    ? (userLanguage === 'sl' ? 'Ustavi snemanje' : 'Stop recording') 
                    : (userLanguage === 'sl' ? 'Začni snemanje' : 'Start recording')}
                >
                  {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
              )}
              <Button onClick={() => sendMessage()} disabled={!input.trim() || isLoading} size="icon" className="flex-shrink-0 h-10 w-10 sm:h-11 sm:w-11">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
