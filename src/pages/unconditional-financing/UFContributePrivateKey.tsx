import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { useUfRequest, UF_API, UF_CONTRIBUTION_KIND } from "@/hooks/useUFData";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, ScanLine, AlertCircle, CheckCircle } from "lucide-react";
import { convertWifToIds } from "@/lib/crypto";
import { useToast } from "@/hooks/use-toast";
import { QRScanner } from "@/components/QRScanner";
import { supabase } from "@/integrations/supabase/client";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useAuth } from "@/contexts/AuthContext";
import { finalizeEvent } from "nostr-tools";
import { useLang } from "@/i18n/I18nContext";

interface ContributeState {
  selectedWalletId: string;
  fiatAmount: number;
  lanaAmount: number;
  rate: number;
  message: string;
  repaymentWalletId: string;
}

// A payment that went on-chain but whose record steps did not complete yet.
// Persisted to sessionStorage BEFORE the fallible post-payment steps so a lost
// response / thrown post-step / page refresh can NEVER lead to a second payment.
interface PendingContribution {
  txHash: string;
  actualLanoshis: number;
  fiatAmount: number;
  lanaAmount: number;
  rate: number;
  selectedWalletId: string;
  repaymentWalletId: string;
  message: string;
  ts: number;
}

// Helper: hex string → Uint8Array
const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

