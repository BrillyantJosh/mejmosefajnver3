import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, WalletCards } from "lucide-react";
import { useNostrUnregisteredWallets } from "@/hooks/useNostrUnregisteredWallets";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useAuth } from "@/contexts/AuthContext";
import WalletCard from "@/components/unregistered-wallets/WalletCard";

export default function TransparencyUnregisteredWallets() {
  const { session } = useAuth();
  const { lists, isLoading } = useNostrUnregisteredWallets();

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

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="space-y-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Unregistered Wallets</h1>
          <p className="text-sm text-muted-foreground">
            Your self-declared unregistered LanaCoin wallets
          </p>
        </div>
      </div>

      {!myList || myList.wallets.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <WalletCards className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">
              You have no unregistered wallets recorded.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-lg">My Unregistered Wallets</CardTitle>
                <CardDescription>
                  {myList.wallets.length} wallet{myList.wallets.length !== 1 ? 's' : ''} in your list
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {myList.wallets.length} wallet{myList.wallets.length !== 1 ? 's' : ''}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border mb-4">
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
            <div className="space-y-2">
              {myList.wallets.map((wallet, idx) => (
                <WalletCard
                  key={idx}
                  address={wallet.address}
                  note={wallet.note}
                  canDelete={false}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
