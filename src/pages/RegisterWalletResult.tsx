import { useNavigate, useLocation } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, XCircle, ArrowLeft, Info } from "lucide-react";
import { useEffect } from "react";

interface RegistrationResult {
  success: boolean;
  message?: string;
  walletId?: string;
  walletType?: string;
  nostrBroadcasts?: {
    successful: number;
    failed: number;
  };
  processingTime?: number;
}

export default function RegisterWalletResult() {
  const navigate = useNavigate();
  const location = useLocation();
  const result = location.state as RegistrationResult;

  useEffect(() => {
    // Redirect if no result data
    if (!result) {
      navigate('/wallet/register');
    }
  }, [result, navigate]);

  if (!result) {
    return null;
  }

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
          <CardTitle className="flex items-center gap-2">
            {result.success ? (
              <>
                <CheckCircle2 className="h-6 w-6 text-green-600" />
                Wallet Registration Successful
              </>
            ) : (
              <>
                <XCircle className="h-6 w-6 text-destructive" />
                Wallet Registration Failed
              </>
            )}
          </CardTitle>
          <CardDescription>
            {result.success 
              ? "Your wallet has been registered successfully"
              : "There was a problem registering your wallet"
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {result.success ? (
            <>
              {/* Success Details */}
              <Alert className="border-green-600 bg-green-50 dark:bg-green-950">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle className="text-green-800 dark:text-green-200">
                  Registration Complete
                </AlertTitle>
                <AlertDescription className="text-green-700 dark:text-green-300">
                  {result.message || "Your wallet has been registered successfully"}
                </AlertDescription>
              </Alert>

              {/* Wallet Details */}
              {result.walletId && (
                <div className="space-y-2 p-4 bg-muted rounded-lg">
                  <div>
                    <p className="text-sm text-muted-foreground">Wallet ID</p>
                    <p className="font-mono text-sm break-all">{result.walletId}</p>
                  </div>
                  {result.walletType && (
                    <div>
                      <p className="text-sm text-muted-foreground">Wallet Type</p>
                      <p className="font-medium">{result.walletType}</p>
                    </div>
                  )}
                </div>
              )}

              {/* NOSTR Broadcast Status */}
              {result.nostrBroadcasts && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>NOSTR Network Status</AlertTitle>
                  <AlertDescription>
                    <div className="space-y-1 mt-2">
                      <p>✓ Successful broadcasts: {result.nostrBroadcasts.successful}</p>
                      {result.nostrBroadcasts.failed > 0 && (
                        <p className="text-amber-600">⚠ Failed broadcasts: {result.nostrBroadcasts.failed}</p>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {/* Directory Update Notice */}
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Directory Update Notice</AlertTitle>
                <AlertDescription>
                  Your wallet will appear in the wallet list within 40 hours, once all directories 
                  and address books have been updated across the network.
                </AlertDescription>
              </Alert>

              {/* Processing Time */}
              {result.processingTime && (
                <p className="text-xs text-muted-foreground text-center">
                  Processing time: {result.processingTime}ms
                </p>
              )}
            </>
          ) : (
            <>
              {/* Error Details */}
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Registration Error</AlertTitle>
                <AlertDescription>
                  {result.message || "An unknown error occurred during wallet registration"}
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Please check the following:
                </p>
                <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                  <li>Wallet ID format is correct</li>
                  <li>Wallet balance is exactly 0 LANA</li>
                  <li>You have an active profile on the network</li>
                  <li>Network connection is stable</li>
                </ul>
              </div>
            </>
          )}

          {/* Action Buttons */}
          <div className="flex gap-4 pt-4">
            {result.success ? (
              <Button
                onClick={() => navigate('/wallet')}
                className="flex-1"
              >
                Go to Wallets
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => navigate('/wallet')}
                  className="flex-1"
                >
                  Back to Wallets
                </Button>
                <Button
                  onClick={() => navigate('/wallet/register')}
                  className="flex-1"
                >
                  Try Again
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
