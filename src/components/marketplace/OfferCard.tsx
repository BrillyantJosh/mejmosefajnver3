import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Package, Coins } from "lucide-react";
import { MarketOffer } from "@/hooks/useNostrMarketOffers";
import { SellerProfile } from "@/hooks/useNostrSellerProfiles";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNavigate } from "react-router-dom";

interface OfferCardProps {
  offer: MarketOffer;
  sellerProfile?: SellerProfile;
}

const OfferCard = ({ offer, sellerProfile }: OfferCardProps) => {
  const { parameters } = useSystemParameters();
  const navigate = useNavigate();

  // Calculate LANA amount from EUR price
  // Exchange rate format: 1 LANA = X EUR (e.g., 0.004 means 1 LANA = 0.004 EUR)
  // To convert EUR to LANA: divide EUR by exchange rate
  const calculateLanaAmount = (): string => {
    if (!parameters?.exchangeRates?.EUR) return "0";

    const eurAmount = parseFloat(offer.amount);
    const eurPerLana = parameters.exchangeRates.EUR;
    const lanaAmount = eurAmount / eurPerLana;

    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(lanaAmount);
  };

  const handleClick = () => {
    navigate(`/marketplace/offer/${offer.dTag}`, { state: { offer } });
  };

  const sellerName = sellerProfile?.display_name || sellerProfile?.name || `${offer.pubkey.slice(0, 8)}...`;

  return (
    <Card
      className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
      onClick={handleClick}
    >
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {offer.image ? (
          <img
            src={offer.image}
            alt={offer.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="h-16 w-16 text-muted-foreground" />
          </div>
        )}
        {offer.category && (
          <Badge className="absolute top-2 right-2" variant="secondary">
            {offer.category}
          </Badge>
        )}
      </div>

      <CardContent className="p-4 space-y-2">
        {/* Title */}
        <h3 className="font-semibold text-lg line-clamp-1">{offer.title}</h3>

        {/* Description */}
        <p className="text-sm text-muted-foreground line-clamp-2">
          {offer.description}
        </p>

        {/* Price in EUR (primary) */}
        <div className="space-y-1">
          <p className="text-2xl font-bold text-primary">
            {offer.currency} {offer.amount}
          </p>
          {/* Price in LANA (secondary, yellow/gold) */}
          <div className="flex items-center gap-1 text-yellow-600 dark:text-yellow-500">
            <Coins className="h-4 w-4" />
            <p className="text-sm font-medium">
              {calculateLanaAmount()} LANA
            </p>
          </div>
        </div>
      </CardContent>

      <CardFooter className="p-4 pt-0 flex items-center justify-between text-sm text-muted-foreground">
        {/* Seller Info */}
        <div className="flex items-center gap-2 min-w-0">
          <UserAvatar
            pubkey={offer.pubkey}
            picture={sellerProfile?.picture}
            name={sellerProfile?.display_name || sellerProfile?.name}
            className="h-6 w-6"
          />
          <span className="truncate">{sellerName}</span>
        </div>

        {/* Location */}
        {offer.location && (
          <div className="flex items-center gap-1 ml-2 shrink-0">
            <MapPin className="h-3.5 w-3.5" />
            <span className="line-clamp-1 text-xs">{offer.location}</span>
          </div>
        )}
      </CardFooter>
    </Card>
  );
};

export default OfferCard;
