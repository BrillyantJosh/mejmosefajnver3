import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNostrDonationPayments } from "@/hooks/useNostrDonationPayments";
import { formatLana, formatCurrency } from "@/lib/currencyConversion";
import { CheckCircle, ExternalLink } from "lucide-react";
import { format } from "date-fns";

export default function Completed() {
  const { payments, isLoading } = useNostrDonationPayments();

  if (isLoading && payments.length === 0) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!isLoading && payments.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <p className="text-muted-foreground">You haven't made any unconditional payments yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {payments.map(payment => (
        <Card key={payment.id}>
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <CheckCircle className="h-6 w-6 text-green-500" />
              </div>
              
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">
                    {payment.service || 'Unconditional Payment'}
                  </h3>
                  <span className="text-sm font-medium text-green-600">
                    {formatLana(parseFloat(payment.amountLana))}
                  </span>
                </div>
                
                {payment.content && (
                  <p className="text-sm text-muted-foreground">{payment.content}</p>
                )}
                
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  {payment.fiatAmount && payment.fiatCurrency && (
                    <span>
                      {formatCurrency(parseFloat(payment.fiatAmount), payment.fiatCurrency)}
                    </span>
                  )}
                  <span>
                    Paid: {format(new Date(payment.timestampPaid * 1000), 'MMM d, yyyy HH:mm')}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">TX:</span>
                  <code className="bg-muted px-2 py-1 rounded text-xs">
                    {payment.txId.substring(0, 16)}...{payment.txId.substring(payment.txId.length - 8)}
                  </code>
                  <a
                    href={`https://chainz.cryptoid.info/lana/tx.dws?${payment.txId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
