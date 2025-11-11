import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { PaymentMethod, PaymentScope, PaymentScheme, PAYMENT_SCHEMES, PaymentMethodFields } from "@/types/paymentMethods";

interface PaymentMethodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (method: PaymentMethod) => void;
  editingMethod?: PaymentMethod | null;
}

export const PaymentMethodDialog = ({ open, onOpenChange, onSave, editingMethod }: PaymentMethodDialogProps) => {
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<PaymentScope>("both");
  const [country, setCountry] = useState("");
  const [scheme, setScheme] = useState<PaymentScheme>("EU.IBAN");
  const [currency, setCurrency] = useState("");
  const [fields, setFields] = useState<PaymentMethodFields>({});
  const [verified, setVerified] = useState(false);
  const [primary, setPrimary] = useState(false);

  useEffect(() => {
    if (editingMethod) {
      setLabel(editingMethod.label);
      setScope(editingMethod.scope);
      setCountry(editingMethod.country);
      setScheme(editingMethod.scheme);
      setCurrency(editingMethod.currency);
      setFields(editingMethod.fields);
      setVerified(editingMethod.verified || false);
      setPrimary(editingMethod.primary || false);
    } else {
      // Reset form
      setLabel("");
      setScope("both");
      setCountry("");
      setScheme("EU.IBAN");
      setCurrency("");
      setFields({});
      setVerified(false);
      setPrimary(false);
    }
  }, [editingMethod, open]);

  const handleSave = () => {
    const method: PaymentMethod = {
      id: editingMethod?.id || `pm_${Date.now()}`,
      label,
      scope,
      country,
      scheme,
      currency,
      fields,
      verified,
      primary
    };
    onSave(method);
    onOpenChange(false);
  };

  const schemeInfo = PAYMENT_SCHEMES[scheme];
  const allFields = [...schemeInfo.requiredFields, ...schemeInfo.optionalFields];

  const updateField = (fieldName: string, value: string) => {
    setFields(prev => ({ ...prev, [fieldName]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingMethod ? "Edit Payment Method" : "Add Payment Method"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My EUR Account"
            />
          </div>

          <div className="space-y-2">
            <Label>Scope</Label>
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as PaymentScope)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="collect" id="collect" />
                <Label htmlFor="collect">Collect only</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="payout" id="payout" />
                <Label htmlFor="payout">Payout only</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="both" id="both" />
                <Label htmlFor="both">Both</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="country">Country (ISO 2-letter)</Label>
              <Input
                id="country"
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                placeholder="SI"
                maxLength={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">Currency (ISO 3-letter)</Label>
              <Input
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                placeholder="EUR"
                maxLength={3}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="scheme">Payment Scheme</Label>
            <Select value={scheme} onValueChange={(v) => setScheme(v as PaymentScheme)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PAYMENT_SCHEMES).map(([key, info]) => (
                  <SelectItem key={key} value={key}>
                    {info.label} ({info.region})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-4 border-t pt-4">
            <h4 className="font-semibold">Scheme Fields</h4>
            {allFields.map((fieldName) => {
              const isRequired = schemeInfo.requiredFields.includes(fieldName);
              const isSpecial = fieldName === 'account_type';
              
              if (isSpecial && scheme === 'US.ACH') {
                return (
                  <div key={fieldName} className="space-y-2">
                    <Label htmlFor={fieldName}>
                      Account Type {isRequired && <span className="text-destructive">*</span>}
                    </Label>
                    <Select 
                      value={fields[fieldName] as string || ""} 
                      onValueChange={(v) => updateField(fieldName, v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="checking">Checking</SelectItem>
                        <SelectItem value="savings">Savings</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              }
              
              return (
                <div key={fieldName} className="space-y-2">
                  <Label htmlFor={fieldName}>
                    {fieldName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    {isRequired && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id={fieldName}
                    value={fields[fieldName] as string || ""}
                    onChange={(e) => updateField(fieldName, e.target.value)}
                    placeholder={`Enter ${fieldName.replace(/_/g, ' ')}`}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="verified"
              checked={verified}
              onCheckedChange={(checked) => setVerified(checked as boolean)}
            />
            <Label htmlFor="verified">Mark as verified</Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="primary"
              checked={primary}
              onCheckedChange={(checked) => setPrimary(checked as boolean)}
            />
            <Label htmlFor="primary">Set as primary method</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!label || !country || !currency}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
