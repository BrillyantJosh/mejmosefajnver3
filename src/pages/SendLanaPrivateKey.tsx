import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowRight, Scan, Key } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Html5Qrcode } from "html5-qrcode";
import { convertWifToIds } from "@/lib/crypto";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSystemParameters } from "@/contexts/SystemParametersContext";

export default function SendLanaPrivateKey() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { parameters } = useSystemParameters();

  const walletId = searchParams.get("walletId") || "";
  const recipientWalletId = searchParams.get("recipientWalletId") || "";
  const amount = searchParams.get("amount") || "";
  const currency = searchParams.get("currency") || "";
  const inputAmount = searchParams.get("inputAmount") || "";

  const [privateKey, setPrivateKey] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState("");
  const [selectedTab, setSelectedTab] = useState("manual");
  const [isValidating, setIsValidating] = useState(false);
  const [isPrivateKeyValid, setIsPrivateKeyValid] = useState(false);
  const [validationError, setValidationError] = useState("");

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  // QR Code Scanner
  const startScanner = async () => {
    try {
      setIsScanning(true);
      setError("");

      const cameras = await Html5Qrcode.getCameras();
      
      if (!cameras || cameras.length === 0) {
        setError("No cameras found on this device.");
        setIsScanning(false);
        return;
      }

      const cameraId = cameras.length > 1 ? cameras[cameras.length - 1].id : cameras[0].id;
      
      const html5QrCode = new Html5Qrcode("qr-reader-private-key");
      html5QrCodeRef.current = html5QrCode;
      
      await html5QrCode.start(
        cameraId,
        { 
          fps: 10, 
          qrbox: { width: 250, height: 250 } 
        },
        (decodedText) => {
          setPrivateKey(decodedText);
          stopScanner();
          setSelectedTab("manual");
        },
        () => {
          // Error callback for scan failures - ignore
        }
      );
    } catch (err: any) {
      console.error("Scanner error:", err);
      setError(`Camera error: ${err.message || "Please check permissions and try again."}`);
      setIsScanning(false);
    }
  };

  const stopScanner = async () => {
    try {
      if (html5QrCodeRef.current) {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current = null;
      }
      setIsScanning(false);
    } catch (err) {
      console.error("Error stopping scanner:", err);
      setIsScanning(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current.stop().catch(console.error);
      }
    };
  }, []);

  // Real-time private key validation
  useEffect(() => {
    const validatePrivateKey = async () => {
      if (!privateKey.trim()) {
        setIsPrivateKeyValid(false);
        setValidationError("");
        return;
      }

      try {
        const derivedIds = await convertWifToIds(privateKey.trim());
        
        if (derivedIds.walletId !== walletId) {
          setIsPrivateKeyValid(false);
          setValidationError("Private key does not match the sender wallet ID");
        } else {
          setIsPrivateKeyValid(true);
          setValidationError("");
        }
      } catch (err) {
        setIsPrivateKeyValid(false);
        setValidationError("Invalid private key format");
      }
    };

    // Debounce validation
    const timeoutId = setTimeout(validatePrivateKey, 500);
    return () => clearTimeout(timeoutId);
  }, [privateKey, walletId]);

  const handleContinue = async () => {
    if (!privateKey.trim()) {
      setError("Please enter or scan a private key");
      return;
    }

    if (!isPrivateKeyValid) {
      setError("Please enter a valid private key that matches the sender wallet");
      return;
    }

    try {
      setIsValidating(true);
      setError("");

      toast.success("Broadcasting transaction...");

      // Call Edge Function to broadcast transaction
      const { data, error: txError } = await supabase.functions.invoke('send-lana-transaction', {
        body: {
          senderAddress: walletId,
          recipientAddress: recipientWalletId,
          amount: parseFloat(amount),
          privateKey: privateKey.trim(),
          emptyWallet: false,
          electrumServers: parameters?.electrumServers || []
        }
      });

      if (txError) throw txError;

      if (data?.success) {
        // Navigate to result page with success parameters
        const params = new URLSearchParams({
          success: "true",
          txHash: data.txHash,
          senderAddress: walletId,
          recipientAddress: recipientWalletId,
          amount: data.amount.toString(),
          fee: data.fee.toString()
        });
        navigate(`/send-lana/result?${params.toString()}`);
      } else {
        throw new Error(data?.error || 'Transaction failed');
      }
      
    } catch (err) {
      console.error("Transaction error:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to process transaction";
      
      // Navigate to result page with error parameters
      const params = new URLSearchParams({
        success: "false",
        error: errorMessage,
        senderAddress: walletId,
        recipientAddress: recipientWalletId,
        amount: amount,
        privateKey: privateKey.trim()
      });
      navigate(`/send-lana/result?${params.toString()}`);
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Enter Private Key</CardTitle>
          <p className="text-sm text-muted-foreground">
            Sending {amount} {currency} from ...{walletId.slice(-8)} to {recipientWalletId}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs value={selectedTab} onValueChange={setSelectedTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual">
                <Key className="h-4 w-4 mr-2" />
                Manual Entry
              </TabsTrigger>
              <TabsTrigger value="scan">
                <Scan className="h-4 w-4 mr-2" />
                Scan QR
              </TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="privateKey">Private Key (WIF Format)</Label>
                <Input
                  id="privateKey"
                  type="password"
                  placeholder="Enter your private key"
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  className={`font-mono ${validationError ? 'border-destructive' : isPrivateKeyValid ? 'border-green-500' : ''}`}
                />
                {validationError && (
                  <p className="text-xs text-destructive">{validationError}</p>
                )}
                {isPrivateKeyValid && (
                  <p className="text-xs text-green-600">✓ Private key is valid for this wallet</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Your private key is never stored and only used for this transaction validation.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="scan" className="space-y-4">
              <div className="space-y-4">
                {!isScanning ? (
                  <Button onClick={startScanner} className="w-full">
                    <Scan className="h-4 w-4 mr-2" />
                    Start Camera
                  </Button>
                ) : (
                  <>
                    <div
                      id="qr-reader-private-key"
                      className="w-full rounded-lg overflow-hidden"
                    />
                    <Button onClick={stopScanner} variant="destructive" className="w-full">
                      Stop Scanning
                    </Button>
                  </>
                )}
                {privateKey && (
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">Scanned private key:</p>
                    <p className="font-mono text-sm break-all">{"•".repeat(privateKey.length)}</p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            className="w-full"
            size="lg"
            onClick={handleContinue}
            disabled={!privateKey.trim() || !isPrivateKeyValid || isValidating}
          >
            {isValidating ? "Broadcasting..." : "Continue"}
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
