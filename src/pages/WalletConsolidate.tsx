import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, Package, Sparkles, AlertTriangle, Key, Layers, QrCode,
  ExternalLink, Loader2, Snowflake,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { convertWifToIds } from "@/lib/crypto";
import { QRScanner } from "@/components/QRScanner";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useAuth } from "@/contexts/AuthContext";

interface UTXO {
  tx_hash: string;
  tx_pos: number;
  height: number;
  value: number;
  value_lana: string;
}

interface UTXOAnalysis {
  success: boolean;
  total_utxos: number;
  total_value: number;
  total_value_lana: string;
  all_utxos: UTXO[];
  largest_utxos: UTXO[];
  dust_count: number;
  dust_value: number;
  dust_value_lana: string;
  dust_threshold: number;
  dust_threshold_lana: string;
  non_dust_count: number;
  non_dust_value: number;
  non_dust_value_lana: string;
  message?: string;
}

interface Batch {
  id: number;
  utxos: UTXO[];
  totalValue: number;
  totalValueLana: string;
  dustCount: number;
  isProcessing?: boolean;
  isCompleted?: boolean;
  txid?: string;
}

const BATCH_SIZE = 20;

export default function WalletConsolidate() {
  const { walletId } = useParams(); // route param IS the wallet address
  const navigate = useNavigate();
  const { wallets } = useNostrWallets();
  const { parameters } = useSystemParameters();
  const { session } = useAuth();

  const walletAddress = walletId || "";
  const matchedWallet = wallets.find((w) => w.walletId === walletAddress);
  const isFrozen = !!matchedWallet?.freezeStatus;

  const [isLoading, setIsLoading] = useState(true);
  const [analysis, setAnalysis] = useState<UTXOAnalysis | null>(null);
  const [privateKey, setPrivateKey] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [isKeyValid, setIsKeyValid] = useState<boolean | null>(null);

  const electrumServers = parameters?.electrumServers || [];

  // Validate the private key against this wallet address (debounced)
  useEffect(() => {
    if (!privateKey.trim()) {
      setIsKeyValid(null);
      return;
    }
    setIsValidatingKey(true);
    const timeoutId = setTimeout(async () => {
      try {
        const derived = await convertWifToIds(privateKey);
        const matches =
          derived.walletIdCompressed === walletAddress ||
          derived.walletIdUncompressed === walletAddress;
        setIsKeyValid(matches);
        if (!matches) toast.error("Private key does not match this wallet address");
      } catch {
        setIsKeyValid(false);
        toast.error("Invalid private key format");
      } finally {
        setIsValidatingKey(false);
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [privateKey, walletAddress]);

  const buildBatches = (allUtxos: UTXO[]) => {
    const created: Batch[] = [];
    for (let i = 0; i < allUtxos.length; i += BATCH_SIZE) {
      const batchUtxos = allUtxos.slice(i, i + BATCH_SIZE);
      const totalValue = batchUtxos.reduce((sum, u) => sum + u.value, 0);
      const dustCount = batchUtxos.filter((u) => u.value < 10000).length;
      created.push({
        id: Math.floor(i / BATCH_SIZE) + 1,
        utxos: batchUtxos,
        totalValue,
        totalValueLana: (totalValue / 100000000).toFixed(8),
        dustCount,
      });
    }
    return created;
  };

  const runAnalysis = async () => {
    if (!walletAddress) {
      toast.error("Wallet address not provided");
      navigate("/wallet");
      return;
    }
    try {
      setIsLoading(true);
      const { data, error } = await supabase.functions.invoke("analyze-wallet-utxos", {
        body: { address: walletAddress, electrumServers },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to analyze UTXOs");
      setAnalysis(data);
      setBatches(data.all_utxos?.length ? buildBatches(data.all_utxos) : []);
    } catch (err) {
      console.error("Error analyzing wallet UTXOs:", err);
      toast.error(err instanceof Error ? err.message : "Failed to analyze wallet UTXOs");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, parameters?.electrumServers]);

  const handleConsolidateBatch = async (batchId: number) => {
    if (!privateKey.trim()) {
      toast.error("Please enter your private key first");
      return;
    }
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;

    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, isProcessing: true } : b)));
    try {
      toast.info(`Consolidating Batch #${batchId} (${batch.utxos.length} UTXOs)…`);
      const { data, error } = await supabase.functions.invoke("consolidate-wallet", {
        body: {
          senderAddress: walletAddress,
          selectedUtxos: batch.utxos,
          privateKey,
          userPubkey: session?.nostrHexId,
          electrumServers,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Consolidation failed");

      setBatches((prev) =>
        prev.map((b) =>
          b.id === batchId ? { ...b, isProcessing: false, isCompleted: true, txid: data.txid } : b
        )
      );
      toast.success(`Batch #${batchId} consolidated! TX: ${data.txid.substring(0, 16)}…`, {
        duration: 6000,
      });
      // Re-analyse after a short delay so counts refresh (mempool needs a moment)
      setTimeout(() => runAnalysis(), 4000);
    } catch (err) {
      console.error(`Batch ${batchId} consolidation error:`, err);
      setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, isProcessing: false } : b)));
      toast.error(err instanceof Error ? `Consolidation failed: ${err.message}` : "Consolidation failed");
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <Button variant="ghost" onClick={() => navigate("/wallet")} className="mb-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Wallets
        </Button>
        <h1 className="text-3xl font-bold">Consolidate UTXOs</h1>
        <p className="mt-1 text-sm text-muted-foreground font-mono break-all">{walletAddress}</p>
      </div>

      {isFrozen && (
        <Card className="border-blue-500/50 bg-blue-500/10">
          <CardContent className="flex items-start gap-3 pt-6">
            <Snowflake className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-700 dark:text-blue-300">
              <p className="font-semibold">This wallet is frozen</p>
              <p>Outgoing transactions — including consolidation — are disabled.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Private Key Input */}
      <Card className="border-primary/50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-3">
              <Key className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1 space-y-3">
              <Label htmlFor="privateKey" className="text-base font-semibold">
                Wallet Private Key (WIF)
              </Label>
              <p className="text-sm text-muted-foreground">
                Enter the private key for this wallet to authorize consolidation. It is used only to
                sign the transaction on the server and is never stored.
              </p>
              <div className="relative">
                <Input
                  id="privateKey"
                  type="password"
                  placeholder="Enter your private key (WIF format)"
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  disabled={isValidatingKey}
                  className={`font-mono pr-10 ${
                    isKeyValid === true
                      ? "border-green-500 focus-visible:ring-green-500"
                      : isKeyValid === false
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                  }`}
                />
                {isValidatingKey && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-primary" />
                )}
                {!isValidatingKey && isKeyValid === true && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500">✓</span>
                )}
                {!isValidatingKey && isKeyValid === false && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-destructive">✗</span>
                )}
              </div>
              <Button type="button" variant="outline" onClick={() => setIsScannerOpen(true)} className="w-full">
                <QrCode className="mr-2 h-4 w-4" />
                Scan QR Code
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : !analysis ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Failed to load UTXO analysis.</p>
            <Button onClick={runAnalysis} className="mt-4" variant="outline">
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="flex items-center gap-3 pt-6">
                <div className="rounded-lg bg-primary/10 p-3">
                  <Package className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total UTXOs</p>
                  <p className="text-2xl font-bold">{analysis.total_utxos}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 pt-6">
                <div className="rounded-lg bg-primary/10 p-3">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Value</p>
                  <p className="text-2xl font-bold">{analysis.total_value_lana} LANA</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 pt-6">
                <div className="rounded-lg bg-destructive/10 p-3">
                  <AlertTriangle className="h-6 w-6 text-destructive" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Dust UTXOs</p>
                  <p className="text-2xl font-bold">{analysis.dust_count}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {analysis.total_utxos === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                This wallet has no UTXOs to consolidate.
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Dust analysis */}
              <Card>
                <CardHeader>
                  <CardTitle>Dust Analysis</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Row label="Dust threshold">
                    &lt; {analysis.dust_threshold_lana} LANA ({analysis.dust_threshold.toLocaleString()} lanoshis)
                  </Row>
                  <Row label="Dust UTXOs">
                    <span className="font-semibold text-destructive">
                      {analysis.dust_count} / {analysis.total_utxos}
                    </span>
                  </Row>
                  <Row label="Total dust value">
                    <span className="font-mono text-destructive">{analysis.dust_value_lana} LANA</span>
                  </Row>
                  <Row label="Non-dust UTXOs">
                    <span className="font-semibold text-primary">{analysis.non_dust_count}</span>
                  </Row>
                </CardContent>
              </Card>

              {/* Batches */}
              {batches.length > 0 && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-accent/10 p-3">
                        <Layers className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <CardTitle>Consolidation Batches</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {batches.length} {batches.length === 1 ? "batch" : "batches"} of up to {BATCH_SIZE} UTXOs
                          each — each merges into one output back to this wallet.
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {batches.map((batch) => (
                      <Card key={batch.id} className="border-border/50">
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between gap-4 flex-wrap">
                            <div className="flex-1 min-w-[200px]">
                              <div className="flex items-center gap-3 mb-2">
                                <h3 className="font-semibold text-lg">Batch #{batch.id}</h3>
                                <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                                  {batch.utxos.length} UTXOs
                                </span>
                                {batch.dustCount > 0 && (
                                  <span className="text-xs px-2 py-1 rounded-full bg-destructive/10 text-destructive">
                                    {batch.dustCount} dust
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-sm">
                                <span className="text-muted-foreground">Total:</span>
                                <span className="font-mono font-semibold text-primary">
                                  {batch.totalValueLana} LANA
                                </span>
                              </div>
                              {batch.txid && (
                                <a
                                  href={`https://chainz.cryptoid.info/lana/tx.dws?${batch.txid}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2 font-mono break-all"
                                >
                                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                  {batch.txid.substring(0, 24)}…
                                </a>
                              )}
                            </div>
                            <Button
                              onClick={() => handleConsolidateBatch(batch.id)}
                              disabled={
                                isFrozen ||
                                !privateKey.trim() ||
                                isKeyValid !== true ||
                                batch.isProcessing ||
                                batch.isCompleted
                              }
                            >
                              {batch.isProcessing ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Processing…
                                </>
                              ) : batch.isCompleted ? (
                                "✓ Completed"
                              ) : (
                                "Consolidate"
                              )}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}

      <QRScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={(data) => {
          setPrivateKey(data.trim());
          setIsScannerOpen(false);
          toast.success("QR code scanned");
        }}
        title="Scan Private Key"
        description="Point your camera at the wallet's private-key QR code."
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
