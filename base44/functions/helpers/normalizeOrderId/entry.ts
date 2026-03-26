/**
 * Canonical order ID normalization helper
 * Used across all settlement matching logic for consistency
 * 
 * @param {string} orderId - Raw order ID
 * @returns {string} Normalized order ID for comparison
 */
export function normalizeOrderId(orderId) {
  if (!orderId) return '';
  
  return orderId
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '') // Remove zero-width and non-breaking chars
    .replace(/\s+/g, '') // Remove all whitespace
    .replace(/[\u2010-\u2015\u2212]/g, '-') // Normalize unicode dashes
    .replace(/[^a-zA-Z0-9]/g, ''); // Remove ALL non-alphanumeric characters for broader comparison
}