const UFContributePrivateKey = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const sl = useLang() === "sl";
  const { detail, isLoading: requestLoading } = useUfRequest(id);
  const { parameters } = useSystemParameters();
  const { session } = useAuth();

  const [privateKey, setPrivateKey] = useState<string>("");
  const [isValidating, setIsValidating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [validationError, setValidationError] = useState<string>("");
  const [isValid, setIsValid] = useState(false);
  // Set the moment the on-chain payment succeeds; from then on the button must
  // never re-enable into a second payment.
  const txHashRef = useRef<string | null>(null);
  const [paidUnrecorded, setPaidUnrecorded] = useState(false);
  const resumeAttemptedRef = useRef(false);

  const PENDING_KEY = `uf-pending-contribution-${id}`;

  const readPending = (): PendingContribution | null => {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      return raw ? (JSON.parse(raw) as PendingContribution) : null;
    } catch {
      return null;
    }
  };

  const state = (location.state || {}) as Partial<ContributeState>;
  const { selectedWalletId, fiatAmount, lanaAmount, rate, message, repaymentWalletId } = state;
  const stateMissing =
    !selectedWalletId || !fiatAmount || !lanaAmount || !rate || !repaymentWalletId;

  // Redirect back if navigation state is missing (e.g. page refresh) — UNLESS a
  // pending on-chain payment exists: then we stay to complete its record.
  useEffect(() => {
    if (stateMissing && !readPending()) {
      navigate(`/unconditional-financing/contribute/${id}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateMissing, id, navigate]);

  const handleQRScan = (data: string) => {
    setPrivateKey(data);
    setShowScanner(false);
  };

  // Debounced real-time WIF validation against the selected source wallet
  useEffect(() => {
    const validateKey = async () => {
      if (!privateKey.trim()) {
        setValidationError("");
        setIsValid(false);
        setIsValidating(false);
        return;
      }

      setIsValidating(true);
      setValidationError("");

      try {
        const result = await convertWifToIds(privateKey.trim());

        // Check both compressed and uncompressed addresses
        // Older wallet registrations (KIND 30889) may use uncompressed addresses
        const matchesCompressed = result.walletIdCompressed === selectedWalletId;
        const matchesUncompressed = result.walletIdUncompressed === selectedWalletId;

        if (!matchesCompressed && !matchesUncompressed) {
          setValidationError(
            sl
              ? "Ključ ne pripada izbrani denarnici."
              : "This key does not belong to the selected wallet."
          );
          setIsValid(false);
        } else {
          setValidationError("");
          setIsValid(true);
        }
      } catch {
        setValidationError(
          sl ? "Neveljaven format zasebnega ključa." : "Invalid private key format."
        );
        setIsValid(false);
      } finally {
        setIsValidating(false);
      }
    };

    const timeoutId = setTimeout(validateKey, 500);
    return () => clearTimeout(timeoutId);
  }, [privateKey, selectedWalletId, sl]);

  // Steps 2–5: sign the KIND 60210, publish it, record it, navigate. Takes the
  // pending snapshot (NOT navigation state) so it also works when resuming
  // after a refresh/lost response. Throwing here never re-triggers a payment.
  const recordContribution = async (p: PendingContribution) => {
    const request = detail?.request;
    if (!request || !session?.nostrHexId || !session?.nostrPrivateKey) {
      throw new Error(sl ? "Manjka seja ali zahtevek." : "Missing session or request.");
    }

    const dTag = request.id;
    const eventTemplate = {
      kind: UF_CONTRIBUTION_KIND,
      created_at: p.ts,
      tags: [
        ["service", "unconditional-financing"],
        ["request", dTag],
        ["a", `31240:${request.pubkey}:${dTag}`],
        ["p", session.nostrHexId, "", "financier"],
        ["p", request.pubkey, "", "requester"],
        ["amount_lanoshis", String(p.actualLanoshis)],
        ["amount_fiat", String(p.fiatAmount)],
        ["currency", request.currency],
        ["rate", String(p.rate)],
        ["from_wallet", p.selectedWalletId],
        ["repayment_wallet", p.repaymentWalletId],
        ["to_wallet", request.wallet],
        ["tx", p.txHash],
        ["timestamp_paid", String(p.ts)],
        ["client", "mejmosefajn"],
      ],
      content: p.message || "",
    };

    const signed = finalizeEvent(eventTemplate, hexToBytes(session.nostrPrivateKey));

    // Publish to relays — verify the result; on failure queue for background
    // retry (retryPendingNostrEvents) so the event is never silently lost.
    let publishedOk = false;
    try {
      const { data: pubData, error: publishError } = await supabase.functions.invoke(
        "publish-dm-event",
        { body: { event: signed } }
      );
      publishedOk = !publishError && pubData?.success === true && (pubData?.publishedTo ?? 0) > 0;
    } catch {
      publishedOk = false;
    }
    if (!publishedOk) {
      console.warn("Contribution publish failed — queuing for background retry");
      supabase.functions
        .invoke("queue-relay-event", { body: { signedEvent: signed, userPubkey: session.nostrHexId } })
        .catch(() => {});
    }

    // Record in server SQLite — the server verifies the SIGNED EVENT and
    // derives all fields from it (hardened contract).
    try {
      const res = await fetch(`${UF_API}/contributions/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: signed }),
      });
      if (res.status === 409) {
        toast({
          title: sl ? "Financiranje še ni odprto" : "Funding not yet open",
          description: sl
            ? "Zahtevek še zori — prispevek je bil poslan na verigo, a strežnik ga je zavrnil, ker financiranje še ni odprto."
            : "The request is still maturing — the payment was sent on-chain, but the server rejected the record because funding is not open yet.",
          variant: "destructive",
        });
      }
    } catch (recordErr) {
      // Non-fatal: background indexer will pick it up from relays
      console.warn("Contribution record failed (will be indexed later):", recordErr);
    }

    // Done — clear the pending marker and show the result.
    sessionStorage.removeItem(PENDING_KEY);
    navigate(`/unconditional-financing/contribute/${id}/result`, {
      state: {
        txHash: p.txHash,
        fiatAmount: p.fiatAmount,
        lanaAmount: p.lanaAmount,
        currency: request.currency,
        requestTitle: request.title,
        requestId: request.id,
        eventId: signed.id,
      },
    });
  };

  // Resume: a previous payment went on-chain but its record didn't complete
  // (lost response, thrown post-step, refresh). Complete it WITHOUT paying again.
  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    const pending = readPending();
    if (!pending?.txHash || !detail?.request || !session?.nostrPrivateKey) return;
    resumeAttemptedRef.current = true;
    txHashRef.current = pending.txHash;
    toast({
      title: sl ? "Zaznano prejšnje plačilo" : "Previous payment detected",
      description: sl
        ? "Plačilo je bilo že poslano na verigo — dokončujem zapis. NE plačuj znova."
        : "The payment was already sent on-chain — completing the record. Do NOT pay again.",
    });
    setIsSending(true);
    recordContribution(pending)
      .catch((err) => {
        console.error("Pending contribution completion failed:", err);
        setPaidUnrecorded(true);
      })
      .finally(() => setIsSending(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.request?.id, session?.nostrPrivateKey]);

  const handleConfirm = async () => {
    const request = detail?.request;
    if (!isValid || !request || !parameters || stateMissing || paidUnrecorded) return;

    if (!session?.nostrHexId || !session?.nostrPrivateKey) {
      toast({
        title: sl ? "Napaka" : "Error",
        description: sl ? "Za prispevek se moraš prijaviti." : "You must be logged in to contribute.",
        variant: "destructive",
      });
      return;
    }

    // Never start a second payment while one is pending completion.
    if (readPending()?.txHash || txHashRef.current) {
      toast({
        title: sl ? "Plačilo že poslano" : "Payment already sent",
        description: sl
          ? "Prejšnje plačilo je že na verigi — ne plačuj znova."
          : "A previous payment is already on-chain — do not pay again.",
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);

    try {
      toast({
        title: sl ? "Pošiljanje transakcije..." : "Sending transaction...",
        description: sl
          ? "LANA transakcija se izvaja na verigi."
          : "The LANA transaction is being processed on-chain.",
      });

      // Step 1: on-chain LANA payment to the recipient's wallet
      const { data: txData, error: txError } = await supabase.functions.invoke(
        "send-lana-transaction",
        {
          body: {
            senderAddress: selectedWalletId,
            recipientAddress: request.wallet,
            amount: lanaAmount,
            privateKey: privateKey.trim(),
            electrumServers: parameters.electrumServers || [],
            userPubkey: session.nostrHexId,
          },
        }
      );

      if (txError || !txData?.success || !txData?.txHash) {
        throw new Error(
          txData?.error ||
            (sl ? "Transakcija ni uspela." : "Transaction failed.")
        );
      }

      // MONEY IS NOW ON-CHAIN. Persist the pending snapshot BEFORE any further
      // fallible step, so nothing past this point can cause a double payment.
      const pending: PendingContribution = {
        txHash: txData.txHash,
        actualLanoshis: txData.projectAmount ?? txData.amount ?? Math.round(lanaAmount * 1e8),
        fiatAmount,
        lanaAmount,
        rate,
        selectedWalletId,
        repaymentWalletId,
        message: message || "",
        ts: Math.floor(Date.now() / 1000),
      };
      txHashRef.current = pending.txHash;
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      } catch {}

      // Steps 2–5
      await recordContribution(pending);
    } catch (error) {
      console.error("Contribution error:", error);
      if (txHashRef.current) {
        // The payment WAS sent — only the record failed. Lock the button.
        setPaidUnrecorded(true);
        toast({
          title: sl ? "Plačilo POSLANO — zapis ni uspel" : "Payment WAS sent — recording failed",
          description: sl
            ? `Transakcija ${txHashRef.current.slice(0, 16)}… je na verigi. NE plačuj znova — ob naslednjem obisku te strani se zapis dokonča samodejno.`
            : `Transaction ${txHashRef.current.slice(0, 16)}… is on-chain. Do NOT pay again — the record will complete automatically next time you open this page.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: sl ? "Prispevek ni uspel" : "Contribution failed",
          description:
            error instanceof Error
              ? error.message
              : sl
                ? "Neznana napaka pri pošiljanju prispevka."
                : "Unknown error while sending the contribution.",
          variant: "destructive",
        });
      }
    } finally {
      setIsSending(false);
    }
  };

  // Keep rendering when a pending on-chain payment exists (resume path) even
  // though the navigation state is gone.
  if (stateMissing && !readPending() && !txHashRef.current) return null;

  if (requestLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const request = detail?.request;
  if (!request) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24">
        <p className="text-center text-muted-foreground py-12">
          {sl ? "Zahtevek ni bil najden." : "Request not found."}
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl">
      <Button
        variant="ghost"
        onClick={() => navigate(`/unconditional-financing/contribute/${id}`)}
        className="gap-2 mb-4"
        disabled={isSending}
      >
        <ArrowLeft className="h-4 w-4" />
        {sl ? "Nazaj" : "Back"}
      </Button>

      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">
            {sl ? "Potrdi prispevek" : "Confirm contribution"}
          </h1>
          <p className="text-muted-foreground mt-2">
            {sl
              ? "Vnesi zasebni ključ (WIF) izbrane denarnice za podpis transakcije."
              : "Enter the private key (WIF) of the selected wallet to sign the transaction."}
          </p>
        </div>

        {/* Contribution summary */}
        <Card className="border-green-500/20 bg-green-500/5">
          <CardHeader>
            <CardTitle className="text-lg">
              {sl ? "Povzetek prispevka" : "Contribution summary"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{sl ? "Zahtevek:" : "Request:"}</span>
              <span className="font-semibold text-right">{request.title}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{sl ? "Znesek:" : "Amount:"}</span>
              <span className="font-semibold">
                {fiatAmount!.toFixed(2)} {request.currency}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{sl ? "V LANI:" : "In LANA:"}</span>
              <span className="font-semibold">{lanaAmount!.toFixed(2)} LANA</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {sl ? "Menjalno razmerje:" : "Exchange rate:"}
              </span>
              <span>
                1 LANA = {rate!.toFixed(6)} {request.currency}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Source wallet */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {sl ? "Denarnica pošiljatelja" : "Sending wallet"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-muted p-3 rounded-md">
              <p className="font-mono text-sm break-all">{selectedWalletId}</p>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {sl
                ? "Zasebni ključ mora pripadati tej denarnici."
                : "The private key must belong to this wallet."}
            </p>
          </CardContent>
        </Card>

        {/* Private key input */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {sl ? "Zasebni ključ (WIF)" : "Private key (WIF)"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="private-key">
                {sl ? "Vnesi ali skeniraj WIF" : "Enter or scan WIF"}
              </Label>
              <div className="flex gap-2 mt-2">
                <div className="relative flex-1">
                  <Input
                    id="private-key"
                    type="password"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder="6v7y8KLxbYtvcp1PRQXLQBX..."
                    className="font-mono pr-10"
                    disabled={isSending}
                  />
                  {isValidating && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  {!isValidating && isValid && (
                    <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                  )}
                  {!isValidating && validationError && (
                    <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive" />
                  )}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowScanner(true)}
                  disabled={isSending}
                  title={sl ? "Skeniraj QR kodo" : "Scan QR code"}
                >
                  <ScanLine className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {sl
                  ? "Ključ se uporabi samo za podpis te transakcije in se nikjer ne shrani."
                  : "The key is used only to sign this transaction and is never stored."}
              </p>
            </div>

            {validationError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                <AlertCircle className="h-4 w-4" />
                <span>{validationError}</span>
              </div>
            )}

            {isValid && (
              <div className="flex items-center gap-2 text-sm text-green-600 bg-green-500/10 p-3 rounded-md">
                <CheckCircle className="h-4 w-4" />
                <span>
                  {sl
                    ? "Ključ potrjen — pripada izbrani denarnici."
                    : "Key verified — it belongs to the selected wallet."}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Confirm */}
        <Button
          onClick={handleConfirm}
          disabled={!isValid || isValidating || isSending || paidUnrecorded}
          className="w-full bg-green-500 hover:bg-green-600 text-white h-12 disabled:opacity-50"
        >
          {isSending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {sl ? "Pošiljanje..." : "Sending..."}
            </>
          ) : sl ? (
            `Pošlji ${fiatAmount!.toFixed(2)} ${request.currency}`
          ) : (
            `Send ${fiatAmount!.toFixed(2)} ${request.currency}`
          )}
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          {sl
            ? "🔒 Zasebni ključ se uporabi samo za to transakcijo in se nikjer ne shranjuje."
            : "🔒 Your private key is used only for this transaction and is never stored."}
        </p>
      </div>

      {/* QR Scanner Dialog */}
      <QRScanner
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleQRScan}
      />
    </div>
  );
};

export default UFContributePrivateKey;
