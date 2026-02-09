import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Loader2, QrCode, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useWalletTypes } from "@/hooks/useWalletTypes";
import { validateLanaWalletIdWithMessage } from "@/lib/lanaWalletValidation";
import { supabase } from "@/integrations/supabase/client";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { QRScanner } from "@/components/QRScanner";
import { useAuth } from "@/contexts/AuthContext";

export default function RegisterWallet() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { data: walletTypes, isLoading: typesLoading } = useWalletTypes();
  const { parameters } = useSystemParameters();
  
  const [walletId, setWalletId] = useState("");
  const [walletType, setWalletType] = useState("");
  const [note, setNote] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isCheckingBalance, setIsCheckingBalance] = useState(false);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  
  const [validationStatus, setValidationStatus] = useState<'idle' | 'validating-format' | 'validating-balance' | 'valid' | 'invalid-format' | 'invalid-balance'>('idle');
  const [validationMessage, setValidationMessage] = useState('');
  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  const handleQRScan = (data: string) => {
    setWalletId(data);
    toast.success("Wallet ID scanned successfully");
  };

  const validateWalletRealtime = async () => {
    if (!walletId || walletId.length < 26) {
      setValidationStatus('idle');
      setValidationMessage('');
      setWalletBalance(null);
      return;
    }

    // Step 1: Validate format
    setValidationStatus('validating-format');
    setValidationMessage('Checking wallet format...');
    
    const formatValidation = await validateLanaWalletIdWithMessage(walletId);
    
    if (!formatValidation.valid) {
      setValidationStatus('invalid-format');
      setValidationMessage(formatValidation.message || 'Invalid wallet ID format');
      setWalletBalance(null);
      return;
    }

    // Step 2: Check balance
    setValidationStatus('validating-balance');
    setValidationMessage('Checking wallet balance...');

    if (!parameters?.electrumServers || parameters.electrumServers.length === 0) {
      setValidationStatus('invalid-balance');
      setValidationMessage('Electrum servers not configured');
      setWalletBalance(null);
      return;
    }

    try {
      const { data: balanceData, error: balanceError } = await supabase.functions.invoke('get-wallet-balances', {
        body: {
          wallet_addresses: [walletId],
          electrum_servers: parameters.electrumServers,
        },
      });

      if (balanceError) {
        console.error('Balance check error:', balanceError);
        setValidationStatus('invalid-balance');
        setValidationMessage('Failed to check wallet balance');
        setWalletBalance(null);
        return;
      }

      const balance = balanceData?.wallets?.[0]?.balance || 0;
      setWalletBalance(balance);

      if (balance !== 0) {
        setValidationStatus('invalid-balance');
        setValidationMessage(`Wallet must be empty. Current balance: ${balance} LANA`);
        return;
      }

      // All validations passed
      setValidationStatus('valid');
      setValidationMessage('Wallet is valid and ready to register');
    } catch (error) {
      console.error('Validation error:', error);
      setValidationStatus('invalid-balance');
      setValidationMessage('An error occurred during validation');
      setWalletBalance(null);
    }
  };

  useEffect(() => {
    if (!walletId || walletId.length < 26) {
      setValidationStatus('idle');
      setValidationMessage('');
      setWalletBalance(null);
      return;
    }

    const timeoutId = setTimeout(() => {
      validateWalletRealtime();
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [walletId, parameters]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!walletId || !walletType) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (validationStatus !== 'valid') {
      toast.error("Please wait for wallet validation to complete");
      return;
    }

    if (!session?.nostrHexId) {
      toast.error("User session not found. Please log in again.");
      return;
    }

    setIsValidating(true);

    try {
      // Call server-side proxy to register wallet via lanawatch.us API
      const { data: result, error: invokeError } = await supabase.functions.invoke('register-virgin-wallet', {
        body: {
          nostr_id_hex: session.nostrHexId,
          wallets: [
            {
              wallet_id: walletId,
              wallet_type: walletType,
              notes: note || undefined,
            }
          ]
        }
      });

      if (invokeError) {
        throw new Error(invokeError.message || 'Failed to register wallet');
      }

      if (!result?.success) {
        throw new Error(result?.message || 'Failed to register wallet');
      }

      // Success - navigate to result page
      toast.success("Wallet registered successfully!");
      
      navigate('/wallet/register/result', {
        state: {
          success: true,
          message: result.message,
          walletId: walletId,
          walletType: walletType,
          nostrBroadcasts: result.data?.nostr_broadcasts,
          processingTime: result.processing_time_ms,
        }
      });

    } catch (error) {
      console.error('Registration error:', error);
      const errorMessage = error instanceof Error ? error.message : 'An error occurred during registration';
      toast.error(errorMessage);
      
      // Navigate to result page with error
      navigate('/wallet/register/result', {
        state: {
          success: false,
          message: errorMessage,
          walletId: walletId,
          walletType: walletType,
        }
      });
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Button
        variant="ghost"
        onClick={() => navigate('/wallet')}
        className="mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Wallets
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Register New Wallet</CardTitle>
          <CardDescription>
            Add a new wallet to your account. The wallet must be empty (0 balance) to register.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="walletId">
                Wallet ID <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="walletId"
                  placeholder="Enter Lana wallet address (e.g., LiJoPczEsgouQSN2HcZaj1jQk...)"
                  value={walletId}
                  onChange={(e) => setWalletId(e.target.value)}
                  required
                  disabled={isValidating}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setQrScannerOpen(true)}
                  disabled={isValidating}
                >
                  <QrCode className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                The wallet address must be a valid Lana wallet ID
              </p>

              {/* Validation Status Indicators */}
              {validationStatus !== 'idle' && (
                <div className="space-y-2 mt-2">
                  {/* Format Validation */}
                  {(validationStatus === 'validating-format' || validationStatus === 'validating-balance' || validationStatus === 'valid' || validationStatus === 'invalid-format') && (
                    <Alert variant={validationStatus === 'invalid-format' ? 'destructive' : 'default'} className="py-2">
                      <div className="flex items-center gap-2">
                        {validationStatus === 'validating-format' && <Loader2 className="h-4 w-4 animate-spin" />}
                        {(validationStatus === 'validating-balance' || validationStatus === 'valid') && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                        {validationStatus === 'invalid-format' && <XCircle className="h-4 w-4" />}
                        <AlertDescription className="text-sm">
                          {validationStatus === 'validating-format' && 'Checking wallet format...'}
                          {(validationStatus === 'validating-balance' || validationStatus === 'valid') && 'Valid Lana wallet format ✓'}
                          {validationStatus === 'invalid-format' && validationMessage}
                        </AlertDescription>
                      </div>
                    </Alert>
                  )}

                  {/* Balance Validation */}
                  {(validationStatus === 'validating-balance' || validationStatus === 'valid' || validationStatus === 'invalid-balance') && (
                    <Alert variant={validationStatus === 'invalid-balance' ? 'destructive' : 'default'} className="py-2">
                      <div className="flex items-center gap-2">
                        {validationStatus === 'validating-balance' && <Loader2 className="h-4 w-4 animate-spin" />}
                        {validationStatus === 'valid' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                        {validationStatus === 'invalid-balance' && <AlertCircle className="h-4 w-4" />}
                        <AlertDescription className="text-sm">
                          {validationStatus === 'validating-balance' && 'Checking wallet balance...'}
                          {validationStatus === 'valid' && `Balance: ${walletBalance} LANA ✓`}
                          {validationStatus === 'invalid-balance' && validationMessage}
                        </AlertDescription>
                      </div>
                    </Alert>
                  )}

                  {/* Success Message */}
                  {validationStatus === 'valid' && (
                    <Alert className="py-2 border-green-600 bg-green-50 dark:bg-green-950">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        <AlertDescription className="text-sm font-medium text-green-800 dark:text-green-200">
                          Wallet is ready to register!
                        </AlertDescription>
                      </div>
                    </Alert>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="walletType">
                Wallet Type <span className="text-destructive">*</span>
              </Label>
              {typesLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading wallet types...
                </div>
              ) : (
                <Select value={walletType} onValueChange={setWalletType} disabled={isValidating}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select wallet type" />
                  </SelectTrigger>
                  <SelectContent>
                    {walletTypes?.map((type) => (
                      <SelectItem key={type.id} value={type.name}>
                        <div className="flex flex-col">
                          <span className="font-medium">{type.name}</span>
                          {type.description && (
                            <span className="text-xs text-muted-foreground">{type.description}</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">Note (Optional)</Label>
              <Textarea
                id="note"
                placeholder="Add a note about this wallet..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={isValidating}
                rows={3}
              />
            </div>

            <div className="flex gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/wallet')}
                disabled={isValidating}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isValidating || typesLoading || validationStatus !== 'valid'}
                className="flex-1"
              >
                {isValidating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Registering...
                  </>
                ) : (
                  "Register Wallet"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <QRScanner
        isOpen={qrScannerOpen}
        onClose={() => setQrScannerOpen(false)}
        onScan={handleQRScan}
      />
    </div>
  );
}
