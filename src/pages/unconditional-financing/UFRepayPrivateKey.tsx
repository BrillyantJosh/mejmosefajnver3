import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { finalizeEvent } from "nostr-tools";
import { UF_API, UF_REPAYMENT_KIND, useUfRequest } from "@/hooks/useUFData";
import type { UfRepaymentOutput } from "@/lib/ufShares";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { supabase } from "@/integrations/supabase/client";
import { convertWifToIds } from "@/lib/crypto";
import { QRScanner } from "@/components/QRScanner";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, AlertCircle, CheckCircle, Loader2, ScanLine } from "lucide-react";
import { useLang } from "@/i18n/I18nContext";

interface RepayState {
  selectedWalletId: string;
  fiatAmount: number;
  lanaTotal: number;
  totalLanoshis: number;
  rate: number;
  outputs: UfRepaymentOutput[];
}

// A repayment tx that went on-chain but whose record steps did not complete.
// Persisted BEFORE the fallible post-payment steps so a lost response or
// refresh can NEVER lead to a second multi-output payment.
interface PendingRepayment {
  txHash: string;
  fiatAmount: number;
  lanaTotal: number;
  totalLanoshis: number;
  rate: number;
  outputs: UfRepaymentOutput[];
  ts: number;
}

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

/**
 * Unconditional Financing — repayment WIF confirmation page.
 * Sends ONE multi-output LANA tx, publishes KIND 60211, records on the server.
 */
