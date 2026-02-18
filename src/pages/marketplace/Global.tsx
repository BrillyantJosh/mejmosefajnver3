import { useMemo } from "react";
import { useNostrMarketOffers } from "@/hooks/useNostrMarketOffers";
import { useNostrSellerProfiles } from "@/hooks/useNostrSellerProfiles";
import OfferCard from "@/components/marketplace/OfferCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe } from "lucide-react";

export default function MarketplaceGlobal() {
  const { offers, isLoading } = useNostrMarketOffers({ status: 'active' });

  // Bulk fetch seller profiles for all offers
  const sellerPubkeys = useMemo(() =>
    Array.from(new Set(offers.map(o => o.pubkey))),
    [offers]
  );
  const { profiles: sellerProfiles } = useNostrSellerProfiles(sellerPubkeys);

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="aspect-[4/3] w-full" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-8 w-1/2" />
            </div>
          ))}
        </div>
      ) : offers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Globe className="h-12 w-12 mx-auto mb-4" />
          <p className="text-lg font-medium mb-2">No offers available</p>
          <p>Check back later for new listings</p>
        </div>
      ) : (
        <>
          <div className="text-sm text-muted-foreground">
            Found {offers.length} offer{offers.length !== 1 ? 's' : ''} worldwide
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {offers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                sellerProfile={sellerProfiles.get(offer.pubkey)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
