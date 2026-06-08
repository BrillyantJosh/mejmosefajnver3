import { useMemo, useState } from "react";
import { CheckCircle2, Clock, Loader2, PackageCheck, RefreshCw, Truck, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useFoodCornerData } from "@/hooks/useFoodCornerData";
import { useFoodCornerPublisher } from "@/hooks/useFoodCornerPublisher";
import { useTranslation } from "@/i18n/I18nContext";
import foodCornerTranslations, { FoodCornerKey } from "@/i18n/modules/foodCorner";
import {
  FOOD_CORNER_FULFILLMENT_KIND,
  FoodCornerFulfillmentStatus,
  FoodCornerOrderWithFulfillment,
} from "@/types/foodCorner";
import { formatFoodMoney, groupOrdersByNode } from "@/lib/foodCorner";

const STATUS_ACTIONS: Array<{ status: FoodCornerFulfillmentStatus; labelKey: FoodCornerKey; icon: LucideIcon; variant?: "default" | "outline" | "destructive" }> = [
  { status: "confirmed", labelKey: "supplier.action.confirm", icon: CheckCircle2, variant: "default" },
  { status: "rejected", labelKey: "supplier.action.reject", icon: XCircle, variant: "destructive" },
  { status: "packed", labelKey: "supplier.action.packed", icon: PackageCheck, variant: "outline" },
  { status: "delivered", labelKey: "supplier.action.delivered", icon: Truck, variant: "outline" },
  { status: "completed", labelKey: "supplier.action.completed", icon: CheckCircle2, variant: "outline" },
];

function OrderCard({
  order,
  nodeName,
  note,
  onNoteChange,
  onStatus,
  isPublishing,
  t,
}: {
  order: FoodCornerOrderWithFulfillment;
  nodeName: string;
  note: string;
  onNoteChange: (value: string) => void;
  onStatus: (status: FoodCornerFulfillmentStatus) => void;
  isPublishing: boolean;
  t: (key: FoodCornerKey, vars?: Record<string, string | number>) => string;
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={order.fulfillmentStatus ? "default" : "secondary"}>
                {order.fulfillmentStatus || order.status}
              </Badge>
              <span className="font-semibold">{formatFoodMoney(order.total, order.currency)}</span>
              <span className="text-xs text-muted-foreground">{nodeName}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t("supplier.buyer")}: {order.buyerPubkey.slice(0, 12)}... · {new Date(order.createdAt * 1000).toLocaleString()}
            </p>
          </div>
          <div className="text-xs text-muted-foreground md:text-right">
            {order.requestedDate && <p>{t("supplier.date")}: {order.requestedDate}</p>}
            {order.requestedWindow && <p>{t("supplier.window")}: {order.requestedWindow}</p>}
            {order.pickupPoint && <p>{t("supplier.pickup")}: {order.pickupPoint}</p>}
          </div>
        </div>

        <div className="rounded-md border divide-y">
          {order.items.map((item) => (
            <div key={`${order.ref}-${item.listingRef}`} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium truncate">{item.listing?.title || item.listingRef}</p>
                <p className="text-xs text-muted-foreground">
                  {item.qty} {item.unit} × {formatFoodMoney(item.unitPrice, item.currency)}
                </p>
              </div>
              {order.fulfillmentStatus && (
                <Badge variant="outline" className="shrink-0">{order.fulfillmentStatus}</Badge>
              )}
            </div>
          ))}
        </div>

        {order.content && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{order.content}</p>
        )}

        <Textarea
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder={t("supplier.notePlaceholder")}
          rows={2}
        />

        <div className="flex flex-wrap gap-2">
          {STATUS_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Button
                key={action.status}
                size="sm"
                variant={action.variant || "outline"}
                onClick={() => onStatus(action.status)}
                disabled={isPublishing}
                className="gap-2"
              >
                <Icon className="h-4 w-4" />
                {t(action.labelKey)}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function FoodCornerSupplier() {
  const { session } = useAuth();
  const { t } = useTranslation(foodCornerTranslations);
  const { nodes, listings, orders, isLoading, refetch } = useFoodCornerData();
  const { publishEvent, isPublishing } = useFoodCornerPublisher();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const supplierListings = listings.filter((listing) => listing.pubkey === session?.nostrHexId);
  const supplierOrders = useMemo(
    () => orders.filter((order) => order.sellerPubkey === session?.nostrHexId),
    [orders, session?.nostrHexId],
  );
  const grouped = groupOrdersByNode(supplierOrders);
  const nodeNames = new Map(nodes.map((node) => [node.ref, node.name]));

  const publishStatus = async (order: FoodCornerOrderWithFulfillment, status: FoodCornerFulfillmentStatus) => {
    const note = notes[order.ref] || "";
    try {
      await publishEvent(
        FOOD_CORNER_FULFILLMENT_KIND,
        [
          ["d", order.dTag],
          ["a", order.ref],
          ["p", order.buyerPubkey],
          ["status", status],
          ...(status === "delivered" || status === "completed"
            ? [["delivered_at", new Date().toISOString()]]
            : []),
          ...(note.trim() ? [["note", note.trim()]] : []),
        ],
        note.trim(),
      );
      toast.success(t("supplier.toast.published"));
      setNotes((current) => ({ ...current, [order.ref]: "" }));
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("supplier.toast.failed"));
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (supplierListings.length === 0) {
    return (
      <div className="px-4 sm:px-0 space-y-4">
        <Alert>
          <Truck className="h-4 w-4" />
          <AlertDescription>{t("supplier.empty.alert")}</AlertDescription>
        </Alert>
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            {t("supplier.empty.none")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("supplier.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("supplier.subtitle")}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={refetch}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{t("supplier.stat.activeOffers")}</p>
            <p className="text-2xl font-bold">{supplierListings.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{t("supplier.stat.orders")}</p>
            <p className="text-2xl font-bold">{supplierOrders.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{t("supplier.stat.unconfirmed")}</p>
            <p className="text-2xl font-bold">
              {supplierOrders.filter((order) => !order.fulfillmentStatus).length}
            </p>
          </CardContent>
        </Card>
      </div>

      {supplierOrders.length > 0 && (
        <div className="grid md:grid-cols-3 gap-3">
          {grouped.map((group) => (
            <Card key={group.nodeRef}>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{nodeNames.get(group.nodeRef) || t("supplier.directNode")}</p>
                <p className="text-xl font-bold">{t("supplier.ordersCount", { count: group.orders.length })}</p>
                <p className="text-sm font-medium">{formatFoodMoney(group.total, group.currency)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {supplierOrders.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            {t("supplier.empty.noOrders")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {supplierOrders.map((order) => (
            <OrderCard
              key={order.ref}
              order={order}
              nodeName={nodeNames.get(order.distributionPoint) || t("supplier.directNode")}
              note={notes[order.ref] || ""}
              onNoteChange={(value) => setNotes((current) => ({ ...current, [order.ref]: value }))}
              onStatus={(status) => publishStatus(order, status)}
              isPublishing={isPublishing}
              t={t}
            />
          ))}
        </div>
      )}

      <Alert>
        <Clock className="h-4 w-4" />
        <AlertDescription>{t("supplier.footer")}</AlertDescription>
      </Alert>
    </div>
  );
}
