import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { useNostrProjects } from "@/hooks/useNostrProjects";
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

const DonatePrivateKey = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { projects, isLoading: projectsLoading } = useNostrProjects();
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  
  const [privateKey, setPrivateKey] = useState<string>("");
  const [isValidating, setIsValidating] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [validationError, setValidationError] = useState<string>("");
  const [isValid, setIsValid] = useState(false);
  // Store the compressed wallet address for server-side transaction
  const [compressedWalletId, setCompressedWalletId] = useState<string>("");

  const project = projects.find(p => p.id === projectId);
  
  // Get data from previous page
  const { selectedWalletId, amount, lanaAmount, message } = location.state || {};

  if (!selectedWalletId || !amount || !lanaAmount) {
    // Redirect back if missing data
    navigate(`/100millionideas/donate/${projectId}`);
    return null;
  }

  const handleQRScan = (data: string) => {
    setPrivateKey(data);
    setShowScanner(false);
  };

  // Real-time validation
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
        const matchesCompressed = result.walletId === selectedWalletId;
        const matchesUncompressed = result.walletIdUncompressed === selectedWalletId;

        if (!matchesCompressed && !matchesUncompressed) {
          setValidationError("Private key does not match the selected wallet");
          setIsValid(false);
          setCompressedWalletId("");
        } else {
          setValidationError("");
          setIsValid(true);
          // Always store the compressed address for server-side transactions
          setCompressedWalletId(result.walletId);
        }
      } catch (error) {
        setValidationError("Invalid private key format");
        setIsValid(false);
      } finally {
        setIsValidating(false);
      }
    };

    const timeoutId = setTimeout(validateKey, 500);
    return () => clearTimeout(timeoutId);
  }, [privateKey, selectedWalletId]);

  const handleContinue = async () => {
    if (!isValid || !project || !parameters) return;

    // Check if user is logged in
    if (!session?.nostrHexId || !session?.nostrPrivateKey) {
      toast({
        title: "Error",
        description: "You must be logged in to donate",
        variant: "destructive"
      });
      return;
    }

    setIsValidating(true);
    
    try {
      toast({
        title: "Processing Donation",
        description: "Creating transaction...",
      });

      // Step 1: Get service name and mentor hex ID from app_settings
      const [{ data: appNameData }, { data: mentorSettingData }] = await Promise.all([
        supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'app_name')
          .single(),
        supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'mentor_100million_ideas')
          .maybeSingle()
      ]);

      const serviceName = appNameData?.value || 'LanaCrowd';
      // mentor_100million_ideas now stores wallet address directly
      const mentorWallet = mentorSettingData?.value as string || '';

      // Step 2: Convert FIAT amount to lanoshis
      const lanaAmountLanoshis = Math.floor(lanaAmount * 100000000);

      // Step 3: Call send-lana-transaction edge function
      // Use the original wallet address (from KIND 30889) — server derives pubkey from WIF
      const hasMentorSplit = !!mentorWallet;
      const { data: txData, error: txError } = await supabase.functions.invoke('send-lana-transaction', {
        body: {
          senderAddress: selectedWalletId,
          recipientAddress: project.wallet,
          mentorAddress: hasMentorSplit ? mentorWallet : undefined,
          mentorPercent: hasMentorSplit ? 10 : undefined,
          amount: lanaAmountLanoshis / 100000000, // Convert back to LANA
          privateKey: privateKey.trim(),
          emptyWallet: false,
          electrumServers: parameters.electrumServers || []
        }
      });

      if (txError || !txData?.success) {
        throw new Error(txData?.error || 'Transaction failed');
      }

      const txHash = txData.txHash;
      const txFee = txData.fee;

      toast({
        title: "Transaction Successful",
        description: "Creating donation record...",
      });

      // Step 4: Create KIND 60200 events
      // Calculate amounts for project and mentor
      const projectLanoshis = hasMentorSplit
        ? Math.floor(lanaAmountLanoshis * 0.90)
        : lanaAmountLanoshis;
      const mentorLanoshis = hasMentorSplit
        ? lanaAmountLanoshis - projectLanoshis
        : 0;

      const nowTs = Math.floor(Date.now() / 1000);

      // Event 1: Project donation (95% or 100%)
      const projectEventTemplate = {
        kind: 60200,
        created_at: nowTs,
        tags: [
          ["service", "lanacrowd"],
          ["project", projectId || ""],
          ["p", session.nostrHexId, "supporter"],
          ["p", project.ownerPubkey, "project_owner"],
          ["amount_lanoshis", projectLanoshis.toString()],
          ["amount_fiat", hasMentorSplit
            ? (parseFloat(amount) * 0.90).toFixed(2)
            : amount.toString()],
          ["currency", project.currency],
          ["from_wallet", selectedWalletId],
          ["to_wallet", project.wallet],
          ["tx", txHash],
          ["type", "donation"],
          ["timestamp_paid", nowTs.toString()]
        ],
        content: message || `Supporting ${project.title} with ${amount} ${project.currency}`
      };

      // Sign the project donation event
      const signedProjectEvent = finalizeEvent(projectEventTemplate, hexToBytes(session.nostrPrivateKey));

      toast({
        title: "Broadcasting Events",
        description: "Publishing to Nostr relays...",
      });

      // Publish project donation event
      const { data: publishData, error: publishError } = await supabase.functions.invoke('publish-dm-event', {
        body: { event: signedProjectEvent }
      });

      let successCount = publishData?.publishedTo || 0;
      let totalRelays = publishData?.totalRelays || 0;

      if (publishError) {
        console.error("Publish error (project event):", publishError);
      }

      console.log('📊 Project donation event:', {
        eventId: signedProjectEvent.id,
        publishedTo: successCount,
        totalRelays,
        projectLanoshis
      });

      // Event 2: Mentor fee (5%) — only if mentor split is active
      let signedMentorEvent: any = null;
      if (hasMentorSplit && mentorLanoshis > 0 && mentorHexId) {
        const mentorEventTemplate = {
          kind: 60200,
          created_at: nowTs,
          tags: [
            ["service", "lanacrowd"],
            ["project", projectId || ""],
            ["p", session.nostrHexId, "supporter"],
            ["p", mentorHexId, "mentor"],
            ["amount_lanoshis", mentorLanoshis.toString()],
            ["amount_fiat", (parseFloat(amount) * 0.10).toFixed(2)],
            ["currency", project.currency],
            ["from_wallet", selectedWalletId],
            ["to_wallet", mentorWallet],
            ["tx", txHash],
            ["type", "mentor_fee"],
            ["timestamp_paid", nowTs.toString()]
          ],
          content: `Mentor fee for ${project.title}`
        };

        signedMentorEvent = finalizeEvent(mentorEventTemplate, hexToBytes(session.nostrPrivateKey));

        const { data: mentorPublishData, error: mentorPublishError } = await supabase.functions.invoke('publish-dm-event', {
          body: { event: signedMentorEvent }
        });

        if (mentorPublishError) {
          console.error("Publish error (mentor event):", mentorPublishError);
        }

        console.log('📊 Mentor fee event:', {
          eventId: signedMentorEvent.id,
          publishedTo: mentorPublishData?.publishedTo || 0,
          mentorLanoshis,
          mentorWallet
        });

        // Update counts with mentor event results
        successCount = Math.max(successCount, mentorPublishData?.publishedTo || 0);
        totalRelays = Math.max(totalRelays, mentorPublishData?.totalRelays || 0);
      }

      // Navigate to result page even if some relays failed
      const resultParams = new URLSearchParams({
        success: "true",
        txHash,
        projectId: projectId || "",
        projectTitle: project.title,
        amount: amount.toString(),
        currency: project.currency,
        lanaAmount: lanaAmount.toFixed(8),
        fee: (txFee / 100000000).toFixed(8),
        senderAddress: selectedWalletId,
        recipientAddress: project.wallet,
        relaysPublished: successCount.toString(),
        totalRelays: totalRelays.toString(),
        eventId: signedProjectEvent.id,
        ...(hasMentorSplit && {
          mentorAddress: mentorWallet,
          mentorAmount: (mentorLanoshis / 100000000).toFixed(8),
          mentorEventId: signedMentorEvent?.id || '',
        })
      });

      navigate(`/100millionideas/donate-result?${resultParams.toString()}`);

    } catch (error) {
      console.error("Donation error:", error);
      
      const params = new URLSearchParams({
        success: "false",
        error: error instanceof Error ? error.message : "Donation failed",
        projectId: projectId || "",
        projectTitle: project?.title || "",
        amount: amount.toString(),
        currency: project?.currency || "EUR"
      });

      navigate(`/100millionideas/donate-result?${params.toString()}`);
    } finally {
      setIsValidating(false);
    }
  };

  // Helper function to convert hex string to Uint8Array
  const hexToBytes = (hex: string): Uint8Array => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  };

  if (projectsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-center text-muted-foreground">Project not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-background sticky top-0 z-10">
        <div className="container mx-auto p-4">
          <Button
            variant="ghost"
            onClick={() => navigate(`/100millionideas/donate/${projectId}`, { 
              state: { selectedWalletId, amount, message } 
            })}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto p-6 max-w-2xl">
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Enter Private Key</h1>
            <p className="text-muted-foreground mt-2">
              Enter the private key for your selected wallet to complete the donation
            </p>
          </div>

          {/* Donation Summary */}
          <Card className="border-green-500/20 bg-green-500/5">
            <CardHeader>
              <CardTitle className="text-lg">Donation Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Project:</span>
                <span className="font-semibold">{project.title}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount:</span>
                <span className="font-semibold">{amount} {project.currency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">LANA Amount:</span>
                <span className="font-semibold">{lanaAmount.toFixed(2)} LANA</span>
              </div>
            </CardContent>
          </Card>

          {/* Wallet Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">From Wallet</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted p-3 rounded-md">
                <p className="font-mono text-sm break-all">{selectedWalletId}</p>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                You need to provide the private key for this wallet
              </p>
            </CardContent>
          </Card>

          {/* Private Key Input */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Private Key (WIF Format) *</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="private-key">Enter your wallet's private key</Label>
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
                    title="Scan QR Code"
                  >
                    <ScanLine className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Your private key is never stored and is only used to sign this transaction
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
                  <span>Private key verified successfully</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Continue Button */}
          <Button
            onClick={handleContinue}
            disabled={!isValid || isValidating}
            className="w-full bg-green-500 hover:bg-green-600 text-white h-12 disabled:opacity-50"
          >
            Continue with Donation
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            🔒 Your private key is handled securely and never transmitted to our servers
          </p>
        </div>
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

export default DonatePrivateKey;
