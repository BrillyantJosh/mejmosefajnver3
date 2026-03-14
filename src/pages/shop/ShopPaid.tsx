import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Receipt,
  Loader2,
  CheckCircle,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Inbox,
  User,
} from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { formatCurrency, formatLana } from "@/lib/currencyConversion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SentInvoice {
  id: string;
  pubkey: string;
  createdAt: number;
  invoiceId: string;
  amountFiat: number;
  currency: string;
  amountLana: number;
  walletId: string;
  status: string;
  description: string;
  deadline: number | null;
  targetBuyer: string | null;
  // Payment confirmation data (from KIND 70101)
  paidAt: number | null;
  paidTxId: string | null;
  paidByPubkey: string | null;
  paidFromWallet: string | null;
}

function parseInvoiceEvent(event: any): SentInvoice | null {
  try {
    const tags = event.tags || [];
    const getTag = (name: string): string | undefined =>
      tags.find((t: string[]) => t[0] === name)?.[1];

    const invoiceId = getTag("d");
    const amountFiat = parseFloat(getTag("amount_fiat") || "0");
    const currency = getTag("currency") || "EUR";
    const amountLana = parseFloat(getTag("amount_lana") || "0");
    const walletId = getTag("wallet_id");
    const status = getTag("status") || "open";
    const description = getTag("description") || event.content || "";
    const deadlineStr = getTag("deadline");
    const deadline = deadlineStr ? parseInt(deadlineStr, 10) : null;
    const targetBuyer =
      tags.find((t: string[]) => t[0] === "p")?.[1] || null;

    if (!invoiceId || !walletId || amountLana <= 0) return null;

    return {
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      invoiceId,
      amountFiat,
      currency,
      amountLana,
      walletId,
      status,
      description,
      deadline,
      targetBuyer,
      paidAt: null,
      paidTxId: null,
      paidByPubkey: null,
      paidFromWallet: null,
    };
  } catch {
    return null;
  }
}

