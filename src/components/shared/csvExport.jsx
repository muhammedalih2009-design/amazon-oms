/**
 * CSV Export Utility
 * Handles UTF-8 BOM encoding, proper escaping, and Arabic text support
 */

/**
 * Escapes a CSV cell value properly
 * - Wraps in quotes if contains comma, newline, or quote
 * - Doubles internal quotes
 * - Converts null/undefined to empty string
 */
function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  
  const str = String(value);
  
  // Check if cell needs quoting (contains comma, quote, or newline)
  const needsQuoting = str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r');
  
  if (needsQuoting) {
    // Escape quotes by doubling them
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  
  return str;
}

/**
 * Generates CSV content with UTF-8 BOM for Excel/Google Sheets compatibility
 * @param {Array<string>} headers - Column headers
 * @param {Array<Array<any>>} rows - Data rows (array of arrays)
 * @returns {string} CSV content with BOM
 */
export function generateCSV(headers, rows) {
  // UTF-8 BOM for Excel/Google Sheets to properly recognize encoding
  const BOM = '\uFEFF';
  
  // Escape and join headers
  const headerLine = headers.map(h => escapeCsvCell(h)).join(',');
  
  // Escape and join each row
  const dataLines = rows.map(row => 
    row.map(cell => escapeCsvCell(cell)).join(',')
  );
  
  // Combine with BOM
  return BOM + [headerLine, ...dataLines].join('\n');
}

/**
 * Triggers a CSV file download
 * @param {string} csvContent - CSV content string
 * @param {string} filename - Download filename (e.g., 'orders_export.csv')
 */
export function downloadCSV(csvContent, filename) {
  // Create blob with UTF-8 encoding
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  
  // Trigger download
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  
  // Cleanup
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDateForCSV(date) {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format number for CSV (no currency symbols)
 */
export function formatNumberForCSV(value, decimals = 2) {
  if (value === null || value === undefined || isNaN(value)) return '';
  return Number(value).toFixed(decimals);
}