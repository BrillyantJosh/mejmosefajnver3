import { useState, useEffect, useMemo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { PaymentMethod, PaymentScope, PaymentScheme, PAYMENT_SCHEMES, PaymentMethodFields } from "@/types/paymentMethods";
import { AlertCircle } from "lucide-react";

interface PaymentMethodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (method: PaymentMethod) => void;
  editingMethod?: PaymentMethod | null;
}

// Format field name for display
const formatFieldName = (fieldName: string): string => {
  return fieldName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

// Normalize input values
const normalizeValue = (fieldName: string, value: string): string => {
  let normalized = value.trim();
  
  // Country and currency should be uppercase
  if (['country', 'currency'].includes(fieldName)) {
    normalized = normalized.toUpperCase().replace(/[^A-Z]/g, '');
  }
  
  // IBAN normalization (remove spaces, uppercase)
  if (fieldName === 'iban') {
    normalized = normalized.replace(/\s/g, '').toUpperCase();
  }
  
  // BIC/SWIFT normalization
  if (fieldName === 'bic') {
    normalized = normalized.replace(/\s/g, '').toUpperCase();
  }
  
  return normalized;
};

export const PaymentMethodDialog = ({ open, onOpenChange, onSave, editingMethod }: PaymentMethodDialogProps) => {
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<PaymentScope>("both");
  const [country, setCountry] = useState("");
  const [scheme, setScheme] = useState<PaymentScheme>("EU.IBAN");
  const [currency, setCurrency] = useState("");
  const [fields, setFields] = useState<PaymentMethodFields>({});
  const [verified, setVerified] = useState(false);
  const [primary, setPrimary] = useState(false);
  
  // Error tracking
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

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
    // Reset errors and touched when dialog opens/closes or editing method changes
    setErrors({});
    setTouched({});
  }, [editingMethod, open]);

  const schemeInfo = PAYMENT_SCHEMES[scheme];
  const allFields = [...schemeInfo.requiredFields, ...schemeInfo.optionalFields];

  // Validation function
  const validateForm = useCallback((): Record<string, string> => {
    const newErrors: Record<string, string> = {};
    
    // Basic fields validation
    const trimmedLabel = label.trim();
    const trimmedCountry = country.trim();
    const trimmedCurrency = currency.trim();
    
    if (!trimmedLabel) {
      newErrors.label = "Label is required";
    } else if (trimmedLabel.length < 2) {
      newErrors.label = "Label must be at least 2 characters";
    }
    
    if (!trimmedCountry) {
      newErrors.country = "Country is required";
    } else if (trimmedCountry.length !== 2) {
      newErrors.country = "Must be exactly 2 letters (e.g., SI)";
    } else if (!/^[A-Z]{2}$/.test(trimmedCountry.toUpperCase())) {
      newErrors.country = "Must contain only letters";
    }
    
    if (!trimmedCurrency) {
      newErrors.currency = "Currency is required";
    } else if (trimmedCurrency.length !== 3) {
      newErrors.currency = "Must be exactly 3 letters (e.g., EUR)";
    } else if (!/^[A-Z]{3}$/.test(trimmedCurrency.toUpperCase())) {
      newErrors.currency = "Must contain only letters";
    }
    
    // Scheme required fields validation
    schemeInfo.requiredFields.forEach(fieldName => {
      const value = (fields[fieldName] as string)?.trim() || "";
      if (!value) {
        newErrors[fieldName] = `${formatFieldName(fieldName)} is required`;
      } else {
        // Additional field-specific validation
        if (fieldName === 'iban') {
          const iban = value.replace(/\s/g, '').toUpperCase();
          if (iban.length < 15 || iban.length > 34) {
            newErrors.iban = "IBAN must be 15-34 characters";
          } else if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) {
            newErrors.iban = "Invalid IBAN format";
          }
        }
        
        if (fieldName === 'bic' && value) {
          const bic = value.replace(/\s/g, '').toUpperCase();
          if (bic.length !== 8 && bic.length !== 11) {
            newErrors.bic = "BIC must be 8 or 11 characters";
          }
        }
        
        if (fieldName === 'routing_number' && value) {
          if (!/^\d{9}$/.test(value)) {
            newErrors.routing_number = "Routing number must be 9 digits";
          }
        }
        
        if (fieldName === 'account_number' && value) {
          if (!/^\d+$/.test(value)) {
            newErrors.account_number = "Account number must contain only digits";
          }
        }
      }
    });
    
    return newErrors;
  }, [label, country, currency, fields, schemeInfo.requiredFields]);

  // Check if form is valid
  const isFormValid = useMemo(() => {
    const validationErrors = validateForm();
    return Object.keys(validationErrors).length === 0;
  }, [validateForm]);

  // Update errors when form changes (only for touched fields)
  useEffect(() => {
    const validationErrors = validateForm();
    setErrors(prev => {
      const newErrors: Record<string, string> = {};
      Object.keys(touched).forEach(field => {
        if (touched[field] && validationErrors[field]) {
          newErrors[field] = validationErrors[field];
        }
      });
      return newErrors;
    });
  }, [label, country, currency, fields, touched, validateForm]);

  const handleBlur = (fieldName: string) => {
    setTouched(prev => ({ ...prev, [fieldName]: true }));
  };

  const handleSave = () => {
    // Mark all fields as touched to show any remaining errors
    const allTouched: Record<string, boolean> = {
      label: true,
      country: true,
      currency: true,
    };
    schemeInfo.requiredFields.forEach(f => { allTouched[f] = true; });
    setTouched(allTouched);
    
    const validationErrors = validateForm();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    
    const method: PaymentMethod = {
      id: editingMethod?.id || `pm_${Date.now()}`,
      label: label.trim(),
      scope,
      country: normalizeValue('country', country),
      scheme,
      currency: normalizeValue('currency', currency),
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' ? normalizeValue(k, v) : v])
      ),
      verified,
      primary
    };
    onSave(method);
    onOpenChange(false);
  };

  const updateField = (fieldName: string, value: string) => {
    setFields(prev => ({ ...prev, [fieldName]: value }));
  };

  // Get error class for input
  const getInputClassName = (fieldName: string) => {
    return touched[fieldName] && errors[fieldName] ? "border-destructive focus-visible:ring-destructive" : "";
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
            <Label htmlFor="label">
              Label <span className="text-destructive">*</span>
            </Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => handleBlur('label')}
              placeholder="My EUR Account"
              className={getInputClassName('label')}
            />
            {touched.label && errors.label && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.label}
              </p>
            )}
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
              <Label htmlFor="country">
                Country (ISO 2-letter) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="country"
                value={country}
                onChange={(e) => setCountry(normalizeValue('country', e.target.value))}
                onBlur={() => handleBlur('country')}
                placeholder="SI"
                maxLength={2}
                className={getInputClassName('country')}
              />
              {touched.country && errors.country && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.country}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">
                Currency (ISO 3-letter) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(normalizeValue('currency', e.target.value))}
                onBlur={() => handleBlur('currency')}
                placeholder="EUR"
                maxLength={3}
                className={getInputClassName('currency')}
              />
              {touched.currency && errors.currency && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.currency}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="scheme">Payment Scheme</Label>
            <Select value={scheme} onValueChange={(v) => {
              setScheme(v as PaymentScheme);
              // Reset scheme-specific fields when scheme changes
              setFields({});
              // Reset touched for scheme fields
              const newTouched = { ...touched };
              Object.keys(PAYMENT_SCHEMES).forEach(s => {
                PAYMENT_SCHEMES[s as PaymentScheme].requiredFields.forEach(f => {
                  delete newTouched[f];
                });
              });
              setTouched(newTouched);
            }}>
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
                      onValueChange={(v) => {
                        updateField(fieldName, v);
                        setTouched(prev => ({ ...prev, [fieldName]: true }));
                      }}
                    >
                      <SelectTrigger className={getInputClassName(fieldName)}>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="checking">Checking</SelectItem>
                        <SelectItem value="savings">Savings</SelectItem>
                      </SelectContent>
                    </Select>
                    {touched[fieldName] && errors[fieldName] && (
                      <p className="text-sm text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {errors[fieldName]}
                      </p>
                    )}
                  </div>
                );
              }
              
              return (
                <div key={fieldName} className="space-y-2">
                  <Label htmlFor={fieldName}>
                    {formatFieldName(fieldName)}
                    {isRequired && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id={fieldName}
                    value={fields[fieldName] as string || ""}
                    onChange={(e) => updateField(fieldName, e.target.value)}
                    onBlur={() => handleBlur(fieldName)}
                    placeholder={`Enter ${fieldName.replace(/_/g, ' ')}`}
                    className={getInputClassName(fieldName)}
                  />
                  {touched[fieldName] && errors[fieldName] && (
                    <p className="text-sm text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {errors[fieldName]}
                    </p>
                  )}
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

        {/* Error summary */}
        {Object.keys(errors).length > 0 && Object.keys(touched).length > 0 && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
            <p className="text-sm font-medium text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Please fix the following errors:
            </p>
            <ul className="list-disc list-inside text-sm text-destructive mt-1 ml-6">
              {Object.entries(errors).map(([field, error]) => (
                <li key={field}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isFormValid}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
