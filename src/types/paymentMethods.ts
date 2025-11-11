// Payment method types based on Lana Extended Profile documentation

export type PaymentScope = 'collect' | 'payout' | 'both';

export type PaymentScheme = 
  | 'EU.IBAN'
  | 'UK.ACCT_SORT'
  | 'US.ACH'
  | 'AU.BSB'
  | 'CA.TRANSIT'
  | 'MX.CLABE'
  | 'BR.PIX'
  | 'IN.IFSC'
  | 'JP.ZENGIN'
  | 'ZA.BRANCH'
  | 'SG.BANK_BRANCH';

export interface PaymentMethodFields {
  // EU.IBAN
  iban?: string;
  bic?: string;
  account_holder?: string;
  
  // UK.ACCT_SORT
  account_number?: string;
  sort_code?: string;
  
  // US.ACH
  routing_number?: string;
  account_type?: 'checking' | 'savings';
  
  // AU.BSB
  bsb?: string;
  
  // CA.TRANSIT
  institution_number?: string;
  transit_number?: string;
  
  // MX.CLABE
  clabe?: string;
  
  // BR.PIX
  pix_key?: string;
  
  // IN.IFSC
  ifsc?: string;
  
  // JP.ZENGIN, ZA.BRANCH, SG.BANK_BRANCH (shared fields)
  bank_code?: string;
  branch_code?: string;
}

export interface PaymentMethod {
  id: string;
  scope: PaymentScope;
  country: string;
  scheme: PaymentScheme;
  currency: string;
  label: string;
  fields: PaymentMethodFields;
  verified?: boolean;
  primary?: boolean;
  privacy?: {
    redact_last4?: boolean;
  };
}

export const PAYMENT_SCHEMES: Record<PaymentScheme, { 
  label: string; 
  region: string;
  requiredFields: string[];
  optionalFields: string[];
}> = {
  'EU.IBAN': {
    label: 'SEPA / Eurozone',
    region: 'Europe',
    requiredFields: ['iban'],
    optionalFields: ['bic', 'account_holder']
  },
  'UK.ACCT_SORT': {
    label: 'UK Bank Account',
    region: 'United Kingdom',
    requiredFields: ['account_number', 'sort_code'],
    optionalFields: ['account_holder']
  },
  'US.ACH': {
    label: 'ACH Transfer',
    region: 'United States',
    requiredFields: ['routing_number', 'account_number', 'account_type'],
    optionalFields: []
  },
  'AU.BSB': {
    label: 'BSB Account',
    region: 'Australia',
    requiredFields: ['bsb', 'account_number'],
    optionalFields: ['account_holder']
  },
  'CA.TRANSIT': {
    label: 'Transit Account',
    region: 'Canada',
    requiredFields: ['institution_number', 'transit_number', 'account_number'],
    optionalFields: []
  },
  'MX.CLABE': {
    label: 'CLABE',
    region: 'Mexico',
    requiredFields: ['clabe'],
    optionalFields: []
  },
  'BR.PIX': {
    label: 'PIX',
    region: 'Brazil',
    requiredFields: ['pix_key'],
    optionalFields: []
  },
  'IN.IFSC': {
    label: 'IFSC Account',
    region: 'India',
    requiredFields: ['ifsc', 'account_number'],
    optionalFields: ['account_holder']
  },
  'JP.ZENGIN': {
    label: 'Zengin',
    region: 'Japan',
    requiredFields: ['bank_code', 'branch_code', 'account_number'],
    optionalFields: []
  },
  'ZA.BRANCH': {
    label: 'Branch Account',
    region: 'South Africa',
    requiredFields: ['branch_code', 'account_number'],
    optionalFields: []
  },
  'SG.BANK_BRANCH': {
    label: 'Bank Branch Account',
    region: 'Singapore',
    requiredFields: ['bank_code', 'branch_code', 'account_number'],
    optionalFields: []
  }
};
