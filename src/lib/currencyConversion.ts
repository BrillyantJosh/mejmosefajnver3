// Currency conversion utilities for donation proposals

export interface ExchangeRates {
  [currency: string]: number; // Rate to LANA
}

// Get exchange rates from system parameters (KIND 38888 via sessionStorage)
// KIND 38888 stores LANA-to-fiat rates (e.g. EUR: 0.008 means 1 LANA = 0.008 EUR)
// This function converts them to fiat-to-LANA rates (e.g. EUR: 125 means 1 EUR = 125 LANA)
export const getExchangeRates = (): ExchangeRates => {
  try {
    // Read from system parameters cached by SystemParametersContext
    const systemParamsJson = sessionStorage.getItem('lana_system_parameters');
    if (systemParamsJson) {
      const systemParams = JSON.parse(systemParamsJson);
      const lanaToFiatRates = systemParams.exchangeRates;
      if (lanaToFiatRates && typeof lanaToFiatRates === 'object') {
        const fiatToLanaRates: ExchangeRates = {};
        for (const [currency, rate] of Object.entries(lanaToFiatRates)) {
          const numRate = Number(rate);
          if (numRate > 0) {
            fiatToLanaRates[currency] = 1 / numRate; // Invert: LANA-to-fiat → fiat-to-LANA
          }
        }
        if (Object.keys(fiatToLanaRates).length > 0) {
          return fiatToLanaRates;
        }
      }
    }
  } catch (error) {
    console.error('Failed to parse exchange rates from system parameters:', error);
  }

  // Default fallback rates (1 EUR = 125 LANA based on 1 LANA = 0.008 EUR)
  return {
    'EUR': 125,
    'USD': 125,
    'GBP': 125
  };
};

// Get LANA-to-fiat rates directly from system parameters
// Returns rates like EUR: 0.008 (1 LANA = 0.008 EUR)
export const getLanaToFiatRates = (): ExchangeRates => {
  try {
    const systemParamsJson = sessionStorage.getItem('lana_system_parameters');
    if (systemParamsJson) {
      const systemParams = JSON.parse(systemParamsJson);
      const rates = systemParams.exchangeRates;
      if (rates && typeof rates === 'object') {
        return rates as ExchangeRates;
      }
    }
  } catch (error) {
    console.error('Failed to parse LANA-to-fiat rates:', error);
  }
  return { 'EUR': 0.008, 'USD': 0.008, 'GBP': 0.008 };
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
