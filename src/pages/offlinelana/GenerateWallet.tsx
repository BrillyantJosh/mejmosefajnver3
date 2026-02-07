import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Download, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import QRCode from "react-qr-code";
import { generateRandomPrivateKey, privateKeyToWIF, generateCompressedPublicKey, generateLanaAddress } from "@/lib/crypto";

const GenerateWallet = () => {
  const [privateKeyWIF, setPrivateKeyWIF] = useState("");
  const [lanaAddress, setLanaAddress] = useState("");
  const [description, setDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const handleGenerateWallet = async () => {
    setIsGenerating(true);
    try {
      // Generate random 32-byte private key
      const privateKeyHex = generateRandomPrivateKey();
      
      // Convert to WIF format
      const wif = await privateKeyToWIF(privateKeyHex);
      
      // Generate compressed public key (matches server-side address derivation)
      const publicKeyHex = generateCompressedPublicKey(privateKeyHex);

      // Generate LanaCoin address
      const address = await generateLanaAddress(publicKeyHex);
      
      setPrivateKeyWIF(wif);
      setLanaAddress(address);
      
      toast({
        title: "Wallet Generated",
        description: "Your new LanaCoin wallet has been created successfully.",
      });
    } catch (error) {
      console.error("Error generating wallet:", error);
      toast({
        title: "Generation Failed",
        description: "Failed to generate wallet. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: `${label} copied to clipboard.`,
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy to clipboard.",
        variant: "destructive",
      });
    }
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>LanaCoin Paper Wallet</title>
          <style>
            @page { margin: 1cm; }
            body {
              font-family: Arial, sans-serif;
              padding: 10px;
              max-width: 800px;
              margin: 0 auto;
            }
            h1 {
              text-align: center;
              color: #333;
              margin-bottom: 15px;
              font-size: 20px;
            }
            .wallet-section {
              margin: 15px 0;
              padding: 12px;
              border: 2px solid #333;
              border-radius: 8px;
              page-break-inside: avoid;
            }
            .label {
              font-weight: bold;
              font-size: 12px;
              color: #666;
              margin-bottom: 5px;
            }
            .value {
              font-family: monospace;
              font-size: 10px;
              word-break: break-all;
              margin-bottom: 10px;
              padding: 8px;
              background: #f5f5f5;
              border-radius: 4px;
            }
            .qr-container {
              display: flex;
              justify-content: center;
              margin: 10px 0;
              padding: 8px;
              background: white;
            }
            .description {
              margin-top: 10px;
              padding: 10px;
              background: #fffbea;
              border-radius: 4px;
              font-size: 12px;
            }
            .warning {
              margin-top: 15px;
              padding: 10px;
              background: #fee;
              border: 1px solid #fcc;
              border-radius: 4px;
              font-size: 10px;
            }
            @media print {
              body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          <h1>LanaCoin Paper Wallet</h1>
          
          ${description ? `<div class="description"><strong>Description:</strong> ${description}</div>` : ''}
          
          <div class="wallet-section">
            <div class="label">LanaCoin Address (Public):</div>
            <div class="value">${lanaAddress}</div>
            <div class="qr-container">
              ${printRef.current?.querySelector('#address-qr')?.outerHTML || ''}
            </div>
          </div>
          
          <div class="wallet-section">
            <div class="label">Private Key (WIF) - KEEP SECRET:</div>
            <div class="value">${privateKeyWIF}</div>
            <div class="qr-container">
              ${printRef.current?.querySelector('#private-qr')?.outerHTML || ''}
            </div>
          </div>
          
          <div class="warning">
            <strong>⚠️ SECURITY WARNING:</strong><br>
            • Store this paper wallet in a secure location<br>
            • Never share your private key with anyone<br>
            • Anyone with access to the private key can access your funds<br>
            • Make backup copies and store them separately
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
    
    // Wait for content to load before printing
    setTimeout(() => {
      printWindow.print();
    }, 500);
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Generate LanaCoin Wallet</h1>
      
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Offline Paper Wallet Generator</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="description">Wallet Description (Optional)</Label>
            <Input
              id="description"
              placeholder="e.g., Savings Wallet, Emergency Fund..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <Button 
            onClick={handleGenerateWallet} 
            disabled={isGenerating}
            className="w-full"
            size="lg"
          >
            <RefreshCw className={`mr-2 h-5 w-5 ${isGenerating ? 'animate-spin' : ''}`} />
            {isGenerating ? "Generating..." : "Generate New Wallet"}
          </Button>
        </CardContent>
      </Card>

      {lanaAddress && privateKeyWIF && (
        <div ref={printRef} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-green-600">LanaCoin Address (Public)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <div className="font-mono text-sm break-all bg-muted p-4 rounded-md">
                    {lanaAddress}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(lanaAddress, "LanaCoin Address")}
                    className="mt-2"
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Address
                  </Button>
                </div>
                <div id="address-qr" className="bg-white p-4 rounded-lg border">
                  <QRCode value={lanaAddress} size={150} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-red-600">Private Key (WIF) - Keep Secret!</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <div className="font-mono text-sm break-all bg-muted p-4 rounded-md">
                    {privateKeyWIF}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(privateKeyWIF, "Private Key")}
                    className="mt-2"
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Private Key
                  </Button>
                </div>
                <div id="private-qr" className="bg-white p-4 rounded-lg border">
                  <QRCode value={privateKeyWIF} size={150} />
                </div>
              </div>
              <div className="bg-destructive/10 border border-destructive/20 rounded-md p-4 text-sm">
                <strong className="text-destructive">⚠️ Warning:</strong> Never share your private key with anyone. 
                Anyone with this key can access and spend your funds.
              </div>
            </CardContent>
          </Card>

          <Button
            onClick={handlePrint}
            variant="secondary"
            size="lg"
            className="w-full"
          >
            <Download className="h-5 w-5 mr-2" />
            Print Paper Wallet
          </Button>
        </div>
      )}
    </div>
  );
};

export default GenerateWallet;
