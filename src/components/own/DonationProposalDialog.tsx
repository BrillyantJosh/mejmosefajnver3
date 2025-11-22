import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { SimplePool, EventTemplate, finalizeEvent } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useNostrRevenueShare, RevenueShareEvent } from '@/hooks/useNostrRevenueShare';
import { useAuth } from '@/contexts/AuthContext';

interface DonationProposalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  processRecordId: string;
  recordEventId: string;
  transcriptEventId?: string;
  caseTitle: string;
  lanAmount: number;
  fiatAmount: number;
  fiatCurrency: string;
  payerPubkey: string;
  existingRevenueShare?: RevenueShareEvent;
  onSuccess: () => void;
}

interface PublishResult {
  relay: string;
  success: boolean;
  error?: string;
}

// Helper function to convert hex string to Uint8Array
const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  return bytes;
};

export const DonationProposalDialog = ({
  isOpen,
  onClose,
  processRecordId,
  recordEventId,
  transcriptEventId,
  caseTitle,
  lanAmount,
  fiatAmount,
  fiatCurrency,
  payerPubkey,
  existingRevenueShare,
  onSuccess,
}: DonationProposalDialogProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { parameters } = useSystemParameters();
  
  // Strip "own:" prefix from processRecordId before querying
  const rawProcessRecordId = processRecordId.startsWith('own:') 
    ? processRecordId.substring(4) 
    : processRecordId;
  
  const { revenueShare: fetchedRevenueShare, isLoading } = useNostrRevenueShare(rawProcessRecordId);
  const { session } = useAuth();
  
  // Use existing revenue share if provided, otherwise use fetched one
  const effectiveRevenueShare = existingRevenueShare ?? fetchedRevenueShare;

  const getRelays = (): string[] => {
    return parameters?.relays || [];
  };

  const handleConfirm = async () => {
    setIsSubmitting(true);

    try {
      // 1. Validate user authentication
      if (!session?.nostrPrivateKey || !session?.nostrHexId) {
        toast({
          title: "Authentication Error",
          description: "You must be logged in to create payment proposals",
          variant: "destructive",
        });
        return;
      }

      // 2. Validate revenue share configuration
      if (!effectiveRevenueShare?.data?.revenue_share || effectiveRevenueShare.data.revenue_share.length === 0) {
        toast({
          title: "Error",
          description: "Revenue share configuration not found",
          variant: "destructive",
        });
        return;
      }

      const serviceName = "www.OwnEverything.com";
      const pool = new SimplePool();
      const relays = getRelays();
      const privateKeyBytes = hexToBytes(session.nostrPrivateKey);

      // Strip "own:" prefix for all event IDs
      const rawProcessId = processRecordId.replace(/^own:/, '');
      const rawRecordId = recordEventId.replace(/^own:/, '');
      const rawTranscriptId = transcriptEventId?.replace(/^own:/, '') || '';

      // 3. Create one KIND 90900 event for EACH recipient
      const eventPromises = effectiveRevenueShare.data.revenue_share.map(async (recipient) => {
        // Calculate this recipient's share
        const recipientFiatAmount = fiatAmount * (recipient.share_percent / 100);
        const recipientLanAmount = lanAmount * (recipient.share_percent / 100);
        const recipientLanoshiAmount = Math.round(recipientLanAmount * 100000);

        // Generate unique payment ID
        const paymentId = `pay:lana:${Date.now()}:${recipient.pubkey.slice(0, 8)}`;

        const eventTemplate: EventTemplate = {
          kind: 90900,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["d", paymentId],
            ["p", payerPubkey, "payer"],
            ["p", recipient.pubkey, "recipient"],
            ["wallet", recipient.wallet_id],
            ["fiat", fiatCurrency, recipientFiatAmount.toFixed(2)],
            ["lana", recipientLanAmount.toFixed(2)],
            ["lanoshi", recipientLanoshiAmount.toString()],
            ["type", "unconditional_payment"],
            ["role", recipient.role],
            ["share_percent", recipient.share_percent.toString()],
            ["service", serviceName],
            ["e", rawProcessId, "", "87044"],
            ["e", rawRecordId, "", "37044"],
            ...(rawTranscriptId ? [["e", rawTranscriptId, "", "87944"]] : []),
            ["expires", (Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60).toString()]
          ],
          content: `Unconditional payment share (${recipient.share_percent}% as ${recipient.role}) to access the transcript for: "${caseTitle}". Total payment: ${fiatAmount} ${fiatCurrency}.`
        };

        // Sign event with app_settings private key
        const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);

        // Publish to all relays
        const results: PublishResult[] = [];
        const publishPromises = relays.map(async (relay: string) => {
          return new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              results.push({ relay, success: false, error: 'Connection timeout (10s)' });
              resolve();
            }, 10000);

            try {
              const pubs = pool.publish([relay], signedEvent);
              
              Promise.race([
                (async () => {
                  for await (const pub of pubs) {
                    // At least one relay accepted
                    break;
                  }
                })(),
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Publish timeout')), 8000)
                )
              ]).then(() => {
                clearTimeout(timeout);
                results.push({ relay, success: true });
                resolve();
              }).catch((error) => {
                clearTimeout(timeout);
                results.push({ relay, success: false, error: error.message });
                resolve();
              });
            } catch (error: any) {
              clearTimeout(timeout);
              results.push({ relay, success: false, error: error.message });
              resolve();
            }
          });
        });
        
        await Promise.all(publishPromises);
        return results;
      });

      // 4. Wait for all events to be published
      const allEventResults = await Promise.all(eventPromises);
      const allResults = allEventResults.flat();
      
      pool.close(relays);

      // 5. Check success rate
      const successCount = allResults.filter(r => r.success).length;
      const successfulRelays = new Set(allResults.filter(r => r.success).map(r => r.relay));
      const totalRelays = relays.length;

      if (successCount === 0) {
        throw new Error('Failed to publish to any relay');
      }

      toast({
        title: "Payment Proposals Sent",
        description: `Payment proposals sent to ${effectiveRevenueShare.data.revenue_share.length} recipients! (${successfulRelays.size}/${totalRelays} relays)`,
      });

      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error creating donation proposals:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to create payment proposals",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Payment</DialogTitle>
          <DialogDescription>
            You are about to create an unconditional payment proposal to access the transcript for:
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="bg-muted p-4 rounded-lg">
            <p className="font-medium">{caseTitle}</p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount (LANA):</span>
              <span className="font-medium">{lanAmount.toFixed(2)} LANA</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount ({fiatCurrency}):</span>
              <span className="font-medium">{fiatAmount.toFixed(2)} {fiatCurrency}</span>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            This payment will be distributed among multiple recipients based on the revenue share configuration.
          </p>

          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={isSubmitting || (isLoading && !existingRevenueShare)}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Payment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
