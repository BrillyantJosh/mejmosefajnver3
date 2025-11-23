import { Wallet, Loader2 } from 'lucide-react';
import { useWalletBalance } from '@/hooks/useWalletBalance';

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

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border">
      <Wallet className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-mono text-sm break-all">
          {address}
        </p>
        {note && (
          <p className="text-sm text-muted-foreground mt-1">
            {note}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2">
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
      </div>
    </div>
  );
}
