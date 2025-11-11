import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, MapPin, Package, Truck, Wallet, Coins, Share2 } from "lucide-react";
import { MarketOffer } from "@/hooks/useNostrMarketOffers";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrSellerProfiles } from "@/hooks/useNostrSellerProfiles";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export default function OfferDetail() {
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const offer = location.state?.offer as MarketOffer | undefined;

  // Fetch seller profile
  const { profiles } = useNostrSellerProfiles(offer ? [offer.pubkey] : []);
  const sellerProfile = offer ? profiles.get(offer.pubkey) : undefined;

  if (!offer) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Button variant="ghost" onClick={() => navigate('/marketplace')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Marketplace
        </Button>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Offer not found</p>
        </div>
      </div>
    );
  }

  // Calculate LANA amount
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

  const handleContactSeller = () => {
    // Navigate to chat with seller
    navigate('/chat', { 
      state: { 
        conversationPubkey: offer.pubkey,
        conversationName: sellerProfile?.display_name || sellerProfile?.name || 'Seller'
      } 
    });
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: offer.title,
        text: offer.description,
        url: window.location.href,
      }).catch(() => {
        // Fallback to clipboard
        navigator.clipboard.writeText(window.location.href);
        toast.success("Link copied to clipboard");
      });
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied to clipboard");
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 pb-20 space-y-6">
      {/* Back Button */}
      <Button variant="ghost" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back
      </Button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Images */}
        <div className="space-y-4">
          {/* Main Image */}
          <div className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
            {offer.image ? (
              <img 
                src={offer.image} 
                alt={offer.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package className="h-24 w-24 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Gallery */}
          {offer.images && offer.images.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {offer.images.map((img, idx) => (
                <div key={idx} className="aspect-square overflow-hidden rounded border">
                  <img 
                    src={img} 
                    alt={`${offer.title} ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column - Details */}
        <div className="space-y-6">
          <div>
            <div className="flex items-start justify-between gap-2 mb-2">
              <h1 className="text-2xl md:text-3xl font-bold break-words flex-1">{offer.title}</h1>
              <Button variant="ghost" size="icon" onClick={handleShare} className="flex-shrink-0">
                <Share2 className="h-5 w-5" />
              </Button>
            </div>
            {offer.category && (
              <Badge variant="secondary">{offer.category}</Badge>
            )}
          </div>

          {/* Price Card */}
          <Card>
            <CardContent className="p-6 space-y-3">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Price</p>
                <p className="text-3xl font-bold text-primary">
                  {offer.currency} {offer.amount}
                </p>
              </div>
              <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-500">
                <Coins className="h-5 w-5" />
                <p className="text-lg font-semibold">
                  {calculateLanaAmount()} LANA
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Contact Seller Button */}
          <Button 
            className="w-full" 
            size="lg"
            onClick={handleContactSeller}
            disabled={offer.pubkey === session?.nostrHexId}
          >
            {offer.pubkey === session?.nostrHexId ? 'Your Offer' : 'Contact Seller'}
          </Button>

          {/* Seller Info */}
          <Card>
            <CardContent className="p-6">
              <p className="text-sm font-medium mb-3">Seller</p>
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src={sellerProfile?.picture} />
                  <AvatarFallback>
                    {(sellerProfile?.display_name || sellerProfile?.name || '?')[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">
                    {sellerProfile?.display_name || sellerProfile?.name || 'Anonymous'}
                  </p>
                  <p className="text-sm text-muted-foreground font-mono break-all">
                    {offer.pubkey.slice(0, 8)}...{offer.pubkey.slice(-8)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Full Width Content */}
      <div className="space-y-6">
        <Separator />

        {/* Description */}
        <div>
          <h2 className="text-xl font-semibold mb-3">Description</h2>
          <p className="text-muted-foreground whitespace-pre-wrap break-words">{offer.description}</p>
        </div>

        {/* Full Content */}
        {offer.content && offer.content !== offer.description && (
          <div>
            <h2 className="text-xl font-semibold mb-3">Details</h2>
            <p className="text-muted-foreground whitespace-pre-wrap break-words">{offer.content}</p>
          </div>
        )}

        <Separator />

        {/* Offer Details */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Offer Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Location */}
            {offer.location && (
              <div className="flex items-start gap-3 p-4 border rounded-lg">
                <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="font-medium">Location</p>
                  <p className="text-sm text-muted-foreground">{offer.location}</p>
                  {offer.latitude && offer.longitude && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {offer.latitude.toFixed(4)}, {offer.longitude.toFixed(4)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Type */}
            {offer.mode && (
              <div className="flex items-start gap-3 p-4 border rounded-lg">
                <Package className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="font-medium">Type</p>
                  <p className="text-sm text-muted-foreground capitalize">
                    {offer.mode.replace('_', ' ')}
                  </p>
                </div>
              </div>
            )}

            {/* Condition */}
            {offer.condition && (
              <div className="flex items-start gap-3 p-4 border rounded-lg">
                <Package className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="font-medium">Condition</p>
                  <p className="text-sm text-muted-foreground capitalize">{offer.condition}</p>
                </div>
              </div>
            )}

            {/* Shipping */}
            {offer.shipping && (
              <div className="flex items-start gap-3 p-4 border rounded-lg">
                <Truck className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="font-medium">Shipping</p>
                  <p className="text-sm text-muted-foreground capitalize">
                    {offer.shipping.replace('_', ' ')}
                  </p>
                </div>
              </div>
            )}

            {/* Payment Wallet */}
            <div className="flex items-start gap-3 p-4 border rounded-lg md:col-span-2">
              <Wallet className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Payment Wallet</p>
                <p className="text-sm text-muted-foreground font-mono truncate">
                  {offer.walletId}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
