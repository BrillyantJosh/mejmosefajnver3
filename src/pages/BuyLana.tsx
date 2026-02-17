import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Button } from "@/components/ui/button";
import { useNostrBuyOffers } from "@/hooks/useNostrBuyOffers";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import { useNostrSellerProfiles } from "@/hooks/useNostrSellerProfiles";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { Calendar, Coins, ArrowUpDown, ExternalLink } from "lucide-react";
import { useState, useMemo } from "react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

export default function BuyLana() {
  const { profile, isLoading: isProfileLoading } = useNostrProfile();
  const { parameters } = useSystemParameters();
  const userCurrency = profile?.currency || 'USD';
  const { offers, isLoading: isOffersLoading } = useNostrBuyOffers(userCurrency);
  
  const sellerPubkeys = offers.map(offer => offer.sellerPubkey);
  const { profiles, isLoading: isProfilesLoading } = useNostrSellerProfiles(sellerPubkeys);
  
  const exchangeRate = parameters?.exchangeRates?.[userCurrency] || 0;

  const [sortBy, setSortBy] = useState<'amount' | 'seller'>('amount');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const lanoshisToLana = (lanoshis: string) => {
    return (parseInt(lanoshis) / 100000000).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  const calculateFiatPrice = (lanoshis: string) => {
    const lana = parseInt(lanoshis) / 100000000;
    return (lana * exchangeRate).toFixed(2);
  };

  const formatDate = (isoDate: string) => {
    if (!isoDate) return 'No expiry';
    return new Date(isoDate).toLocaleDateString();
  };

  const sortedOffers = useMemo(() => {
    const sorted = [...offers].sort((a, b) => {
      if (sortBy === 'amount') {
        const diff = parseInt(a.amount) - parseInt(b.amount);
        return sortOrder === 'asc' ? diff : -diff;
      } else {
        const sellerA = profiles.get(a.sellerPubkey);
        const sellerB = profiles.get(b.sellerPubkey);
        const nameA = sellerA?.display_name || sellerA?.name || '';
        const nameB = sellerB?.display_name || sellerB?.name || '';
        const diff = nameA.localeCompare(nameB);
        return sortOrder === 'asc' ? diff : -diff;
      }
    });
    return sorted;
  }, [offers, sortBy, sortOrder, profiles]);

  const totalLana = offers.reduce((sum, offer) => sum + parseInt(offer.amount) / 100000000, 0);
  const totalFiat = totalLana * exchangeRate;

  const totalPages = Math.ceil(sortedOffers.length / itemsPerPage);
  const paginatedOffers = sortedOffers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const isLoading = isProfileLoading || isOffersLoading || isProfilesLoading;

  const toggleSort = (column: 'amount' | 'seller') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
    setCurrentPage(1);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Buy LANA</h1>
          <p className="text-muted-foreground">
            Available offers in {userCurrency}
          </p>
        </div>
        <Button asChild>
          <a href="https://www.buylana.com" target="_blank" rel="noopener noreferrer" className="gap-2">
            BUY Lanas
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      </div>

      {offers.length > 0 && (
        <Card className="p-6 bg-muted/50">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Total LANA Available</p>
              <p className="text-2xl font-bold">{totalLana.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} LANA</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Value in {userCurrency}</p>
              <p className="text-2xl font-bold">{totalFiat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {userCurrency}</p>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Available Offers</h2>
        
        {sortedOffers.length === 0 ? (
          <div className="text-center py-12">
            <Coins className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              No offers available in {userCurrency} at the moment
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 md:px-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleSort('seller')}
                        className="gap-1 -ml-2 text-xs md:text-sm"
                      >
                        Seller
                        <ArrowUpDown className="h-3 w-3 md:h-4 md:w-4" />
                      </Button>
                    </th>
                    <th className="text-right py-3 px-2 md:px-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleSort('amount')}
                        className="gap-1 text-xs md:text-sm"
                      >
                        Amount
                        <ArrowUpDown className="h-3 w-3 md:h-4 md:w-4" />
                      </Button>
                    </th>
                    <th className="text-right py-3 px-2 md:px-4 text-xs md:text-sm">Price</th>
                    <th className="text-left py-3 px-2 md:px-4 text-xs md:text-sm">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOffers.map((offer) => {
                    const sellerProfile = profiles.get(offer.sellerPubkey);
                    const displayName = sellerProfile?.display_name || sellerProfile?.name || 'Unknown';
                    
                    return (
                      <tr key={offer.id} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-2 md:px-4">
                          <div className="flex items-center gap-2">
                            <UserAvatar pubkey={offer.sellerPubkey} picture={sellerProfile?.picture} name={displayName} className="h-6 w-6 md:h-8 md:w-8 flex-shrink-0" />
                            <span className="font-medium text-xs md:text-sm truncate">{displayName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-2 md:px-4 text-right font-mono font-semibold text-xs md:text-sm">
                          {lanoshisToLana(offer.amount)}
                        </td>
                        <td className="py-3 px-2 md:px-4 text-right">
                          <div>
                            <div className="font-semibold text-xs md:text-sm whitespace-nowrap">{calculateFiatPrice(offer.amount)} {offer.currency}</div>
                            {offer.validUntil && (
                              <div className="flex items-center gap-1 justify-end text-xs text-muted-foreground">
                                <Calendar className="h-3 w-3 flex-shrink-0" />
                                <span className="whitespace-nowrap">{formatDate(offer.validUntil)}</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-2 md:px-4">
                          <span className="text-xs md:text-sm">{offer.paymentMethods || 'Any'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="mt-6">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      />
                    </PaginationItem>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                      <PaginationItem key={page}>
                        <PaginationLink
                          onClick={() => setCurrentPage(page)}
                          isActive={currentPage === page}
                          className="cursor-pointer"
                        >
                          {page}
                        </PaginationLink>
                      </PaginationItem>
                    ))}
                    <PaginationItem>
                      <PaginationNext 
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </>
        )}
      </Card>

      {offers.length > 0 && (
        <Card className="p-6 bg-muted/50">
          <h3 className="font-semibold mb-2">How to Buy</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Visit BUY Lana server to purchase LANA coins</li>
            <li>Complete the payment using the seller's specified methods</li>
            <li>Receive LANA directly to your wallet</li>
          </ol>
        </Card>
      )}
    </div>
  );
}
