import { Wallet, Loader2, Copy, ExternalLink, Send, Trash2 } from 'lucide-react';
import { useWalletBalance } from '@/hooks/useWalletBalance';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { finalizeEvent, VerifiedEvent } from 'nostr-tools';
import { useState } from 'react';

interface WalletCardProps {
  address: string;
  note: string;
  canDelete?: boolean;
  userPubkey?: string;
  privateKey?: string;
  onDeleted?: () => void;
}

export default function WalletCard({ 
  address, 
  note, 
  canDelete = false, 
  userPubkey, 
  privateKey,
  onDeleted 
}: WalletCardProps) {
  const { balance, isLoading } = useWalletBalance(address);
  const { parameters } = useSystemParameters();
  const [isDeleting, setIsDeleting] = useState(false);

  const formatBalance = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(address);
    toast.success('Address copied to clipboard');
  };

  const handleSendLana = () => {
    window.open('https://lanapay.online', '_blank');
  };

  const transactionLink = `https://chainz.cryptoid.info/lana/address.dws?${address}.htm`;

  const handleDelete = async () => {
    if (!canDelete || !userPubkey || !privateKey || !parameters?.relays) {
      toast.error('Unable to delete wallet');
      return;
    }

    setIsDeleting(true);
    const pool = new SimplePool();

    try {
      // Fetch existing wallets
      const filter = {
        kinds: [30289],
        authors: [userPubkey],
        '#d': [userPubkey],
        limit: 1
      };

      const events = await pool.querySync(parameters.relays, filter);
      const existingEvent = events[0];

      if (!existingEvent) {
        toast.error('Wallet list not found');
        setIsDeleting(false);
        return;
      }

      // Filter out the deleted wallet
      const updatedWallets = existingEvent.tags
        .filter(t => t[0] === 'w' && t.length >= 2)
        .filter(t => t[1] !== address);

      // Create new event
      const hexToBytes = (hex: string): Uint8Array => {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
          bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        return bytes;
      };

      const privateKeyBytes = hexToBytes(privateKey);
      
      const event = finalizeEvent({
        kind: 30289,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', userPubkey],
          ['p', userPubkey],
          ['status', 'active'],
          ...updatedWallets
        ],
        content: ''
      }, privateKeyBytes) as VerifiedEvent;

      // Publish to relays and wait for confirmation
      const publishPromises = parameters.relays.map(async (relay) => {
        try {
          const pub = pool.publish([relay], event);
          await pub;
          console.log(`✅ Published deletion to ${relay}`);
          return true;
        } catch (err) {
          console.error(`❌ Failed to publish to ${relay}:`, err);
          return false;
        }
      });

      const results = await Promise.all(publishPromises);
      const successCount = results.filter(r => r).length;

      if (successCount > 0) {
        console.log(`✅ Wallet deleted and published to ${successCount}/${parameters.relays.length} relays`);
        toast.success('Wallet deleted successfully');
        
        // Wait a moment before refreshing to allow relays to process
        setTimeout(() => {
          onDeleted?.();
        }, 500);
      } else {
        throw new Error('Failed to publish to any relay');
      }
    } catch (error) {
      console.error('Error deleting wallet:', error);
      toast.error('Failed to delete wallet');
    } finally {
      pool.close(parameters.relays);
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border">
      <Wallet className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-start gap-2">
          <p className="font-mono text-sm break-all flex-1">
            {address}
          </p>
          <div className="flex gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleCopyAddress}
              title="Copy address"
            >
              <Copy className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => window.open(transactionLink, '_blank')}
              title="View transactions"
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive hover:text-destructive"
                onClick={handleDelete}
                disabled={isDeleting}
                title="Delete wallet"
              >
                {isDeleting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </Button>
            )}
          </div>
        </div>
        
        {note && (
          <p className="text-sm text-muted-foreground">
            {note}
          </p>
        )}
        
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isLoading ? (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Loading balance...</span>
              </div>
            ) : balance !== null ? (
              <div className="text-xs font-medium">
                Balance: <span className="text-primary">{formatBalance(balance)} LANA</span>
              </div>
            ) : null}
          </div>
          
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleSendLana}
          >
            <Send className="h-3 w-3 mr-1" />
            Send LANA
          </Button>
        </div>
      </div>
    </div>
  );
}
