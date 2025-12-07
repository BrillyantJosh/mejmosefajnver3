import { useLocation, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, ExternalLink } from "lucide-react";

interface LocationState {
  success: boolean;
  txId?: string;
  amount?: number;
  fiatAmount?: string;
  eventTitle: string;
  isPay: boolean;
  dTag: string;
  error?: string;
}

const EventDonateResult = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;

  if (!state) {
    return (
      <div className="space-y-4 px-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">No transaction result found</p>
          </CardContent>
        </Card>
        <Button onClick={() => navigate('/events')} className="w-full">
          Back to Events
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 pb-24">
      <Card>
        <CardHeader className="text-center">
          {state.success ? (
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          ) : (
            <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
          )}
          <CardTitle className="text-2xl">
            {state.success 
              ? (state.isPay ? 'Payment Successful!' : 'Donation Successful!')
              : (state.isPay ? 'Payment Failed' : 'Donation Failed')
            }
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-muted-foreground">
            {state.eventTitle}
          </p>

          {state.success && state.amount && (
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount:</span>
                <span className="font-semibold">{state.amount.toFixed(2)} LANA</span>
              </div>
              {state.fiatAmount && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Value:</span>
                  <span className="font-semibold">€{state.fiatAmount}</span>
                </div>
              )}
            </div>
          )}

          {state.success && state.txId && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Transaction ID:</p>
              <p className="font-mono text-xs break-all bg-muted p-2 rounded">
                {state.txId}
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open(`https://chainz.cryptoid.info/lana/tx.dws?${state.txId}.htm`, '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View on Explorer
              </Button>
            </div>
          )}

          {!state.success && state.error && (
            <div className="bg-destructive/10 border border-destructive/30 p-4 rounded-lg">
              <p className="text-sm text-destructive">{state.error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <Button
          onClick={() => navigate(`/events/detail/${encodeURIComponent(state.dTag)}`)}
          className="w-full"
        >
          Back to Event
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate('/events')}
          className="w-full"
        >
          Back to Events
        </Button>
      </div>
    </div>
  );
};

export default EventDonateResult;
