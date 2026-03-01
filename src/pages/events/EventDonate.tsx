import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useNostrUnregisteredWallets } from "@/hooks/useNostrUnregisteredWallets";
import { useCoinGeckoRate } from "@/hooks/useCoinGeckoRate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Wallet, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { SimplePool } from "nostr-tools";
import { LanaEvent } from "@/hooks/useNostrEvents";

interface WalletBalance {
  wallet_id: string;
  balance: number;
}

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

  const [event, setEvent] = useState<LanaEvent | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [walletType, setWalletType] = useState<'registered' | 'unregistered'>('registered');
  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [lanaAmount, setLanaAmount] = useState<string>("0");
  const [walletBalances, setWalletBalances] = useState<Record<string, number>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);

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
      const organizerPubkey = getTagValue('p');

      if (!title || !status || !startStr || !eventDTag || !language || !eventType || !organizerPubkey) {
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
        organizerPubkey,
        isOnline,
        onlineUrl,
        youtubeUrl: getTagValue('youtube'),
        location: getTagValue('location'),
        lat,
        lon,
        capacity: capacityStr ? parseInt(capacityStr, 10) : undefined,
        cover: getTagValue('cover'),
        donationWallet: getTagValue('donation_wallet'),
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

          // Lock wallet type to match event's donation wallet type (no mixing allowed)
          if (parsed?.donationWalletType) {
            setWalletType(parsed.donationWalletType);
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
  const canProceed = selectedWalletId && lanaAmount && parsedLanaAmount > 0 && hasSufficientBalance && !loadingBalances && event?.donationWallet;

  const handleContinue = async () => {
    if (!selectedWalletId || !lanaAmount || !event) {
      toast({
        title: "Missing information",
        description: "Please select a wallet and enter an amount",
        variant: "destructive"
      });
      return;
    }

    // Navigate to private key entry page
    navigate(`/events/donate-private-key/${encodeURIComponent(decodedDTag)}`, {
      state: {
        selectedWalletId,
        lanaAmount: parsedLanaAmount,
        fiatAmount: fiatAmount.toFixed(2),
        eventTitle: event.title,
        donationWallet: event.donationWallet,
        isPay,
        walletType
      }
    });
  };

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
          Back
        </Button>
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Event not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!event.donationWallet) {
    return (
      <div className="space-y-4 px-4">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">This event does not accept donations/payments</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedRegWallet = availableWallets.find(w => w.walletId === selectedWalletId);
  const selectedUnregWallet = myUnregWallets.find(w => w.address === selectedWalletId);

  return (
    <div className="space-y-4 px-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">{isPay ? 'Pay for Event' : 'Donate to Event'}</h1>
        <p className="text-muted-foreground mt-1">{event.title}</p>
      </div>

      {/* Event Wallet (TO) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Event Wallet (TO)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-muted p-3 rounded-md">
            <p className="font-mono text-sm break-all">{event.donationWallet}</p>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Funds will be sent to this wallet
          </p>
        </CardContent>
      </Card>

      {/* Your Wallet (FROM) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your Wallet (FROM) *</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Wallet type toggle — locked when event has donation_wallet_type */}
          {event.donationWalletType ? (
            <div className="space-y-1">
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled
                  className="flex-1"
                >
                  {event.donationWalletType === 'registered' ? 'Registered' : 'Unregistered'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This event only accepts {event.donationWalletType} wallets
              </p>
            </div>
          ) : (
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
          )}

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
            {isPay ? 'Payment Amount (LANA) *' : 'Donation Amount (LANA) *'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Input
              type="number"
              value={lanaAmount}
              onChange={(e) => {
                const value = e.target.value;
                // Prevent entering more than available balance
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
                Event price: €{event.fiatValue.toFixed(2)}
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
                      ✗ Insufficient balance (Available: {selectedWalletBalance.toFixed(2)} LANA)
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
        disabled={!canProceed}
        className="w-full h-12"
      >
        {parsedLanaAmount > 0 
          ? `${isPay ? 'Pay' : 'Donate'} ${parsedLanaAmount.toFixed(2)} LANA (€${fiatAmount.toFixed(2)})`
          : isPay ? 'Pay' : 'Donate'
        }
      </Button>
      
      {!selectedWalletId && (
        <p className="text-sm text-center text-muted-foreground">
          Please select a wallet to continue
        </p>
      )}
      {selectedWalletId && parsedLanaAmount === 0 && (
        <p className="text-sm text-center text-muted-foreground">
          Please enter an amount
        </p>
      )}
      {!hasSufficientBalance && selectedWalletId && parsedLanaAmount > 0 && (
        <p className="text-sm text-center text-destructive">
          Insufficient balance in selected wallet
        </p>
      )}
    </div>
  );
};

export default EventDonate;
