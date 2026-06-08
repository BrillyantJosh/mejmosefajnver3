import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, MapPin, RefreshCw, Send, ShoppingBasket, Store } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useFoodCornerData } from "@/hooks/useFoodCornerData";
import { useFoodCornerPublisher } from "@/hooks/useFoodCornerPublisher";
import {
  FOOD_CORNER_ORDER_KIND,
  FoodCornerListing,
} from "@/types/foodCorner";
import { formatFoodMoney, generateFoodCornerId } from "@/lib/foodCorner";

function firstImage(listing: FoodCornerListing): string | undefined {
  return listing.images[0] || listing.thumbs[0];
}

export default function FoodCornerOrder() {
  const { session } = useAuth();
  const { nodes, orders, isLoading, error, refetch, getNodeCatalog, getNodeByRef } = useFoodCornerData();
  const { publishEvent, isPublishing } = useFoodCornerPublisher();
  const storageKey = session?.nostrHexId ? `food_corner_selected_node_${session.nostrHexId}` : "food_corner_selected_node";

  const [selectedNodeRef, setSelectedNodeRef] = useState(() => localStorage.getItem(storageKey) || "");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [requestedDate, setRequestedDate] = useState("");

  const activeNodes = useMemo(
    () => nodes.filter((node) => node.status === "active"),
    [nodes],
  );
  const selectedNode = getNodeByRef(selectedNodeRef);
  const catalog = useMemo(
    () => getNodeCatalog(selectedNodeRef),
    [getNodeCatalog, selectedNodeRef],
  );

  useEffect(() => {
    if (!selectedNodeRef) return;
    if (!activeNodes.some((node) => node.ref === selectedNodeRef)) {
      setSelectedNodeRef("");
      localStorage.removeItem(storageKey);
    }
  }, [activeNodes, selectedNodeRef, storageKey]);

  const selectedItems = useMemo(
    () =>
      catalog
        .map((listing) => {
          const qty = Number.parseFloat(quantities[listing.ref] || "0");
          return { listing, qty };
        })
        .filter((item) => Number.isFinite(item.qty) && item.qty > 0),
    [catalog, quantities],
  );

  const total = selectedItems.reduce((sum, item) => sum + item.qty * item.listing.price, 0);
  const currency = selectedItems[0]?.listing.priceCurrency || "EUR";
  const myOrders = orders.filter((order) => order.buyerPubkey === session?.nostrHexId);

  const chooseNode = (nodeRef: string) => {
    setSelectedNodeRef(nodeRef);
    localStorage.setItem(storageKey, nodeRef);
    setQuantities({});
  };

  const updateQuantity = (listingRef: string, value: string) => {
    setQuantities((current) => ({
      ...current,
      [listingRef]: value,
    }));
  };

  const placeOrder = async () => {
    if (!session?.nostrHexId) return;
    if (!selectedNode) {
      toast.error("Najprej izberi Eko točko");
      return;
    }
    if (selectedItems.length === 0) {
      toast.error("Dodaj vsaj en izdelek v naročilo");
      return;
    }

    const groups = new Map<string, typeof selectedItems>();
    for (const item of selectedItems) {
      const existing = groups.get(item.listing.unitRef) || [];
      existing.push(item);
      groups.set(item.listing.unitRef, existing);
    }

    try {
      for (const [sellerRef, items] of groups.entries()) {
        const orderId = generateFoodCornerId("o");
        const orderTotal = items.reduce((sum, item) => sum + item.qty * item.listing.price, 0);
        const pickup = selectedNode.pickups[0];
        const itemTags = items.map(({ listing, qty }) => [
          "item",
          listing.ref,
          String(qty),
          listing.unit || "piece",
          listing.price.toFixed(2),
          listing.priceCurrency || "EUR",
        ]);
        const categoryTags = Array.from(new Set(items.flatMap(({ listing }) => listing.tags))).slice(0, 6);

        await publishEvent(
          FOOD_CORNER_ORDER_KIND,
          [
            ["d", orderId],
            ["a", sellerRef],
            ["buyer_type", "individual"],
            ...itemTags,
            ["total", orderTotal.toFixed(2), items[0]?.listing.priceCurrency || "EUR"],
            ["status", "placed"],
            ["fulfillment", "distribution_point"],
            ["distribution_point", selectedNode.ref],
            ...(pickup?.id ? [["pickup_point", pickup.id]] : []),
            ...(requestedDate ? [["requested_date", requestedDate]] : []),
            ...(pickup?.window ? [["requested_window", pickup.window]] : []),
            ["payment", "lana_pay"],
            ["paid", "false"],
            ...categoryTags.map((tag) => ["t", tag]),
          ],
          note.trim(),
        );
      }

      toast.success("Naročilo je objavljeno na relayje");
      setQuantities({});
      setNote("");
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Objava naročila ni uspela");
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0 space-y-5">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Izberi eno Eko točko</h2>
          <p className="text-sm text-muted-foreground">
            Izbrana točka določa, katere ponudbe so trenutno na voljo za naročanje.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={refetch}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {activeNodes.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            Trenutno še ni objavljenih aktivnih Eko točk.
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {activeNodes.map((node) => {
            const isSelected = node.ref === selectedNodeRef;
            return (
              <Card
                key={node.ref}
                className={`cursor-pointer transition-colors ${isSelected ? "border-primary ring-1 ring-primary/30" : "hover:border-primary/40"}`}
                onClick={() => chooseNode(node.ref)}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{node.name}</h3>
                      <p className="text-xs text-muted-foreground line-clamp-2">{node.content || "Brez dodatnega opisa"}</p>
                    </div>
                    {isSelected && <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {node.geoLabel && (
                      <Badge variant="outline" className="gap-1">
                        <MapPin className="h-3 w-3" />
                        {node.geoLabel}
                      </Badge>
                    )}
                    {node.cycle && <Badge variant="secondary">{node.cycle}</Badge>}
                    {node.fulfillment.map((item) => (
                      <Badge key={item} variant="secondary">{item}</Badge>
                    ))}
                  </div>
                  {node.pickups[0] && (
                    <p className="text-xs text-muted-foreground">
                      Prevzem: {node.pickups[0].label} · {node.pickups[0].day} {node.pickups[0].window}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {selectedNode && (
        <>
          <div className="flex items-center justify-between gap-3 pt-2">
            <div>
              <h2 className="text-lg font-semibold">Ponudbe za {selectedNode.name}</h2>
              <p className="text-sm text-muted-foreground">
                Cene prihajajo neposredno iz dobaviteljevih objav KIND 36500.
              </p>
            </div>
            <Badge variant="outline">{catalog.length} ponudb</Badge>
          </div>

          {catalog.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                Ta Eko točka še nima aktivnih ponudb.
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-[1fr_360px] gap-5 items-start">
              <div className="grid md:grid-cols-2 gap-3">
                {catalog.map((listing) => {
                  const image = firstImage(listing);
                  return (
                    <Card key={listing.ref} className="overflow-hidden">
                      {image && (
                        <div className="aspect-[4/2.2] overflow-hidden bg-muted">
                          <img src={image} alt={listing.title} className="h-full w-full object-cover" loading="lazy" />
                        </div>
                      )}
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-semibold truncate">{listing.title}</h3>
                            <p className="text-xs text-muted-foreground line-clamp-2">{listing.content}</p>
                          </div>
                          <Badge variant="secondary" className="shrink-0">{listing.type}</Badge>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-bold">
                            {formatFoodMoney(listing.price, listing.priceCurrency)}
                            <span className="text-xs font-normal text-muted-foreground"> / {listing.unit}</span>
                          </p>
                          <Input
                            type="number"
                            min="0"
                            step="0.1"
                            value={quantities[listing.ref] || ""}
                            onChange={(event) => updateQuantity(listing.ref, event.target.value)}
                            className="w-24"
                            placeholder="0"
                          />
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {listing.eco.slice(0, 3).map((tag) => (
                            <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <Card className="sticky top-20">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShoppingBasket className="h-4 w-4" />
                    Košarica
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Vnesi količine pri ponudbah.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedItems.map(({ listing, qty }) => (
                        <div key={listing.ref} className="flex justify-between gap-3 text-sm">
                          <span className="truncate">{qty} {listing.unit} · {listing.title}</span>
                          <span className="font-medium shrink-0">{formatFoodMoney(qty * listing.price, listing.priceCurrency)}</span>
                        </div>
                      ))}
                      <div className="border-t pt-2 flex justify-between font-bold">
                        <span>Skupaj</span>
                        <span>{formatFoodMoney(total, currency)}</span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="requested-date">Želeni datum prevzema</Label>
                    <Input
                      id="requested-date"
                      type="date"
                      value={requestedDate}
                      onChange={(event) => setRequestedDate(event.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="order-note">Opomba</Label>
                    <Textarea
                      id="order-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Npr. prevzamem po 17:00 ..."
                      rows={3}
                    />
                  </div>

                  <Button className="w-full gap-2" onClick={placeOrder} disabled={isPublishing || selectedItems.length === 0}>
                    {isPublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Oddaj naročilo
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      <div className="pt-4">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Store className="h-5 w-5 text-primary" />
          Moja naročila
        </h2>
        {myOrders.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              Ko oddaš naročilo, bo tukaj prikazan njegov status iz KIND 36602.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {myOrders.slice(0, 8).map((order) => (
              <Card key={order.ref}>
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{formatFoodMoney(order.total, order.currency)}</span>
                      <Badge variant={order.fulfillmentStatus ? "default" : "secondary"}>
                        {order.fulfillmentStatus || order.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {order.items.map((item) => `${item.qty} ${item.unit} ${item.listing?.title || item.listingRef.slice(-8)}`).join(" · ")}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(order.createdAt * 1000).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
