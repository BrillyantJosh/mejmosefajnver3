// Currency conversion utilities for donation proposals

export interface ExchangeRates {
  [currency: string]: number; // Rate to LANA
}

// Get exchange rates from session storage (stored by system parameters)
export const getExchangeRates = (): ExchangeRates => {
  try {
    const ratesJson = sessionStorage.getItem('exchangeRates');
    if (ratesJson) {
      return JSON.parse(ratesJson);
    }
  } catch (error) {
    console.error('Failed to parse exchange rates:', error);
  }
  
  // Default fallback rates (1 EUR = 250 LANA)
  return {
    'EUR': 250,
    'USD': 270,
    'GBP': 290
  };
};

// Get user's local currency from session
export const getUserCurrency = (): string => {
  return sessionStorage.getItem('userCurrency') || 'EUR';
};

// Convert from source fiat to LANA
export const fiatToLana = (amount: number, sourceCurrency: string): number => {
  const rates = getExchangeRates();
  const rate = rates[sourceCurrency] || rates['EUR'];
  return amount * rate;
};

// Convert from LANA to target fiat
export const lanaToFiat = (lanaAmount: number, targetCurrency: string): number => {
  const rates = getExchangeRates();
  const rate = rates[targetCurrency] || rates['EUR'];
  return lanaAmount / rate;
};

// Convert from source fiat to target fiat via LANA
export const fiatToFiat = (amount: number, sourceCurrency: string, targetCurrency: string): number => {
  const lanaAmount = fiatToLana(amount, sourceCurrency);
  return lanaToFiat(lanaAmount, targetCurrency);
};

// Convert LANA to lanoshis (1 LANA = 100,000,000 lanoshis)
export const lanaToLanoshi = (lana: number): number => {
  return Math.floor(lana * 100000000);
};

// Convert lanoshis to LANA
export const lanoshiToLana = (lanoshi: number): number => {
  return lanoshi / 100000000;
};

// Format currency for display
export const formatCurrency = (amount: number, currency: string): string => {
  // Validate currency code - must be a non-empty 3-letter string
  if (!currency || currency.trim().length !== 3) {
    return `${amount.toFixed(2)}`;
  }
  
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.trim().toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch (error) {
    // Fallback if currency code is still invalid
    return `${amount.toFixed(2)} ${currency}`;
  }
};

// Format LANA for display
export const formatLana = (amount: number): string => {
  return `${amount.toFixed(2)} LANA`;
};
