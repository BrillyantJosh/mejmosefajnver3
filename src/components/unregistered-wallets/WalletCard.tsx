import { Wallet, Loader2, Copy, ExternalLink, Send } from 'lucide-react';
import { useWalletBalance } from '@/hooks/useWalletBalance';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface WalletCardProps {
  address: string;
  note: string;
}

export default function WalletCard({ address, note }: WalletCardProps) {
  const { balance, isLoading } = useWalletBalance(address);

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
