import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, CheckCircle2, XCircle, Star } from "lucide-react";
import { PaymentMethod, PAYMENT_SCHEMES } from "@/types/paymentMethods";

interface PaymentMethodCardProps {
  method: PaymentMethod;
  onEdit: (method: PaymentMethod) => void;
  onDelete: (id: string) => void;
  onSetPrimary: (id: string) => void;
}

export const PaymentMethodCard = ({ method, onEdit, onDelete, onSetPrimary }: PaymentMethodCardProps) => {
  const schemeInfo = PAYMENT_SCHEMES[method.scheme];
  
  const renderFieldValue = (key: string, value: any) => {
    if (!value) return null;
    
    // Mask sensitive data
    if (key === 'account_number' || key === 'iban') {
      const str = String(value);
      return str.slice(0, -4).replace(/./g, '*') + str.slice(-4);
    }
    
    return String(value);
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">{method.label}</h3>
            {method.primary && (
              <Star className="h-4 w-4 fill-primary text-primary" />
            )}
          </div>
          
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{schemeInfo.label}</Badge>
            <Badge variant="outline">{method.country}</Badge>
            <Badge variant="outline">{method.currency}</Badge>
            <Badge variant={method.scope === 'both' ? 'default' : 'secondary'}>
              {method.scope}
            </Badge>
          </div>

          <div className="space-y-1 text-sm">
            {Object.entries(method.fields).map(([key, value]) => {
              if (!value) return null;
              return (
                <div key={key} className="flex gap-2">
                  <span className="text-muted-foreground capitalize">
                    {key.replace(/_/g, ' ')}:
                  </span>
                  <span className="font-mono text-foreground">
                    {renderFieldValue(key, value)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 text-sm">
            {method.verified ? (
              <div className="flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                <span>Verified</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-muted-foreground">
                <XCircle className="h-4 w-4" />
                <span>Not verified</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onEdit(method)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          
          {!method.primary && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => onSetPrimary(method.id)}
              title="Set as primary"
            >
              <Star className="h-4 w-4" />
            </Button>
          )}
          
          <Button
            variant="outline"
            size="icon"
            onClick={() => onDelete(method.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
};