// Sub-component for invoice row
function InvoiceRow({ invoice }: { invoice: SentInvoice }) {
  const [expanded, setExpanded] = useState(false);
  const { profile: buyerProfile } = useNostrProfileCache(
    invoice.paidByPubkey || invoice.targetBuyer || ""
  );

  const isPaid = !!invoice.paidTxId;
  const now = Math.floor(Date.now() / 1000);
  const isExpired = !isPaid && invoice.deadline && invoice.deadline < now;

  const formatDate = (unix: number) => {
    return new Date(unix * 1000).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Card
      className={`transition-shadow ${
        isPaid
          ? "border-green-200 dark:border-green-800/50"
          : isExpired
          ? "border-muted opacity-60"
          : ""
      }`}
    >
      <CardContent className="p-3 sm:p-4">
        {/* Main row — always visible */}
        <button
          className="w-full text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-3">
            {/* Status icon */}
            <div className="shrink-0">
              {isPaid ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : isExpired ? (
                <Clock className="h-5 w-5 text-muted-foreground" />
              ) : (
                <Clock className="h-5 w-5 text-orange-500" />
              )}
            </div>

            {/* Amount + description */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-base sm:text-lg font-bold">
                  {formatLana(invoice.amountLana)}
                </span>
                {invoice.amountFiat > 0 && invoice.currency !== "LANA" && (
                  <span className="text-xs sm:text-sm text-muted-foreground">
                    {formatCurrency(invoice.amountFiat, invoice.currency)}
                  </span>
                )}
              </div>
              {invoice.description && (
                <p className="text-xs sm:text-sm text-muted-foreground truncate">
                  {invoice.description}
                </p>
              )}
            </div>

            {/* Status badge + expand */}
            <div className="flex items-center gap-2 shrink-0">
              {isPaid ? (
                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs">
                  Paid
                </Badge>
              ) : isExpired ? (
                <Badge variant="secondary" className="text-xs">
                  Expired
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                  Open
                </Badge>
              )}
              {expanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </button>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-3 pt-3 border-t space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{formatDate(invoice.createdAt)}</span>
            </div>

            {invoice.deadline && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deadline</span>
                <span className={isExpired ? "text-destructive" : ""}>
                  {formatDate(invoice.deadline)}
                </span>
              </div>
            )}

            <div className="flex justify-between items-start">
              <span className="text-muted-foreground">Receive wallet</span>
              <span className="font-mono text-xs text-right break-all max-w-[55%]">
                {invoice.walletId}
              </span>
            </div>

            {/* Target buyer */}
            {(invoice.targetBuyer || invoice.paidByPubkey) && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {isPaid ? "Paid by" : "Sent to"}
                </span>
                <div className="flex items-center gap-2">
                  <UserAvatar
                    pubkey={invoice.paidByPubkey || invoice.targetBuyer || ""}
                    picture={buyerProfile?.picture}
                    name={buyerProfile?.display_name || buyerProfile?.full_name}
                    className="h-5 w-5"
                  />
                  <span className="text-xs truncate max-w-[120px]">
                    {buyerProfile?.display_name ||
                      buyerProfile?.full_name ||
                      (invoice.paidByPubkey || invoice.targetBuyer || "").slice(0, 12) + "..."}
                  </span>
                </div>
              </div>
            )}

            {/* Payment details */}
            {isPaid && (
              <>
                {invoice.paidAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Paid at</span>
                    <span className="text-green-600">
                      {formatDate(invoice.paidAt)}
                    </span>
                  </div>
                )}
                {invoice.paidTxId && (
                  <div>
                    <span className="text-muted-foreground">TX Hash</span>
                    <p className="font-mono text-xs break-all mt-1 bg-muted p-2 rounded">
                      {invoice.paidTxId}
                    </p>
                  </div>
                )}
                {invoice.paidFromWallet && (
                  <div className="flex justify-between items-start">
                    <span className="text-muted-foreground">From wallet</span>
                    <span className="font-mono text-xs text-right break-all max-w-[55%]">
                      {invoice.paidFromWallet}
                    </span>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-between">
              <span className="text-muted-foreground">Invoice ID</span>
              <span className="font-mono text-xs">
                {invoice.invoiceId.slice(0, 8)}...
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ShopPaid() {
  const { session } = useAuth();

  const [invoices, setInvoices] = useState<SentInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "paid" | "open">("all");

  // Fetch user's invoices (KIND 70100) and payment confirmations (KIND 70101)
  const fetchData = async () => {
    if (!session?.nostrHexId) return;

    setIsLoading(true);
    try {
      // Fetch KIND 70100 (invoices by this user) and KIND 70101 (payment confirmations for this user)
      const [invoiceRes, confirmRes] = await Promise.all([
        supabase.functions.invoke("query-nostr-events", {
          body: {
            filter: {
              kinds: [70100],
              authors: [session.nostrHexId],
              limit: 200,
            },
            timeout: 15000,
          },
        }),
        supabase.functions.invoke("query-nostr-events", {
          body: {
            filter: {
              kinds: [70101],
              "#p": [session.nostrHexId],
              limit: 200,
            },
            timeout: 15000,
          },
        }),
      ]);

      if (invoiceRes.error) {
        console.error("Failed to fetch invoices:", invoiceRes.error);
        toast.error("Failed to load invoices");
        return;
      }

      // Parse invoices
      const invoiceEvents = invoiceRes.data?.events || [];
      const parsed: SentInvoice[] = invoiceEvents
        .map(parseInvoiceEvent)
        .filter((inv: SentInvoice | null): inv is SentInvoice => inv !== null);

      // Build confirmation lookup: invoice_ref event ID → confirmation data
      const confirmEvents = confirmRes.data?.events || [];
      const confirmMap = new Map<
        string,
        { paidAt: number; txId: string; paidBy: string; fromWallet: string }
      >();

      for (const evt of confirmEvents) {
        const tags = evt.tags || [];
        const getTag = (name: string): string | undefined =>
          tags.find((t: string[]) => t[0] === name)?.[1];

        const invoiceRef = getTag("invoice_ref");
        const txId = getTag("tx_id");
        const status = getTag("status");
        const senderWallet = getTag("sender_wallet");

        if (invoiceRef && txId && status === "confirmed") {
          confirmMap.set(invoiceRef, {
            paidAt: evt.created_at,
            txId,
            paidBy: evt.pubkey,
            fromWallet: senderWallet || "",
          });
        }
      }

      // Merge confirmation data into invoices
      for (const inv of parsed) {
        const conf = confirmMap.get(inv.id);
        if (conf) {
          inv.paidAt = conf.paidAt;
          inv.paidTxId = conf.txId;
          inv.paidByPubkey = conf.paidBy;
          inv.paidFromWallet = conf.fromWallet;
        }
      }

      // Sort: paid first (newest paid first), then open (newest first), then expired
      parsed.sort((a, b) => {
        const now = Math.floor(Date.now() / 1000);
        const aIsPaid = !!a.paidTxId;
        const bIsPaid = !!b.paidTxId;
        const aIsExpired = !aIsPaid && a.deadline && a.deadline < now;
        const bIsExpired = !bIsPaid && b.deadline && b.deadline < now;

        // Paid before open, open before expired
        if (aIsPaid && !bIsPaid) return -1;
        if (!aIsPaid && bIsPaid) return 1;
        if (!aIsExpired && bIsExpired) return -1;
        if (aIsExpired && !bIsExpired) return 1;

        // Within same status, sort by creation date (newest first)
        return b.createdAt - a.createdAt;
      });

      setInvoices(parsed);
    } catch (error) {
      console.error("Error fetching paid data:", error);
      toast.error("Failed to load data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [session?.nostrHexId]);

  // Filter invoices
  const filteredInvoices = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return invoices.filter((inv) => {
      if (filter === "paid") return !!inv.paidTxId;
      if (filter === "open") {
        return !inv.paidTxId && (!inv.deadline || inv.deadline >= now);
      }
      return true; // "all"
    });
  }, [invoices, filter]);

  // Stats
  const stats = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const paid = invoices.filter((inv) => !!inv.paidTxId).length;
    const open = invoices.filter(
      (inv) => !inv.paidTxId && (!inv.deadline || inv.deadline >= now)
    ).length;
    const expired = invoices.filter(
      (inv) => !inv.paidTxId && inv.deadline && inv.deadline < now
    ).length;
    const totalLanaPaid = invoices
      .filter((inv) => !!inv.paidTxId)
      .reduce((sum, inv) => sum + inv.amountLana, 0);
    return { paid, open, expired, total: invoices.length, totalLanaPaid };
  }, [invoices]);

  return (
    <div className="px-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Receipt className="h-5 w-5 sm:h-6 sm:w-6" />
            Paid
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Your sent invoices & payment status
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          disabled={isLoading}
        >
          <RefreshCw
            className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`}
          />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* Stats bar */}
      {!isLoading && invoices.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setFilter(filter === "paid" ? "all" : "paid")}
            className={`p-2 sm:p-3 rounded-lg text-center transition-colors ${
              filter === "paid"
                ? "bg-green-100 dark:bg-green-900/30 ring-2 ring-green-500"
                : "bg-muted hover:bg-muted/80"
            }`}
          >
            <p className="text-lg sm:text-xl font-bold text-green-600">{stats.paid}</p>
            <p className="text-[0.65rem] sm:text-xs text-muted-foreground">Paid</p>
          </button>
          <button
            onClick={() => setFilter(filter === "open" ? "all" : "open")}
            className={`p-2 sm:p-3 rounded-lg text-center transition-colors ${
              filter === "open"
                ? "bg-orange-100 dark:bg-orange-900/30 ring-2 ring-orange-500"
                : "bg-muted hover:bg-muted/80"
            }`}
          >
            <p className="text-lg sm:text-xl font-bold text-orange-500">{stats.open}</p>
            <p className="text-[0.65rem] sm:text-xs text-muted-foreground">Open</p>
          </button>
          <div className="p-2 sm:p-3 bg-muted rounded-lg text-center">
            <p className="text-lg sm:text-xl font-bold">{stats.total}</p>
            <p className="text-[0.65rem] sm:text-xs text-muted-foreground">Total</p>
          </div>
        </div>
      )}

      {/* Total LANA earned */}
      {!isLoading && stats.totalLanaPaid > 0 && (
        <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">Total earned</p>
          <p className="text-xl sm:text-2xl font-bold text-green-600">
            {formatLana(stats.totalLanaPaid)}
          </p>
        </div>
      )}

      {/* Invoice list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">
            Loading invoices...
          </span>
        </div>
      ) : filteredInvoices.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Inbox className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {filter !== "all"
                ? `No ${filter} invoices`
                : "No invoices sent yet"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {filter !== "all"
                ? "Try a different filter"
                : "Create an invoice from the Sell tab"}
            </p>
            {filter !== "all" && (
              <Button
                variant="link"
                className="mt-2"
                onClick={() => setFilter("all")}
              >
                Show all
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredInvoices.map((invoice) => (
            <InvoiceRow key={invoice.id} invoice={invoice} />
          ))}
        </div>
      )}
    </div>
  );
}
