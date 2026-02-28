import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { Loader2, TrendingUp, Calendar, Target, DollarSign, Clock } from "lucide-react";

export default function SplitWatcherGeneral() {
  const { parameters, isLoading } = useSystemParameters();

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
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const daysInSplit = parameters?.splitStartedAt
    ? getDaysInSplit(parameters.splitStartedAt)
    : null;

  return (
    <div className="space-y-4 md:space-y-6 max-w-2xl mx-auto">
      {/* Split Number */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm md:text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 md:h-5 md:w-5 text-orange-500" />
            Current SPLIT
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl md:text-4xl font-bold text-orange-500">
            {parameters?.split || "—"}
          </p>
        </CardContent>
      </Card>

      {/* Start Date + Days in Split */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm md:text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 md:h-5 md:w-5 text-blue-500" />
            Start Date
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 md:space-y-3">
          <p className="text-xl md:text-2xl font-semibold">
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
        <CardHeader className="pb-2">
          <CardTitle className="text-sm md:text-base flex items-center gap-2">
            <Target className="h-4 w-4 md:h-5 md:w-5 text-red-500" />
            Max Amount Target
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xl md:text-2xl font-semibold">
            {parameters?.splitTargetLana ? (
              <span>{parameters.splitTargetLana.toLocaleString("en-US")} <span className="text-sm md:text-base text-muted-foreground">LANA</span></span>
            ) : (
              "—"
            )}
          </p>
        </CardContent>
      </Card>

      {/* Exchange Rates */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm md:text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4 md:h-5 md:w-5 text-green-500" />
            Exchange Rates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2 md:gap-4">
            <div className="bg-secondary/50 rounded-lg p-2.5 md:p-4 text-center">
              <p className="text-[0.65rem] md:text-xs text-muted-foreground mb-1">EUR / LANA</p>
              <p className="text-base md:text-xl font-bold">
                €{parameters?.exchangeRates?.EUR?.toFixed(6) ?? "—"}
              </p>
            </div>
            <div className="bg-secondary/50 rounded-lg p-2.5 md:p-4 text-center">
              <p className="text-[0.65rem] md:text-xs text-muted-foreground mb-1">USD / LANA</p>
              <p className="text-base md:text-xl font-bold">
                ${parameters?.exchangeRates?.USD?.toFixed(6) ?? "—"}
              </p>
            </div>
            <div className="bg-secondary/50 rounded-lg p-2.5 md:p-4 text-center">
              <p className="text-[0.65rem] md:text-xs text-muted-foreground mb-1">GBP / LANA</p>
              <p className="text-base md:text-xl font-bold">
                £{parameters?.exchangeRates?.GBP?.toFixed(6) ?? "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
