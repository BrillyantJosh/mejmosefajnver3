import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowRight, Scan, Search, User, Wallet } from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Html5Qrcode } from "html5-qrcode";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { SimplePool } from "nostr-tools";
import { validateLanaWalletIdWithMessage } from "@/lib/lanaWalletValidation";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrUserWallets } from "@/hooks/useNostrUserWallets";

interface SearchResult {
  pubkey: string;
  name: string;
  display_name: string;
  picture?: string;
  wallets: {
    walletId: string;
    walletType: string;
    note: string;
  }[];
}

export default function SendLanaRecipient() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { parameters } = useSystemParameters();
  const { session } = useAuth();

  const walletId = searchParams.get("walletId") || "";
  const amount = searchParams.get("amount") || "";
  const currency = searchParams.get("currency") || "";
  const inputAmount = searchParams.get("inputAmount") || "";
  const emptyWallet = searchParams.get("emptyWallet") === "true";
  const manualOnly = searchParams.get("manualOnly") === "true";

  const [recipientWalletId, setRecipientWalletId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState("");
  const [selectedTab, setSelectedTab] = useState("manual");
  
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  const relays = parameters?.relays || [];

  // Fetch user's own wallets
  const { wallets: userWallets, isLoading: isLoadingWallets } = useNostrUserWallets(session?.nostrHexId || null);
  
  // Filter wallets - only eligible types, exclude the source wallet
  const eligibleWallets = userWallets.filter(w =>
    (w.walletType === "Main Wallet" || w.walletType === "Wallet" || w.walletType === "Lana.Discount") &&
    w.walletId !== walletId
  );

  // QR Code Scanner
  const startScanner = async () => {
    try {
      setIsScanning(true);
      setError("");

      // Get available cameras first
      const cameras = await Html5Qrcode.getCameras();
      
      if (!cameras || cameras.length === 0) {
        setError("No cameras found on this device.");
        setIsScanning(false);
        return;
      }

      // Use the back camera if available, otherwise use the first camera
      const cameraId = cameras.length > 1 ? cameras[cameras.length - 1].id : cameras[0].id;
      
      // Create scanner instance
      const html5QrCode = new Html5Qrcode("qr-reader");
      html5QrCodeRef.current = html5QrCode;
      
      await html5QrCode.start(
        cameraId,
        { 
          fps: 10, 
          qrbox: { width: 250, height: 250 } 
        },
        (decodedText) => {
          setRecipientWalletId(decodedText);
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

  // Search by name
  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setError("Please enter a search term");
      return;
    }
    
    if (searchQuery.trim().length < 2) {
      setError("Search term must be at least 2 characters");
      return;
    }
    
    if (relays.length === 0) {
      setError("No relays available");
      return;
    }

    setIsSearching(true);
    setError("");
    setSearchResults([]);

    try {
      const pool = new SimplePool();
      const events = await Promise.race([
        pool.querySync(relays, {
          kinds: [0],
          limit: 1000,
        }),
        new Promise<any[]>((_, reject) => 
          setTimeout(() => reject(new Error('Search timeout')), 10000)
        )
      ]);

      const matchingProfiles = events
        .map((event) => {
          try {
            const profile = JSON.parse(event.content);
            const name = profile.name?.toLowerCase() || "";
            const displayName = profile.display_name?.toLowerCase() || "";
            const query = searchQuery.toLowerCase();

            if (name.includes(query) || displayName.includes(query)) {
              return {
                pubkey: event.pubkey,
                name: profile.name || "",
                display_name: profile.display_name || "",
                picture: profile.picture,
              };
            }
          } catch (e) {
            return null;
          }
          return null;
        })
        .filter(Boolean);

      // Fetch wallets for matching profiles
      const results: SearchResult[] = [];
      for (const profile of matchingProfiles) {
        if (!profile) continue;

        const walletEvents = await pool.querySync(relays, {
          kinds: [30889],
          "#d": [profile.pubkey],
          limit: 10,
        });

        const wallets = walletEvents.flatMap((event) => {
          const wTags = event.tags.filter((tag) => tag[0] === "w");
          return wTags.map((tag) => ({
            walletId: tag[1] || "",
            walletType: tag[2] || "",
            note: tag[4] || "",
          }));
        });

        if (wallets.length > 0) {
          results.push({
            ...profile,
            wallets,
          });
        }
      }

      setSearchResults(results);
      if (results.length === 0) {
        setError("No users found with wallets");
      }
    } catch (err) {
      setError("Search failed. Please try again.");
      console.error("Search error:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleContinue = async () => {
    if (!recipientWalletId.trim()) {
      setError("Please enter or select a recipient wallet ID");
      return;
    }

    // Validate wallet ID
    const validation = await validateLanaWalletIdWithMessage(recipientWalletId);
    if (!validation.valid) {
      setError(validation.message || "Invalid wallet ID");
      return;
    }

    console.log('🚀 SendLanaRecipient navigate:', { 
      walletId, 
      recipientWalletId, 
      amount, 
      currency, 
      inputAmount 
    });

    // Navigate to private key entry page
    const params = new URLSearchParams({
      walletId,
      recipientWalletId,
      amount,
      currency,
      inputAmount,
    });
    if (emptyWallet) params.set('emptyWallet', 'true');
    navigate(`/send-lana/private-key?${params.toString()}`);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Select Recipient</CardTitle>
          <p className="text-sm text-muted-foreground">
            Sending {amount} LANA from wallet ending in ...{walletId.slice(-8)}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs value={selectedTab} onValueChange={setSelectedTab}>
            <TabsList className={`grid w-full ${manualOnly ? 'grid-cols-2' : 'grid-cols-4'}`}>
              <TabsTrigger value="manual">
                <User className="h-4 w-4 mr-2" />
                Manual
              </TabsTrigger>
              {!manualOnly && (
                <TabsTrigger value="mywallets">
                  <Wallet className="h-4 w-4 mr-2" />
                  My Wallets
                </TabsTrigger>
              )}
              <TabsTrigger value="scan">
                <Scan className="h-4 w-4 mr-2" />
                Scan QR
              </TabsTrigger>
              {!manualOnly && (
                <TabsTrigger value="search">
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="manual" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="walletId">Recipient Wallet ID</Label>
                <Input
                  id="walletId"
                  placeholder="Enter wallet ID (e.g., LcGT73RnXXwMUUyaMoHeZnVPYTa28j9F3f)"
                  value={recipientWalletId}
                  onChange={(e) => setRecipientWalletId(e.target.value)}
                />
              </div>
            </TabsContent>

            <TabsContent value="mywallets" className="space-y-4">
              <div className="space-y-2">
                <Label>Select one of your wallets</Label>
                {isLoadingWallets ? (
                  <p className="text-sm text-muted-foreground">Loading wallets...</p>
                ) : eligibleWallets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No eligible wallets found (Main Wallet or Wallet types)</p>
                ) : (
                  <div className="space-y-2">
                    {eligibleWallets.map((wallet) => (
                      <Button
                        key={wallet.walletId}
                        variant={recipientWalletId === wallet.walletId ? "default" : "outline"}
                        className="w-full justify-start h-auto py-3 overflow-hidden"
                        onClick={() => setRecipientWalletId(wallet.walletId)}
                      >
                        <div className="text-left w-full overflow-hidden">
                          <p className="font-mono text-xs break-all">{wallet.walletId}</p>
                          <p className="text-xs text-muted-foreground break-words whitespace-normal">
                            {wallet.walletType}
                            {wallet.note && ` - ${wallet.note.length > 50 ? wallet.note.slice(0, 50) + '...' : wallet.note}`}
                          </p>
                        </div>
                      </Button>
                    ))}
                  </div>
                )}
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
                      id="qr-reader"
                      className="w-full rounded-lg overflow-hidden"
                    />
                    <Button onClick={stopScanner} variant="destructive" className="w-full">
                      Stop Scanning
                    </Button>
                  </>
                )}
                {recipientWalletId && (
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">Scanned wallet:</p>
                    <p className="font-mono text-sm break-all">{recipientWalletId}</p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="search" className="space-y-4">
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Search by name or display name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                  <Button onClick={handleSearch} disabled={isSearching}>
                    {isSearching ? "Searching..." : "Search"}
                  </Button>
                </div>

                {searchResults.length > 0 && (
                  <div className="space-y-2">
                    {searchResults.map((result) => (
                      <Card key={result.pubkey} className="p-4">
                        <div className="flex items-start gap-3 mb-3">
                          <UserAvatar pubkey={result.pubkey} picture={result.picture} name={result.display_name || result.name} className="h-10 w-10" />
                          <div>
                            <p className="font-semibold">{result.display_name}</p>
                            <p className="text-sm text-muted-foreground">@{result.name}</p>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {result.wallets.map((wallet, idx) => (
                            <Button
                              key={idx}
                              variant="outline"
                              className="w-full justify-start"
                              onClick={() => {
                                setRecipientWalletId(wallet.walletId);
                                setSelectedTab("manual");
                              }}
                            >
                              <div className="text-left">
                                <p className="font-mono text-xs">{wallet.walletId}</p>
                                <p className="text-xs text-muted-foreground">
                                  {wallet.walletType}
                                  {wallet.note && ` - ${wallet.note}`}
                                </p>
                              </div>
                            </Button>
                          ))}
                        </div>
                      </Card>
                    ))}
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
            onClick={async () => await handleContinue()}
            disabled={!recipientWalletId.trim()}
          >
            Continue
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
