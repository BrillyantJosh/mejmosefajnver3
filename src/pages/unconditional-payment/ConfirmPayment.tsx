import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { QRScanner } from "@/components/QRScanner";
import { Camera, Wallet, ArrowRight, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { convertWifToIds } from "@/lib/crypto";
import { formatLana } from "@/lib/currencyConversion";
import { supabase } from "@/integrations/supabase/client";
import { SimplePool, finalizeEvent } from 'nostr-tools';
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";

interface PaymentRecipient {
  proposalId: string;
  proposalDTag: string;
  recipientWallet: string;
  recipientPubkey: string;
  lanaAmount: number;
  lanoshiAmount: number;
  service: string;
}

interface RecipientSummaryWithPubkey {
  wallet: string;
  pubkey: string;
  amount: number;
  services: string[];
}

interface PaymentData {
  selectedProposals: PaymentRecipient[];
  senderWallet: string;
  totalLana: number;
}

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

export default function ConfirmPayment() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [privateKey, setPrivateKey] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isPrivateKeyValid, setIsPrivateKeyValid] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const relays = parameters?.relays && parameters.relays.length > 0 
    ? parameters.relays 
    : DEFAULT_RELAYS;

  useEffect(() => {
    // Load payment data from session storage
    const storedData = sessionStorage.getItem('pendingUnconditionalPayment');
    if (!storedData) {
      toast.error("No payment data found");
      navigate('/unconditional-payment');
      return;
    }

    try {
      const data = JSON.parse(storedData);
      setPaymentData(data);
    } catch (error) {
      toast.error("Invalid payment data");
      navigate('/unconditional-payment');
    }
  }, [navigate]);

  useEffect(() => {
    if (!privateKey || !paymentData) {
      setIsPrivateKeyValid(false);
      setValidationError(null);
      return;
    }

    const validatePrivateKey = async () => {
      try {
        setIsValidating(true);
        const derivedIds = await convertWifToIds(privateKey);
        
        // Check both compressed and uncompressed addresses
        const matchesCompressed = derivedIds.walletId === paymentData.senderWallet;
        const matchesUncompressed = derivedIds.walletIdUncompressed === paymentData.senderWallet;

        if (matchesCompressed || matchesUncompressed) {
          setIsPrivateKeyValid(true);
          setValidationError(null);
        } else {
          setIsPrivateKeyValid(false);
          setValidationError("Private key does not match the selected wallet");
        }
      } catch (error) {
        setIsPrivateKeyValid(false);
        setValidationError("Invalid private key format");
      } finally {
        setIsValidating(false);
      }
    };

    const debounce = setTimeout(validatePrivateKey, 500);
    return () => clearTimeout(debounce);
  }, [privateKey, paymentData]);

  const handleScanComplete = (scannedData: string) => {
    setPrivateKey(scannedData.trim());
    setIsScannerOpen(false);
  };

  // Group recipients by wallet address and calculate totals
  const recipientSummary = paymentData?.selectedProposals.reduce((acc, proposal) => {
    const existing = acc.find(r => r.wallet === proposal.recipientWallet);
    if (existing) {
      existing.amount += proposal.lanaAmount;
      existing.services.push(proposal.service);
    } else {
      acc.push({
        wallet: proposal.recipientWallet,
        pubkey: proposal.recipientPubkey,
        amount: proposal.lanaAmount,
        services: [proposal.service]
      });
    }
    return acc;
  }, [] as RecipientSummaryWithPubkey[]) || [];

  // Fetch profiles for all recipient pubkeys
  const recipientPubkeys = recipientSummary.map(r => r.pubkey);
  const { profiles: recipientProfiles } = useNostrProfilesCacheBulk(recipientPubkeys);

  const handleConfirmPayment = async () => {
    if (!privateKey || !isPrivateKeyValid || !paymentData) {
      toast.error("Please enter a valid private key");
      return;
    }

    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast.error("Nostr authentication required");
      return;
    }

    setIsProcessing(true);

    try {
      console.log('🚀 Processing unconditional payment...');
      
      // Prepare recipients in the format expected by the edge function
      const recipients = recipientSummary.map(r => ({
        address: r.wallet,
        amount: r.amount // in LANA
      }));

      // Get Electrum servers from session storage or use defaults
      const storedServers = sessionStorage.getItem('electrumServers');
      const electrum_servers = storedServers 
        ? JSON.parse(storedServers)
        : [
            { host: "electrum1.lanacoin.com", port: 5097 },
            { host: "electrum2.lanacoin.com", port: 5097 }
          ];

      console.log('📤 Calling edge function with:', {
        sender_address: paymentData.senderWallet,
        recipients: recipients,
        electrum_servers: electrum_servers
      });

      // Call the edge function
      const { data, error } = await supabase.functions.invoke('send-unconditional-payment', {
        body: {
          sender_address: paymentData.senderWallet,
          recipients: recipients,
          private_key: privateKey,
          electrum_servers: electrum_servers
        }
      });

      if (error) {
        console.error('Edge function error:', error);
        throw new Error(error.message || 'Payment transaction failed');
      }

      if (!data.success) {
        throw new Error(data.error || 'Payment transaction failed');
      }

      console.log('✅ Transaction successful:', data.txid);
      
      // Create and publish KIND 90901 events for each proposal
      const pool = new SimplePool();
      const relayResults: Array<{ proposalId: string; relay: string; success: boolean; error?: string }> = [];

      console.log(`📝 Creating KIND 90901 events for ${paymentData.selectedProposals.length} proposals...`);

      for (const proposal of paymentData.selectedProposals) {
        try {
          // Create KIND 90901 event
          const eventTemplate = {
            kind: 90901,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['proposal', proposal.proposalDTag],
              ['p', proposal.recipientPubkey],
              ['from_wallet', paymentData.senderWallet],
              ['to_wallet', proposal.recipientWallet],
              ['amount_lana', proposal.lanaAmount.toString()],
              ['amount_lanoshi', proposal.lanoshiAmount.toString()],
              ['tx', data.txid],
              ['service', proposal.service],
              ['timestamp_paid', Math.floor(Date.now() / 1000).toString()],
              ['e', proposal.proposalId, '', 'proposal'],
              ['type', 'unconditional_payment_confirmation']
            ],
            content: `Unconditional payment successfully received for proposal ${proposal.proposalDTag}.`,
            pubkey: session.nostrHexId
          };

          // Sign the event
          const privateKeyBytes = new Uint8Array(
            session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
          );
          const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);

          console.log(`📡 Publishing KIND 90901 for proposal ${proposal.proposalDTag}...`);

          // Publish to all relays
          const publishPromises = pool.publish(relays, signedEvent);

          // Track each relay result
          const trackedPromises = publishPromises.map((promise, idx) => {
            const relay = relays[idx];
            return promise
              .then(() => {
                console.log(`✅ KIND 90901 published to ${relay}`);
                relayResults.push({ proposalId: proposal.proposalDTag, relay, success: true });
                return { relay, success: true };
              })
              .catch((err) => {
                console.error(`❌ Failed to publish to ${relay}:`, err);
                const errorMsg = err instanceof Error ? err.message : 'Unknown error';
                relayResults.push({ proposalId: proposal.proposalDTag, relay, success: false, error: errorMsg });
                return { relay, success: false, error: err };
              });
          });

          // Wait for publishing with timeout
          try {
            await Promise.race([
              Promise.all(trackedPromises),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Publish timeout')), 10000)
              )
            ]);
          } catch (error) {
            console.warn('⚠️ Publish timeout for proposal:', proposal.proposalDTag);
          }

        } catch (error) {
          console.error(`❌ Error creating KIND 90901 for proposal ${proposal.proposalDTag}:`, error);
        }
      }

      pool.close(relays);

      // Store result data for result page
      const resultData = {
        txid: data.txid,
        totalAmount: paymentData.totalLana,
        recipients: recipientSummary,
        relayResults: relayResults,
        timestamp: new Date().toISOString()
      };

      sessionStorage.setItem('unconditionalPaymentResult', JSON.stringify(resultData));
      
      // Clear pending payment data
      sessionStorage.removeItem('pendingUnconditionalPayment');
      
      // Show success toast
      toast.success(`Payment sent successfully! TX: ${data.txid.substring(0, 8)}...`);
      
      // Navigate to result page
      navigate('/unconditional-payment/result');
      
    } catch (error) {
      console.error('❌ Payment error:', error);
      toast.error(error instanceof Error ? error.message : 'Payment failed');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!paymentData) {
    return null;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate('/unconditional-payment')}
          className="mb-4"
        >
          ← Back to Payments
        </Button>
        <h1 className="text-3xl font-bold">Confirm Payment</h1>
        <p className="text-muted-foreground">Review and authorize your unconditional payment</p>
      </div>

      {/* Payment Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Payment Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground">From Wallet</Label>
            <div className="p-3 bg-muted rounded-lg">
              <p className="font-mono text-sm break-all">{paymentData.senderWallet}</p>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-muted-foreground">To Recipients</Label>
            {recipientSummary.map((recipient, index) => {
              const profile = recipientProfiles.get(recipient.pubkey);
              return (
                <div key={index} className="p-3 bg-muted rounded-lg space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">To:</span>
                        <span className="text-sm font-semibold">
                          {profile?.display_name || profile?.full_name || 'Unknown'}
                        </span>
                      </div>
                      <p className="font-mono text-xs break-all text-muted-foreground">{recipient.wallet}</p>
                      <p className="text-xs text-muted-foreground">
                        {recipient.services.join(', ')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatLana(recipient.amount)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">Total Amount</span>
              <span className="text-2xl font-bold text-primary">{formatLana(paymentData.totalLana)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Private Key Input */}
      <Card>
        <CardHeader>
          <CardTitle>Authorize Payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="privateKey">Enter Private Key (WIF Format)</Label>
            <div className="flex gap-2">
              <Input
                id="privateKey"
                type="password"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="Enter your private key..."
                className={isPrivateKeyValid ? "border-green-500" : validationError ? "border-destructive" : ""}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setIsScannerOpen(true)}
              >
                <Camera className="h-4 w-4" />
              </Button>
            </div>

            {isValidating && (
              <p className="text-sm text-muted-foreground">Validating...</p>
            )}

            {isPrivateKeyValid && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <AlertCircle className="h-4 w-4" />
                <span>Private key verified for selected wallet</span>
              </div>
            )}

            {validationError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your private key is required to authorize this transaction. It will be used securely to sign the payment and will not be stored.
            </AlertDescription>
          </Alert>

          <Button
            onClick={handleConfirmPayment}
            disabled={!isPrivateKeyValid || isProcessing}
            className="w-full"
            size="lg"
          >
            {isProcessing ? (
              "Processing..."
            ) : (
              <>
                Confirm & Send Payment
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <QRScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleScanComplete}
      />
    </div>
  );
}
