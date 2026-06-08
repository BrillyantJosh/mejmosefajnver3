import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, ImagePlus, Loader2, MapPin, Plus, RefreshCw, Save, Sparkles, Store, X } from "lucide-react";
import { toast } from "sonner";
import { AddressSearch } from "@/components/AddressSearch";
import LocationPicker from "@/components/LocationPicker";
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
import { useTranslation } from "@/i18n/I18nContext";
import foodCornerTranslations, { FoodCornerKey } from "@/i18n/modules/foodCorner";
import { FOOD_CORNER_NODE_KIND, FoodCornerNodeStatus } from "@/types/foodCorner";
import {
  describeFoodCornerPause,
  formatFoodMoney,
  generateFoodCornerId,
  groupOrdersByNode,
  slugifyFoodCorner,
} from "@/lib/foodCorner";
import { uploadToLanaMedia } from "@/lib/lanaMediaUpload";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function splitAreas(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function FoodCornerEcoPoint() {
  const { session } = useAuth();
  const { t } = useTranslation(foodCornerTranslations);
  const { status: lana8WonderStatus, isLoading: lana8WonderLoading } = useNostrLana8Wonder();
  const { nodes, producers, orders, isLoading, refetch } = useFoodCornerData();
  const { publishEvent, isPublishing } = useFoodCornerPublisher();

  const dayLabel = (day?: string) => (day ? t(`days.${day.trim().toLowerCase()}` as FoodCornerKey) : "");
  const cycleLabel = (cycle?: string) => (cycle ? t(`cycle.${cycle}` as FoodCornerKey) : "");
  const statusLabel = (status?: string) =>
    status ? t(`ecoPoint.status.${status === "archived" ? "archived" : status}` as FoodCornerKey) : "";

  const myNodes = useMemo(
    () => nodes.filter((node) => node.pubkey === session?.nostrHexId),
    [nodes, session?.nostrHexId],
  );
  const [editingNodeRef, setEditingNodeRef] = useState<string>("");
  const editingNode = myNodes.find((node) => node.ref === editingNodeRef);

  const [showForm, setShowForm] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nodeStatus, setNodeStatus] = useState<FoodCornerNodeStatus>("active");
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
  const [pauseFrom, setPauseFrom] = useState("");
  const [pauseUntil, setPauseUntil] = useState("");
  const [pauseNote, setPauseNote] = useState("");
  const [selectedSellers, setSelectedSellers] = useState<string[]>([]);
  const [selectedListings, setSelectedListings] = useState<string[]>([]);
  const [excludedListings, setExcludedListings] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);

  const handleImageUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast.error(t("ecoPoint.toast.loginRequired"));
      return;
    }
    setUploadingImage(true);
    try {
      const result = await uploadToLanaMedia(file, session.nostrPrivateKey, session.nostrHexId);
      setImageUrl(result.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ecoPoint.toast.imageFailed"));
    } finally {
      setUploadingImage(false);
    }
  };

  useEffect(() => {
    if (!editingNodeRef && myNodes.length > 0) {
      setEditingNodeRef(myNodes[0].ref);
    }
  }, [editingNodeRef, myNodes]);

  useEffect(() => {
    if (!editingNode || !showForm) return;
    setName(editingNode.name);
    setDescription(editingNode.content);
    setNodeStatus(editingNode.status);
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
    setPauseFrom(editingNode.pause.from);
    setPauseUntil(editingNode.pause.until);
    setPauseNote(editingNode.pause.note);
    setSelectedSellers(editingNode.sellers);
    setSelectedListings(editingNode.listings);
    setExcludedListings(editingNode.excludes);
    setImageUrl(editingNode.images[0] || "");
  }, [editingNode, showForm]);

  const startNew = () => {
    setEditingNodeRef("");
    setShowForm(true);
    setName("");
    setDescription("");
    setNodeStatus("active");
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
    setPauseFrom("");
    setPauseUntil("");
    setPauseNote("");
    setSelectedSellers([]);
    setSelectedListings([]);
    setExcludedListings([]);
    setImageUrl("");
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
      toast.error(t("ecoPoint.toast.needLana8Wonder"));
      return;
    }
    if (!name.trim()) {
      toast.error(t("ecoPoint.toast.enterName"));
      return;
    }
    if (!pickupLabel.trim()) {
      toast.error(t("ecoPoint.toast.enterPickup"));
      return;
    }
    if (!pickupLat.trim() || !pickupLon.trim()) {
      toast.error(t("ecoPoint.toast.pickLocation"));
      return;
    }
    if (!Number.isFinite(Number.parseFloat(pickupLat)) || !Number.isFinite(Number.parseFloat(pickupLon))) {
      toast.error(t("ecoPoint.toast.invalidCoords"));
      return;
    }
    if (pauseFrom && pauseUntil && pauseFrom > pauseUntil) {
      toast.error(t("ecoPoint.toast.pauseOrder"));
      return;
    }
    if (selectedSellers.length + selectedListings.length === 0) {
      toast.error(t("ecoPoint.toast.pickSupplier"));
      return;
    }

    const dTag = editingNode?.dTag || slugifyFoodCorner(name) || generateFoodCornerId("dp");
    const areaTags = splitAreas(areas);
    const tags: string[][] = [
      ["d", dTag],
      ["name", name.trim()],
      ["status", nodeStatus],
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
      ...(imageUrl.trim() ? [["image", imageUrl.trim()]] : []),
      ...(nodeStatus === "paused" || pauseFrom.trim() || pauseUntil.trim() || pauseNote.trim()
        ? [["pause", pauseFrom.trim(), pauseUntil.trim(), pauseNote.trim()]]
        : []),
      ["t", "eco_point"],
    ];

    try {
      await publishEvent(FOOD_CORNER_NODE_KIND, tags, description.trim());
      toast.success(t("ecoPoint.toast.published"));
      setShowForm(false);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ecoPoint.toast.failed"));
    }
  };

  const myNodeRefs = new Set(myNodes.map((node) => node.ref));
  const myNodeOrders = orders.filter((order) => myNodeRefs.has(order.distributionPoint));
  const groupedOrders = groupOrdersByNode(myNodeOrders);
  const pickupLatNumber = Number.parseFloat(pickupLat);
  const pickupLonNumber = Number.parseFloat(pickupLon);
  const hasPickupCoordinates = Number.isFinite(pickupLatNumber) && Number.isFinite(pickupLonNumber);

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
          <h2 className="text-lg font-semibold">{t("ecoPoint.heading.manage")}</h2>
          <p className="text-sm text-muted-foreground">{t("ecoPoint.subtitle.manage")}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={refetch}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {!lana8WonderStatus.exists && (
        <Alert>
          <Sparkles className="h-4 w-4" />
          <AlertDescription>{t("ecoPoint.alert.lana8WonderOnly")}</AlertDescription>
        </Alert>
      )}

      {myNodes.length > 0 && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {myNodes.map((node) => (
            <Card
              key={node.ref}
              className={`cursor-pointer ${editingNodeRef === node.ref ? "border-primary ring-1 ring-primary/30" : "hover:border-primary/40"} ${node.status === "archived" ? "opacity-70" : ""}`}
              onClick={() => setEditingNodeRef(node.ref)}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{node.name}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2">{node.content}</p>
                  </div>
                  <Badge>{statusLabel(node.status)}</Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="secondary">{t("ecoPoint.badge.suppliers", { count: node.sellers.length })}</Badge>
                  <Badge variant="secondary">{t("ecoPoint.badge.offers", { count: node.listings.length })}</Badge>
                  <Badge variant="outline">{cycleLabel(node.cycle) || node.cycle || "cycle"}</Badge>
                </div>
                {(node.status === "paused" || describeFoodCornerPause(node)) && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t("ecoPoint.label.pause")}{describeFoodCornerPause(node) ? ` · ${describeFoodCornerPause(node)}` : ""}
                  </p>
                )}
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
                  {t("ecoPoint.button.edit")}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <Button onClick={startNew} disabled={!lana8WonderStatus.exists} className="gap-2">
          <Plus className="h-4 w-4" />
          {t("ecoPoint.button.create")}
        </Button>
        {editingNode && (
          <Button variant="outline" onClick={() => setShowForm(true)} className="gap-2">
            <Store className="h-4 w-4" />
            {t("ecoPoint.button.editSelected")}
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{editingNode ? t("ecoPoint.form.titleEdit") : t("ecoPoint.form.titleNew")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.name")}</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("ecoPoint.form.namePlaceholder")} />
              </div>
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.paymentAddress")}</Label>
                <Input value={lud16} onChange={(event) => setLud16(event.target.value)} placeholder="center@lanapays.us" />
                <p className="text-xs text-muted-foreground">{t("ecoPoint.form.paymentHint")}</p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>{t("ecoPoint.form.description")}</Label>
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("ecoPoint.form.image")}</Label>
              {imageUrl ? (
                <div className="relative w-full max-w-xs">
                  <img src={imageUrl} alt="" className="rounded-lg border w-full aspect-video object-cover" />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="absolute top-2 right-2 gap-1"
                    onClick={() => setImageUrl("")}
                  >
                    <X className="h-3 w-3" />
                    {t("ecoPoint.form.imageRemove")}
                  </Button>
                </div>
              ) : (
                <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed p-4 text-sm text-muted-foreground hover:border-primary/50 w-full max-w-xs">
                  {uploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  {uploadingImage ? t("ecoPoint.form.imageUploading") : t("ecoPoint.form.imageUpload")}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingImage}
                    onChange={(event) => handleImageUpload(event.target.files?.[0])}
                  />
                </label>
              )}
              <p className="text-xs text-muted-foreground">{t("ecoPoint.form.imageHint")}</p>
            </div>

            <div className="grid md:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.status")}</Label>
                <Select value={nodeStatus} onValueChange={(value) => setNodeStatus(value as FoodCornerNodeStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t("ecoPoint.status.active")}</SelectItem>
                    <SelectItem value="paused">{t("ecoPoint.status.paused")}</SelectItem>
                    <SelectItem value="archived">{t("ecoPoint.status.archived")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.cycle")}</Label>
                <Select value={cycle} onValueChange={setCycle}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">{t("cycle.weekly")}</SelectItem>
                    <SelectItem value="biweekly">{t("cycle.biweekly")}</SelectItem>
                    <SelectItem value="monthly">{t("cycle.monthly")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.cutoffDay")}</Label>
                <Select value={cutoffDay} onValueChange={setCutoffDay}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map((day) => <SelectItem key={day} value={day}>{dayLabel(day)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.cutoffTime")}</Label>
                <Input value={cutoffTime} onChange={(event) => setCutoffTime(event.target.value)} placeholder="18:00" />
              </div>
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.areas")}</Label>
                <Input value={areas} onChange={(event) => setAreas(event.target.value)} placeholder="1000 Ljubljana, 1295 ..." />
              </div>
            </div>

            {(nodeStatus === "paused" || pauseFrom || pauseUntil || pauseNote) && (
              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("ecoPoint.form.pauseFrom")}</Label>
                  <Input type="date" value={pauseFrom} onChange={(event) => setPauseFrom(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t("ecoPoint.form.pauseUntil")}</Label>
                  <Input type="date" value={pauseUntil} onChange={(event) => setPauseUntil(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t("ecoPoint.form.pauseReason")}</Label>
                  <Input value={pauseNote} onChange={(event) => setPauseNote(event.target.value)} placeholder={t("ecoPoint.form.pauseReasonPlaceholder")} />
                </div>
              </div>
            )}

            <div className="space-y-3 rounded-lg border p-4">
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.pickupLocation")}</Label>
                <Input value={pickupLabel} onChange={(event) => setPickupLabel(event.target.value)} placeholder={t("ecoPoint.form.pickupLocationPlaceholder")} />
              </div>
              <AddressSearch
                onLocationChange={(lat, lng, displayName) => {
                  setPickupLat(lat);
                  setPickupLon(lng);
                  if (displayName) setPickupLabel(displayName);
                }}
                labels={{
                  autoDetect: t("ecoPoint.addr.autoDetect"),
                  placeholder: t("ecoPoint.addr.placeholder"),
                  noResults: t("ecoPoint.addr.noResults"),
                  selectLocation: t("ecoPoint.addr.selectLocation"),
                  searchFailed: t("ecoPoint.addr.searchFailed"),
                  permissionDenied: t("ecoPoint.addr.permissionDenied"),
                  geoUnavailable: t("ecoPoint.addr.geoUnavailable"),
                }}
              />
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setShowLocationPicker(true)} className="gap-2">
                  <MapPin className="h-4 w-4" />
                  {t("ecoPoint.form.pickOnMap")}
                </Button>
                {hasPickupCoordinates && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {pickupLatNumber.toFixed(6)}, {pickupLonNumber.toFixed(6)}
                  </span>
                )}
              </div>
              {hasPickupCoordinates && (
                <div className="overflow-hidden rounded-lg border">
                  <iframe
                    title={t("ecoPoint.iframe.title")}
                    width="100%"
                    height="220"
                    className="block"
                    loading="lazy"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${pickupLonNumber - 0.01},${pickupLatNumber - 0.007},${pickupLonNumber + 0.01},${pickupLatNumber + 0.007}&layer=mapnik&marker=${pickupLat},${pickupLon}`}
                  />
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${pickupLat}&mlon=${pickupLon}#map=16/${pickupLat}/${pickupLon}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block py-2 text-center text-xs text-primary hover:underline"
                  >
                    {t("ecoPoint.form.openInOSM")}
                  </a>
                </div>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.pickupWindow")}</Label>
                <Input value={pickupWindow} onChange={(event) => setPickupWindow(event.target.value)} placeholder="16:00-19:00" />
              </div>
              <div className="space-y-2">
                <Label>{t("ecoPoint.form.pickupDay")}</Label>
                <Select value={pickupDay} onValueChange={setPickupDay}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map((day) => <SelectItem key={day} value={day}>{dayLabel(day)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid md:grid-cols-4 gap-4 items-end">
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Checkbox checked={deliveryEnabled} onCheckedChange={(checked) => setDeliveryEnabled(checked === true)} />
                {t("ecoPoint.form.enableDelivery")}
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
                <h3 className="font-semibold">{t("ecoPoint.suppliers.title")}</h3>
                <p className="text-sm text-muted-foreground">{t("ecoPoint.suppliers.subtitle")}</p>
              </div>
              {producers.length === 0 ? (
                <Card>
                  <CardContent className="p-5 text-sm text-muted-foreground">
                    {t("ecoPoint.suppliers.empty")}
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
                                {t("ecoPoint.suppliers.producerLine", {
                                  place: producer.city || producer.country || producer.pubkey.slice(0, 10),
                                  count: producer.listings.length,
                                })}
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
                {t("ecoPoint.button.publish")}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>{t("ecoPoint.button.close")}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showLocationPicker && (
        <LocationPicker
          initialLat={hasPickupCoordinates ? pickupLatNumber : undefined}
          initialLng={hasPickupCoordinates ? pickupLonNumber : undefined}
          onLocationSelect={(lat, lng) => {
            setPickupLat(lat.toFixed(6));
            setPickupLon(lng.toFixed(6));
          }}
          onClose={() => setShowLocationPicker(false)}
          labels={{
            title: t("ecoPoint.picker.title"),
            hint: t("ecoPoint.picker.hint"),
            selected: t("ecoPoint.picker.selected"),
            cancel: t("ecoPoint.picker.cancel"),
            confirm: t("ecoPoint.picker.confirm"),
            myLocation: t("ecoPoint.picker.myLocation"),
            locating: t("ecoPoint.picker.locating"),
          }}
        />
      )}

      <div className="space-y-3 pt-3">
        <h2 className="text-lg font-semibold">{t("ecoPoint.orders.title")}</h2>
        {myNodeOrders.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              {t("ecoPoint.orders.empty")}
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
                      <p className="text-sm text-muted-foreground">{node?.name || t("ecoPoint.orders.direct")}</p>
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
          <AlertDescription>{t("ecoPoint.footer")}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
