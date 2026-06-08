import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, Plus, RefreshCw, Save, Sparkles, Store } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useFoodCornerData } from "@/hooks/useFoodCornerData";
import { useFoodCornerPublisher } from "@/hooks/useFoodCornerPublisher";
import { useNostrLana8Wonder } from "@/hooks/useNostrLana8Wonder";
import { FOOD_CORNER_NODE_KIND, FoodCornerNode } from "@/types/foodCorner";
import { formatFoodMoney, generateFoodCornerId, groupOrdersByNode, slugifyFoodCorner } from "@/lib/foodCorner";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function splitAreas(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function FoodCornerEcoPoint() {
  const { session } = useAuth();
  const { status: lana8WonderStatus, isLoading: lana8WonderLoading } = useNostrLana8Wonder();
  const { nodes, producers, orders, isLoading, refetch } = useFoodCornerData();
  const { publishEvent, isPublishing } = useFoodCornerPublisher();

  const myNodes = useMemo(
    () => nodes.filter((node) => node.pubkey === session?.nostrHexId),
    [nodes, session?.nostrHexId],
  );
  const [editingNodeRef, setEditingNodeRef] = useState<string>("");
  const editingNode = myNodes.find((node) => node.ref === editingNodeRef);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cycle, setCycle] = useState("weekly");
  const [cutoffDay, setCutoffDay] = useState("tuesday");
  const [cutoffTime, setCutoffTime] = useState("18:00");
  const [pickupLabel, setPickupLabel] = useState("");
  const [pickupLat, setPickupLat] = useState("");
  const [pickupLon, setPickupLon] = useState("");
  const [pickupDay, setPickupDay] = useState("thursday");
  const [pickupWindow, setPickupWindow] = useState("16:00-19:00");
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryDay, setDeliveryDay] = useState("thursday");
  const [deliveryWindow, setDeliveryWindow] = useState("16:00-20:00");
  const [deliveryRadius, setDeliveryRadius] = useState("20");
  const [areas, setAreas] = useState("");
  const [lud16, setLud16] = useState("");
  const [selectedSellers, setSelectedSellers] = useState<string[]>([]);
  const [selectedListings, setSelectedListings] = useState<string[]>([]);
  const [excludedListings, setExcludedListings] = useState<string[]>([]);

  useEffect(() => {
    if (!editingNodeRef && myNodes.length > 0) {
      setEditingNodeRef(myNodes[0].ref);
    }
  }, [editingNodeRef, myNodes]);

  useEffect(() => {
    if (!editingNode || !showForm) return;
    setName(editingNode.name);
    setDescription(editingNode.content);
    setCycle(editingNode.cycle || "weekly");
    setCutoffDay(editingNode.orderCutoffDay || "tuesday");
    setCutoffTime(editingNode.orderCutoffTime || "18:00");
    setPickupLabel(editingNode.pickups[0]?.label || "");
    setPickupLat(editingNode.pickups[0]?.lat || editingNode.geoLat || "");
    setPickupLon(editingNode.pickups[0]?.lon || editingNode.geoLon || "");
    setPickupDay(editingNode.pickups[0]?.day || "thursday");
    setPickupWindow(editingNode.pickups[0]?.window || "16:00-19:00");
    setDeliveryEnabled(editingNode.fulfillment.includes("delivery"));
    setDeliveryDay(editingNode.deliveries[0]?.day || "thursday");
    setDeliveryWindow(editingNode.deliveries[0]?.window || "16:00-20:00");
    setDeliveryRadius(editingNode.deliveries[0]?.radiusKm || "20");
    setAreas(editingNode.areas.join(", "));
    setLud16(editingNode.lud16);
    setSelectedSellers(editingNode.sellers);
    setSelectedListings(editingNode.listings);
    setExcludedListings(editingNode.excludes);
  }, [editingNode, showForm]);

  const startNew = () => {
    setEditingNodeRef("");
    setShowForm(true);
    setName("");
    setDescription("");
    setCycle("weekly");
    setCutoffDay("tuesday");
    setCutoffTime("18:00");
    setPickupLabel("");
    setPickupLat("");
    setPickupLon("");
    setPickupDay("thursday");
    setPickupWindow("16:00-19:00");
    setDeliveryEnabled(false);
    setDeliveryDay("thursday");
    setDeliveryWindow("16:00-20:00");
    setDeliveryRadius("20");
    setAreas("");
    setLud16("");
    setSelectedSellers([]);
    setSelectedListings([]);
    setExcludedListings([]);
  };

  const toggleSeller = (sellerRef: string, checked: boolean) => {
    setSelectedSellers((current) =>
      checked ? Array.from(new Set([...current, sellerRef])) : current.filter((item) => item !== sellerRef),
    );
    if (!checked) {
      setExcludedListings((current) => current.filter((listingRef) => {
        const producer = producers.find((item) => item.unitRef === sellerRef);
        return !producer?.listings.some((listing) => listing.ref === listingRef);
      }));
    }
  };

  const toggleListing = (sellerRef: string, listingRef: string, checked: boolean) => {
    const sellerSelected = selectedSellers.includes(sellerRef);
    if (sellerSelected) {
      setExcludedListings((current) =>
        checked ? current.filter((item) => item !== listingRef) : Array.from(new Set([...current, listingRef])),
      );
      return;
    }

    setSelectedListings((current) =>
      checked ? Array.from(new Set([...current, listingRef])) : current.filter((item) => item !== listingRef),
    );
  };

  const saveNode = async () => {
    if (!lana8WonderStatus.exists) {
      toast.error("Za ustvarjanje Eko točke potrebuješ Lana8Wonder zapis");
      return;
    }
    if (!name.trim()) {
      toast.error("Vnesi ime Eko točke");
      return;
    }
    if (!pickupLabel.trim()) {
      toast.error("Vnesi lokacijo prevzema");
      return;
    }
    if (selectedSellers.length + selectedListings.length === 0) {
      toast.error("Izberi vsaj enega dobavitelja ali eno ponudbo");
      return;
    }

    const dTag = editingNode?.dTag || slugifyFoodCorner(name) || generateFoodCornerId("dp");
    const areaTags = splitAreas(areas);
    const tags: string[][] = [
      ["d", dTag],
      ["name", name.trim()],
      ["status", "active"],
      ["fulfillment", "pickup"],
      ...(deliveryEnabled ? [["fulfillment", "delivery"]] : []),
      ...selectedSellers.map((sellerRef) => ["seller", sellerRef]),
      ...selectedListings.map((listingRef) => ["listing", listingRef]),
      ...excludedListings.map((listingRef) => ["exclude", listingRef]),
      ["cycle", cycle],
      ["order_cutoff", cutoffDay, cutoffTime],
      ["pickup", "p1", pickupLabel.trim(), pickupLat.trim(), pickupLon.trim(), pickupDay, pickupWindow.trim()],
      ...(deliveryEnabled ? [["delivery", deliveryDay, deliveryWindow.trim(), deliveryRadius.trim()]] : []),
      ...(pickupLat.trim() && pickupLon.trim() ? [["geo", pickupLat.trim(), pickupLon.trim(), pickupLabel.trim()]] : []),
      ...areaTags.map((area) => ["area", area]),
      ...(lud16.trim() ? [["lud16", lud16.trim()]] : []),
      ["t", "eco_point"],
    ];

    try {
      await publishEvent(FOOD_CORNER_NODE_KIND, tags, description.trim());
      toast.success("Eko točka je objavljena na relayje");
      setShowForm(false);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Objava Eko točke ni uspela");
    }
  };

  const myNodeRefs = new Set(myNodes.map((node) => node.ref));
  const myNodeOrders = orders.filter((order) => myNodeRefs.has(order.distributionPoint));
  const groupedOrders = groupOrdersByNode(myNodeOrders);

  if (isLoading || lana8WonderLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Upravljanje Eko točke</h2>
          <p className="text-sm text-muted-foreground">
            Eko točka objavi KIND 30905 in kurira dobavitelje ter njihove KIND 36500 ponudbe.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={refetch}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {!lana8WonderStatus.exists && (
        <Alert>
          <Sparkles className="h-4 w-4" />
          <AlertDescription>
            Ustvarjanje Eko točke je omogočeno samo uporabnikom z Lana8Wonder zapisom KIND 88888.
          </AlertDescription>
        </Alert>
      )}

      {myNodes.length > 0 && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {myNodes.map((node) => (
            <Card
              key={node.ref}
              className={`cursor-pointer ${editingNodeRef === node.ref ? "border-primary ring-1 ring-primary/30" : "hover:border-primary/40"}`}
              onClick={() => setEditingNodeRef(node.ref)}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{node.name}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2">{node.content}</p>
                  </div>
                  <Badge>{node.status}</Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="secondary">{node.sellers.length} dobaviteljev</Badge>
                  <Badge variant="secondary">{node.listings.length} ponudb</Badge>
                  <Badge variant="outline">{node.cycle || "cycle"}</Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingNodeRef(node.ref);
                    setShowForm(true);
                  }}
                >
                  Uredi
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <Button onClick={startNew} disabled={!lana8WonderStatus.exists} className="gap-2">
          <Plus className="h-4 w-4" />
          Ustvari svojo Eko točko
        </Button>
        {editingNode && (
          <Button variant="outline" onClick={() => setShowForm(true)} className="gap-2">
            <Store className="h-4 w-4" />
            Uredi izbrano
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{editingNode ? "Uredi Eko točko" : "Nova Eko točka"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Ime</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Eko točka Center" />
              </div>
              <div className="space-y-2">
                <Label>LanaPays / lud16 naslov</Label>
                <Input value={lud16} onChange={(event) => setLud16(event.target.value)} placeholder="center@lanaeco.farm" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Opis</Label>
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
              </div>
            </div>

            <div className="grid md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Cikel</Label>
                <Select value={cycle} onValueChange={setCycle}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">weekly</SelectItem>
                    <SelectItem value="biweekly">biweekly</SelectItem>
                    <SelectItem value="monthly">monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Rok naročila</Label>
                <Select value={cutoffDay} onValueChange={setCutoffDay}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map((day) => <SelectItem key={day} value={day}>{day}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Ura roka</Label>
                <Input value={cutoffTime} onChange={(event) => setCutoffTime(event.target.value)} placeholder="18:00" />
              </div>
              <div className="space-y-2">
                <Label>Območja</Label>
                <Input value={areas} onChange={(event) => setAreas(event.target.value)} placeholder="1000 Ljubljana, 1295 ..." />
              </div>
            </div>

            <div className="grid md:grid-cols-5 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label>Prevzemna lokacija</Label>
                <Input value={pickupLabel} onChange={(event) => setPickupLabel(event.target.value)} placeholder="Naslov ali opis lokacije" />
              </div>
              <div className="space-y-2">
                <Label>Lat</Label>
                <Input value={pickupLat} onChange={(event) => setPickupLat(event.target.value)} placeholder="46.0569" />
              </div>
              <div className="space-y-2">
                <Label>Lon</Label>
                <Input value={pickupLon} onChange={(event) => setPickupLon(event.target.value)} placeholder="14.5058" />
              </div>
              <div className="space-y-2">
                <Label>Okno</Label>
                <Input value={pickupWindow} onChange={(event) => setPickupWindow(event.target.value)} placeholder="16:00-19:00" />
              </div>
            </div>

            <div className="grid md:grid-cols-4 gap-4 items-end">
              <div className="space-y-2">
                <Label>Dan prevzema</Label>
                <Select value={pickupDay} onValueChange={setPickupDay}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map((day) => <SelectItem key={day} value={day}>{day}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Checkbox checked={deliveryEnabled} onCheckedChange={(checked) => setDeliveryEnabled(checked === true)} />
                Omogoči dostavo
              </label>
              {deliveryEnabled && (
                <>
                  <Input value={deliveryWindow} onChange={(event) => setDeliveryWindow(event.target.value)} placeholder="16:00-20:00" />
                  <Input value={deliveryRadius} onChange={(event) => setDeliveryRadius(event.target.value)} placeholder="20 km" />
                </>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <h3 className="font-semibold">Dobavitelji in ponudbe</h3>
                <p className="text-sm text-muted-foreground">
                  Označi dobavitelja za vse njegove aktivne ponudbe ali izberi posamezne ponudbe.
                </p>
              </div>
              {producers.length === 0 ? (
                <Card>
                  <CardContent className="p-5 text-sm text-muted-foreground">
                    Na relayjih trenutno ni aktivnih KIND 36500 ponudb.
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {producers.map((producer) => {
                    const sellerSelected = selectedSellers.includes(producer.unitRef);
                    return (
                      <Card key={producer.unitRef}>
                        <CardContent className="p-4 space-y-3">
                          <label className="flex items-start gap-3">
                            <Checkbox
                              checked={sellerSelected}
                              onCheckedChange={(checked) => toggleSeller(producer.unitRef, checked === true)}
                              className="mt-1"
                            />
                            <span className="flex-1">
                              <span className="font-medium block">{producer.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {producer.city || producer.country || producer.pubkey.slice(0, 10)} · {producer.listings.length} ponudb
                              </span>
                            </span>
                          </label>

                          <div className="grid md:grid-cols-2 gap-2 pl-7">
                            {producer.listings.map((listing) => {
                              const checked = sellerSelected
                                ? !excludedListings.includes(listing.ref)
                                : selectedListings.includes(listing.ref);
                              return (
                                <label key={listing.ref} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(value) => toggleListing(producer.unitRef, listing.ref, value === true)}
                                  />
                                  <span className="flex-1 truncate">{listing.title}</span>
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    {formatFoodMoney(listing.price, listing.priceCurrency)}/{listing.unit}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button onClick={saveNode} disabled={isPublishing} className="gap-2">
                {isPublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Objavi Eko točko
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Zapri</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3 pt-3">
        <h2 className="text-lg font-semibold">Naročila prek mojih Eko točk</h2>
        {myNodeOrders.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              Ko kupci naročijo prek tvoje Eko točke, se naročila prikažejo tukaj.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid md:grid-cols-3 gap-3">
              {groupedOrders.map((group) => {
                const node = myNodes.find((item) => item.ref === group.nodeRef);
                return (
                  <Card key={group.nodeRef}>
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground">{node?.name || "Direktno"}</p>
                      <p className="text-2xl font-bold">{group.orders.length}</p>
                      <p className="text-sm font-medium">{formatFoodMoney(group.total, group.currency)}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <div className="space-y-3">
              {myNodeOrders.slice(0, 20).map((order) => (
                <Card key={order.ref}>
                  <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={order.fulfillmentStatus ? "default" : "secondary"}>
                          {order.fulfillmentStatus || order.status}
                        </Badge>
                        <span className="font-semibold">{formatFoodMoney(order.total, order.currency)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {order.items.map((item) => `${item.qty} ${item.unit} ${item.listing?.title || item.listingRef.slice(-8)}`).join(" · ")}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground hidden md:block" />
                    <div className="text-xs text-muted-foreground md:text-right">
                      <p>{new Date(order.createdAt * 1000).toLocaleString()}</p>
                      <p>{order.buyerPubkey.slice(0, 12)}...</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {myNodes.length > 0 && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            Aktivna Eko točka ostane zamenljiva po istem <code>d</code> tagu. Ob urejanju objavimo novejši KIND 30905 zapis.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
