import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, ExternalLink, Wallet, Send, Network } from "lucide-react";
import { formatLana } from "@/lib/currencyConversion";
import { Badge } from "@/components/ui/badge";

interface RecipientSummary {
  wallet: string;
  amount: number;
  services: string[];
}

interface RelayResult {
  proposalId: string;
  relay: string;
  success: boolean;
  error?: string;
}

interface ResultData {
  txid: string;
  totalAmount: number;
  recipients: RecipientSummary[];
  relayResults: RelayResult[];
  timestamp: string;
}

export default function Result() {
  const navigate = useNavigate();
  const [resultData, setResultData] = useState<ResultData | null>(null);

  useEffect(() => {
    const storedResult = sessionStorage.getItem('unconditionalPaymentResult');
    if (!storedResult) {
      navigate('/unconditional-payment');
      return;
    }

    try {
      const data = JSON.parse(storedResult);
      setResultData(data);
    } catch (error) {
      console.error('Error parsing result data:', error);
      navigate('/unconditional-payment');
    }
  }, [navigate]);

  if (!resultData) {
    return null;
  }

  const successfulRelays = resultData.relayResults.filter(r => r.success).length;
  const totalRelays = resultData.relayResults.length;

  // Group relay results by relay URL
  const relayGroups = resultData.relayResults.reduce((acc, result) => {
    if (!acc[result.relay]) {
      acc[result.relay] = { success: 0, failed: 0, proposals: [] as string[] };
    }
    if (result.success) {
      acc[result.relay].success++;
    } else {
      acc[result.relay].failed++;
    }
    acc[result.relay].proposals.push(result.proposalId);
    return acc;
  }, {} as Record<string, { success: number; failed: number; proposals: string[] }>);

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <CheckCircle2 className="h-8 w-8 text-green-500" />
          Payment Successful
        </h1>
        <p className="text-muted-foreground">Transaction confirmed and published to Nostr relays</p>
      </div>

      {/* Transaction Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Transaction Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm text-muted-foreground mb-1">Transaction ID</p>
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono bg-muted px-2 py-1 rounded break-all">
                    {resultData.txid}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => window.open(`https://chainz.cryptoid.info/lana/tx.dws?${resultData.txid}`, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">Total Amount Sent</span>
              <span className="text-2xl font-bold text-primary">{formatLana(resultData.totalAmount)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Recipients ({resultData.recipients.length})</p>
            {resultData.recipients.map((recipient, index) => (
              <div key={index} className="p-3 bg-muted rounded-lg flex items-center justify-between">
                <div className="flex-1">
                  <p className="font-mono text-sm break-all">{recipient.wallet.substring(0, 20)}...{recipient.wallet.substring(recipient.wallet.length - 8)}</p>
                  <p className="text-xs text-muted-foreground">{recipient.services.join(', ')}</p>
                </div>
                <p className="font-semibold">{formatLana(recipient.amount)}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Relay Publishing Results */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" />
            Nostr Relay Publishing Results
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <span className="font-medium">Overall Success Rate</span>
            <Badge variant={successfulRelays === totalRelays ? "default" : successfulRelays > 0 ? "secondary" : "destructive"}>
              {successfulRelays} / {totalRelays} successful
            </Badge>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Publishing Details by Relay</p>
            {Object.entries(relayGroups).map(([relay, stats]) => (
              <div key={relay} className="p-3 border rounded-lg space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-mono text-sm break-all">{relay}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Published {stats.proposals.length} KIND 90901 events
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {stats.success > 0 && (
                      <Badge variant="default" className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {stats.success}
                      </Badge>
                    )}
                    {stats.failed > 0 && (
                      <Badge variant="destructive" className="flex items-center gap-1">
                        <XCircle className="h-3 w-3" />
                        {stats.failed}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t">
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <Send className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <p>
                KIND 90901 confirmation events have been published to Nostr relays. 
                Recipients can now verify their unconditional payments on the network.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-4">
        <Button 
          onClick={() => {
            sessionStorage.removeItem('unconditionalPaymentResult');
            navigate('/unconditional-payment/completed');
          }}
          className="flex-1"
        >
          View Completed Payments
        </Button>
        <Button 
          onClick={() => {
            sessionStorage.removeItem('unconditionalPaymentResult');
            navigate('/unconditional-payment');
          }}
          variant="outline"
          className="flex-1"
        >
          Make Another Payment
        </Button>
      </div>
    </div>
  );
}
