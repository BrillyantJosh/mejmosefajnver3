import { useAuth } from "@/contexts/AuthContext";
import { useNostrUnpaidLashDetails } from "@/hooks/useNostrUnpaidLashDetails";
import { useBatchLashSender } from "@/hooks/useBatchLashSender";
import { useAutoLashSender } from "@/hooks/useAutoLashSender";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, RefreshCw, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useEffect } from "react";

export default function PayLashes() {
  const { session } = useAuth();
  const { allLashes, isLoading, refetch, removeLashFromList, setAutoRefreshEnabled } = useNostrUnpaidLashDetails();
  const { sendBatch, isSending } = useBatchLashSender();
  
  // Use shared auto-send hook with lashes data
  const {
    blockStatus,
    checkingBlock,
    countdown,
    autoSendEnabled,
    setAutoSendEnabled,
    checkBlockStatus,
  } = useAutoLashSender({ allLashes, refetch });

  // Disable auto-refresh when on this page
  useEffect(() => {
    setAutoRefreshEnabled(false);
    
    return () => {
      setAutoRefreshEnabled(true);
    };
  }, [setAutoRefreshEnabled]);

  const formatLanoshis = (amount: string) => {
    return parseInt(amount).toLocaleString();
  };

  const totalLanoshis = allLashes.reduce((sum, lash) => sum + parseInt(lash.amount), 0);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (allLashes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Heart className="h-16 w-16 text-muted-foreground mb-4" />
        <h3 className="text-xl font-semibold mb-2">No Unpaid LASHes</h3>
        <p className="text-muted-foreground">
          You don't have any pending LASH payments to send.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Card */}
      <Card className="p-4 bg-muted/30">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Total Unpaid LASHes:</span>
            <span className="text-lg font-bold">{allLashes.length}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Total Amount:</span>
            <span className="text-lg font-bold text-primary">
              {(totalLanoshis / 100000000).toFixed(8)} LANA
            </span>
          </div>
          <div className="text-xs text-muted-foreground text-right">
            {formatLanoshis(totalLanoshis.toString())} lanoshis
          </div>
        </div>
      </Card>

      {/* Auto-Send Toggle */}
      <Card className="p-4 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <Label htmlFor="auto-send" className="text-sm font-medium cursor-pointer">
              🤖 Auto-send LASHes
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              Automatically send pending LASHes when blockchain is ready
            </p>
          </div>
          <Switch 
            id="auto-send"
            checked={autoSendEnabled} 
            onCheckedChange={setAutoSendEnabled}
          />
        </div>
      </Card>

      {/* Block Status Display */}
      {allLashes.length > 0 && (
        <div className="border rounded-lg p-3 bg-muted/30 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Blockchain Status:</span>
            {checkingBlock ? (
              <span className="text-xs">Checking...</span>
            ) : blockStatus.canSend ? (
              <span className="text-green-600 font-medium">✓ Ready to send</span>
            ) : (
              <span className="text-destructive font-medium">⚠ Wait for next block</span>
            )}
          </div>
          {blockStatus.currentBlock && (
            <div className="mt-1 text-xs text-muted-foreground">
              Current Block: {blockStatus.currentBlock}
              {blockStatus.lastBlock && ` | Last TX: Block ${blockStatus.lastBlock}`}
            </div>
          )}
          {!blockStatus.canSend && blockStatus.error && (
            <div className="mt-2 text-xs text-destructive">
              {blockStatus.error}
            </div>
          )}
          <div className="mt-2 text-xs text-muted-foreground flex items-center justify-between">
            <span>Next check in:</span>
            <span className="font-mono">{Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}</span>
          </div>
          {autoSendEnabled && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Auto-send:</span>
                <span className="text-green-600 font-medium">Active</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Send All Button */}
      <Button
        onClick={async () => {
          if (!session?.lanaPrivateKey || !session?.nostrPrivateKey || !session?.nostrHexId || !session?.lanaWalletID) {
            toast.error("Missing wallet credentials");
            return;
          }
          
          await checkBlockStatus();
          if (!blockStatus.canSend) {
            toast.error("Cannot send in current block. Wait for next block.");
            return;
          }
          
          console.log(`🚀 Sending ALL ${allLashes.length} unpaid LASHes in one transaction`);
          
          const result = await sendBatch(
            allLashes,
            session.lanaPrivateKey,
            session.nostrPrivateKey,
            session.nostrHexId,
            session.lanaWalletID
          );
          
          if (result.success) {
            console.log(`✅ Batch transaction successful: ${result.txid}`);
            console.log(`⏳ Waiting 10 seconds for Nostr event propagation before refetch...`);
            
            setTimeout(() => {
              console.log('🔄 Refetching unpaid LASHes after confirmation propagation');
              refetch();
              checkBlockStatus();
            }, 10000);
          } else if (result.error?.includes('block')) {
            checkBlockStatus();
          }
        }}
        disabled={isSending || checkingBlock || !blockStatus.canSend}
        className="w-full"
      >
        {isSending ? 'Sending...' : 
         checkingBlock ? 'Checking blockchain...' :
         !blockStatus.canSend ? `Wait for Block ${(blockStatus.lastBlock || 0) + 1}` :
         `Send All (${allLashes.length}) in One Transaction`}
      </Button>

      {/* Manual Refresh Button */}
      <Button
        onClick={() => {
          refetch();
          checkBlockStatus();
        }}
        variant="outline"
        className="w-full"
        disabled={checkingBlock}
      >
        <RefreshCw className={`h-4 w-4 mr-2 ${checkingBlock ? 'animate-spin' : ''}`} />
        Check Now
      </Button>

      {/* Lashes List */}
      <div className="space-y-3">
        {allLashes.map((lash) => (
          <Card key={lash.lashId} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <Avatar className="h-10 w-10 flex-shrink-0">
                  <AvatarFallback>
                    {lash.recipientDisplayName?.[0] || lash.recipientName?.[0] || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">
                      {lash.recipientDisplayName || lash.recipientName || "Unknown"}
                    </span>
                    {lash.recipientName && (
                      <span className="text-sm text-muted-foreground">
                        @{lash.recipientName}
                      </span>
                    )}
                  </div>
                  <div className="mt-1">
                    <div className="font-bold text-primary">
                      {(parseInt(lash.amount) / 100000000).toFixed(8)} LANA
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatLanoshis(lash.amount)} lanoshis
                    </div>
                  </div>
                  {lash.memo && (
                    <div className="mt-2 text-sm text-muted-foreground italic">
                      "{lash.memo}"
                    </div>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeLashFromList(lash.eventId)}
                className="flex-shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
