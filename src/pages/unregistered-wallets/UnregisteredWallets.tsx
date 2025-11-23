import { useNostrUnregisteredWallets } from '@/hooks/useNostrUnregisteredWallets';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Wallet } from 'lucide-react';
import { nip19 } from 'nostr-tools';

export default function UnregisteredWallets() {
  const { lists, isLoading, refetch } = useNostrUnregisteredWallets();

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
      <div className="flex items-center justify-between mb-6">
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
                  <div className="space-y-1 flex-1">
                    <CardTitle className="text-lg">
                      Owner: {getNpubShort(list.ownerPubkey)}
                    </CardTitle>
                    <CardDescription>
                      Published: {formatDate(list.createdAt)}
                    </CardDescription>
                  </div>
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
                      <div
                        key={idx}
                        className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border"
                      >
                        <Wallet className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-sm break-all">
                            {wallet.address}
                          </p>
                          {wallet.note && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {wallet.note}
                            </p>
                          )}
                        </div>
                      </div>
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
