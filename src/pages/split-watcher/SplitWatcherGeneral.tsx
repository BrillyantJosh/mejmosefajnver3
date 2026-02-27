import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, TrendingUp, Calendar, Target, DollarSign } from "lucide-react";

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

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

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

      {/* Start Date */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-5 w-5 text-blue-500" />
            Start Date
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {parameters?.validFrom ? formatDate(parameters.validFrom) : "—"}
          </p>
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
