import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Bot, Send, User, Loader2, RefreshCw, Sparkles, ExternalLink, Coins, Mic, MicOff, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface MessagePart {
  type: 'text' | 'image' | 'link';
  content: string;
  alt?: string;
  url?: string;
}

const parseMessageContent = (content: string): MessagePart[] => {
  const parts: MessagePart[] = [];
  const combinedRegex = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = combinedRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) parts.push({ type: 'text', content: text });
    }
    
    if (match[1] !== undefined || match[2] !== undefined) {
      parts.push({ type: 'image', content: match[2], alt: match[1] });
    } else {
      parts.push({ type: 'link', content: match[3], url: match[4] });
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) parts.push({ type: 'text', content: text });
  }
  
  return parts.length > 0 ? parts : [{ type: 'text', content }];
};

// Triad response interface
interface TriadResponse {
  type: 'triad';
  final_answer: string;
  confidence: number;
  what_i_did: string[];
  what_i_did_not_do: string[];
  next_step: string;
  _debug?: {
    builder: {
      answer_preview: string;
      assumptions: string[];
      risks: string[];
      questions: string[];
    };
    skeptic: {
      claims_to_verify: string[];
      failure_modes: string[];
      missing_info: string[];
    };
  };
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  triadData?: TriadResponse;
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

// Confidence badge component
function ConfidenceBadge({ confidence }: { confidence: number }) {
  const variant = confidence >= 80 ? 'default' : confidence >= 50 ? 'secondary' : 'destructive';
  const icon = confidence >= 80 ? <CheckCircle2 className="h-3 w-3" /> : confidence >= 50 ? <HelpCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />;
  
  return (
    <Badge variant={variant} className="flex items-center gap-1 text-[10px]">
      {icon}
      <span>{confidence}%</span>
    </Badge>
  );
}

// Triad debug panel component
function TriadDebugPanel({ triadData, language }: { triadData: TriadResponse; language: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const isSl = language === 'sl';

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-3 border-t pt-2">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-muted-foreground h-7">
          <span>{isSl ? '🔍 Pokaži razmišljanje AI' : '🔍 Show AI reasoning'}</span>
          {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        {/* What I did / didn't do */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-green-500/10 rounded p-2">
            <div className="font-medium text-green-600 mb-1">✅ {isSl ? 'Kaj sem naredil' : 'What I did'}</div>
            <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
              {triadData.what_i_did.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="bg-orange-500/10 rounded p-2">
            <div className="font-medium text-orange-600 mb-1">⚠️ {isSl ? 'Česar nisem naredil' : 'What I didn\'t do'}</div>
            <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
              {triadData.what_i_did_not_do.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Next step */}
        {triadData.next_step && (
          <div className="bg-blue-500/10 rounded p-2 text-xs">
            <div className="font-medium text-blue-600 mb-1">💡 {isSl ? 'Naslednji korak' : 'Next step'}</div>
            <p className="text-muted-foreground">{triadData.next_step}</p>
          </div>
        )}

        {/* Debug info from Builder & Skeptic */}
        {triadData._debug && (
          <div className="space-y-2 border-t pt-2">
            <div className="text-[10px] text-muted-foreground font-medium uppercase">{isSl ? 'Notranji proces' : 'Internal Process'}</div>
            
            {triadData._debug.builder.risks.length > 0 && (
              <div className="text-xs">
                <span className="text-yellow-600">⚡ {isSl ? 'Tveganja' : 'Risks'}:</span>
                <span className="text-muted-foreground ml-1">{triadData._debug.builder.risks.join(', ')}</span>
              </div>
            )}
            
            {triadData._debug.skeptic.claims_to_verify.length > 0 && (
              <div className="text-xs">
                <span className="text-red-600">🔍 {isSl ? 'Za preveriti' : 'To verify'}:</span>
                <span className="text-muted-foreground ml-1">{triadData._debug.skeptic.claims_to_verify.join(', ')}</span>
              </div>
            )}
            
            {triadData._debug.builder.questions.length > 0 && (
              <div className="text-xs">
                <span className="text-purple-600">❓ {isSl ? 'Vprašanja' : 'Questions'}:</span>
                <span className="text-muted-foreground ml-1">{triadData._debug.builder.questions.join(', ')}</span>
              </div>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
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
  const { eventsContext, isLoading: eventsLoading, fetchStatus: eventsFetchStatus } = useAiAdvisorEvents();
  const { totalLana: aiUsageLana, isLoading: usageLoading } = useAiUsageThisMonth();
  const { parameters } = useSystemParameters();
  const { profile } = useNostrProfile();
  const { session } = useAuth();
  
  const nostrHexId = session?.nostrHexId || '';
  const userLanguage = profile?.lang || 'en';
  const trans = getTranslation(userLanguage);
  
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<SelectedRecipient | null>(null);
  const [showRecipientSelector, setShowRecipientSelector] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  const isSpeechSupported = typeof window !== 'undefined' && 
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const getSpeechLanguage = useCallback((lang: string) => {
    const langMap: Record<string, string> = {
      'sl': 'sl-SI', 'en': 'en-US', 'de': 'de-DE', 'hr': 'hr-HR',
      'hu': 'hu-HU', 'it': 'it-IT', 'es': 'es-ES', 'pt': 'pt-PT',
    };
    return langMap[lang] || 'en-US';
  }, []);

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
    
    recognition.onstart = () => { setIsListening(true); };
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
      }
      if (finalTranscript) setInput(prev => prev + finalTranscript);
    };
    recognition.onerror = (event: any) => {
      setIsListening(false);
      if (event.error === 'not-allowed') {
        toast.error(userLanguage === 'sl' ? 'Dostop do mikrofona ni dovoljen' : 'Microphone access denied');
      }
    };
    recognition.onend = () => { setIsListening(false); };
    
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
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  useEffect(() => {
    return () => { if (recognitionRef.current) recognitionRef.current.stop(); };
  }, []);

  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }, [messages]);

  const parsePaymentIntent = (content: string): PaymentIntent | null => {
    try {
      const jsonMatch = content.match(/\{[^}]*"action"\s*:\s*"payment"[^}]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.action === 'payment' && parsed.recipient && parsed.amount) {
          return { recipient: parsed.recipient, amount: parsed.amount, currency: parsed.currency || 'LANA', sourceWallet: parsed.sourceWallet || 'Main Wallet' };
        }
      }
    } catch { /* Not a payment intent */ }
    return null;
  };

  const parseTriadResponse = (content: string): TriadResponse | null => {
    try {
      // Try to parse directly
      let parsed = JSON.parse(content);
      if (parsed.type === 'triad' && parsed.final_answer) {
        console.log('✅ Triad parsed successfully, confidence:', parsed.confidence);
        return parsed as TriadResponse;
      }
    } catch (e) {
      // Try to extract JSON from content if wrapped in other text
      try {
        const jsonMatch = content.match(/\{[\s\S]*"type"\s*:\s*"triad"[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.type === 'triad' && parsed.final_answer) {
            console.log('✅ Triad extracted and parsed, confidence:', parsed.confidence);
            return parsed as TriadResponse;
          }
        }
      } catch { /* Still not valid */ }
    }
    return null;
  };

  const sendMessage = async (overrideInput?: string) => {
    const messageContent = overrideInput || input.trim();
    if (!messageContent || isLoading) return;

    const userMessage: Message = { role: 'user', content: messageContent };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);
    setProgressMessage(null);

    try {
      const userProjectsContext = context.userProjects ? {
        projectCount: context.userProjects.projectCount,
        totalRaised: context.userProjects.totalRaised,
        totalGoal: context.userProjects.totalGoal,
        overallPercentFunded: context.userProjects.overallPercentFunded,
        totalDonations: context.userProjects.totalDonations,
        fullyFundedCount: context.userProjects.fullyFundedCount,
        activeCount: context.userProjects.activeCount,
        draftCount: context.userProjects.draftCount,
        myProjects: context.userProjects.projects.map(p => ({
          ...p,
          donations: context.userProjects?.getProjectDonations(p.id) || [],
        })),
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
            userProfile: context.userProfile,
            wallets: context.wallets,
            lana8Wonder: context.lana8Wonder,
            unconditionalPayments: context.unconditionalPayments,
            unpaidLashes: context.unpaidLashes,
            userProjects: userProjectsContext,
            events: eventsContext,
            recentChats: context.recentChats,
            connectionState: context.connectionState,
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
      let assistantContent = '';

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
            
            // Check for progress message
            if (parsed.progress) {
              setProgressMessage(parsed.progress);
              console.log('📊 Progress:', parsed.progress);
              continue; // Don't process as content
            }
            
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantContent += content;
              
              // Try to parse as triad response
              const triadData = parseTriadResponse(assistantContent);
              
              setMessages(prev => {
                const newMessages = [...prev];
                const lastIndex = newMessages.length - 1;
                if (newMessages[lastIndex]?.role === 'assistant') {
                  if (triadData) {
                    // ✅ Use ONLY the final_answer as display content
                    newMessages[lastIndex] = { 
                      role: 'assistant', 
                      content: triadData.final_answer,
                      triadData 
                    };
                    console.log('📝 Set message to final_answer:', triadData.final_answer.substring(0, 100));
                    setProgressMessage(null); // Clear progress when done
                  } else {
                    // Only show raw content if NOT a triad response (fallback for non-triad)
                    // But don't show raw JSON - check if it looks like triad JSON
                    const looksLikeTriadJson = assistantContent.includes('"type":"triad"') || assistantContent.includes('"final_answer"');
                    if (looksLikeTriadJson) {
                      // Still parsing, show loading indicator
                      newMessages[lastIndex] = { role: 'assistant', content: '' };
                    } else {
                      newMessages[lastIndex] = { role: 'assistant', content: assistantContent };
                    }
                  }
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

      // Check for payment intent in final answer
      const finalMessage = messages[messages.length - 1];
      if (finalMessage?.triadData?.final_answer) {
        const intent = parsePaymentIntent(finalMessage.triadData.final_answer);
        if (intent) {
          setPaymentIntent(intent);
          setShowRecipientSelector(true);
        }
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
      setMessages(prev => [...prev, { role: 'assistant', content: `${t('txSuccess', userLanguage)}\n\n${t('txHash', userLanguage)}: ${txHash}` }]);
    } else if (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: t('txError', userLanguage, { error }) }]);
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
    const wallet = context.wallets.details.find(w => w.walletType === paymentIntent.sourceWallet || w.walletType === 'Main Wallet');
    return wallet || context.wallets.details.find(w => w.walletType === 'Wallet');
  };

  const sourceWallet = getSourceWallet();

  const getLanaAmount = () => {
    if (!paymentIntent) return 0;
    if (paymentIntent.currency === 'LANA') return paymentIntent.amount;
    const rate = parameters?.exchangeRates?.[paymentIntent.currency as 'EUR' | 'USD' | 'GBP'] || 0;
    return rate > 0 ? paymentIntent.amount / rate : 0;
  };

  const suggestedQuestions = useMemo(() => {
    const baseQuestions = [trans.showBalances, trans.totalBalance];
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
        <RecipientSelector searchQuery={paymentIntent.recipient} language={userLanguage} onSelect={handleRecipientSelect} onCancel={handlePaymentCancel} />
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
                
                <div className="flex flex-col sm:flex-row flex-wrap gap-2 justify-center mb-3 sm:mb-4 w-full max-w-lg">
                  <Button variant="default" size="sm" onClick={() => sendMessage(userLanguage === 'sl' ? 'Kaj je novega pri meni?' : 'What\'s new with me?')} className="text-xs sm:text-sm w-full sm:w-auto">
                    {userLanguage === 'sl' ? '🔔 Kaj je novega pri meni?' : '🔔 What\'s new with me?'}
                  </Button>
                  <Button variant="default" size="sm" onClick={() => sendMessage(userLanguage === 'sl' ? 'Kaj je novega v Lana Svetu?' : 'What\'s new in Lana World?')} className="text-xs sm:text-sm w-full sm:w-auto">
                    {userLanguage === 'sl' ? '🌍 Kaj je novega v Lana Svetu?' : '🌍 What\'s new in Lana World?'}
                  </Button>
                </div>
                
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
                          {/* Confidence badge for triad responses */}
                          {message.triadData && (
                            <div className="flex items-center justify-between mb-2">
                              <ConfidenceBadge confidence={message.triadData.confidence} />
                            </div>
                          )}
                          
                          {/* Message content */}
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
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                              <span className="text-xs text-muted-foreground animate-pulse">
                                {progressMessage || (userLanguage === 'sl' ? '🔨 Uporabljam triadno razmišljanje...' : '🔨 Using triad thinking...')}
                              </span>
                            </div>
                          )}
                          
                          {/* Triad debug panel */}
                          {message.triadData && message.content && (
                            <TriadDebugPanel triadData={message.triadData} language={userLanguage} />
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
                placeholder={isListening ? (userLanguage === 'sl' ? '🎤 Govori...' : '🎤 Listening...') : trans.askPlaceholder}
                className={cn("resize-none min-h-[40px] sm:min-h-[44px] max-h-24 sm:max-h-32 text-sm", isListening && "border-primary ring-2 ring-primary/20")}
                rows={1}
                disabled={isLoading}
              />
              {isSpeechSupported && (
                <Button 
                  onClick={toggleListening}
                  disabled={isLoading}
                  variant={isListening ? "destructive" : "outline"}
                  size="icon" 
                  className={cn("flex-shrink-0 h-10 w-10 sm:h-11 sm:w-11 transition-all", isListening && "animate-pulse")}
                  title={isListening ? (userLanguage === 'sl' ? 'Ustavi snemanje' : 'Stop recording') : (userLanguage === 'sl' ? 'Začni snemanje' : 'Start recording')}
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
