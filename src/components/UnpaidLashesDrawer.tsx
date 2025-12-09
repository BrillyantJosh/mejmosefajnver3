import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Trash2, Loader2, Heart, ChevronLeft, ChevronRight } from 'lucide-react';
import { SimplePool, finalizeEvent } from 'nostr-tools';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useNostrUnpaidLashDetails, UnpaidLashDetail } from '@/hooks/useNostrUnpaidLashDetails';
import { useBatchLashSender } from '@/hooks/useBatchLashSender';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

interface BlockStatus {
  canSend: boolean;
  lastBlock?: number;
  currentBlock?: number;
  blockTime?: number;
  error?: string;
}

interface UnpaidLashesDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UnpaidLashesDrawer({ open, onOpenChange }: UnpaidLashesDrawerProps) {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const { 
    displayedLashes,  // ✅ For displaying on current page
    allLashes,  // ✅ All unpaid lashes for batch send
    totalLashes,
    isLoading, 
    currentPage,
    totalPages,
    loadPage,
    removeLashFromList,
    setAutoRefreshEnabled,
    refetch 
  } = useNostrUnpaidLashDetails();
  const { sendBatch, isSending: isSendingBatch } = useBatchLashSender();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [lashToDelete, setLashToDelete] = useState<UnpaidLashDetail | null>(null);
  const [blockStatus, setBlockStatus] = useState<BlockStatus>({ canSend: true });
  const [checkingBlock, setCheckingBlock] = useState(false);

  // Disable auto-refresh when drawer is open
  useEffect(() => {
    if (open) {
      setAutoRefreshEnabled(false);
      if (session?.nostrHexId) {
        checkBlockStatus();
      }
    } else {
      setAutoRefreshEnabled(true);
    }
  }, [open, setAutoRefreshEnabled, session?.nostrHexId]);

  const relays = parameters?.relays && parameters.relays.length > 0 
    ? parameters.relays 
    : DEFAULT_RELAYS;

  const checkBlockStatus = async () => {
    if (!session?.nostrHexId) return;
    
    setCheckingBlock(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-send-eligibility', {
        body: { senderPubkey: session.nostrHexId }
      });

      if (error) {
        console.error('❌ Error checking block status:', error);
        setBlockStatus({ canSend: true }); // Fail-open
        return;
      }

