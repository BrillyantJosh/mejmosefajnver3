import { useNostrUnregisteredWallets } from '@/hooks/useNostrUnregisteredWallets';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Wallet } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import AddWalletDialog from '@/components/unregistered-wallets/AddWalletDialog';
import WalletCard from '@/components/unregistered-wallets/WalletCard';
import { useAuth } from '@/contexts/AuthContext';
import { useMemo } from 'react';

export default function UnregisteredWallets() {
  const { lists, isLoading, refetch } = useNostrUnregisteredWallets();
  const { session } = useAuth();

  const myList = lists.find(list => list.ownerPubkey === session?.nostrHexId);
  
  const myWalletAddresses = useMemo(() => 
    myList?.wallets.map(w => w.address) || [], 
    [myList]
  );
  
  const { totalBalance, isLoading: balancesLoading } = useWalletBalances(myWalletAddresses);

  const formatBalance = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const getNpubShort = (hex: string) => {
    try {
      const npub = nip19.npubEncode(hex);
      return `${npub.slice(0, 8)}...${npub.slice(-4)}`;
    } catch {
      return `${hex.slice(0, 8)}...${hex.slice(-4)}`;
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="max-w-7xl mx-auto p-6 pb-20">
      <div className="space-y-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Unregistered Wallets</h1>
            <p className="text-muted-foreground">
              Self-declared lists of unregistered LanaCoin wallets from users
            </p>
          </div>
          <Button
            onClick={() => refetch()}
            disabled={isLoading}
            variant="outline"
            size="sm"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        {session && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-lg">My Unregistered Wallets</CardTitle>
                  <CardDescription>
                    {myList 
                      ? `You have ${myList.wallets.length} wallet${myList.wallets.length !== 1 ? 's' : ''} in your list`
                      : 'You haven\'t published a list yet'}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {myList && (
                    <Badge variant="secondary">
                      {myList.wallets.length} wallet{myList.wallets.length !== 1 ? 's' : ''}
                    </Badge>
                  )}
                  <AddWalletDialog onSuccess={refetch} />
                </div>
              </div>
            </CardHeader>
            {myList && myList.wallets.length > 0 && (
              <CardContent>
                <div className="flex items-center justify-between p-3 rounded-lg bg-background border mb-4">
                  <span className="text-sm font-medium">Total Balance:</span>
                  <div className="flex items-center gap-2">
                    {balancesLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="text-lg font-bold text-primary">
                        {formatBalance(totalBalance)} LANA
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        )}
      </div>

      {isLoading && lists.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : lists.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center">
              No unregistered wallet lists found on relays
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {lists.map((list) => (
            <Card key={list.eventId}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardDescription>
                    Published: {formatDate(list.createdAt)}
                  </CardDescription>
                  <Badge variant="secondary" className="ml-4">
                    {list.wallets.length} wallet{list.wallets.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {list.wallets.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">
                    No wallets in this list
                  </p>
                ) : (
                  <div className="space-y-3">
                    {list.wallets.map((wallet, idx) => (
                      <WalletCard
                        key={idx}
                        address={wallet.address}
                        note={wallet.note}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
