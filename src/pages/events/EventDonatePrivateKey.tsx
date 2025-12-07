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

interface LocationState {
  selectedWalletId: string;
  lanaAmount: number;
  fiatAmount: string;
  eventTitle: string;
  donationWallet: string;
  isPay: boolean;
}

const EventDonatePrivateKey = () => {
  const { dTag } = useParams<{ dTag: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { parameters } = useSystemParameters();
  const { toast } = useToast();
  
  const state = location.state as LocationState | null;
  
  const [privateKey, setPrivateKey] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isPrivateKeyValid, setIsPrivateKeyValid] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const decodedDTag = dTag ? decodeURIComponent(dTag) : '';

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

  const handleSubmit = async () => {
    if (!state || !isPrivateKeyValid) return;

    setIsSubmitting(true);

    try {
      const electrumServers = parameters?.electrumServers || [];
      
      if (electrumServers.length === 0) {
        throw new Error("No Electrum servers configured");
      }

      // Call the send-lana-transaction edge function
      const { data, error } = await supabase.functions.invoke('send-lana-transaction', {
        body: {
          private_key: privateKey,
          sender_address: state.selectedWalletId,
          recipient_address: state.donationWallet,
          amount: state.lanaAmount,
          electrum_servers: electrumServers
        }
      });

      if (error) throw error;

      if (data?.success) {
        navigate(`/events/donate-result`, {
          state: {
            success: true,
            txId: data.txid,
            amount: state.lanaAmount,
            fiatAmount: state.fiatAmount,
            eventTitle: state.eventTitle,
            isPay: state.isPay,
            dTag: decodedDTag
          }
        });
      } else {
        throw new Error(data?.error || "Transaction failed");
      }
    } catch (error) {
      console.error('Transaction error:', error);
      navigate(`/events/donate-result`, {
        state: {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
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
                className="font-mono pr-10"
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
            {validationError && (
              <p className="text-sm text-destructive mt-1">{validationError}</p>
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
