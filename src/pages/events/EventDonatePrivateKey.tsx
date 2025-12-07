import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Key, Loader2, Check, X } from "lucide-react";
import { convertWifToIds } from "@/lib/crypto";
import { supabase } from "@/integrations/supabase/client";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useToast } from "@/hooks/use-toast";
import { QRScanner } from "@/components/QRScanner";
import { useAuth } from "@/contexts/AuthContext";
import { SimplePool, finalizeEvent } from "nostr-tools";

interface LocationState {
  selectedWalletId: string;
  lanaAmount: number;
  fiatAmount: string;
  eventTitle: string;
  donationWallet: string;
  isPay: boolean;
}

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

const EventDonatePrivateKey = () => {
  const { dTag } = useParams<{ dTag: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const { toast } = useToast();
  
  const state = location.state as LocationState | null;
  
  const [privateKey, setPrivateKey] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isPrivateKeyValid, setIsPrivateKeyValid] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const decodedDTag = dTag ? decodeURIComponent(dTag) : '';

  const relays = parameters?.relays && parameters.relays.length > 0 
    ? parameters.relays 
    : DEFAULT_RELAYS;

  // Validate private key against selected wallet
  useEffect(() => {
    const validatePrivateKey = async () => {
      if (!privateKey || privateKey.length < 10 || !state?.selectedWalletId) {
        setIsPrivateKeyValid(false);
        setValidationError(null);
        return;
      }

      setIsValidating(true);
      setValidationError(null);

      try {
        const result = await convertWifToIds(privateKey);
        
        if (result.walletId === state.selectedWalletId) {
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

    const debounceTimer = setTimeout(validatePrivateKey, 500);
    return () => clearTimeout(debounceTimer);
  }, [privateKey, state?.selectedWalletId]);

  // Broadcast donation event to Nostr relays (KIND 53334)
  const broadcastDonationEvent = async (txId: string) => {
    console.log('🔔 Starting donation event broadcast...');
    console.log('Session nostrPrivateKey exists:', !!session?.nostrPrivateKey);
    console.log('Session nostrHexId:', session?.nostrHexId);
    
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      console.log('❌ No Nostr session, skipping donation event broadcast');
      return;
    }

    try {
      const pool = new SimplePool();
      
      // Convert hex private key to bytes (same as AddEvent.tsx)
      const privKeyBytes = new Uint8Array(
        session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );

      // Build tags for KIND 53334
      const tags: string[][] = [
        ["event", decodedDTag],
        ["txid", txId],
        ["amount_lana", state!.lanaAmount.toFixed(8)],
        ["from_wallet", state!.selectedWalletId],
        ["to_wallet", state!.donationWallet],
        ["p", session.nostrHexId],
        ["source", "Lana.app"],
        ["attachment", `https://lana.lanablock.com/tx/${txId}`]
      ];

      console.log('📝 Creating donation event with tags:', tags);

      const donationEvent = finalizeEvent({
        kind: 53334,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: "",
      }, privKeyBytes);

      console.log('📤 Broadcasting donation event:', donationEvent);
      console.log('📡 Publishing to relays:', relays);

      // Publish to relays (same pattern as AddEvent.tsx)
      const publishPromises = pool.publish(relays, donationEvent);
      const publishArray = Array.from(publishPromises);
      let successCount = 0;
      let errorCount = 0;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (successCount === 0) {
            console.log('⏱️ Donation event broadcast timeout, but continuing...');
          }
          resolve();
        }, 10000);

        publishArray.forEach((promise) => {
          promise
            .then(() => {
              successCount++;
              console.log(`✅ Donation event published to relay (${successCount}/${relays.length})`);
              if (successCount === 1) {
                clearTimeout(timeout);
                resolve();
              }
            })
            .catch((err) => {
              errorCount++;
              console.error('❌ Relay publish error:', err);
              if (errorCount === publishArray.length) {
                clearTimeout(timeout);
                console.log('❌ All relays failed');
                resolve(); // Still resolve, don't reject - we don't want to fail the whole flow
              }
            });
        });
      });

      console.log(`🎉 Donation event broadcast complete. Success: ${successCount}/${relays.length} relay(s)`);
    } catch (error) {
      console.error('❌ Error broadcasting donation event:', error);
      // Don't throw - we don't want to fail the whole flow if broadcast fails
    }
  };

  const handleSubmit = async () => {
    if (!state || !isPrivateKeyValid) return;

    setIsSubmitting(true);
    console.log('🚀 Starting donation transaction...');
    console.log('Amount:', state.lanaAmount, 'LANA');
    console.log('From:', state.selectedWalletId);
    console.log('To:', state.donationWallet);

    try {
      const electrumServers = parameters?.electrumServers || [];
      
      if (electrumServers.length === 0) {
        throw new Error("No Electrum servers configured");
      }

      console.log('📡 Calling send-lana-transaction with electrumServers:', electrumServers.length);

      // Call the send-lana-transaction edge function
      const { data, error } = await supabase.functions.invoke('send-lana-transaction', {
        body: {
          privateKey: privateKey,
          senderAddress: state.selectedWalletId,
          recipientAddress: state.donationWallet,
          amount: state.lanaAmount,
          electrumServers: electrumServers
        }
      });

      console.log('📥 Response from edge function:', { data, error });

      if (error) {
        console.error('❌ Edge function error:', error);
        throw error;
      }

      if (data?.success && data?.txHash) {
        console.log('✅ Transaction successful! TXID:', data.txHash);
        
        // Transaction successful - broadcast donation event to Nostr
        await broadcastDonationEvent(data.txHash);

        navigate(`/events/donate-result`, {
          state: {
            success: true,
            txId: data.txHash,
            amount: state.lanaAmount,
            fiatAmount: state.fiatAmount,
            eventTitle: state.eventTitle,
            isPay: state.isPay,
            dTag: decodedDTag
          }
        });
      } else {
        const errorMsg = data?.error || data?.message || "Transaction failed - no txid returned";
        console.error('❌ Transaction failed:', errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error('❌ Transaction error:', error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error('Error message:', errorMessage);
      
      navigate(`/events/donate-result`, {
        state: {
          success: false,
          error: errorMessage,
          eventTitle: state.eventTitle,
          isPay: state.isPay,
          dTag: decodedDTag
        }
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleScanResult = (result: string) => {
    setPrivateKey(result);
    setShowScanner(false);
  };

  if (!state) {
    return (
      <div className="space-y-4 px-4">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Missing transaction details</p>
          </CardContent>
        </Card>
      </div>
    );
  }

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
        <h1 className="text-2xl font-bold">Enter Private Key</h1>
        <p className="text-muted-foreground mt-1">{state.eventTitle}</p>
      </div>

      {/* Transaction Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Transaction Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount:</span>
            <span className="font-semibold">{state.lanaAmount.toFixed(2)} LANA</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Value:</span>
            <span className="font-semibold">€{state.fiatAmount}</span>
          </div>
          <div className="border-t pt-3">
            <div className="text-sm">
              <span className="text-muted-foreground">From:</span>
              <p className="font-mono text-xs mt-1 break-all">{state.selectedWalletId}</p>
            </div>
          </div>
          <div>
            <div className="text-sm">
              <span className="text-muted-foreground">To:</span>
              <p className="font-mono text-xs mt-1 break-all">{state.donationWallet}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Private Key Input */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Key className="h-5 w-5" />
            Private Key (WIF)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="private-key">Enter your private key</Label>
            <div className="relative">
              <Input
                id="private-key"
                type="password"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="Enter WIF private key"
                className={`font-mono pr-10 ${
                  isPrivateKeyValid 
                    ? 'border-green-500 focus-visible:ring-green-500' 
                    : validationError 
                      ? 'border-destructive focus-visible:ring-destructive' 
                      : ''
                }`}
              />
              {isValidating && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {!isValidating && isPrivateKeyValid && (
                <Check className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
              )}
              {!isValidating && validationError && (
                <X className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive" />
              )}
            </div>
            
            {/* Validation Status */}
            {isPrivateKeyValid && (
              <p className="text-sm text-green-500 mt-2 flex items-center gap-2">
                <Check className="h-4 w-4" />
                Private key matches the selected wallet
              </p>
            )}
            {validationError && (
              <p className="text-sm text-destructive mt-2 flex items-center gap-2">
                <X className="h-4 w-4" />
                {validationError}
              </p>
            )}
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => setShowScanner(true)}
          >
            Scan QR Code
          </Button>
        </CardContent>
      </Card>

      <QRScanner
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleScanResult}
      />

      <Alert>
        <AlertDescription>
          Your private key is only used to sign this transaction and is never stored or sent to any server.
        </AlertDescription>
      </Alert>

      {/* Submit Button */}
      <Button
        onClick={handleSubmit}
        disabled={!isPrivateKeyValid || isSubmitting}
        className="w-full h-12"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Processing...
          </>
        ) : (
          `${state.isPay ? 'Pay' : 'Donate'} ${state.lanaAmount.toFixed(2)} LANA`
        )}
      </Button>
    </div>
  );
};

export default EventDonatePrivateKey;
