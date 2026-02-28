import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, XCircle, ExternalLink, ArrowLeft, RefreshCw, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { toast } from "sonner";

export default function SendLanaResult() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { parameters } = useSystemParameters();

  const success = searchParams.get("success") === "true";
  const txHash = searchParams.get("txHash") || "";
  const error = searchParams.get("error") || "";
  const senderAddress = searchParams.get("senderAddress") || "";
  const recipientAddress = searchParams.get("recipientAddress") || "";
  const amount = searchParams.get("amount") || "";
  const fee = searchParams.get("fee") || "";
  const privateKey = searchParams.get("privateKey") || "";

  const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null);
  const [isCheckingBlock, setIsCheckingBlock] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    if (!success && error) {
      // Set checking state immediately and fetch block height
      setIsCheckingBlock(true);
      fetchBlockHeight().then(() => {
        // Auto-start block monitoring after fetching initial height
        startBlockMonitoring();
      });
    }
  }, [success, error]);

  const fetchBlockHeight = async () => {
    try {
      const { data, error: blockError } = await supabase.functions.invoke('get-block-height', {
        body: {
          electrumServers: parameters?.electrumServers || []
        }
      });

      if (blockError) throw blockError;

      if (data?.success && data.blockHeight) {
        setCurrentBlockHeight(data.blockHeight);
      }
    } catch (err) {
      console.error("Error fetching block height:", err);
      setIsCheckingBlock(false);
    }
  };

  const startBlockMonitoring = async () => {
    if (!currentBlockHeight) return;

    setIsCheckingBlock(true);
    const initialBlock = currentBlockHeight;

    // Check every 30 seconds for new block
    const interval = setInterval(async () => {
      try {
        const { data, error: blockError } = await supabase.functions.invoke('get-block-height', {
          body: {
            electrumServers: parameters?.electrumServers || []
          }
        });

        if (blockError) throw blockError;

        if (data?.success && data.blockHeight) {
          setCurrentBlockHeight(data.blockHeight);
          
          // If block has changed, allow retry
          if (data.blockHeight > initialBlock) {
            setCanRetry(true);
            setIsCheckingBlock(false);
            clearInterval(interval);
            toast.success("New block has been mined! You can now retry the transaction.");
          }
        }
      } catch (err) {
        console.error("Error monitoring block:", err);
      }
    }, 30000); // Check every 30 seconds

    // Auto-stop after 2 hours
    setTimeout(() => {
      clearInterval(interval);
      setIsCheckingBlock(false);
      setCanRetry(true);
    }, 2 * 60 * 60 * 1000);
  };

  const handleRetry = async () => {
    try {
      setIsRetrying(true);
      toast.info("Retrying transaction...");

      const { data, error: txError } = await supabase.functions.invoke('send-lana-transaction', {
        body: {
          senderAddress,
          recipientAddress,
          amount: parseFloat(amount),
          privateKey,
          emptyWallet: false,
          electrumServers: parameters?.electrumServers || []
        }
      });

      if (txError) throw txError;

      if (data?.success) {
        // Update URL with new success parameters
        const params = new URLSearchParams({
          success: "true",
          txHash: data.txHash,
          senderAddress,
          recipientAddress,
          amount: data.amount.toString(),
          fee: data.fee.toString()
        });
        navigate(`/send-lana/result?${params.toString()}`, { replace: true });
        toast.success("Transaction successful!");
      } else {
        throw new Error(data?.error || 'Transaction failed');
      }
    } catch (err) {
      console.error("Retry error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to retry transaction");
      
      // Update URL with new error
      const params = new URLSearchParams({
        success: "false",
        error: err instanceof Error ? err.message : "Failed to retry transaction",
        senderAddress,
        recipientAddress,
        amount,
        privateKey
      });
      navigate(`/send-lana/result?${params.toString()}`, { replace: true });
    } finally {
      setIsRetrying(false);
    }
  };

  const explorerUrl = txHash 
    ? `https://chainz.cryptoid.info/lana/tx.dws?${txHash}`
    : null;

  return (
    <div className="max-w-2xl mx-auto">
      <Button variant="ghost" onClick={() => navigate('/wallet')} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Wallet
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {success ? (
              <>
                <CheckCircle2 className="h-6 w-6 text-green-500" />
                Transaction Successful
              </>
            ) : (
              <>
                <XCircle className="h-6 w-6 text-destructive" />
                Transaction Failed
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {success ? (
            <>
              {/* Success Details */}
              <div className="space-y-4">
                <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Transaction ID</p>
                    <p className="font-mono text-sm break-all">{txHash}</p>
                  </div>
                  
                  {explorerUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => window.open(explorerUrl, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View on Block Explorer
                    </Button>
                  )}
                </div>

                <div className="grid gap-3">
                  <div className="flex justify-between items-start">
                    <span className="text-sm text-muted-foreground">From</span>
                    <span className="font-mono text-sm text-right break-all max-w-[200px]">
                      {senderAddress}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-start">
                    <span className="text-sm text-muted-foreground">To</span>
                    <span className="font-mono text-sm text-right break-all max-w-[200px]">
                      {recipientAddress}
                    </span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Amount</span>
                    <span className="font-semibold">
                      {(parseFloat(amount) / 100000000).toFixed(8)} LANA
                    </span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Fee</span>
                    <span className="text-sm">
                      {(parseFloat(fee) / 100000000).toFixed(8)} LANA
                    </span>
                  </div>
                </div>
              </div>

              <Button className="w-full" onClick={() => navigate('/wallet')}>
                Back to Wallet
              </Button>
            </>
          ) : error?.includes('TOO_MANY_UTXOS') ? (
            <>
              {/* Too Many UTXOs - Consolidation Required */}
              <Alert variant="destructive">
                <AlertDescription className="space-y-2">
                  <p className="font-semibold">Too many UTXOs in your wallet</p>
                  <p className="text-sm">
                    Your wallet contains too many unspent transaction outputs (UTXOs).
                    The network cannot process transactions with this many inputs.
                  </p>
                </AlertDescription>
              </Alert>

              <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                <p className="text-sm font-medium">What to do:</p>
                <p className="text-sm text-muted-foreground">
                  Before sending, you need to consolidate your wallet first.
                  Use the Registrar to combine your UTXOs into fewer, larger ones.
                  After consolidation, you can retry the transaction.
                </p>
              </div>

              <div className="space-y-3">
                <Button
                  className="w-full"
                  onClick={() => window.open('https://www.lanawatch.us', '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Registrar to Consolidate
                </Button>

                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => navigate('/wallet')}
                >
                  Back to Wallet
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* Error Details */}
              <Alert variant="destructive">
                <AlertDescription className="space-y-2">
                  <p className="font-semibold">Transaction was rejected by the network.</p>
                  <p className="text-sm">{error}</p>
                </AlertDescription>
              </Alert>

              <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                <p className="text-sm font-medium">Most Common Reason:</p>
                <p className="text-sm text-muted-foreground">
                  The previous transaction has not yet been processed in a block.
                  The network requires the previous block to be confirmed before accepting a new transaction.
                </p>

                {currentBlockHeight && (
                  <div className="mt-4 pt-4 border-t space-y-2">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <span className="text-sm font-medium">Current Block Height:</span>
                      <span className="font-mono text-sm">{currentBlockHeight}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Block processing can take anywhere from a few minutes to up to 2 hours.
                      You will be able to retry once a new block has been mined.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {isCheckingBlock && (
                  <Alert>
                    <AlertDescription className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span className="text-sm">
                        Monitoring blockchain... Waiting for new block (current: {currentBlockHeight})
                      </span>
                    </AlertDescription>
                  </Alert>
                )}

                {canRetry && (
                  <Button
                    className="w-full"
                    onClick={handleRetry}
                    disabled={isRetrying}
                  >
                    {isRetrying ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Retrying Transaction...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Retry Transaction
                      </>
                    )}
                  </Button>
                )}

                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => navigate('/wallet')}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
