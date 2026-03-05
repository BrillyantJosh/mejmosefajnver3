import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, Play } from "lucide-react";
import type { UnregisteredLanaRecord } from "@/hooks/useUnregisteredLana";

interface UnregisteredLanaAlertProps {
  records: UnregisteredLanaRecord[];
  count: number;
}

export function UnregisteredLanaAlert({ records, count }: UnregisteredLanaAlertProps) {
  const [expanded, setExpanded] = useState(false);

  if (count === 0) return null;

  const totalLanoshis = records.reduce((sum, r) => sum + r.amount_lanoshis, 0);
  const totalLana = totalLanoshis / 100_000_000;

  const formatLana = (lanoshis: number) =>
    (lanoshis / 100_000_000).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    });

  const formatDate = (unixTimestamp: number) => {
    const d = new Date(unixTimestamp * 1000);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };

  const truncateWallet = (id: string) =>
    id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-8)}` : id;

  return (
    <Alert variant="destructive" className="mb-6">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="w-full">
        {/* Collapsed header — always visible */}
        <button
          type="button"
          className="flex items-center justify-between w-full text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <div>
            <p className="font-semibold">
              You have {count} unregistered LANA record{count !== 1 ? "s" : ""} on your wallet{count !== 1 ? "s" : ""}!
            </p>
            <p className="text-sm mt-0.5">
              Total: <strong>{totalLana.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} LANA</strong>{" "}
              — tap to see details
            </p>
          </div>
          {expanded ? (
            <ChevronUp className="h-5 w-5 shrink-0 ml-2" />
          ) : (
            <ChevronDown className="h-5 w-5 shrink-0 ml-2" />
          )}
        </button>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-4 space-y-4">
            {/* Records table */}
            <div className="overflow-x-auto rounded-md border border-destructive/30">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-destructive/20 bg-destructive/5">
                    <th className="text-left px-3 py-2 font-medium">Wallet</th>
                    <th className="text-right px-3 py-2 font-medium">Amount (LANA)</th>
                    <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">TX ID</th>
                    <th className="text-left px-3 py-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} className="border-b border-destructive/10 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs" title={record.wallet_id}>
                        {truncateWallet(record.wallet_id)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {formatLana(record.amount_lanoshis)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs hidden sm:table-cell" title={record.tx_id}>
                        {record.tx_id ? truncateWallet(record.tx_id) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {formatDate(record.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Instructions */}
            <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-sm">
              <p>
                You need to return unregistered LANA to the Registrar.
                Watch the video below for step-by-step instructions.
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                asChild
              >
                <a
                  href="https://youtu.be/Uhnnpy1zzHM"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <Play className="h-4 w-4" />
                  Watch: How to return unregistered LANA
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                asChild
              >
                <a
                  href="https://www.lanawatch.us"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open Registrar
                </a>
              </Button>
            </div>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
