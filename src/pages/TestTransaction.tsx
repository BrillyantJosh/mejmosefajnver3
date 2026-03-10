import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Send,
  Key,
  Wallet,
  Search,
  CheckCircle,
  XCircle,
  Loader2,
  Bug,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { useSystemParameters } from "@/contexts/SystemParametersContext";

const API_URL = import.meta.env.VITE_API_URL ?? "";

interface DerivationResult {
  payloadLength: number;
  versionByte: string;
  hasCompressionFlag: boolean;
  privateKeyHex: string;
  uncompressedPubkey: string;
  compressedPubkey: string;
  uncompressedAddress: string;
  compressedAddress: string;
}

interface TxResult {
  success: boolean;
  txHash?: string;
  amount?: number;
  fee?: number;
  error?: string;
}

export default function TestTransaction() {
  const { parameters } = useSystemParameters();

  const [senderAddress, setSenderAddress] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [amount, setAmount] = useState("");

  const [derivation, setDerivation] = useState<DerivationResult | null>(null);
  const [derivationLoading, setDerivationLoading] = useState(false);
  const [derivationError, setDerivationError] = useState<string | null>(null);

  const [txResult, setTxResult] = useState<TxResult | null>(null);
  const [txLoading, setTxLoading] = useState(false);

  // Debug: derive keys from WIF
  const handleDerive = async () => {
    if (!privateKey.trim()) {
      toast.error("Enter a WIF private key first");
      return;
    }
    setDerivationLoading(true);
    setDerivationError(null);
    setDerivation(null);

    try {
      const res = await fetch(`${API_URL}/api/functions/debug-derive-wif`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wif: privateKey.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setDerivation(data.derivation);
        // Auto-fill sender address based on key type
        if (data.derivation.hasCompressionFlag) {
          setSenderAddress(data.derivation.compressedAddress);
          toast.success("Compressed key detected — sender address auto-filled");
        } else {
          setSenderAddress(data.derivation.uncompressedAddress);
          toast.success("Uncompressed key detected — sender address auto-filled");
        }
      } else {
        setDerivationError(data.error || "Derivation failed");
      }
    } catch (err: any) {
      setDerivationError(err.message || "Network error");
    } finally {
      setDerivationLoading(false);
    }
  };

  // Send transaction
  const handleSend = async () => {
    if (!senderAddress.trim() || !recipientAddress.trim() || !privateKey.trim() || !amount.trim()) {
      toast.error("Fill in all fields");
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    setTxLoading(true);
    setTxResult(null);

    try {
      const res = await fetch(
        `${API_URL}/api/functions/send-lana-transaction`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            senderAddress: senderAddress.trim(),
            recipientAddress: recipientAddress.trim(),
            privateKey: privateKey.trim(),
            amount: amountNum,
            electrumServers: parameters?.electrumServers || [],
          }),
        }
      );
      const data = await res.json();
      setTxResult(data);
      if (data.success) {
        toast.success("Transaction sent!");
      } else {
        toast.error(data.error || "Transaction failed");
      }
    } catch (err: any) {
      setTxResult({ success: false, error: err.message });
      toast.error(err.message || "Network error");
    } finally {
      setTxLoading(false);
    }
  };

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied!`);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="container mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Test Transaction</h1>
        <p className="text-muted-foreground mb-6">
          Debug WIF key derivation and test LANA transactions
        </p>

        {/* Step 1: WIF Key Derivation Debug */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Bug className="h-5 w-5" />
              Step 1: Derive & Debug WIF Key
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>WIF Private Key</Label>
              <Input
                type="password"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="Enter WIF private key..."
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Length: {privateKey.trim().length} chars | Starts with: {privateKey.trim()[0] || "?"}
              </p>
            </div>

            <Button onClick={handleDerive} disabled={derivationLoading}>
              {derivationLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Derive Keys
            </Button>

            {derivationError && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Derivation Error</AlertTitle>
                <AlertDescription>{derivationError}</AlertDescription>
              </Alert>
            )}

            {derivation && (
              <div className="space-y-3 bg-muted/50 rounded-lg p-4">
                <h3 className="font-semibold text-sm">Derivation Result</h3>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payload length:</span>
                    <span className="font-mono">
                      {derivation.payloadLength} bytes
                      {derivation.payloadLength === 34 && " (compressed WIF)"}
                      {derivation.payloadLength === 33 && " (uncompressed WIF)"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Version byte:</span>
                    <span className="font-mono">{derivation.versionByte}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Compression flag:</span>
                    <span className={derivation.hasCompressionFlag ? "text-green-500 font-bold" : "text-muted-foreground"}>
                      {derivation.hasCompressionFlag ? "YES (0x01)" : "No"}
                    </span>
                  </div>

                  <div className="border-t pt-2 mt-2">
                    <p className="text-muted-foreground mb-1">Private Key Hex (32 bytes):</p>
                    <p className="font-mono text-xs break-all bg-background p-2 rounded">
                      {derivation.privateKeyHex}
                    </p>
                  </div>

                  <div className="border-t pt-2">
                    <p className="text-muted-foreground mb-1">Uncompressed Pubkey ({derivation.uncompressedPubkey.length / 2} bytes):</p>
                    <p className="font-mono text-xs break-all bg-background p-2 rounded">
                      {derivation.uncompressedPubkey}
                    </p>
                  </div>

                  <div>
                    <p className="text-muted-foreground mb-1">Compressed Pubkey ({derivation.compressedPubkey.length / 2} bytes):</p>
                    <p className="font-mono text-xs break-all bg-background p-2 rounded">
                      {derivation.compressedPubkey}
                    </p>
                  </div>

                  <div className="border-t pt-2">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-muted-foreground">
                        Address (from uncompressed)
                        {!derivation.hasCompressionFlag && <span className="text-orange-500 ml-1">← auto-selected</span>}
                        :
                      </p>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2"
                          onClick={() => copyText(derivation.uncompressedAddress, "Address")}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <p className={`font-mono text-sm p-2 rounded ${
                      derivation.uncompressedAddress === senderAddress.trim()
                        ? "bg-green-500/10 text-green-600 border border-green-500/30"
                        : "bg-background"
                    }`}>
                      {derivation.uncompressedAddress}
                      {derivation.uncompressedAddress === senderAddress.trim() && " ✅ SENDER"}
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-muted-foreground">
                        Address (from compressed)
                        {derivation.hasCompressionFlag && <span className="text-orange-500 ml-1">← auto-selected</span>}
                        :
                      </p>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2"
                          onClick={() => copyText(derivation.compressedAddress, "Address")}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <p className={`font-mono text-sm p-2 rounded ${
                      derivation.compressedAddress === senderAddress.trim()
                        ? "bg-green-500/10 text-green-600 border border-green-500/30"
                        : "bg-background"
                    }`}>
                      {derivation.compressedAddress}
                      {derivation.compressedAddress === senderAddress.trim() && " ✅ SENDER"}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 2: Send Transaction */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Send className="h-5 w-5" />
              Step 2: Send Test Transaction
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Sender Address</Label>
              <Input
                value={senderAddress}
                onChange={(e) => setSenderAddress(e.target.value)}
                placeholder="Sender LANA address..."
                className="font-mono"
              />
            </div>

            <div>
              <Label>Recipient Address</Label>
              <Input
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                placeholder="Enter recipient LANA address..."
                className="font-mono"
              />
            </div>

            <div>
              <Label>Amount (LANA)</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 1.0"
                step="0.01"
                min="0"
              />
            </div>

            <Button
              onClick={handleSend}
              disabled={txLoading || !recipientAddress.trim() || !amount.trim()}
              className="w-full"
              variant="default"
            >
              {txLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {txLoading ? "Sending..." : "Send Transaction"}
            </Button>

            {txResult && (
              <Alert
                variant={txResult.success ? "default" : "destructive"}
                className={
                  txResult.success
                    ? "border-green-500/50 bg-green-500/10"
                    : ""
                }
              >
                {txResult.success ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                <AlertTitle>
                  {txResult.success ? "Transaction Sent!" : "Transaction Failed"}
                </AlertTitle>
                <AlertDescription className="space-y-2">
                  {txResult.success ? (
                    <>
                      <p>
                        <strong>TX Hash:</strong>
                      </p>
                      <p className="font-mono text-xs break-all select-all">
                        {txResult.txHash}
                      </p>
                      <p className="text-sm mt-2">
                        Amount: {txResult.amount} LANA | Fee: {txResult.fee} LANA
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() =>
                          window.open(
                            `https://chainz.cryptoid.info/lana/tx.dws?${txResult.txHash}.htm`,
                            "_blank"
                          )
                        }
                      >
                        View on Explorer
                      </Button>
                    </>
                  ) : (
                    <p>{txResult.error}</p>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
