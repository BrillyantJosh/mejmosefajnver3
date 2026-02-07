import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useNostrWallets } from '@/hooks/useNostrWallets';
import { supabase } from '@/integrations/supabase/client';
import { convertWifToIds } from '@/lib/crypto';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, Send, Key, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { QRScanner } from '@/components/QRScanner';

interface LocationState {
  sourceWalletId: string;
  cashOutAmount: number;
  cashOutFiat: number;
  currency: string;
  accountId: number;
}

const ALLOWED_WALLET_TYPES = ['Wallet', 'Main Wallet'];

export default function Lana8WonderTransfer() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();

  const state = location.state as LocationState | undefined;

  const [privateKey, setPrivateKey] = useState('');
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [isKeyValid, setIsKeyValid] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [selectedDestination, setSelectedDestination] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);

  // Filter wallets to only show allowed types and exclude source wallet
  const destinationWallets = wallets.filter(
    w => ALLOWED_WALLET_TYPES.includes(w.walletType) && w.walletId !== state?.sourceWalletId
  );

  // Validate private key with debounce
  useEffect(() => {
    if (!privateKey || !state?.sourceWalletId) {
      setIsKeyValid(false);
      setKeyError('');
      return;
    }

    const timeout = setTimeout(async () => {
      setIsValidatingKey(true);
      setKeyError('');
      
      try {
        const result = await convertWifToIds(privateKey);
        
        // Check both compressed and uncompressed addresses
        const matchesCompressed = result.walletId === state.sourceWalletId;
        const matchesUncompressed = result.walletIdUncompressed === state.sourceWalletId;

        if (matchesCompressed || matchesUncompressed) {
          setIsKeyValid(true);
          setKeyError('');
        } else {
          setIsKeyValid(false);
          setKeyError('Private key does not match the source wallet');
        }
      } catch (error) {
        setIsKeyValid(false);
        setKeyError(error instanceof Error ? error.message : 'Invalid private key format');
      } finally {
        setIsValidatingKey(false);
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [privateKey, state?.sourceWalletId]);

  const handleSubmit = async () => {
    if (!state || !isKeyValid || !selectedDestination || !session?.nostrHexId) {
      return;
    }

    if (state.sourceWalletId === selectedDestination) {
      toast.error('Cannot transfer to the same wallet');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke('send-lana-transaction', {
        body: {
          senderAddress: state.sourceWalletId,
          recipientAddress: selectedDestination,
          amount: state.cashOutAmount,
          privateKey: privateKey,
          electrumServers: parameters?.electrumServers || [],
        },
      });

      if (error) throw error;

      if (data?.success) {
        toast.success('Transfer successful!');
        navigate('/lana8wonder', {
          state: {
            transferSuccess: true,
            txHash: data.txHash,
            amount: state.cashOutAmount,
          },
        });
      } else {
        throw new Error(data?.error || 'Transaction failed');
      }
    } catch (error) {
      console.error('Transfer error:', error);
      toast.error(error instanceof Error ? error.message : 'Transfer failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!state) {
    return (
      <div className="container mx-auto p-4 pb-24">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Missing transfer details</AlertTitle>
          <AlertDescription>
            Please start the transfer from the Lana8Wonder page.
          </AlertDescription>
        </Alert>
        <Button variant="ghost" onClick={() => navigate('/lana8wonder')} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Lana8Wonder
        </Button>
      </div>
    );
  }

  const isFormValid = isKeyValid && selectedDestination && !isSubmitting;

  return (
    <div className="container mx-auto p-3 md:p-4 pb-24 space-y-4 md:space-y-6">
      <Button variant="ghost" onClick={() => navigate('/lana8wonder')} className="mb-2">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Lana8Wonder
      </Button>

      <div className="flex items-center gap-2 md:gap-3 mb-4">
        <Send className="h-6 w-6 md:h-8 md:w-8 text-primary flex-shrink-0" />
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Cash Out Transfer</h1>
          <p className="text-sm md:text-base text-muted-foreground">Account {state.accountId}</p>
        </div>
      </div>

      {/* Transfer Summary */}
      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-lg md:text-xl">Transfer Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 md:p-6 pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground mb-1">Amount to Transfer</p>
              <p className="text-xl md:text-2xl font-bold text-primary">
                {state.cashOutAmount.toFixed(4)} LANA
              </p>
              <p className="text-sm text-muted-foreground">
                ≈{state.cashOutFiat.toFixed(2)} {state.currency}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground mb-1">From Wallet</p>
              <p className="font-mono text-xs md:text-sm break-all">{state.sourceWalletId}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Destination Wallet Selection */}
      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-lg md:text-xl">Destination Wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 md:p-6 pt-0">
          {walletsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : destinationWallets.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>No eligible wallets</AlertTitle>
              <AlertDescription>
                You need a wallet of type "Wallets" or "Main Wallet" to receive the transfer.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="destination">Select destination wallet</Label>
              <Select value={selectedDestination} onValueChange={setSelectedDestination}>
                <SelectTrigger id="destination">
                  <SelectValue placeholder="Choose a wallet" />
                </SelectTrigger>
                <SelectContent>
                  {destinationWallets.map(wallet => (
                    <SelectItem key={wallet.walletId} value={wallet.walletId}>
                      <div className="flex flex-col">
                        <span className="font-mono text-xs truncate max-w-[200px]">
                          {wallet.walletId}
                        </span>
                        <span className="text-xs text-muted-foreground">{wallet.walletType}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Private Key Input */}
      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
            <Key className="h-5 w-5" />
            Private Key
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 md:p-6 pt-0">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs md:text-sm">
              Enter the private key (WIF format) for the source wallet to authorize this transfer. Your private key is never stored.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="privateKey">Private Key (WIF)</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="privateKey"
                  type="password"
                  placeholder="Enter your private key"
                  value={privateKey}
                  onChange={e => setPrivateKey(e.target.value)}
                  className={`pr-10 ${
                    privateKey
                      ? isKeyValid
                        ? 'border-green-500 focus-visible:ring-green-500'
                        : keyError
                        ? 'border-destructive focus-visible:ring-destructive'
                        : ''
                      : ''
                  }`}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isValidatingKey && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {!isValidatingKey && isKeyValid && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                  {!isValidatingKey && keyError && <AlertCircle className="h-4 w-4 text-destructive" />}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowQRScanner(true)}
                title="Scan QR Code"
              >
                <QrCode className="w-4 h-4" />
              </Button>
            </div>
            {keyError && <p className="text-sm text-destructive">{keyError}</p>}
            {isKeyValid && <p className="text-sm text-green-600">Private key validated ✓</p>}
          </div>

          <QRScanner
            isOpen={showQRScanner}
            onClose={() => setShowQRScanner(false)}
            onScan={(data) => {
              setPrivateKey(data);
              setShowQRScanner(false);
              toast.success('QR Code scanned - Private key loaded');
            }}
          />
        </CardContent>
      </Card>

      {/* Submit Button */}
      <Button
        className="w-full"
        size="lg"
        onClick={handleSubmit}
        disabled={!isFormValid}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Processing Transfer...
          </>
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            Transfer {state.cashOutAmount.toFixed(4)} LANA
          </>
        )}
      </Button>
    </div>
  );
}
