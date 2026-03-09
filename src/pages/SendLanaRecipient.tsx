import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowRight, Scan, Search, User, Wallet, Snowflake, ShieldAlert, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Html5Qrcode } from "html5-qrcode";
import { validateLanaWalletIdWithMessage } from "@/lib/lanaWalletValidation";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrUserWallets } from "@/hooks/useNostrUserWallets";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";

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
  const { session } = useAuth();
  const { wallets: myWallets } = useNostrWallets();

  const walletId = searchParams.get("walletId") || "";
  const amount = searchParams.get("amount") || "";
  const currency = searchParams.get("currency") || "";
  const inputAmount = searchParams.get("inputAmount") || "";
  const emptyWallet = searchParams.get("emptyWallet") === "true";
  const manualOnly = searchParams.get("manualOnly") === "true";

  // Check if sender wallet is frozen
  const senderWallet = myWallets.find(w => w.walletId === walletId);
  const isFrozen = !!(senderWallet?.freezeStatus);

  const [recipientWalletId, setRecipientWalletId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState("");
  const [selectedTab, setSelectedTab] = useState("manual");

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  // Real-time wallet registration check
  const [walletCheckStatus, setWalletCheckStatus] = useState<'idle' | 'checking' | 'registered' | 'unregistered' | 'error'>('idle');
  const [walletCheckData, setWalletCheckData] = useState<{ wallet_type?: string; frozen?: boolean; nostr_hex_id?: string } | null>(null);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch owner profile when we have a nostr_hex_id
  const { profile: ownerProfile, isLoading: ownerProfileLoading } = useNostrProfileCache(
    walletCheckData?.nostr_hex_id || null
  );

  // Debounced wallet registration check
  const checkWalletRegistration = useCallback(async (walletAddress: string) => {
    setWalletCheckStatus('checking');
    setWalletCheckData(null);
    setError("");
    try {
      const API_URL = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${API_URL}/api/functions/check-wallet-registration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_id: walletAddress }),
      });
      const data = await res.json();

      if (data.registered === true) {
        setWalletCheckStatus('registered');
        setWalletCheckData({
          wallet_type: data.wallet?.wallet_type,
          frozen: data.wallet?.frozen,
          nostr_hex_id: data.wallet?.nostr_hex_id,
        });
      } else if (data.registered === false) {
        setWalletCheckStatus('unregistered');
        setWalletCheckData(null);
      } else {
        setWalletCheckStatus('error');
        setWalletCheckData(null);
      }
    } catch {
      setWalletCheckStatus('error');
      setWalletCheckData(null);
    }
  }, []);

  // Auto-check when recipientWalletId changes (debounced 600ms)
  useEffect(() => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);

    const trimmed = recipientWalletId.trim();
    if (!trimmed || trimmed.length < 26 || !trimmed.startsWith('L')) {
      setWalletCheckStatus('idle');
      setWalletCheckData(null);
      return;
    }

    checkTimerRef.current = setTimeout(() => {
      checkWalletRegistration(trimmed);
    }, 600);

    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    };
  }, [recipientWalletId, checkWalletRegistration]);

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
    
    setIsSearching(true);
    setError("");
    setSearchResults([]);

    const API_URL = import.meta.env.VITE_API_URL ?? '';

    try {
      // Search profiles from the local DB (no relay limit, finds ALL profiles)
      const res = await fetch(`${API_URL}/api/functions/search-recipient`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim() }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const results: SearchResult[] = (data.results || []).map((r: any) => ({
        pubkey: r.pubkey,
        name: r.name || '',
        display_name: r.displayName || r.name || '',
        picture: r.picture,
        wallets: r.wallets || [],
      }));

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

    // Validate wallet ID format
    const validation = await validateLanaWalletIdWithMessage(recipientWalletId);
    if (!validation.valid) {
      setError(validation.message || "Invalid wallet ID");
      return;
    }

    // Block based on real-time wallet check result
    if (manualOnly && walletCheckStatus === 'registered') {
      setError("This wallet is registered. Unregistered LANA can only be sent to unregistered wallets.");
      return;
    }
    if (!manualOnly && walletCheckStatus === 'unregistered') {
      setError("This wallet is not registered. You can only send LANA to registered wallets.");
      return;
    }

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

  // Block frozen wallets from proceeding
  if (isFrozen) {
    return (
      <div className="max-w-2xl mx-auto">
        <Button variant="ghost" onClick={() => navigate("/wallet")} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Wallets
        </Button>
        <Alert variant="destructive" className="border-blue-500/50 bg-blue-500/10">
          <ShieldAlert className="h-4 w-4 text-blue-500" />
          <AlertTitle className="text-blue-700 dark:text-blue-400">Wallet Frozen — Sending Disabled</AlertTitle>
          <AlertDescription className="text-blue-700/80 dark:text-blue-300/80">
            This wallet has been frozen. All outgoing transactions are disabled.
            Contact your registrar to resolve this issue.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

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

              {/* Real-time wallet check result */}
              {walletCheckStatus === 'checking' && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking wallet...
                </div>
              )}

              {walletCheckStatus === 'registered' && (
                <div className={`p-3 rounded-lg border text-sm ${
                  manualOnly
                    ? 'bg-red-500/10 border-red-500/30'
                    : 'bg-green-500/10 border-green-500/30'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    {manualOnly ? (
                      <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                    ) : (
                      <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                    )}
                    <span className={`font-medium ${manualOnly ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                      Registered Wallet
                    </span>
                    {walletCheckData?.wallet_type && (
                      <span className="text-xs text-muted-foreground">({walletCheckData.wallet_type})</span>
                    )}
                    {walletCheckData?.frozen && (
                      <span className="text-xs text-blue-500 flex items-center gap-1">
                        <Snowflake className="h-3 w-3" /> Frozen
                      </span>
                    )}
                  </div>
                  {/* Owner profile */}
                  {walletCheckData?.nostr_hex_id && (
                    <div className="flex items-center gap-2 mt-2 pl-6">
                      {ownerProfileLoading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading owner...
                        </div>
                      ) : ownerProfile ? (
                        <>
                          <UserAvatar
                            pubkey={walletCheckData.nostr_hex_id}
                            picture={ownerProfile.picture}
                            name={ownerProfile.display_name || ownerProfile.full_name || ''}
                            className="h-8 w-8"
                          />
                          <div>
                            <p className="font-medium text-sm">
                              {ownerProfile.display_name || ownerProfile.full_name || 'Unknown'}
                            </p>
                            {ownerProfile.full_name && ownerProfile.display_name && ownerProfile.full_name !== ownerProfile.display_name && (
                              <p className="text-xs text-muted-foreground">@{ownerProfile.full_name}</p>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">Owner profile not found</p>
                      )}
                    </div>
                  )}
                  {manualOnly && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-2 pl-6">
                      Unregistered LANA can only be sent to unregistered wallets.
                    </p>
                  )}
                </div>
              )}

              {walletCheckStatus === 'unregistered' && (
                <div className={`p-3 rounded-lg border text-sm ${
                  manualOnly
                    ? 'bg-green-500/10 border-green-500/30'
                    : 'bg-red-500/10 border-red-500/30'
                }`}>
                  <div className="flex items-center gap-2">
                    {manualOnly ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span className={`font-medium ${manualOnly ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                      Unregistered Wallet
                    </span>
                  </div>
                  {!manualOnly && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1 pl-6">
                      You can only send registered LANA to registered wallets.
                    </p>
                  )}
                </div>
              )}
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
            disabled={
              !recipientWalletId.trim() ||
              walletCheckStatus === 'checking' ||
              (manualOnly && walletCheckStatus === 'registered') ||
              (!manualOnly && walletCheckStatus === 'unregistered')
            }
          >
            {walletCheckStatus === 'checking' ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Checking wallet...
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
