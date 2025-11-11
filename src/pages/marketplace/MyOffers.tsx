import { useNostrMarketOffers } from "@/hooks/useNostrMarketOffers";
import { useAuth } from "@/contexts/AuthContext";
import OfferCard from "@/components/marketplace/OfferCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Package, ExternalLink } from "lucide-react";

export default function MarketplaceMyOffers() {
  const { session } = useAuth();
  const { offers, isLoading } = useNostrMarketOffers({ 
    authorFilter: session?.nostrHexId,
    status: 'all'
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Offers</h1>
          <p className="text-muted-foreground">Manage your marketplace listings</p>
        </div>
        <Button 
          variant="outline" 
          asChild
          className="gap-2"
        >
          <a href="https://www.lanamarket.place" target="_blank" rel="noopener noreferrer">
            Manage offers
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      </div>
      
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
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
          <Package className="h-12 w-12 mx-auto mb-4" />
          <p className="text-lg font-medium mb-2">No offers yet</p>
          <p>You haven't created any marketplace offers</p>
        </div>
      ) : (
        <>
          <div className="text-sm text-muted-foreground">
            You have {offers.length} offer{offers.length !== 1 ? 's' : ''}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {offers.map((offer) => (
              <OfferCard key={offer.id} offer={offer} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
