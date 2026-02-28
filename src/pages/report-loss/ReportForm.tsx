import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Send, Wallet } from "lucide-react";

export default function ReportForm() {
  const { session } = useAuth();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  const [selectedWallets, setSelectedWallets] = useState<Set<string>>(new Set());
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleWallet = (walletId: string) => {
    setSelectedWallets((prev) => {
      const next = new Set(prev);
      if (next.has(walletId)) {
        next.delete(walletId);
      } else {
        next.add(walletId);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!session?.nostrHexId) return;
    if (selectedWallets.size === 0) {
      toast.error("Please select at least one wallet");
      return;
    }
    if (!description.trim()) {
      toast.error("Please describe what happened");
      return;
    }

    setIsSubmitting(true);
    try {
      // Insert one row per selected wallet
      for (const walletAddress of selectedWallets) {
        const { error } = await supabase.from("loss_reports").insert({
          nostr_hex_id: session.nostrHexId,
          wallet_address: walletAddress,
          description: description.trim(),
        });
        if (error) throw error;
      }

      toast.success(
        `Successfully reported ${selectedWallets.size} wallet${selectedWallets.size > 1 ? "s" : ""} as lost`
      );
      setSelectedWallets(new Set());
      setDescription("");
    } catch (error: any) {
      console.error("Error submitting loss report:", error);
      toast.error(error.message || "Failed to submit report");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (walletsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading wallets...</span>
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <div className="px-4">
        <Alert>
          <Wallet className="h-4 w-4" />
          <AlertDescription>
            No wallets found. You need registered wallets to report a loss.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="px-4 space-y-6">
      <Alert variant="destructive" className="border-orange-500/30 bg-orange-500/5">
        <AlertTriangle className="h-4 w-4 !text-orange-500" />
        <AlertDescription className="text-orange-700 dark:text-orange-400">
          Only report wallets for which you have permanently lost the private key.
          This report is public and visible to everyone on the Loss Board.
        </AlertDescription>
      </Alert>

      {/* Wallet Selection */}
      <div className="space-y-3">
        <Label className="text-base font-semibold">
          Select lost wallets ({selectedWallets.size} selected)
        </Label>
        <div className="space-y-2">
          {wallets.map((wallet) => (
            <Card
              key={wallet.walletId}
              className={`cursor-pointer transition-colors ${
                selectedWallets.has(wallet.walletId)
                  ? "border-red-500 bg-red-500/5"
                  : "hover:bg-muted/50"
              }`}
              onClick={() => toggleWallet(wallet.walletId)}
            >
              <CardContent className="flex items-center gap-3 p-3">
                <Checkbox
                  checked={selectedWallets.has(wallet.walletId)}
                  onCheckedChange={() => toggleWallet(wallet.walletId)}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm truncate">{wallet.walletId}</p>
                  {wallet.walletType && (
                    <p className="text-xs text-muted-foreground capitalize">
                      {wallet.walletType}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description" className="text-base font-semibold">
          What happened?
        </Label>
        <Textarea
          id="description"
          placeholder="Describe how you lost access to the wallet(s)... e.g. lost paper wallet, device failure, forgotten password..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="resize-none"
        />
      </div>

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        disabled={isSubmitting || selectedWallets.size === 0 || !description.trim()}
        className="w-full"
        size="lg"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Submitting...
          </>
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            Submit Loss Report
          </>
        )}
      </Button>
    </div>
  );
}
