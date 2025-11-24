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

const DonatePrivateKey = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { projects, isLoading: projectsLoading } = useNostrProjects();
  
  const [privateKey, setPrivateKey] = useState<string>("");
  const [isValidating, setIsValidating] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [validationError, setValidationError] = useState<string>("");
  const [isValid, setIsValid] = useState(false);

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
        
        if (result.walletId !== selectedWalletId) {
          setValidationError("Private key does not match the selected wallet");
          setIsValid(false);
        } else {
          setValidationError("");
          setIsValid(true);
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

  const handleContinue = () => {
    if (!isValid) return;

    toast({
      title: "Private Key Verified",
      description: "Proceeding to complete donation...",
    });

    // TODO: Navigate to transaction confirmation/result page
    setTimeout(() => {
      toast({
        title: "Donation Processing",
        description: "Transaction functionality will be implemented soon",
      });
      navigate(`/100millionideas/project/${projectId}`);
    }, 1500);
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
