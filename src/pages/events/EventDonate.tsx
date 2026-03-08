import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useNostrUnregisteredWallets } from "@/hooks/useNostrUnregisteredWallets";
import { useCoinGeckoRate } from "@/hooks/useCoinGeckoRate";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { useTranslation } from "@/i18n/I18nContext";
import eventsTranslations from "@/i18n/modules/events";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Wallet, Loader2, ExternalLink, Copy, CheckCircle, CreditCard, Building2, Coins, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { SimplePool, finalizeEvent } from "nostr-tools";
import { LanaEvent } from "@/hooks/useNostrEvents";

interface WalletBalance {
  wallet_id: string;
  balance: number;
}

type PaymentMethodTab = 'lana' | 'card' | 'bank';

const EventDonate = () => {
  const { dTag } = useParams<{ dTag: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const { toast } = useToast();
  const { parameters } = useSystemParameters();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  const { lists: unregLists, isLoading: unregLoading } = useNostrUnregisteredWallets();
  const { rate: marketRate } = useCoinGeckoRate();
  const { t } = useTranslation(eventsTranslations);

  const [event, setEvent] = useState<LanaEvent | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [walletType, setWalletType] = useState<'registered' | 'unregistered'>('registered');
  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [lanaAmount, setLanaAmount] = useState<string>("0");
  const [walletBalances, setWalletBalances] = useState<Record<string, number>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  // Payment method tab state
  const [paymentTab, setPaymentTab] = useState<PaymentMethodTab>('lana');
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Organizer pubkey — set after event is fetched
  const [organizerPubkey, setOrganizerPubkey] = useState<string | null>(null);
  const { profile: organizerProfile } = useNostrProfileCache(organizerPubkey);

  // Get pre-filled amount from location state (for "Pay" flow)
  const preFilledAmount = location.state?.preFilledLanaAmount;
  const isPay = location.state?.isPay || false;

  const decodedDTag = dTag ? decodeURIComponent(dTag) : '';

  const relays = parameters?.relays || [];

  // Filter out LanaPays.Us and Lana8Wonder wallets
  const availableWallets = wallets.filter(wallet =>
    wallet.walletType !== 'LanaPays.Us' &&
    wallet.walletType !== 'Lana8Wonder'
  );

  // Get user's unregistered wallets
  const myUnregWallets = unregLists
    .filter(l => l.ownerPubkey === session?.nostrHexId)
    .flatMap(l => l.wallets);

  // Extract payment options from organizer profile
  const paymentLink = organizerProfile?.raw_metadata?.payment_link;
  const paymentMethods = (organizerProfile?.raw_metadata?.payment_methods || [])
    .filter((m: any) => m.scope === 'collect' || m.scope === 'both');
  // Legacy bank fields
  const legacyBank = organizerProfile?.raw_metadata?.bankAccount
    ? {
        iban: organizerProfile.raw_metadata.bankAccount,
        bic: organizerProfile.raw_metadata.bankSWIFT,
        holder: organizerProfile.raw_metadata.bankName,
      }
    : null;

  const hasLana = !!event?.donationWallet || !!event?.donationWalletUnreg;
  const hasCard = !!paymentLink;
  const hasBank = paymentMethods.length > 0 || !!legacyBank;
  const isEventPaid = !!event?.fiatValue;

  // Only show card/bank tabs for paid events
  const showCardTab = isEventPaid && hasCard;
  const showBankTab = isEventPaid && hasBank;
  const availableTabs: PaymentMethodTab[] = [
    ...(hasLana ? ['lana' as const] : []),
    ...(showCardTab ? ['card' as const] : []),
    ...(showBankTab ? ['bank' as const] : []),
  ];

  const parseEvent = useCallback((rawEvent: any): LanaEvent | null => {
    try {
      const tags = rawEvent.tags || [];
      const getTagValue = (name: string): string | undefined => {
        const tag = tags.find((t: string[]) => t[0] === name);
        return tag ? tag[1] : undefined;
      };
      const getAllTagValues = (name: string): string[] => {
        return tags.filter((t: string[]) => t[0] === name).map((t: string[]) => t[1]);
      };

      const title = getTagValue('title');
      const status = getTagValue('status') as 'active' | 'archived' | 'canceled';
      const startStr = getTagValue('start');
      const eventDTag = getTagValue('d');
      const language = getTagValue('language');
      const eventType = getTagValue('event_type');
      const orgPubkey = getTagValue('p');

      if (!title || !status || !startStr || !eventDTag || !language || !eventType || !orgPubkey) {
        return null;
      }

      const start = new Date(startStr);
      if (isNaN(start.getTime())) return null;

      const endStr = getTagValue('end');
      const end = endStr ? new Date(endStr) : undefined;

      const onlineUrl = getTagValue('online');
      const isOnline = !!onlineUrl;

      const latStr = getTagValue('lat');
      const lonStr = getTagValue('lon');
      const lat = latStr ? parseFloat(latStr) : undefined;
      const lon = lonStr ? parseFloat(lonStr) : undefined;

      const capacityStr = getTagValue('capacity');
      const fiatValueStr = getTagValue('fiat_value');
      const maxGuestsStr = getTagValue('max_guests');

      return {
        id: rawEvent.id,
        pubkey: rawEvent.pubkey,
        created_at: rawEvent.created_at,
        title,
        content: rawEvent.content || '',
        status,
        start,
        end: end && !isNaN(end.getTime()) ? end : undefined,
        language,
        eventType,
        organizerPubkey: orgPubkey,
        isOnline,
        onlineUrl,
        youtubeUrl: getTagValue('youtube'),
        location: getTagValue('location'),
        lat,
        lon,
        capacity: capacityStr ? parseInt(capacityStr, 10) : undefined,
        cover: getTagValue('cover'),
        donationWallet: getTagValue('donation_wallet'),
        donationWalletUnreg: getTagValue('donation_wallet_unreg'),
        donationWalletType: (getTagValue('donation_wallet_type') as 'registered' | 'unregistered') || undefined,
        fiatValue: fiatValueStr ? parseFloat(fiatValueStr) : undefined,
        guests: getAllTagValues('guest'),
        attachments: getAllTagValues('attachment'),
        category: getTagValue('category'),
        recording: getTagValue('recording'),
        maxGuests: maxGuestsStr ? parseInt(maxGuestsStr, 10) : undefined,
        dTag: eventDTag,
      };
    } catch (err) {
      console.error('Error parsing event:', err);
      return null;
    }
  }, []);

  // Fetch event details
  useEffect(() => {
    const fetchEvent = async () => {
      if (!decodedDTag) {
        setEventLoading(false);
        return;
      }

      setEventLoading(true);

      try {
        const pool = new SimplePool();

        const rawEvents = await pool.querySync(relays, {
          kinds: [36677],
          "#d": [decodedDTag]
        });

        if (rawEvents.length > 0) {
          const latestEvent = rawEvents.reduce((latest, current) =>
            current.created_at > latest.created_at ? current : latest
          );
          const parsed = parseEvent(latestEvent);
          setEvent(parsed);

          // Set organizer pubkey for profile fetch
          if (parsed?.organizerPubkey) {
            setOrganizerPubkey(parsed.organizerPubkey);
          }

          // Determine available wallet type based on event config
          if (parsed) {
            const hasReg = !!parsed.donationWallet;
            const hasUnreg = !!parsed.donationWalletUnreg;
            // Backward compat: old events with donationWalletType
            if (!hasReg && !hasUnreg && parsed.donationWalletType === 'unregistered') {
              setWalletType('unregistered');
            } else if (hasUnreg && !hasReg) {
              setWalletType('unregistered');
            } else {
              setWalletType('registered');
            }
          }

          // Pre-fill amount will be recalculated when walletType changes
          if (parsed?.fiatValue && preFilledAmount) {
            setLanaAmount(preFilledAmount.toString());
          }

        }
      } catch (err) {
        console.error('Error fetching event:', err);
      } finally {
        setEventLoading(false);
      }
    };

    fetchEvent();
  }, [decodedDTag, relays, parseEvent, preFilledAmount]);

  // Set default payment tab when options are known
  useEffect(() => {
    if (!event) return;
    const lana = !!event.donationWallet || !!event.donationWalletUnreg;
    if (lana) {
      setPaymentTab('lana');
    } else if (isEventPaid && hasCard) {
      setPaymentTab('card');
    } else if (isEventPaid && hasBank) {
      setPaymentTab('bank');
    }
  }, [event, hasCard, hasBank, isEventPaid]);

  // Fetch wallet balances (both registered and unregistered)
  useEffect(() => {
    const regIds = availableWallets.map(w => w.walletId);
    const unregIds = myUnregWallets.map(w => w.address);
    const allIds = [...regIds, ...unregIds];
    if (allIds.length > 0) {
      fetchWalletBalances(allIds);
    }
  }, [availableWallets.length, myUnregWallets.length]);

  const fetchWalletBalances = async (walletIds: string[]) => {
    setLoadingBalances(true);
    try {
      const electrumServers = parameters?.electrumServers || [];

      if (electrumServers.length === 0) {
        console.error('No Electrum servers available');
        toast({
          title: "Error",
          description: "No Electrum servers configured",
          variant: "destructive"
        });
        return;
      }

      const { data, error } = await supabase.functions.invoke('get-wallet-balances', {
        body: {
          wallet_addresses: walletIds,
          electrum_servers: electrumServers
        }
      });

      if (error) throw error;

      if (data?.wallets) {
        const balancesMap: Record<string, number> = {};
        data.wallets.forEach((w: WalletBalance) => {
          balancesMap[w.wallet_id] = w.balance;
        });
        setWalletBalances(balancesMap);
      }
    } catch (error) {
      console.error('Error fetching wallet balances:', error);
      toast({
        title: "Error",
        description: "Failed to fetch wallet balances",
        variant: "destructive"
      });
    } finally {
      setLoadingBalances(false);
    }
  };

  const formatBalance = (balance: number): string => {
    return balance.toFixed(2);
  };

  // Recalculate pre-filled amount when wallet type changes
  useEffect(() => {
    if (!isPay || !event?.fiatValue) return;
    const rate = walletType === 'unregistered' ? marketRate : (parameters?.exchangeRates?.EUR || null);
    if (rate && rate > 0) {
      setLanaAmount((event.fiatValue / rate).toFixed(2));
    }
  }, [walletType, event?.fiatValue, marketRate, parameters?.exchangeRates?.EUR, isPay]);

  // Get the active exchange rate based on wallet type
  const activeRate = walletType === 'unregistered' ? marketRate : (parameters?.exchangeRates?.EUR || null);

  // Calculate fiat amount from LANA using exchange rate
  const calculateFiatAmount = (): number => {
    const lana = parseFloat(lanaAmount) || 0;
    if (lana === 0) return 0;

    if (!activeRate || activeRate === 0) return 0;

    // LANA * exchangeRate = EUR (rate is EUR per LANA)
    return lana * activeRate;
  };

  const fiatAmount = calculateFiatAmount();
  const parsedLanaAmount = parseFloat(lanaAmount) || 0;
  const selectedWalletBalance = selectedWalletId && walletBalances[selectedWalletId]
    ? walletBalances[selectedWalletId]
    : 0;

  const hasSufficientBalance = parsedLanaAmount > 0 && selectedWalletBalance >= parsedLanaAmount;
  // Determine the destination wallet based on wallet type
  const destinationWallet = walletType === 'unregistered' ? event?.donationWalletUnreg : event?.donationWallet;
  const canProceed = selectedWalletId && lanaAmount && parsedLanaAmount > 0 && hasSufficientBalance && !loadingBalances && destinationWallet;

  const [isCheckingRegistration, setIsCheckingRegistration] = useState(false);

  const handleContinue = async () => {
    if (!selectedWalletId || !lanaAmount || !event) {
      toast({
        title: "Missing information",
        description: "Please select a wallet and enter an amount",
        variant: "destructive"
      });
      return;
    }

    // Verify destination wallet registration status matches wallet type
    if (destinationWallet) {
      setIsCheckingRegistration(true);
      try {
        const API_URL = import.meta.env.VITE_API_URL ?? '';
        const res = await fetch(`${API_URL}/api/functions/check-wallet-registration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet_id: destinationWallet }),
        });

        const data = await res.json();

        if (data.success !== false && data.registered !== undefined) {
          if (walletType === 'unregistered' && data.registered === true) {
            toast({
              title: "Invalid destination",
              description: "Cannot send unregistered LANA to a registered wallet. The event's unregistered donation wallet is actually registered.",
              variant: "destructive"
            });
            setIsCheckingRegistration(false);
            return;
          }
          if (walletType === 'registered' && data.registered === false) {
            toast({
              title: "Invalid destination",
              description: "Cannot send registered LANA to an unregistered wallet. The event's donation wallet is not registered.",
              variant: "destructive"
            });
            setIsCheckingRegistration(false);
            return;
          }
        }
      } catch (err) {
        console.warn('Wallet registration check error (proceeding anyway):', err);
      } finally {
        setIsCheckingRegistration(false);
      }
    }

    // Navigate to private key entry page
    navigate(`/events/donate-private-key/${encodeURIComponent(decodedDTag)}`, {
      state: {
        selectedWalletId,
        lanaAmount: parsedLanaAmount,
        fiatAmount: fiatAmount.toFixed(2),
        eventTitle: event.title,
        donationWallet: destinationWallet,
        isPay,
        walletType
      }
    });
  };

  // Copy to clipboard helper
  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      toast({ title: t('donate.copied') });
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  // Auto-register "going" on Nostr (for card/bank confirmations)
  const autoRegisterGoing = async (eventDTag: string) => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      console.log('⚠️ No Nostr session, skipping auto-register going');
      return;
    }

    try {
      const pool = new SimplePool();
      const privKeyBytes = new Uint8Array(
        session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );

      const tags: string[][] = [
        ["event", eventDTag],
        ["status", "going"],
        ["p", session.nostrHexId],
        ["seats", "1"],
        ["source", "Lana.app"]
      ];

      const registrationEvent = finalizeEvent({
        kind: 53333,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: "",
      }, privKeyBytes);

      console.log('📝 Auto-registering "going" after card/bank payment:', registrationEvent.id);

      const publishPromises = pool.publish(relays, registrationEvent);
      const publishArray = Array.from(publishPromises);
      let successCount = 0;

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.log(`⏱️ Auto-register timeout. Success: ${successCount}`);
          resolve();
        }, 10000);

        publishArray.forEach((promise) => {
          promise
            .then(() => {
              successCount++;
              if (successCount === 1) {
                clearTimeout(timeout);
                resolve();
              }
            })
            .catch(() => {});
        });
      });

      console.log(`✅ Auto-registered "going" to ${successCount}/${relays.length} relay(s)`);
    } catch (error) {
      console.error('❌ Error auto-registering going:', error);
    }
  };

  // Handle card/bank payment confirmation
  const handleConfirmPayment = async (type: 'card' | 'bank') => {
    if (!event || !session?.nostrHexId || !decodedDTag) return;

    setConfirmLoading(true);

    try {
      const txId = `${type}-${Date.now()}`;

      // Save ticket to event_tickets
      const { data, error } = await supabase
        .from('event_tickets')
        .insert({
          event_dtag: decodedDTag,
          nostr_hex_id: session.nostrHexId,
          wallet_address: '',
          tx_id: txId,
          amount_lana: 0,
          amount_eur: event.fiatValue || 0,
          wallet_type: type === 'card' ? 'card' : 'bank_transfer',
        })
        .select('id')
        .single();

      if (error) {
        console.error('Error saving ticket:', error);
        toast({
          title: "Error",
          description: "Failed to save ticket. Please try again.",
          variant: "destructive"
        });
        setConfirmLoading(false);
        return;
      }

      if (data) {
        setTicketId(data.id);
        console.log('🎫 Ticket saved:', data.id);
      }

      // Auto-register "going"
      await autoRegisterGoing(decodedDTag);

      setConfirmed(true);
      toast({
        title: t('donate.successTitle'),
        description: t('donate.successDesc'),
      });
    } catch (err) {
      console.error('Error confirming payment:', err);
      toast({
        title: "Error",
        description: "Failed to confirm payment. Please try again.",
        variant: "destructive"
      });
    } finally {
      setConfirmLoading(false);
    }
  };

  // Get bank details — prefer payment_methods, fallback to legacy
  const getBankDetails = () => {
    if (paymentMethods.length > 0) {
      const pm = paymentMethods[0];
      return {
        holder: pm.fields?.account_holder || pm.label || '',
        iban: pm.fields?.iban || '',
        bic: pm.fields?.bic || '',
        scheme: pm.scheme || '',
      };
    }
    if (legacyBank) {
      return {
        holder: legacyBank.holder || '',
        iban: legacyBank.iban || '',
        bic: legacyBank.bic || '',
        scheme: 'EU.IBAN',
      };
    }
    return null;
  };

  // Loading state
  if (eventLoading || walletsLoading || unregLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="space-y-4 px-4">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('detail.back')}
        </Button>
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">{t('detail.eventNotFound')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No payment methods at all
  if (!hasLana && !showCardTab && !showBankTab) {
    return (
      <div className="space-y-4 px-4">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('detail.back')}
        </Button>
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">{t('donate.noAcceptDonations')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state (after card/bank confirmation)
  if (confirmed) {
    return (
      <div className="space-y-4 px-4 pb-24">
        <Card>
          <CardHeader className="text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <CardTitle className="text-2xl">{t('donate.successTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-muted-foreground">{event.title}</p>
            <p className="text-center text-muted-foreground">{t('donate.successDesc')}</p>
            {event.fiatValue && (
              <div className="bg-muted p-4 rounded-lg">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount:</span>
                  <span className="font-semibold">€{event.fiatValue.toFixed(2)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-2">
          {ticketId && (
            <Button
              onClick={() => navigate(`/events/ticket/${ticketId}`)}
              className="w-full"
            >
              <Ticket className="h-4 w-4 mr-2" />
              {t('donate.viewTicket')}
            </Button>
          )}
          <Button
            variant={ticketId ? "outline" : "default"}
            onClick={() => navigate(`/events/detail/${encodeURIComponent(decodedDTag)}`)}
            className="w-full"
          >
            {t('donate.backToEvent')}
          </Button>
        </div>
      </div>
    );
  }

  const selectedRegWallet = availableWallets.find(w => w.walletId === selectedWalletId);
  const selectedUnregWallet = myUnregWallets.find(w => w.address === selectedWalletId);
  const bankDetails = getBankDetails();

  return (
    <div className="space-y-4 px-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('detail.back')}
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">{isPay ? t('donate.payFor') : t('donate.donateTo')}</h1>
        <p className="text-muted-foreground mt-1">{event.title}</p>
      </div>

      {/* Payment Method Tabs — only for paid events with multiple options */}
      {availableTabs.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">{t('donate.paymentMethod')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-1">
              {availableTabs.includes('lana') && (
                <Button
                  type="button"
                  variant={paymentTab === 'lana' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPaymentTab('lana')}
                  className="flex-1"
                >
                  <Coins className="h-4 w-4 mr-1" />
                  {t('donate.lana')}
                </Button>
              )}
              {availableTabs.includes('card') && (
                <Button
                  type="button"
                  variant={paymentTab === 'card' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPaymentTab('card')}
                  className="flex-1"
                >
                  <CreditCard className="h-4 w-4 mr-1" />
                  {t('donate.creditCard')}
                </Button>
              )}
              {availableTabs.includes('bank') && (
                <Button
                  type="button"
                  variant={paymentTab === 'bank' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPaymentTab('bank')}
                  className="flex-1"
                >
                  <Building2 className="h-4 w-4 mr-1" />
                  {t('donate.bankTransfer')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════
          LANA Payment Tab (existing flow)
          ═══════════════════════════════════════════ */}
      {paymentTab === 'lana' && (
        <>
          {/* Event Wallet (TO) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('donate.eventWallet')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted p-3 rounded-md">
                <p className="font-mono text-sm break-all">{destinationWallet}</p>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Funds will be sent to this {walletType} wallet
              </p>
            </CardContent>
          </Card>

          {/* Your Wallet (FROM) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('donate.yourWallet')} *</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Wallet type toggle */}
              {(() => {
                const hasReg = !!event.donationWallet;
                const hasUnreg = !!event.donationWalletUnreg;
                const hasBoth = hasReg && hasUnreg;
                const onlyType = hasReg ? 'registered' : 'unregistered';

                if (hasBoth) {
                  return (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant={walletType === 'registered' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => { setWalletType('registered'); setSelectedWalletId(''); }}
                        className="flex-1"
                      >
                        Registered
                      </Button>
                      <Button
                        type="button"
                        variant={walletType === 'unregistered' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => { setWalletType('unregistered'); setSelectedWalletId(''); }}
                        className="flex-1"
                      >
                        Unregistered
                      </Button>
                    </div>
                  );
                }

                return (
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      <Button type="button" variant="default" size="sm" disabled className="flex-1">
                        {onlyType === 'registered' ? 'Registered' : 'Unregistered'}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This event only accepts {onlyType} wallets
                    </p>
                  </div>
                );
              })()}

              {walletType === 'registered' ? (
                !availableWallets || availableWallets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No registered wallets found. Please register a wallet first.
                  </p>
                ) : (
                  <>
                    <div>
                      <Label htmlFor="wallet-select">Select wallet</Label>
                      <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
                        <SelectTrigger id="wallet-select">
                          <SelectValue placeholder="Select registered wallet" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableWallets.map((wallet) => (
                            <SelectItem key={wallet.walletId} value={wallet.walletId}>
                              <div className="flex flex-col items-start">
                                <div className="font-mono text-xs">
                                  {wallet.walletId.substring(0, 10)}...{wallet.walletId.substring(wallet.walletId.length - 8)}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {wallet.walletType} {wallet.note && `- ${wallet.note.substring(0, 20)}`}
                                </div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {selectedRegWallet && (
                      <div className="bg-muted p-4 rounded-md space-y-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold">Wallet Details</span>
                        </div>
                        <div className="space-y-1 text-sm">
                          <p>
                            <span className="text-muted-foreground">ID:</span>{' '}
                            <span className="font-mono">
                              {selectedRegWallet.walletId.substring(0, 10)}...{selectedRegWallet.walletId.substring(selectedRegWallet.walletId.length - 8)}
                            </span>
                          </p>
                          <p>
                            <span className="text-muted-foreground">Type:</span> {selectedRegWallet.walletType}
                          </p>
                          {selectedRegWallet.note && (
                            <p>
                              <span className="text-muted-foreground">Note:</span> {selectedRegWallet.note}
                            </p>
                          )}
                          <p>
                            <span className="text-muted-foreground">Balance:</span>{' '}
                            {loadingBalances ? (
                              <Loader2 className="h-3 w-3 animate-spin inline" />
                            ) : (
                              <span className="font-semibold">
                                {walletBalances[selectedRegWallet.walletId] !== undefined
                                  ? `${formatBalance(walletBalances[selectedRegWallet.walletId])} LANA`
                                  : 'Loading...'}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )
              ) : (
                myUnregWallets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No unregistered wallets found.
                  </p>
                ) : (
                  <>
                    <div>
                      <Label htmlFor="wallet-select">Select wallet</Label>
                      <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
                        <SelectTrigger id="wallet-select">
                          <SelectValue placeholder="Select unregistered wallet" />
                        </SelectTrigger>
                        <SelectContent>
                          {myUnregWallets.map((wallet) => (
                            <SelectItem key={wallet.address} value={wallet.address}>
                              <div className="flex flex-col items-start">
                                <div className="font-mono text-xs">
                                  {wallet.address.substring(0, 10)}...{wallet.address.substring(wallet.address.length - 8)}
                                </div>
                                {wallet.note && (
                                  <div className="text-xs text-muted-foreground">
                                    {wallet.note.substring(0, 30)}
                                  </div>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {selectedUnregWallet && (
                      <div className="bg-muted p-4 rounded-md space-y-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold">Wallet Details</span>
                        </div>
                        <div className="space-y-1 text-sm">
                          <p>
                            <span className="text-muted-foreground">Address:</span>{' '}
                            <span className="font-mono">
                              {selectedUnregWallet.address.substring(0, 10)}...{selectedUnregWallet.address.substring(selectedUnregWallet.address.length - 8)}
                            </span>
                          </p>
                          {selectedUnregWallet.note && (
                            <p>
                              <span className="text-muted-foreground">Note:</span> {selectedUnregWallet.note}
                            </p>
                          )}
                          <p>
                            <span className="text-muted-foreground">Balance:</span>{' '}
                            {loadingBalances ? (
                              <Loader2 className="h-3 w-3 animate-spin inline" />
                            ) : (
                              <span className="font-semibold">
                                {walletBalances[selectedUnregWallet.address] !== undefined
                                  ? `${formatBalance(walletBalances[selectedUnregWallet.address])} LANA`
                                  : 'Loading...'}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )
              )}
            </CardContent>
          </Card>

          {/* Amount */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {isPay ? t('donate.paymentAmountLana') + ' *' : t('donate.donationAmountLana') + ' *'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Input
                  type="number"
                  value={lanaAmount}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (selectedWalletId && selectedWalletBalance > 0) {
                      const numValue = parseFloat(value) || 0;
                      if (numValue > selectedWalletBalance) {
                        setLanaAmount(selectedWalletBalance.toFixed(2));
                        return;
                      }
                    }
                    setLanaAmount(value);
                  }}
                  placeholder="0"
                  step="0.01"
                  min="0"
                  max={selectedWalletId ? selectedWalletBalance : undefined}
                  disabled={isPay}
                  className={parsedLanaAmount > 0 && selectedWalletId && !hasSufficientBalance ? 'border-destructive' : ''}
                />
                {selectedWalletId && selectedWalletBalance > 0 && !isPay && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Max available: {selectedWalletBalance.toFixed(2)} LANA
                  </p>
                )}
                {isPay && event.fiatValue && (
                  <p className="text-sm text-muted-foreground mt-2">
                    {t('donate.eventPrice', { amount: event.fiatValue.toFixed(2) })}
                  </p>
                )}
              </div>

              {/* Fiat Amount Display */}
              {parsedLanaAmount > 0 && (
                <div className="bg-muted p-4 rounded-md space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Amount in EUR:</span>
                    <span className="text-lg font-bold">
                      €{fiatAmount.toFixed(2)}
                    </span>
                  </div>
                  {activeRate && (
                    <p className="text-xs text-muted-foreground">
                      {walletType === 'unregistered' ? 'Market' : 'Registered'} rate: 1 LANA = {activeRate} EUR
                    </p>
                  )}

                  {/* Show both rates for comparison */}
                  {event.fiatValue && parameters?.exchangeRates?.EUR && marketRate && (
                    <div className="pt-2 border-t space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Registered: {(event.fiatValue / parameters.exchangeRates.EUR).toFixed(2)} LANA
                        {walletType === 'registered' && <span className="text-primary ml-1">(active)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Market: {(event.fiatValue / marketRate).toFixed(2)} LANA
                        {walletType === 'unregistered' && <span className="text-primary ml-1">(active)</span>}
                      </p>
                    </div>
                  )}

                  {/* Balance Check */}
                  {selectedWalletId && (
                    <div className="pt-2 border-t">
                      {hasSufficientBalance ? (
                        <p className="text-sm text-green-500 flex items-center gap-2">
                          ✓ Sufficient balance available
                        </p>
                      ) : (
                        <p className="text-sm text-destructive flex items-center gap-2">
                          ✗ {t('donate.insufficientBalance')} (Available: {selectedWalletBalance.toFixed(2)} LANA)
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Continue Button */}
          <Button
            onClick={handleContinue}
            disabled={!canProceed || isCheckingRegistration}
            className="w-full h-12"
          >
            {isCheckingRegistration
              ? 'Checking wallet...'
              : parsedLanaAmount > 0
                ? `${isPay ? 'Pay' : 'Donate'} ${parsedLanaAmount.toFixed(2)} LANA (€${fiatAmount.toFixed(2)})`
                : isPay ? 'Pay' : 'Donate'
            }
          </Button>

          {!selectedWalletId && (
            <p className="text-sm text-center text-muted-foreground">
              {t('donate.selectWallet')}
            </p>
          )}
          {selectedWalletId && parsedLanaAmount === 0 && (
            <p className="text-sm text-center text-muted-foreground">
              {t('donate.enterAmount')}
            </p>
          )}
          {!hasSufficientBalance && selectedWalletId && parsedLanaAmount > 0 && (
            <p className="text-sm text-center text-destructive">
              {t('donate.insufficientBalance')}
            </p>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════
          Credit Card Tab
          ═══════════════════════════════════════════ */}
      {paymentTab === 'card' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                {t('donate.creditCard')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Event price */}
              {event.fiatValue && (
                <div className="bg-muted p-4 rounded-lg">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">{t('donate.eventPrice', { amount: '' }).replace(': €', ':')}</span>
                    <span className="text-2xl font-bold">€{event.fiatValue.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Instructions */}
              <p className="text-sm text-muted-foreground">
                {t('donate.cardInstructions')}
              </p>

              {/* Payment link button */}
              <Button
                variant="outline"
                className="w-full h-12"
                onClick={() => window.open(paymentLink, '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                {t('donate.openPaymentLink')}
              </Button>
            </CardContent>
          </Card>

          {/* Confirm button */}
          <Button
            onClick={() => handleConfirmPayment('card')}
            disabled={confirmLoading}
            className="w-full h-12"
          >
            {confirmLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t('donate.registering')}
              </>
            ) : (
              t('donate.confirmPayment')
            )}
          </Button>
        </>
      )}

      {/* ═══════════════════════════════════════════
          Bank Transfer Tab
          ═══════════════════════════════════════════ */}
      {paymentTab === 'bank' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                {t('donate.bankTransfer')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Event price */}
              {event.fiatValue && (
                <div className="bg-muted p-4 rounded-lg">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">{t('donate.eventPrice', { amount: '' }).replace(': €', ':')}</span>
                    <span className="text-2xl font-bold">€{event.fiatValue.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Instructions */}
              <p className="text-sm text-muted-foreground">
                {t('donate.bankInstructions', { amount: event.fiatValue?.toFixed(2) || '0' })}
              </p>

              {/* Bank details */}
              {bankDetails && (
                <div className="bg-muted p-4 rounded-lg space-y-3">
                  {/* Account holder */}
                  {bankDetails.holder && (
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-xs text-muted-foreground">{t('donate.accountHolder')}</p>
                        <p className="font-medium">{bankDetails.holder}</p>
                      </div>
                    </div>
                  )}

                  {/* IBAN */}
                  {bankDetails.iban && (
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground">{t('donate.iban')}</p>
                        <p className="font-mono text-sm break-all">{bankDetails.iban}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(bankDetails.iban, 'iban')}
                        className="shrink-0"
                      >
                        {copiedField === 'iban' ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  )}

                  {/* BIC/SWIFT */}
                  {bankDetails.bic && (
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground">{t('donate.bic')}</p>
                        <p className="font-mono text-sm">{bankDetails.bic}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(bankDetails.bic, 'bic')}
                        className="shrink-0"
                      >
                        {copiedField === 'bic' ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  )}

                  {/* Reference */}
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1">
                      <p className="text-xs text-muted-foreground">{t('donate.reference')}</p>
                      <p className="font-mono text-sm break-all">{decodedDTag}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(decodedDTag, 'reference')}
                      className="shrink-0"
                    >
                      {copiedField === 'reference' ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Confirm button */}
          <Button
            onClick={() => handleConfirmPayment('bank')}
            disabled={confirmLoading}
            className="w-full h-12"
          >
            {confirmLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t('donate.registering')}
              </>
            ) : (
              t('donate.confirmTransfer')
            )}
          </Button>
        </>
      )}
    </div>
  );
};

export default EventDonate;
