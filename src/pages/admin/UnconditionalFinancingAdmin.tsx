import { useState, useEffect } from "react";
import { useAdmin } from "@/contexts/AdminContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { HandCoins, Clock, Info, HeartHandshake, Leaf, Globe, type LucideIcon } from "lucide-react";
import type { UfMaxAmounts } from "@/types/admin";

const GROUPS: { key: keyof UfMaxAmounts; label: string; icon: LucideIcon; desc: string }[] = [
  {
    key: "personal_hardship",
    label: "Personal hardship",
    icon: HeartHandshake,
    desc: "Bridging a difficult life or financial situation.",
  },
  {
    key: "lifestyle_transition",
    label: "Natural lifestyle transition",
    icon: Leaf,
    desc: "A concrete step toward a more natural, self-sufficient life.",
  },
  {
    key: "wellbeing_project",
    label: "Well-being project",
    icon: Globe,
    desc: "A project for the common good; requires a prior crowdfunding project.",
  },
];

const DEFAULT_MAX: UfMaxAmounts = {
  personal_hardship: 0,
  lifestyle_transition: 0,
  wellbeing_project: 0,
};

export default function UnconditionalFinancingAdmin() {
  const { appSettings, updateUnconditionalFinancingSettings } = useAdmin();

  const [days, setDays] = useState<string>(String(appSettings?.uf_maturing_days ?? 8));
  const [maxAmounts, setMaxAmounts] = useState<UfMaxAmounts>({
    ...DEFAULT_MAX,
    ...(appSettings?.uf_max_amounts || {}),
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (appSettings) {
      setDays(String(appSettings.uf_maturing_days ?? 8));
      setMaxAmounts({ ...DEFAULT_MAX, ...(appSettings.uf_max_amounts || {}) });
    }
  }, [appSettings]);

  const daysNum = parseInt(days, 10);
  const daysValid = Number.isFinite(daysNum) && daysNum >= 0 && daysNum <= 365;

  const handleMax = (key: keyof UfMaxAmounts, value: string) => {
    const num = parseFloat(value);
    setMaxAmounts((prev) => ({ ...prev, [key]: Number.isFinite(num) && num > 0 ? num : 0 }));
  };

  const handleSave = async () => {
    if (!daysValid) return;
    setSaving(true);
    try {
      await updateUnconditionalFinancingSettings({
        uf_maturing_days: daysNum,
        uf_max_amounts: maxAmounts,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <HandCoins className="h-6 w-6 text-primary" />
        <div>
          <h2 className="text-xl font-semibold">Unconditional Financing</h2>
          <p className="text-sm text-muted-foreground">
            Rules for the Unconditional Financing module
          </p>
        </div>
      </div>

      {/* Maturing period */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Maturing period
          </CardTitle>
          <CardDescription>
            How many days a published request matures before funding opens. During maturing,
            comments are open and contributions are refused — by the API and by the relay indexer
            alike.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="uf-days" className="text-sm">
              Days of maturing
            </Label>
            <Input
              id="uf-days"
              type="number"
              min="0"
              max="365"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="max-w-[200px]"
            />
            {!daysValid && (
              <p className="text-xs text-destructive">Enter a whole number of days between 0 and 365.</p>
            )}
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Changing this only affects requests published <strong>afterwards</strong>. A request's
              opening moment is written once, when it is first published, and can never be moved
              later — so no one who is already waiting has their date changed.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Per-group maximum amounts */}
      <Card>
        <CardHeader>
          <CardTitle>Maximum amount per group</CardTitle>
          <CardDescription>
            The highest amount a request of each type may ask for, in the currency chosen by the
            requester. Enter <strong>0</strong> for no limit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {GROUPS.map((g) => (
            <div key={g.key} className="p-3 border rounded-lg space-y-2">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <g.icon className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <Label htmlFor={`uf-max-${g.key}`} className="font-medium">
                    {g.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{g.desc}</p>
                </div>
              </div>
              <div className="space-y-1">
                <Input
                  id={`uf-max-${g.key}`}
                  type="number"
                  min="0"
                  step="any"
                  value={maxAmounts[g.key] || 0}
                  onChange={(e) => handleMax(g.key, e.target.value)}
                  className="max-w-[200px]"
                />
                <p className="text-xs text-muted-foreground">
                  {maxAmounts[g.key] > 0
                    ? `Requests of this type may ask for at most ${maxAmounts[g.key]}.`
                    : "No limit — requests of this type may ask for any amount."}
                </p>
              </div>
            </div>
          ))}

          <Button onClick={handleSave} disabled={!daysValid || saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Saved values are enforced on the server and shown to members in the request form and in
            the module article.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
