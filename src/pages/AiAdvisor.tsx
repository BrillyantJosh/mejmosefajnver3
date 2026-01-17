import { useState, useRef, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Bot, Send, User, Loader2, RefreshCw, Sparkles, ExternalLink, Coins } from 'lucide-react';
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

export default function AiAdvisor() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
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

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
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
    <div className="container max-w-4xl mx-auto p-4 h-[calc(100vh-120px)] flex flex-col">
      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/10">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">{trans.aiAdvisor}</CardTitle>
                <p className="text-sm text-muted-foreground">{trans.askOrPay}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!usageLoading && aiUsageLana > 0 && (
                <Badge variant="outline" className="flex items-center gap-1 text-xs">
                  <Coins className="h-3 w-3" />
                  {aiUsageLana.toFixed(2)} LANA
                </Badge>
              )}
              {messages.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => { setMessages([]); setError(null); }}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {trans.newQuery}
                </Button>
              )}
            </div>
          </div>
          {(context.isLoading || eventsLoading) && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              {trans.loadingData}
            </p>
          )}
        </CardHeader>

        <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
          <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-8">
                <Bot className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-medium mb-2">{trans.howCanIHelp}</h3>
                <p className="text-sm text-muted-foreground mb-6 max-w-md">
                  {trans.askOrSendPayment}
                </p>
                <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                  {suggestedQuestions.map((q, i) => (
                    <Button key={i} variant="outline" size="sm" onClick={() => { setInput(q); textareaRef.current?.focus(); }} className="text-xs">
                      {q}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message, i) => (
                  <div key={i} className={cn("flex gap-3", message.role === 'user' ? 'justify-end' : 'justify-start')}>
                    {message.role === 'assistant' && (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div className={cn("max-w-[80%] rounded-lg px-4 py-2", message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                      {message.role === 'assistant' ? (
                        <div className="space-y-2">
                          {parseMessageContent(message.content).map((part, idx) => (
                            part.type === 'image' ? (
                              <img 
                                key={idx} 
                                src={getProxiedImageUrl(part.content)} 
                                alt={part.alt || 'Image'} 
                                className="rounded-lg max-w-full max-h-48 object-cover"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                            ) : part.type === 'link' ? (
                              <a 
                                key={idx}
                                href={part.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                              >
                                {part.content}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <p key={idx} className="text-sm whitespace-pre-wrap">{part.content}</p>
                            )
                          ))}
                          {message.content === '' && isLoading && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>
                    {message.role === 'user' && (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                        <User className="h-4 w-4 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {error && <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm">{error}</div>}

          <div className="p-4 border-t flex-shrink-0">
            <div className="flex gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={trans.askPlaceholder}
                className="resize-none min-h-[44px] max-h-32"
                rows={1}
                disabled={isLoading}
              />
              <Button onClick={sendMessage} disabled={!input.trim() || isLoading} size="icon" className="flex-shrink-0 h-11 w-11">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
