import { useAuth } from '@/contexts/AuthContext';
import { useNostrInvestorPayments } from '@/hooks/useNostrInvestorPayments';
import { Clock, CheckCircle, AlertTriangle, ExternalLink, Camera, Banknote, Loader2 } from 'lucide-react';

function formatFiat(amount: number, currency: string): string {
  const sym: Record<string, string> = { EUR: '\u20ac', USD: '$', GBP: '\u00a3' };
  return `${(sym[currency] || currency + ' ')}${amount.toFixed(2)}`;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso + 'Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const purposeColors: Record<string, string> = {
  lana_purchase: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  merchant_payment: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  merchant_commission: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  caretaker_via_discount: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
};

const purposeLabels: Record<string, string> = {
  lana_purchase: 'LANA Purchase',
  merchant_payment: 'Shop Invoice',
  merchant_commission: 'Shop Incentive',
  caretaker_via_discount: 'Caretaker',
};

export default function PaymentsPage() {
  const { session } = useAuth();
  const { pendingPayments, confirmedPayments, isLoading } = useNostrInvestorPayments(session?.nostrHexId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
        <span className="ml-2 text-sm text-muted-foreground">Loading payments from Nostr...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Awaiting Payment</p>
          <p className="text-2xl font-bold text-amber-500 mt-1">{pendingPayments.length}</p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Completed</p>
          <p className="text-2xl font-bold text-emerald-500 mt-1">{confirmedPayments.length}</p>
        </div>
      </div>

      {/* Pending payments */}
      {pendingPayments.length === 0 ? (
        <div className="text-center py-12 rounded-xl border">
          <CheckCircle className="w-10 h-10 text-emerald-300 dark:text-emerald-700 mx-auto mb-3" />
          <p className="text-lg font-medium text-muted-foreground">No pending payments</p>
          <p className="text-sm text-muted-foreground/60 mt-1">All payment obligations are fulfilled</p>
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Awaiting Payment ({pendingPayments.length})
          </h3>
          {pendingPayments.map(p => (
            <div
              key={p.id}
              className={`rounded-xl border p-4 transition-colors ${
                p.overdueDays > 0
                  ? 'border-red-300 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5'
                  : 'hover:bg-muted/30'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {p.orderType && (
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        purposeColors[p.orderType] || 'bg-muted text-muted-foreground'
                      }`}>
                        {purposeLabels[p.orderType] || p.orderType}
                      </span>
                    )}
                    {p.batchRef && (
                      <span className="text-[10px] text-muted-foreground font-mono">{p.batchRef}</span>
                    )}
                    {p.receiptUrl && (
                      <Camera className={`w-3 h-3 ${p.receiptType === 'photo' ? 'text-amber-500' : 'text-emerald-500'}`} />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {p.destinationName || 'Payment'} · {formatDate(p.createdAt)}
                  </p>
                  {p.overdueDays > 0 && (
                    <div className="flex items-center gap-1 text-red-500">
                      <AlertTriangle className="w-3 h-3" />
                      <span className="text-[11px] font-semibold">Overdue {p.overdueDays.toFixed(1)} days</span>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold tabular-nums">{formatFiat(p.amount, p.currency)}</p>
                  {p.lanaTxHash && (
                    <a
                      href={`https://chainz.cryptoid.info/lana/tx.dws?${p.lanaTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                      TX {p.rpcVerified ? 'Verified' : 'Pending'}
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirmed payments */}
      {confirmedPayments.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            Completed ({confirmedPayments.length})
          </h3>
          {confirmedPayments.slice(0, 20).map(p => (
            <div key={p.id} className="rounded-xl border p-3 opacity-60">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {p.orderType && (
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                      purposeColors[p.orderType] || 'bg-muted text-muted-foreground'
                    }`}>
                      {purposeLabels[p.orderType] || p.orderType}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">{formatDate(p.confirmedAt || p.createdAt)}</span>
                  {p.batchRef && <span className="text-[9px] font-mono text-muted-foreground">{p.batchRef}</span>}
                </div>
                <span className="text-sm font-medium tabular-nums">{formatFiat(p.amount, p.currency)}</span>
              </div>
            </div>
          ))}
          {confirmedPayments.length > 20 && (
            <p className="text-xs text-muted-foreground text-center">
              Showing 20 of {confirmedPayments.length} completed payments
            </p>
          )}
        </div>
      )}
    </div>
  );
}
