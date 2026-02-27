import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, TrendingUp, Calendar, Target, DollarSign, Clock } from "lucide-react";

export default function SplitWatcherGeneral() {
  const { parameters, isLoading } = useSystemParameters();
  const [maxAmount, setMaxAmount] = useState<number | null>(null);

  useEffect(() => {
    async function fetchMaxAmount() {
      try {
        const { data, error } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "inspiration_max_allowed_amount")
          .single();

        if (!error && data?.value) {
          const val = typeof data.value === "number"
            ? data.value
            : parseInt(String(data.value).replace(/"/g, ""), 10);
          if (val > 0) setMaxAmount(val);
        }
      } catch (err) {
        console.error("Failed to fetch max amount:", err);
      }
    }
    fetchMaxAmount();
  }, []);

  const formatDate = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return "—";
    }
  };

  const getDaysInSplit = (isoString: string): number | null => {
    try {
      const startDate = new Date(isoString).getTime();
      if (isNaN(startDate) || startDate === 0) return null;
      return Math.floor((Date.now() - startDate) / 86400000);
    } catch {
      return null;
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const daysInSplit = parameters?.splitStartedAt
    ? getDaysInSplit(parameters.splitStartedAt)
    : null;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Split Number */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-orange-500" />
            Current SPLIT
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-4xl font-bold text-orange-500">
            {parameters?.split || "—"}
          </p>
        </CardContent>
      </Card>

      {/* Start Date + Days in Split */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-5 w-5 text-blue-500" />
            Start Date
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-2xl font-semibold">
            {parameters?.splitStartedAt ? formatDate(parameters.splitStartedAt) : "—"}
          </p>
          {daysInSplit !== null && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="text-sm">
                <span className="font-semibold text-foreground">{daysInSplit}</span> days in this SPLIT
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Max Amount Target */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-5 w-5 text-red-500" />
            Max Amount Target
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {maxAmount !== null ? (
              <span>{maxAmount.toLocaleString("en-US")} <span className="text-base text-muted-foreground">LANA</span></span>
            ) : (
              "—"
            )}
          </p>
        </CardContent>
      </Card>

      {/* Exchange Rates */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-green-500" />
            Exchange Rates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-secondary/50 rounded-lg p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">EUR per LANA</p>
              <p className="text-xl font-bold">
                €{parameters?.exchangeRates?.EUR?.toFixed(6) ?? "—"}
              </p>
            </div>
            <div className="bg-secondary/50 rounded-lg p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">USD per LANA</p>
              <p className="text-xl font-bold">
                ${parameters?.exchangeRates?.USD?.toFixed(6) ?? "—"}
              </p>
            </div>
            <div className="bg-secondary/50 rounded-lg p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">GBP per LANA</p>
              <p className="text-xl font-bold">
                £{parameters?.exchangeRates?.GBP?.toFixed(6) ?? "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
