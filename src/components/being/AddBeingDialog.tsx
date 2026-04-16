import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { QRScanner } from "@/components/QRScanner";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { convertWifToIds } from "@/lib/crypto";
import { ScanLine, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface AddBeingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (wif: string, name?: string) => Promise<{ success: boolean; error?: string; hexId?: string }>;
}

export default function AddBeingDialog({ open, onOpenChange, onAdd }: AddBeingDialogProps) {
  const [wifKey, setWifKey] = useState("");
  const [customName, setCustomName] = useState("");
  const [derivedHexId, setDerivedHexId] = useState<string | null>(null);
  const [deriveError, setDeriveError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const { profile } = useNostrProfileCache(derivedHexId);

  const handleWifChange = async (value: string) => {
    setWifKey(value.trim());
    setDerivedHexId(null);
    setDeriveError(null);

    if (value.trim().length > 30) {
      try {
        const ids = await convertWifToIds(value.trim());
        setDerivedHexId(ids.nostrHexId);
        setDeriveError(null);
      } catch (err: any) {
        setDeriveError(err.message || 'Invalid WIF key');
        setDerivedHexId(null);
      }
    }
  };

  const handleScan = (data: string) => {
    setScannerOpen(false);
    handleWifChange(data);
    setWifKey(data.trim());
  };

  const handleAdd = async () => {
    if (!derivedHexId) {
      toast.error('Please enter a valid WIF key first');
      return;
    }

    const result = await onAdd(wifKey, customName || profile?.display_name || profile?.full_name || undefined);
    if (result.success) {
      toast.success('Being added successfully');
      setWifKey("");
      setCustomName("");
      setDerivedHexId(null);
      onOpenChange(false);
    } else {
      toast.error(result.error || 'Failed to add being');
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setWifKey("");
      setCustomName("");
      setDerivedHexId(null);
      setDeriveError(null);
    }
    onOpenChange(open);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a Being</DialogTitle>
            <DialogDescription>
              Scan or enter the WIF private key of your Being to add it to your list.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* WIF Input */}
            <div className="space-y-2">
              <Label>WIF Private Key</Label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={wifKey}
                  onChange={(e) => handleWifChange(e.target.value)}
                  placeholder="Enter or scan WIF key..."
                  className="font-mono text-sm"
                />
                <Button variant="outline" size="icon" onClick={() => setScannerOpen(true)}>
                  <ScanLine className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Derivation result */}
            {deriveError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>{deriveError}</span>
              </div>
            )}

            {derivedHexId && (
              <div className="space-y-3 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle className="h-4 w-4" />
                  <span className="font-medium">Being identified</span>
                </div>

                {/* Profile preview */}
                <div className="flex items-center gap-3">
                  <UserAvatar
                    pubkey={derivedHexId}
                    picture={profile?.picture}
                    name={profile?.display_name || profile?.full_name || derivedHexId.slice(0, 8)}
                    className="h-12 w-12"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {profile?.display_name || profile?.full_name || 'Loading profile...'}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {derivedHexId}
                    </p>
                  </div>
                </div>

                {/* Custom name */}
                <div className="space-y-1">
                  <Label className="text-xs">Custom Name (optional)</Label>
                  <Input
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder={profile?.display_name || 'Give your being a name...'}
                    className="text-sm"
                  />
                </div>
              </div>
            )}

            {/* Add button */}
            <Button
              onClick={handleAdd}
              disabled={!derivedHexId}
              className="w-full"
            >
              Add Being
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <QRScanner
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScan}
      />
    </>
  );
}
