import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdmin } from "@/contexts/AdminContext";
import { Loader2, Save, Tag, Percent, Wallet, Link, Key, Coins } from "lucide-react";

export default function DiscountAdmin() {
  const { appSettings, updateDiscountSettings } = useAdmin();
  const [saving, setSaving] = useState(false);

  // Form state
  const [commissionLanaPays, setCommissionLanaPays] = useState("30");
  const [commissionOther, setCommissionOther] = useState("21");
  const [minSellEur, setMinSellEur] = useState("2");
  const [minSellUsd, setMinSellUsd] = useState("2");
  const [minSellGbp, setMinSellGbp] = useState("2");
  const [buybackWallet, setBuybackWallet] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  // Load from appSettings
  useEffect(() => {
    if (!appSettings) return;
    setCommissionLanaPays(String(appSettings.discount_commission_lanapays ?? 30));
    setCommissionOther(String(appSettings.discount_commission_other ?? 21));
    setMinSellEur(String(appSettings.discount_min_sell_eur ?? 2));
    setMinSellUsd(String(appSettings.discount_min_sell_usd ?? 2));
    setMinSellGbp(String(appSettings.discount_min_sell_gbp ?? 2));
    setBuybackWallet(appSettings.discount_buyback_wallet || "Lg7iw2aQp8qazNsZVZFhf4rP7bikSrLRxB");
    setApiUrl(appSettings.discount_api_url || "https://www.lana.discount");
    setApiKey(appSettings.discount_api_key || "");
  }, [appSettings]);

  const handleSave = async () => {
    setSaving(true);
    await updateDiscountSettings({
      discount_commission_lanapays: parseFloat(commissionLanaPays) || 30,
      discount_commission_other: parseFloat(commissionOther) || 21,
      discount_min_sell_eur: parseFloat(minSellEur) || 0,
      discount_min_sell_usd: parseFloat(minSellUsd) || 0,
      discount_min_sell_gbp: parseFloat(minSellGbp) || 0,
      discount_buyback_wallet: buybackWallet.trim(),
      discount_api_url: apiUrl.trim(),
      discount_api_key: apiKey.trim(),
    });
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Tag className="h-6 w-6 text-teal-500" />
        <div>
          <h2 className="text-xl font-bold">Lana Discount Settings</h2>
          <p className="text-sm text-muted-foreground">Configure the LANA sell flow for Lana.Discount integration</p>
        </div>
      </div>

      {/* Commission Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Percent className="h-4 w-4 text-orange-500" />
            Commission Rates
          </CardTitle>
          <CardDescription>
            Different commission rates apply based on wallet type. LanaPays.Us wallets have a higher rate because they include merchant incentives.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">LanaPays.Us Wallets</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={commissionLanaPays}
                  onChange={(e) => setCommissionLanaPays(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">Applies to wallets registered via LanaPays.Us POS</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Other Wallets</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={commissionOther}
                  onChange={(e) => setCommissionOther(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">Applies to all other wallet types (Main, Wallet, etc.)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Minimum Sell Amounts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="h-4 w-4 text-amber-500" />
            Minimum Sell Amounts
          </CardTitle>
          <CardDescription>
            Minimum FIAT value required to process a sale. Set to 0 to disable minimum for a currency.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">EUR Minimum</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">&euro;</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={minSellEur}
                  onChange={(e) => setMinSellEur(e.target.value)}
                  className="w-28"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">USD Minimum</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={minSellUsd}
                  onChange={(e) => setMinSellUsd(e.target.value)}
                  className="w-28"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">GBP Minimum</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">&pound;</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={minSellGbp}
                  onChange={(e) => setMinSellGbp(e.target.value)}
                  className="w-28"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Buyback Wallet */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-green-500" />
            Buyback Wallet
          </CardTitle>
          <CardDescription>
            LANA wallet address where sold coins are sent. This is the Lana.Discount buyback wallet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Wallet Address</Label>
            <Input
              value={buybackWallet}
              onChange={(e) => setBuybackWallet(e.target.value)}
              placeholder="L..."
              className="font-mono"
            />
          </div>
        </CardContent>
      </Card>

      {/* API Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link className="h-4 w-4 text-blue-500" />
            Lana.Discount API
          </CardTitle>
          <CardDescription>
            Connection to the Lana.Discount service for registering sales.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">API URL</Label>
            <Input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://www.lana.discount"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Key className="h-3 w-3" /> API Key
            </Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="ldk_..."
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">Bearer token for authenticating with Lana.Discount external API</p>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
        {saving ? (
          <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving...</>
        ) : (
          <><Save className="h-4 w-4 mr-2" /> Save Lana Discount Settings</>
        )}
      </Button>
    </div>
  );
}