const UFRepayPrivateKey = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const sl = useLang() === "sl";
  const { toast } = useToast();
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const { detail, isLoading } = useUfRequest(id);

  const state = (location.state || {}) as Partial<RepayState>;
  const { selectedWalletId, fiatAmount, lanaTotal, totalLanoshis, rate, outputs } = state;
  const hasState =
    !!selectedWalletId &&
    typeof fiatAmount === "number" &&
    fiatAmount > 0 &&
    typeof totalLanoshis === "number" &&
    totalLanoshis > 0 &&
    typeof rate === "number" &&
    Array.isArray(outputs) &&
    outputs.length > 0;

  const [privateKey, setPrivateKey] = useState<string>("");
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string>("");
  const [isValid, setIsValid] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [txError, setTxError] = useState<string>("");
  // Set the moment the on-chain batch payment succeeds; from then on the
  // button must never re-enable into a second payment.
  const txHashRef = useRef<string | null>(null);
  const [paidUnrecorded, setPaidUnrecorded] = useState(false);
  const resumeAttemptedRef = useRef(false);

  const PENDING_KEY = `uf-pending-repayment-${id}`;
  const readPending = (): PendingRepayment | null => {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      return raw ? (JSON.parse(raw) as PendingRepayment) : null;
    } catch {
      return null;
    }
  };

  // State guard — sent here without the repay data means the flow was skipped.
  // EXCEPT when a pending on-chain payment exists: then we stay to complete it.
  useEffect(() => {
    if (!hasState && !readPending()) {
      navigate(`/unconditional-financing/repay/${id}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasState, id, navigate]);

  // Real-time WIF validation (same pattern as DonatePrivateKey/BatchFunding).
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
        const matchesCompressed = result.walletIdCompressed === selectedWalletId;
        const matchesUncompressed = result.walletIdUncompressed === selectedWalletId;
        if (!matchesCompressed && !matchesUncompressed) {
          setValidationError(
            sl
              ? "Privatni ključ ne pripada izbrani denarnici."
              : "The private key does not belong to the selected wallet.",
          );
          setIsValid(false);
        } else {
          setValidationError("");
          setIsValid(true);
        }
      } catch {
        setValidationError(
          sl ? "Neveljaven format privatnega ključa (WIF)." : "Invalid private key format (WIF).",
        );
        setIsValid(false);
      } finally {
        setIsValidating(false);
      }
    };
    const timeoutId = setTimeout(validateKey, 500);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privateKey, selectedWalletId]);

  const handleQRScan = (data: string) => {
    setPrivateKey(data);
    setShowScanner(false);
  };

  // Steps 2–4: sign KIND 60211, publish (verified, with queued retry), record
  // on the server (hardened { event } contract), navigate. Uses the pending
  // snapshot so it also works when resuming after a lost response/refresh.
  const recordRepayment = async (p: PendingRepayment) => {
    const request = detail?.request;
    if (!request || !session?.nostrHexId || !session?.nostrPrivateKey) {
      throw new Error(sl ? "Manjka seja ali zahtevek." : "Missing session or request.");
    }

    setProcessingStatus(sl ? "Objavljanje zapisa vračila…" : "Publishing the repayment record…");
    const tags: string[][] = [
      ["service", "unconditional-financing"],
      ["request", request.id],
      ["a", `31240:${request.pubkey}:${request.id}`],
      ["p", session.nostrHexId, "", "payer"],
      ["amount_lanoshis_total", String(p.totalLanoshis)],
      ["amount_fiat_total", String(p.fiatAmount)],
      ["currency", request.currency],
      ["rate", String(p.rate)],
      ["tx", p.txHash],
      ...p.outputs.map((o) => ["out", o.pubkey, o.wallet, String(o.lanoshis), String(o.fiat)]),
      ["client", "mejmosefajn"],
    ];

    const signedEvent = finalizeEvent(
      { kind: UF_REPAYMENT_KIND, created_at: p.ts, tags, content: "" },
      hexToBytes(session.nostrPrivateKey),
    );

    // Publish to relays — verify the result; queue for background retry on failure.
    let publishedOk = false;
    try {
      const { data: pubData, error: pubErr } = await supabase.functions.invoke(
        "publish-dm-event",
        { body: { event: signedEvent } },
      );
      publishedOk = !pubErr && pubData?.success === true && (pubData?.publishedTo ?? 0) > 0;
    } catch {
      publishedOk = false;
    }
    if (!publishedOk) {
      console.warn("⚠️ Repayment publish failed — queuing for background retry");
      supabase.functions
        .invoke("queue-relay-event", { body: { signedEvent, userPubkey: session.nostrHexId } })
        .catch(() => {});
    }

    // Record in server SQLite — the server verifies the SIGNED EVENT.
    let isRepaid = false;
    try {
      const res = await fetch(`${UF_API}/repayments/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: signedEvent }),
      });
      if (res.ok) {
        const recorded = await res.json();
        isRepaid = !!recorded?.isRepaid;
      }
    } catch (recordErr) {
      console.warn("⚠️ Repayment record failed (will be indexed later):", recordErr);
    }

    sessionStorage.removeItem(PENDING_KEY);
    navigate(`/unconditional-financing/repay/${id}/result`, {
      state: {
        txHash: p.txHash,
        fiatAmount: p.fiatAmount,
        lanaTotal: p.lanaTotal,
        currency: request.currency,
        outputs: p.outputs,
        requestId: id,
        isRepaid,
      },
    });
  };

  // Resume: a previous batch payment went on-chain but its record didn't
  // complete. Complete it WITHOUT paying again.
  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    const pending = readPending();
    if (!pending?.txHash || !detail?.request || !session?.nostrPrivateKey) return;
    resumeAttemptedRef.current = true;
    txHashRef.current = pending.txHash;
    toast({
      title: sl ? "Zaznano prejšnje plačilo" : "Previous payment detected",
      description: sl
        ? "Vračilo je bilo že poslano na verigo — dokončujem zapis. NE plačuj znova."
        : "The repayment was already sent on-chain — completing the record. Do NOT pay again.",
    });
    setIsProcessing(true);
    recordRepayment(pending)
      .catch((err) => {
        console.error("Pending repayment completion failed:", err);
        setPaidUnrecorded(true);
      })
      .finally(() => {
        setIsProcessing(false);
        setProcessingStatus("");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.request?.id, session?.nostrPrivateKey]);

  const handleConfirm = async () => {
    const request = detail?.request;
    if (!isValid || !hasState || !request || !parameters || paidUnrecorded) return;
    if (!session?.nostrHexId || !session?.nostrPrivateKey) {
      toast({
        title: sl ? "Napaka" : "Error",
        description: sl ? "Za vračilo morate biti prijavljeni." : "You must be logged in to repay.",
        variant: "destructive",
      });
      return;
    }

    // Never start a second payment while one is pending completion.
    if (readPending()?.txHash || txHashRef.current) {
      toast({
        title: sl ? "Plačilo že poslano" : "Payment already sent",
        description: sl
          ? "Prejšnje vračilo je že na verigi — ne plačuj znova."
          : "A previous repayment is already on-chain — do not pay again.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setTxError("");
    setProcessingStatus(
      sl ? "Pošiljanje LANA transakcije…" : "Sending the LANA transaction…",
    );

    try {
      // Step 1: ONE multi-output LANA transaction (amounts in LANOSHIS)
      const { data: txData, error: invokeError } = await supabase.functions.invoke(
        "send-batch-lana-transaction",
        {
          body: {
            senderAddress: selectedWalletId,
            recipients: outputs!.map((o) => ({ address: o.wallet, amount: o.lanoshis })),
            privateKey: privateKey.trim(),
            electrumServers: parameters.electrumServers || [],
            userPubkey: session.nostrHexId,
          },
        },
      );

      if (invokeError || !txData?.success || !txData?.txHash) {
        // Surface the server error VERBATIM (e.g. TOO_MANY_UTXOS instructs consolidation).
        throw new Error(
          txData?.error ||
            invokeError?.message ||
            (sl ? "Transakcija ni uspela." : "Transaction failed."),
        );
      }

      // MONEY IS NOW ON-CHAIN. Persist the pending snapshot BEFORE any further
      // fallible step, so nothing past this point can cause a double payment.
      const pending: PendingRepayment = {
        txHash: txData.txHash,
        fiatAmount: fiatAmount!,
        lanaTotal: lanaTotal!,
        totalLanoshis: totalLanoshis!,
        rate: rate!,
        outputs: outputs!,
        ts: Math.floor(Date.now() / 1000),
      };
      txHashRef.current = pending.txHash;
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      } catch {}

      toast({
        title: sl ? "Transakcija poslana" : "Transaction sent",
        description: sl ? "Vračilo je bilo poslano financerjem." : "The repayment was sent to the financiers.",
      });

      // Steps 2–4
      await recordRepayment(pending);
    } catch (error) {
      console.error("Repayment error:", error);
      if (txHashRef.current) {
        // The payment WAS sent — only the record failed. Lock the button.
        setPaidUnrecorded(true);
        setTxError(
          sl
            ? `Plačilo JE bilo poslano (tx ${txHashRef.current.slice(0, 16)}…), a zapis ni uspel. NE plačuj znova — ob naslednjem obisku te strani se zapis dokonča samodejno.`
            : `The payment WAS sent (tx ${txHashRef.current.slice(0, 16)}…) but recording failed. Do NOT pay again — the record will complete automatically next time you open this page.`,
        );
      } else {
        setTxError(
          error instanceof Error
            ? error.message
            : sl
              ? "Vračilo ni uspelo."
              : "Repayment failed.",
        );
      }
    } finally {
      setIsProcessing(false);
      setProcessingStatus("");
    }
  };

  // Keep rendering when a pending on-chain payment exists (resume path) even
  // though the navigation state is gone.
  if (!hasState && !readPending() && !txHashRef.current) return null;

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!detail?.request) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl">
        <Card>
          <CardContent className="p-6 text-center space-y-4">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
            <p className="text-muted-foreground">
              {sl ? "Zahtevka ni bilo mogoče naložiti." : "Could not load the request."}
            </p>
            <Button variant="outline" onClick={() => navigate("/unconditional-financing/requests")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              {sl ? "Nazaj na financiranja" : "Back to financings"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const request = detail.request;

  // Processing overlay
  if (isProcessing) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl">
        <div className="text-center py-16">
          <Loader2 className="h-12 w-12 animate-spin text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold">{sl ? "Izvajanje vračila" : "Processing repayment"}</h2>
          <p className="text-muted-foreground mt-2">{processingStatus}</p>
          <p className="text-xs text-muted-foreground mt-4">
            {sl ? "Ne zapirajte te strani." : "Do not close this page."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl space-y-6">
      {/* Header */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(`/unconditional-financing/repay/${id}`)}
        className="gap-2"
      >
        <ArrowLeft className="h-4 w-4" />
        {sl ? "Nazaj" : "Back"}
      </Button>

      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">
          {sl ? "Potrditev vračila" : "Confirm repayment"}
        </h1>
        <p className="text-muted-foreground mt-1">
          {sl
            ? "Vnesite privatni ključ denarnice za podpis transakcije."
            : "Enter the wallet's private key to sign the transaction."}
        </p>
      </div>

      {/* Repayment summary */}
      <Card className="border-green-500/20 bg-green-500/5">
        <CardHeader>
          <CardTitle className="text-lg">{sl ? "Povzetek vračila" : "Repayment summary"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{sl ? "Zahtevek" : "Request"}</span>
            <span className="font-semibold truncate max-w-[12rem]">{request.title}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{sl ? "Znesek" : "Amount"}</span>
            <span className="font-semibold">
              {fiatAmount!.toFixed(2)} {request.currency}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">LANA</span>
            <span className="font-semibold">{(totalLanoshis! / 1e8).toFixed(4)} LANA</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{sl ? "Financerji" : "Financiers"}</span>
            <span className="font-semibold">{outputs!.length}</span>
          </div>
        </CardContent>
      </Card>

      {/* From wallet */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{sl ? "Iz denarnice" : "From wallet"}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-muted p-3 rounded-md">
            <p className="font-mono text-sm break-all">{selectedWalletId}</p>
          </div>
        </CardContent>
      </Card>

      {/* Private key */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{sl ? "Privatni ključ" : "Private key"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="private-key">
              {sl ? "Privatni ključ (WIF)" : "Private key (WIF)"}
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
                title={sl ? "Skeniraj QR kodo" : "Scan QR code"}
              >
                <ScanLine className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {sl
                ? "Ključ se uporabi samo za podpis te transakcije in se nikamor ne shrani."
                : "The key is used only to sign this transaction and is never stored."}
            </p>
          </div>

          {validationError && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {isValid && (
            <div className="flex items-center gap-2 text-sm text-green-600 bg-green-500/10 p-3 rounded-md">
              <CheckCircle className="h-4 w-4 shrink-0" />
              <span>
                {sl ? "Privatni ključ ustreza izbrani denarnici." : "The private key matches the selected wallet."}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction error — verbatim server message (e.g. TOO_MANY_UTXOS) */}
      {txError && (
        <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="break-words">{txError}</span>
        </div>
      )}

      {/* Confirm */}
      <Button
        onClick={handleConfirm}
        disabled={!isValid || isValidating || isProcessing || paidUnrecorded}
        className="w-full bg-green-500 hover:bg-green-600 text-white h-12 disabled:opacity-50"
      >
        {isProcessing ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {processingStatus || (sl ? "Obdelava…" : "Processing…")}
          </>
        ) : sl ? (
          `Pošlji vračilo — ${(fiatAmount ?? readPending()?.fiatAmount ?? 0).toFixed(2)} ${request.currency}`
        ) : (
          `Send repayment — ${(fiatAmount ?? readPending()?.fiatAmount ?? 0).toFixed(2)} ${request.currency}`
        )}
      </Button>

      <p className="text-xs text-center text-muted-foreground">
        🔒{" "}
        {sl
          ? "Transakcija je podpisana varno; ključ nikoli ne zapusti te seje."
          : "The transaction is signed securely; the key never leaves this session."}
      </p>

      {/* QR Scanner Dialog */}
      <QRScanner
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleQRScan}
      />
    </div>
  );
};

export default UFRepayPrivateKey;