      setBlockStatus(data);
      console.log('📊 Block status:', data);
    } catch (error) {
      console.error('❌ Exception checking block status:', error);
      setBlockStatus({ canSend: true }); // Fail-open
    } finally {
      setCheckingBlock(false);
    }
  };

  const formatLanoshis = (amount: string) => {
    return parseInt(amount).toLocaleString('en-US');
  };

  const formatDate = (timestamp: number) => {
    return format(timestamp * 1000, 'MMM d, yyyy, HH:mm');
  };

  const getRecipientDisplay = (lash: UnpaidLashDetail) => {
    if (lash.recipientDisplayName) return lash.recipientDisplayName;
    if (lash.recipientName) return `@${lash.recipientName}`;
    return `${lash.recipientPubkey.slice(0, 8)}...${lash.recipientPubkey.slice(-6)}`;
  };

  const handleDeleteClick = (lash: UnpaidLashDetail) => {
    setLashToDelete(lash);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!lashToDelete || !session?.nostrPrivateKey || !session?.nostrHexId) {
      toast.error('Error deleting LASH');
      return;
    }

    setDeletingId(lashToDelete.lashId);
    setDeleteDialogOpen(false);
    const pool = new SimplePool();

    try {
      // Convert hex private key to Uint8Array
      const privateKeyBytes = new Uint8Array(
        session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );

      // Create KIND 5 deletion event (NIP-09)
      const deletionEvent = finalizeEvent({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', lashToDelete.eventId],
          ['k', '89800']
        ],
        content: 'LASH payment cancelled by user',
      }, privateKeyBytes);

      console.log('🗑️ Publishing deletion event (KIND 5):', deletionEvent);

      // Publish to relays
      const publishPromises = pool.publish(relays, deletionEvent);
      const results = await Promise.allSettled(publishPromises);
      const successCount = results.filter(r => r.status === 'fulfilled').length;

      if (successCount === 0) {
        throw new Error('Failed to publish to any relay');
      }

      // Remove from local list immediately
      removeLashFromList(lashToDelete.lashId);

      toast.success(`LASH deleted successfully (${successCount}/${relays.length} relays)`);

    } catch (error) {
      console.error('❌ Failed to delete LASH:', error);
      toast.error('Error deleting LASH');
    } finally {
      setDeletingId(null);
      setLashToDelete(null);
      pool.close(relays);
    }
  };

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <Heart className="h-5 w-5 text-destructive fill-current" />
              Unpaid LASHes
            </DrawerTitle>
            <DrawerDescription>
              List of all payments waiting for confirmation {totalLashes > 0 && `(${totalLashes} total)`}
            </DrawerDescription>
          </DrawerHeader>

          {/* Total Sum Display & Send All Button */}
          {allLashes.length > 0 && (
            <div className="px-4 pb-2 space-y-2">
              <div className="border rounded-lg p-4 bg-primary/5">
                <p className="text-sm text-muted-foreground mb-1">Total Amount</p>
                <p className="text-3xl font-bold text-primary">
                  {allLashes.reduce((sum, lash) => sum + parseFloat(lash.amountLana), 0).toFixed(8)} LANA
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatLanoshis(
                    allLashes.reduce((sum, lash) => sum + parseInt(lash.amount), 0).toString()
                  )} lanoshis
                </p>
              </div>

              {/* Block Status Display */}
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
              </div>

              <Button
                onClick={async () => {
                  if (!session?.lanaPrivateKey || !session?.nostrPrivateKey || !session?.nostrHexId || !session?.lanaWalletID) {
                    toast.error("Missing wallet credentials");
                    return;
                  }
                  
                  // Re-check block status before sending
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
                    
                    // Wait for Nostr confirmations to propagate to relays
                    setTimeout(() => {
                      console.log('🔄 Refetching unpaid LASHes after confirmation propagation');
                      refetch();
                      checkBlockStatus(); // Refresh block status after send
                    }, 10000);  // ✅ 10 seconds for relay sync
                    
                    onOpenChange(false);
                  } else if (result.error?.includes('block')) {
                    // If error is block-related, refresh status
                    checkBlockStatus();
                  }
                }}
                disabled={isSendingBatch || checkingBlock || !blockStatus.canSend}
                className="w-full"
              >
                {isSendingBatch ? 'Sending...' : 
                 checkingBlock ? 'Checking blockchain...' :
                 !blockStatus.canSend ? `Wait for Block ${(blockStatus.lastBlock || 0) + 1}` :
                 `Send All (${allLashes.length}) in One Transaction`}
              </Button>
            </div>
          )}

          <div className="px-4 pb-4 max-h-[60vh] overflow-y-auto">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border rounded-lg p-4 space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))}
              </div>
            ) : displayedLashes.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Heart className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-lg font-medium">No unpaid LASHes</p>
                <p className="text-sm">All LASHes are paid! 🎉</p>
              </div>
            ) : (
              <div className="space-y-3">
                {displayedLashes.map((lash) => (
                  <div
                    key={lash.lashId}
                    className="border rounded-lg p-4 hover:bg-accent/5 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-medium truncate">
                            {getRecipientDisplay(lash)}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {formatDate(lash.createdAt)}
                          </Badge>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-bold text-primary">
                              {lash.amountLana} LANA
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatLanoshis(lash.amount)} lanoshis
                          </div>
                          
                          {lash.memo && (
                            <div className="text-sm text-muted-foreground italic mt-2">
                              "{lash.memo}"
                            </div>
                          )}
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteClick(lash)}
                        disabled={deletingId === lash.lashId}
                        className="flex-shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        {deletingId === lash.lashId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadPage(currentPage - 1)}
                  disabled={currentPage === 1 || isLoading}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadPage(currentPage + 1)}
                  disabled={currentPage === totalPages || isLoading}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline">Close</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete LASH?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this LASH of{' '}
              <span className="font-bold">{lashToDelete?.amountLana} LANA</span>{' '}
              to{' '}
              <span className="font-bold">
                {lashToDelete && getRecipientDisplay(lashToDelete)}
              </span>?
              <br /><br />
              This action will publish a KIND 5 deletion event to Nostr relays.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
