export function formatCurrency(
  amount,
  currencyCode = 'USD',
  locale = 'en-US'
) {
  const value = amount || 0;
  
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  } catch (error) {
    // Fallback if currency/locale is invalid
    console.error('Currency formatting error:', error);
    return `${currencyCode} ${value.toFixed(2)}`;
  }
}

export function getCurrencySymbol(currencyCode = 'USD', locale = 'en-US') {
  try {
    const formatted = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(0);
    
    // Extract symbol by removing digits
    return formatted.replace(/[\d\s,\.]/g, '').trim();
  } catch (error) {
    return currencyCode;
  }
}