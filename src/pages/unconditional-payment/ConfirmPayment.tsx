import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { QRScanner } from "@/components/QRScanner";
import { Camera, Wallet, ArrowRight, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { convertWifToIds } from "@/lib/crypto";
import { formatLana } from "@/lib/currencyConversion";
import { supabase } from "@/integrations/supabase/client";
import { SimplePool, finalizeEvent, type Event } from 'nostr-tools';
import { readFromRelaysWithRetry } from "@/lib/relayRead";
import {
  GUARD_READ_ATTEMPTS,
  GUARD_READ_BUDGET_MS,
  GUARD_READ_PAUSE_MS,
  GUARD_NO_RELAY_LIST_MESSAGE,
} from "@/lib/unconditionalPaymentGuard";
import {
  guardAndSend,
  deliverConfirmations,
  DELIVERING_CONFIRMATION_PROGRESS,
  type AlreadyPaid,
  type DeliveryReport,
  type RelayPublishResult,
  type SendResponse,
} from "@/lib/unconditionalPaymentFlow";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";

interface PaymentRecipient {
  proposalId: string;
  proposalDTag: string;
  recipientWallet: string;
  recipientPubkey: string;
  lanaAmount: number;
  lanoshiAmount: number;
  service: string;
  /** The 90900's billing_day tag ('' when absent) — copied onto the 90901 for audits. */
  billingDay?: string;
  /** created_at of the 90900 — mint time of this proposal set; drives the duplicate guard. */
  proposalCreatedAt?: number;
}

interface RecipientSummaryWithPubkey {
  wallet: string;
  pubkey: string;
  amount: number;
  services: string[];
}

interface PaymentData {
  selectedProposals: PaymentRecipient[];
  senderWallet: string;
  totalLana: number;
}

const API_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * POST to the payment route, keeping what the supabase shim throws away: the
 * status and the body of a refusal. The route's 409 names the duplicates, and
 * its 503 is the refusal that proves nothing was sent — both are lost when
 * every non-2xx is flattened into `error.message`. Never throws.
 */
async function postUnconditionalPayment(body: unknown): Promise<SendResponse> {
  try {
    const response = await fetch(`${API_URL}/api/functions/send-unconditional-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => undefined);
    return { status: response.status, body: json };
  } catch (error) {
    return { status: null, body: undefined, networkError: error instanceof Error ? error.message : String(error) };
  }
}

export default function ConfirmPayment() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [privateKey, setPrivateKey] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isPrivateKeyValid, setIsPrivateKeyValid] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  /** Set only when the duplicate check could not be made — nothing was sent. */
  const [verifyError, setVerifyError] = useState<string | null>(null);
  /** Which verification attempt is running, so a long wait stays legible. */
  const [verifyProgress, setVerifyProgress] = useState<string | null>(null);

  const relays = parameters?.relays || [];

  useEffect(() => {
    // Load payment data from session storage
    const storedData = sessionStorage.getItem('pendingUnconditionalPayment');
    if (!storedData) {
      toast.error("No payment data found");
      navigate('/unconditional-payment');
      return;
    }

    try {
      const data = JSON.parse(storedData);
      setPaymentData(data);
    } catch (error) {
      toast.error("Invalid payment data");
      navigate('/unconditional-payment');
    }
  }, [navigate]);

  useEffect(() => {
    if (!privateKey || !paymentData) {
      setIsPrivateKeyValid(false);
      setValidationError(null);
      return;
    }

    const validatePrivateKey = async () => {
      try {
        setIsValidating(true);
        const derivedIds = await convertWifToIds(privateKey);
        
        // Check both compressed and uncompressed addresses
        const matchesCompressed = derivedIds.walletIdCompressed === paymentData.senderWallet;
        const matchesUncompressed = derivedIds.walletIdUncompressed === paymentData.senderWallet;

        if (matchesCompressed || matchesUncompressed) {
          setIsPrivateKeyValid(true);
          setValidationError(null);
        } else {
          setIsPrivateKeyValid(false);
          setValidationError("Private key does not match the selected wallet");
        }
      } catch (error) {
        setIsPrivateKeyValid(false);
        setValidationError("Invalid private key format");
      } finally {
        setIsValidating(false);
      }
    };

    const debounce = setTimeout(validatePrivateKey, 500);
    return () => clearTimeout(debounce);
  }, [privateKey, paymentData]);

  const handleScanComplete = (scannedData: string) => {
    setPrivateKey(scannedData.trim());
    setIsScannerOpen(false);
  };

  // Group recipients by wallet address and calculate totals
  const recipientSummary = paymentData?.selectedProposals.reduce((acc, proposal) => {
    const existing = acc.find(r => r.wallet === proposal.recipientWallet);
    if (existing) {
      existing.amount += proposal.lanaAmount;
      existing.services.push(proposal.service);
    } else {
      acc.push({
        wallet: proposal.recipientWallet,
        pubkey: proposal.recipientPubkey,
        amount: proposal.lanaAmount,
        services: [proposal.service]
      });
    }
    return acc;
  }, [] as RecipientSummaryWithPubkey[]) || [];

  // Fetch profiles for all recipient pubkeys
  const recipientPubkeys = recipientSummary.map(r => r.pubkey);
  const { profiles: recipientProfiles } = useNostrProfilesCacheBulk(recipientPubkeys);

  /**
   * Nothing was sent, because the check could not be made. Said on the page as
   * well as in a toast: a toast that has faded leaves exactly the doubt this
   * message exists to remove.
   */
  const refuseUnverified = (message: string) => {
    console.warn('⛔ Payment refused — previous payments could not be verified');
    setVerifyError(message);
    toast.error(message, { duration: 15000 });
  };

  /**
   * Nothing was sent: these are paid already — found by this page's own read
   * or by the server's. They leave the batch; what remains can be confirmed
   * again with a fresh click.
   */
  const dropAlreadyPaid = (data: PaymentData, alreadyPaid: AlreadyPaid[], foundBy: 'device' | 'server') => {
    const remaining = data.selectedProposals.filter(
      (p) => !alreadyPaid.some((d) => d.proposalId === p.proposalId),
    );
    for (const d of alreadyPaid) {
      const txNote = d.txId ? ` (tx ${d.txId.substring(0, 12)}…)` : '';
      toast.error(`"${d.service}" was already paid${txNote} — removed from this batch.`, { duration: 10000 });
      console.warn(`⛔ Duplicate blocked by the ${foundBy} [${d.via}]: ${d.service}, existing tx ${d.txId || 'unknown'}`);
    }
    if (remaining.length === 0) {
      sessionStorage.removeItem('pendingUnconditionalPayment');
      navigate('/unconditional-payment');
    } else {
      const updated = {
        ...data,
        selectedProposals: remaining,
        totalLana: remaining.reduce((sum, p) => sum + p.lanaAmount, 0),
      };
      sessionStorage.setItem('pendingUnconditionalPayment', JSON.stringify(updated));
      setPaymentData(updated);
    }
  };

  /**
   * This device's own publish of one confirmation — one result per relay:
   * 10 s per relay, 8 s for the relay's OK, as it always was. Each relay is
   * recorded once; a late answer after its timeout no longer adds a second row.
   */
  const publishFromThisDevice = async (
    pool: SimplePool,
    signedEvent: Event,
    proposalDTag: string,
  ): Promise<RelayPublishResult[]> => {
    console.log(`📡 Publishing KIND 90901 for proposal ${proposalDTag}...`);
    const results: RelayPublishResult[] = [];

    await Promise.all(relays.map((relay: string) => new Promise<void>((resolve) => {
      let recorded = false;
      const record = (success: boolean, error?: string) => {
        if (recorded) return;
        recorded = true;
        clearTimeout(timeout);
        results.push({ proposalId: proposalDTag, relay, success, ...(error ? { error } : {}) });
        if (success) console.log(`✅ ${relay}: KIND 90901 published for ${proposalDTag}`);
        else console.error(`❌ ${relay}: ${error} for ${proposalDTag}`);
        resolve();
      };

      // Outer timeout: 10s - guards against relay never responding
      const timeout = setTimeout(() => record(false, 'Connection timeout (10s)'), 10000);

      try {
        // Publish to SINGLE relay
        const pubs = pool.publish([relay], signedEvent);

        // Use for-await to consume the async iterable (proven pattern)
        Promise.race([
          (async () => {
            for await (const pub of pubs) {
              // At least one relay accepted
              break;
            }
          })(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Publish timeout (8s)')), 8000)
          )
        ])
          .then(() => record(true))
          .catch((error) => record(false, error instanceof Error ? error.message : 'Unknown error'));
      } catch (error: any) {
        record(false, error?.message || 'Unknown error');
      }
    })));

    return results;
  };

  const handleConfirmPayment = async () => {
    if (!privateKey || !isPrivateKeyValid || !paymentData) {
      toast.error("Please enter a valid private key");
      return;
    }

    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast.error("Nostr authentication required");
      return;
    }

    setIsProcessing(true);
    setVerifyError(null);

    try {
      console.log('🚀 Processing unconditional payment...');

      // ── Duplicate guard — nothing is broadcast until it has passed ─────────
      // One matcher (src/lib/unconditionalPaymentGuard.ts), two checks: this
      // page's read of the payer's KIND 90901, and the server route's, which
      // runs in front of the broadcast and fails CLOSED on its own (409 when
      // already paid, 503 when no relay answered). If this device gets an
      // answer, it refuses a duplicate itself, before the key leaves the page.
      // If no relay answers it after every retry, the server's check decides:
      // a network that blocks relay WebSockets must not make a verifiable
      // payment impossible (src/lib/unconditionalPaymentFlow.ts has the why).
      if (relays.length === 0) {
        refuseUnverified(GUARD_NO_RELAY_LIST_MESSAGE);
        return;
      }

      const obligations = paymentData.selectedProposals.map((item) => ({
        proposalId: item.proposalId,
        proposalDTag: item.proposalDTag,
        recipientWallet: item.recipientWallet,
        service: item.service,
        // Snapshots written before this change carry no mint time; 0 makes
        // Rule B match ANY prior confirmation for the service+wallet —
        // the fail-closed direction for stale data.
        proposalCreatedAt: item.proposalCreatedAt || 0,
      }));

      // Set while the outputs are built; the confirmations publish the
      // recipient's net share, which depends on it.
      let hasFeeWallet = false;

      const outcome = await guardAndSend(obligations, {
        // Retried, each attempt on its OWN pool — readFromRelaysWithRetry
        // explains why a fresh pool is the only thing that actually re-dials.
        readPriorConfirmations: async () => {
          try {
            return await readFromRelaysWithRetry(
              () => new SimplePool(),
              relays,
              { kinds: [90901], authors: [session.nostrHexId], limit: 500 },
              {
                budgetMs: GUARD_READ_BUDGET_MS,
                attempts: GUARD_READ_ATTEMPTS,
                pauseMs: GUARD_READ_PAUSE_MS,
                onAttempt: (attempt, total) =>
                  setVerifyProgress(
                    attempt === 1
                      ? 'Checking your previous payments…'
                      : `No relay answered — trying again (${attempt} of ${total})…`,
                  ),
              },
            );
          } finally {
            setVerifyProgress(null);
          }
        },

        send: async () => {
          // Fetch fee wallet for service fee (10%)
          const { data: feeWalletSetting } = await supabase
            .from('app_settings')
            .select('value')
            .eq('key', 'mentor_unconditional_payment')
            .maybeSingle();

          let feeWallet = '';
          if (feeWalletSetting?.value) {
            const raw = feeWalletSetting.value as string;
            feeWallet = raw.startsWith('"') ? JSON.parse(raw) : raw;
            console.log('💰 Fee wallet loaded:', feeWallet);
          }
          hasFeeWallet = !!feeWallet;

          // Build recipients with 90/10 split (90% to recipient, 10% service fee)
          const recipients: { address: string; amount: number }[] = [];
          let totalFeeLanoshis = 0;

          for (const r of recipientSummary) {
            const totalLanoshis = Math.floor(r.amount * 100000000);
            const feeLanoshis = hasFeeWallet ? Math.floor(totalLanoshis * 0.10) : 0;
            const recipientLanoshis = totalLanoshis - feeLanoshis;

            recipients.push({ address: r.wallet, amount: recipientLanoshis / 100000000 });
            totalFeeLanoshis += feeLanoshis;
          }

          // Single aggregated fee output (only if total fee exceeds dust threshold)
          if (hasFeeWallet && totalFeeLanoshis > 546) {
            recipients.push({ address: feeWallet, amount: totalFeeLanoshis / 100000000 });
            console.log(`📊 Service fee: ${totalFeeLanoshis} lanoshis (${(totalFeeLanoshis / 100000000).toFixed(8)} LANA) to ${feeWallet}`);
          }

          // Get Electrum servers from session storage or use defaults
          const storedServers = sessionStorage.getItem('electrumServers');
          const electrum_servers = storedServers
            ? JSON.parse(storedServers)
            : [
                { host: "electrum1.lanacoin.com", port: 5097 },
                { host: "electrum2.lanacoin.com", port: 5097 }
              ];

          console.log('📤 Calling edge function with:', {
            sender_address: paymentData.senderWallet,
            recipients: recipients,
            electrum_servers: electrum_servers
          });

          // payer_pubkey + proposals are what the SERVER's guard checks before
          // it broadcasts — for every caller, and the only check that runs when
          // this device could not reach a relay.
          return postUnconditionalPayment({
            sender_address: paymentData.senderWallet,
            recipients: recipients,
            private_key: privateKey,
            electrum_servers: electrum_servers,
            payer_pubkey: session.nostrHexId,
            proposals: obligations,
          });
        },

        onProgress: setVerifyProgress,
      });

      if (outcome.kind === 'already-paid') {
        dropAlreadyPaid(paymentData, outcome.alreadyPaid, outcome.foundBy);
        return;
      }
      if (outcome.kind === 'refused') {
        refuseUnverified(outcome.message);
        return;
      }
      if (outcome.kind === 'failed') {
        console.error('Edge function error:', outcome.message);
        throw new Error(outcome.message);
      }
      // ── End duplicate guard — the transaction is out ─────────────────────

      const txid = outcome.txid;
      console.log('✅ Transaction successful:', txid);

      // Paid. Whatever happens from here on, this batch must not be payable
      // again from this page.
      sessionStorage.removeItem('pendingUnconditionalPayment');
      setVerifyProgress(DELIVERING_CONFIRMATION_PROGRESS);

      // The KIND 90901 confirmations are what mark these obligations paid —
      // the pending list and both guards read them. Saved on the server first,
      // published from this device if it can reach relays, and published by
      // the server now for whatever the device could not land.
      console.log(`📝 Creating KIND 90901 events for ${paymentData.selectedProposals.length} proposals...`);
      const pool = outcome.deviceReachedRelays ? new SimplePool() : null;
      let delivery: DeliveryReport | null = null;
      try {
        delivery = await deliverConfirmations(paymentData.selectedProposals, outcome.deviceReachedRelays, {
          sign: (proposal) => {
            // Create KIND 90901 event (publish only the recipient's 90% share)
            const netLanoshis = hasFeeWallet
              ? Math.floor(proposal.lanoshiAmount * 0.90)
              : proposal.lanoshiAmount;
            const netLana = netLanoshis / 100000000;

            // Build tags - only include 'p' tag if recipientPubkey is a valid 64-char hex string
            // Relays reject events with invalid p-tag sizes ("unexpected size for fixed-size tag: p")
            const isValidHexPubkey = (pk: string) => /^[0-9a-f]{64}$/i.test(pk);
            const tags: string[][] = [
              ['proposal', proposal.proposalDTag],
              ['from_wallet', paymentData.senderWallet],
              ['to_wallet', proposal.recipientWallet],
              ['amount_lana', netLana.toString()],
              ['amount_lanoshi', netLanoshis.toString()],
              ['tx', txid],
              ['service', proposal.service],
              ['timestamp_paid', Math.floor(Date.now() / 1000).toString()],
              ['e', proposal.proposalId, '', 'proposal'],
              ['type', 'unconditional_payment_confirmation']
            ];

            // Obligation cycle identity — lets future duplicate guards match this
            // confirmation even against a REGENERATED proposal set (new d-tag).
            if (proposal.billingDay) {
              tags.push(['billing_day', proposal.billingDay]);
            }

            // Only add p-tag if pubkey is valid 64-char hex (NIP-01 requirement)
            if (proposal.recipientPubkey && isValidHexPubkey(proposal.recipientPubkey)) {
              tags.splice(1, 0, ['p', proposal.recipientPubkey]);
            } else {
              console.warn(`⚠️ Skipping invalid p-tag for proposal ${proposal.proposalDTag}: "${proposal.recipientPubkey}" (length: ${proposal.recipientPubkey?.length || 0})`);
            }

            const eventTemplate = {
              kind: 90901,
              created_at: Math.floor(Date.now() / 1000),
              tags,
              content: `Unconditional payment successfully received for proposal ${proposal.proposalDTag}.`,
              pubkey: session.nostrHexId
            };

            // Sign the event
            const privateKeyBytes = new Uint8Array(
              session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
            );
            return finalizeEvent(eventTemplate, privateKeyBytes);
          },

          // The heartbeat republishes from this queue until a relay accepts.
          queue: async (signedEvent) => {
            const { data, error } = await supabase.functions.invoke('queue-relay-event', {
              body: { signedEvent, userPubkey: session.nostrHexId }
            });
            return !error && data?.success === true;
          },

          publishFromDevice: (signedEvent, proposal) =>
            publishFromThisDevice(pool!, signedEvent, proposal.proposalDTag),

          publishFromServer: async (signedEvent) => {
            const { data, error } = await supabase.functions.invoke('publish-dm-event', {
              body: { event: signedEvent }
            });
            return !error && data?.success === true && Number(data?.publishedTo) > 0;
          },
        });
      } catch (error) {
        // The money has moved: nothing here may turn into "Payment failed".
        console.error('❌ Error delivering KIND 90901 confirmations:', error);
      } finally {
        pool?.close(relays);
      }

      const total = paymentData.selectedProposals.length;
      console.log(delivery
        ? `📬 Confirmations: ${delivery.deliveredByDevice} from this device, ${delivery.deliveredByServer} by the server, ${delivery.savedForServer} queued on the server, ${delivery.undelivered} undelivered (${delivery.mode})`
        : '📬 Confirmations: delivery did not complete');

      // Store result data for result page
      const resultData = {
        txid,
        totalAmount: paymentData.totalLana,
        recipients: recipientSummary,
        relayResults: delivery?.relayResults ?? [],
        confirmations: delivery
          ? {
              mode: delivery.mode,
              total: delivery.total,
              deliveredByDevice: delivery.deliveredByDevice,
              deliveredByServer: delivery.deliveredByServer,
              savedForServer: delivery.savedForServer,
              undelivered: delivery.undelivered,
            }
          : { mode: 'undelivered', total, deliveredByDevice: 0, deliveredByServer: 0, savedForServer: 0, undelivered: total },
        timestamp: new Date().toISOString()
      };

      sessionStorage.setItem('unconditionalPaymentResult', JSON.stringify(resultData));

      // Show success toast
      toast.success(`Payment sent successfully! TX: ${txid.substring(0, 8)}...`);

      // Navigate to result page
      navigate('/unconditional-payment/result');

    } catch (error) {
      console.error('❌ Payment error:', error);
      toast.error(error instanceof Error ? error.message : 'Payment failed');
    } finally {
      setVerifyProgress(null);
      setIsProcessing(false);
    }
  };

  if (!paymentData) {
    return null;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate('/unconditional-payment')}
          className="mb-4"
        >
          ← Back to Payments
        </Button>
        <h1 className="text-3xl font-bold">Confirm Payment</h1>
        <p className="text-muted-foreground">Review and authorize your unconditional payment</p>
      </div>

      {/* Payment Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Payment Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground">From Wallet</Label>
            <div className="p-3 bg-muted rounded-lg">
              <p className="font-mono text-sm break-all">{paymentData.senderWallet}</p>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-muted-foreground">To Recipients</Label>
            {recipientSummary.map((recipient, index) => {
              const profile = recipientProfiles.get(recipient.pubkey);
              return (
                <div key={index} className="p-3 bg-muted rounded-lg space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">To:</span>
                        <span className="text-sm font-semibold">
                          {profile?.display_name || profile?.full_name || 'Unknown'}
                        </span>
                      </div>
                      <p className="font-mono text-xs break-all text-muted-foreground">{recipient.wallet}</p>
                      <p className="text-xs text-muted-foreground">
                        {recipient.services.join(', ')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatLana(recipient.amount)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">Total Amount</span>
              <span className="text-2xl font-bold text-primary">{formatLana(paymentData.totalLana)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Private Key Input */}
      <Card>
        <CardHeader>
          <CardTitle>Authorize Payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="privateKey">Enter Private Key (WIF Format)</Label>
            <div className="flex gap-2">
              <Input
                id="privateKey"
                type="password"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="Enter your private key..."
                className={isPrivateKeyValid ? "border-green-500" : validationError ? "border-destructive" : ""}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setIsScannerOpen(true)}
              >
                <Camera className="h-4 w-4" />
              </Button>
            </div>

            {isValidating && (
              <p className="text-sm text-muted-foreground">Validating...</p>
            )}

            {isPrivateKeyValid && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <AlertCircle className="h-4 w-4" />
                <span>Private key verified for selected wallet</span>
              </div>
            )}

            {validationError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your private key is required to authorize this transaction. It will be used securely to sign the payment and will not be stored.
            </AlertDescription>
          </Alert>

          {verifyError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{verifyError}</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleConfirmPayment}
            disabled={!isPrivateKeyValid || isProcessing}
            className="w-full"
            size="lg"
          >
            {isProcessing ? (
              "Processing..."
            ) : (
              <>
                Confirm & Send Payment
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>

          {verifyProgress && (
            <p className="text-sm text-muted-foreground text-center">{verifyProgress}</p>
          )}
        </CardContent>
      </Card>

      <QRScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleScanComplete}
      />
    </div>
  );
}
