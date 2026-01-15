import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Send, Key, Scan, CheckCircle, XCircle, User, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { convertWifToIds } from '@/lib/crypto';
import { Html5Qrcode } from 'html5-qrcode';
import { toast } from 'sonner';

interface PaymentFormProps {
  recipientName: string;
  recipientWalletId: string;
  recipientWalletType: string;
  amount: number;
  senderWalletId: string;
  senderWalletBalance: number;
  currency: string;
  onComplete: (success: boolean, txHash?: string, error?: string) => void;
  onCancel: () => void;
}

export function PaymentForm({
  recipientName,
  recipientWalletId,
  recipientWalletType,
  amount,
  senderWalletId,
  senderWalletBalance,
  currency,
  onComplete,
  onCancel,
}: PaymentFormProps) {
  const { parameters } = useSystemParameters();
  const [privateKey, setPrivateKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isPrivateKeyValid, setIsPrivateKeyValid] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selectedTab, setSelectedTab] = useState('manual');
  const [isScanning, setIsScanning] = useState(false);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  // Validate private key in real-time
  useEffect(() => {
    const validatePrivateKey = async () => {
      if (!privateKey.trim()) {
        setIsPrivateKeyValid(false);
        setValidationError('');
        return;
      }

      setIsValidating(true);
      try {
        const derivedIds = await convertWifToIds(privateKey.trim());
        
        if (derivedIds.walletId !== senderWalletId) {
          setIsPrivateKeyValid(false);
          setValidationError(
            `Privatni ključ ne ustreza! Ključ je za: ${derivedIds.walletId.slice(0, 8)}...`
          );
        } else {
          setIsPrivateKeyValid(true);
          setValidationError('');
        }
      } catch (err) {
        setIsPrivateKeyValid(false);
        setValidationError('Neveljaven format privatnega ključa');
      } finally {
        setIsValidating(false);
      }
    };

    const timeoutId = setTimeout(validatePrivateKey, 500);
    return () => clearTimeout(timeoutId);
  }, [privateKey, senderWalletId]);

  // QR Scanner
  const startScanner = async () => {
    try {
      setIsScanning(true);
      setError('');

      const cameras = await Html5Qrcode.getCameras();
      if (!cameras || cameras.length === 0) {
        setError('Ni dostopnih kamer.');
        setIsScanning(false);
        return;
      }

      const cameraId = cameras.length > 1 ? cameras[cameras.length - 1].id : cameras[0].id;
      const html5QrCode = new Html5Qrcode('qr-reader-payment');
      html5QrCodeRef.current = html5QrCode;

      await html5QrCode.start(
        cameraId,
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          setPrivateKey(decodedText);
          stopScanner();
          setSelectedTab('manual');
        },
        () => {}
      );
    } catch (err: any) {
      setError(`Napaka kamere: ${err.message || 'Preverite dovoljenja.'}`);
      setIsScanning(false);
    }
  };

  const stopScanner = async () => {
    try {
      if (html5QrCodeRef.current) {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current = null;
      }
      setIsScanning(false);
    } catch (err) {
      setIsScanning(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const handleSubmit = async () => {
    if (!privateKey.trim() || !isPrivateKeyValid) {
      setError('Vnesite veljaven privatni ključ');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      toast.info('Pošiljam transakcijo...');

      const { data, error: txError } = await supabase.functions.invoke('send-lana-transaction', {
        body: {
          senderAddress: senderWalletId,
          recipientAddress: recipientWalletId,
          amount: amount,
          privateKey: privateKey.trim(),
          emptyWallet: false,
          electrumServers: parameters?.electrumServers || [],
        },
      });

      if (txError) throw txError;

      if (data?.success) {
        toast.success('Transakcija uspešno poslana!');
        onComplete(true, data.txHash);
      } else {
        throw new Error(data?.error || 'Transakcija ni uspela');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Napaka pri transakciji';
      setError(errorMessage);
      toast.error(errorMessage);
      onComplete(false, undefined, errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Check if enough balance
  const hasEnoughBalance = senderWalletBalance >= amount;

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Send className="h-5 w-5" />
          Potrdi plačilo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Transaction Summary */}
        <div className="p-4 rounded-lg bg-muted/50 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Prejemnik</p>
              <p className="font-semibold">{recipientName}</p>
            </div>
          </div>
          
          <div className="text-xs text-muted-foreground">
            <p>Na denarnico: <span className="font-mono">{recipientWalletId.slice(0, 12)}...{recipientWalletId.slice(-8)}</span></p>
            <p>Tip: {recipientWalletType}</p>
          </div>

          <div className="pt-2 border-t">
            <p className="text-2xl font-bold text-primary text-center">
              {formatNumber(amount)} LANA
            </p>
          </div>
        </div>

        {/* Sender Info */}
        <div className="p-3 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Iz denarnice:</span>
          </div>
          <p className="font-mono text-xs mt-1">{senderWalletId}</p>
          <p className="text-sm mt-1">
            Stanje: <span className={hasEnoughBalance ? 'text-green-600' : 'text-destructive'}>
              {formatNumber(senderWalletBalance)} LANA
            </span>
          </p>
        </div>

        {!hasEnoughBalance && (
          <Alert variant="destructive">
            <AlertDescription>
              Nezadostno stanje! Potrebuješ {formatNumber(amount)} LANA, imaš pa {formatNumber(senderWalletBalance)} LANA.
            </AlertDescription>
          </Alert>
        )}

        {hasEnoughBalance && (
          <>
            {/* Private Key Input */}
            <Tabs value={selectedTab} onValueChange={setSelectedTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="manual">
                  <Key className="h-4 w-4 mr-2" />
                  Vnesi ključ
                </TabsTrigger>
                <TabsTrigger value="scan">
                  <Scan className="h-4 w-4 mr-2" />
                  Skeniraj QR
                </TabsTrigger>
              </TabsList>

              <TabsContent value="manual" className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="privateKey">Privatni ključ (WIF)</Label>
                  <div className="relative">
                    <Input
                      id="privateKey"
                      type="password"
                      placeholder="Vnesite privatni ključ"
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      className={`pr-10 ${
                        validationError ? 'border-destructive' : 
                        isPrivateKeyValid ? 'border-green-500' : ''
                      }`}
                    />
                    {isValidating && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {!isValidating && isPrivateKeyValid && (
                      <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                    )}
                    {!isValidating && validationError && (
                      <XCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive" />
                    )}
                  </div>
                  {validationError && (
                    <p className="text-xs text-destructive">{validationError}</p>
                  )}
                  {isPrivateKeyValid && (
                    <p className="text-xs text-green-600">✓ Privatni ključ je veljaven</p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="scan" className="space-y-3">
                {!isScanning ? (
                  <Button onClick={startScanner} className="w-full">
                    <Scan className="h-4 w-4 mr-2" />
                    Zaženi kamero
                  </Button>
                ) : (
                  <>
                    <div id="qr-reader-payment" className="w-full rounded-lg overflow-hidden" />
                    <Button onClick={stopScanner} variant="destructive" className="w-full">
                      Ustavi skeniranje
                    </Button>
                  </>
                )}
                {privateKey && (
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">Skeniran ključ:</p>
                    <p className="font-mono text-xs">{'•'.repeat(Math.min(privateKey.length, 40))}</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onCancel} className="flex-1" disabled={isSubmitting}>
                Prekliči
              </Button>
              <Button 
                onClick={handleSubmit} 
                className="flex-1"
                disabled={!isPrivateKeyValid || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Pošiljam...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Pošlji
                  </>
                )}
              </Button>
            </div>
          </>
        )}

        {!hasEnoughBalance && (
          <Button variant="outline" onClick={onCancel} className="w-full">
            Zapri
          </Button>
        )}

        <p className="text-xs text-muted-foreground text-center">
          Vaš privatni ključ ni nikoli shranjen in se uporabi samo za podpis transakcije.
        </p>
      </CardContent>
    </Card>
  );
}
