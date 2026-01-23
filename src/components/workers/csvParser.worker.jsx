// Web Worker for background CSV parsing
// Prevents UI freezing during large file processing

self.onmessage = async function(e) {
  const { file, type } = e.data;
  
  try {
    // Read file as text
    const text = await file.text();
    
    // Parse CSV
    const lines = text.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length === headers.length) {
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index]?.trim() || '';
        });
        
        // Only include rows with some data
        if (Object.values(row).some(val => val !== '')) {
          rows.push(row);
        }
      }
    }
    
    // Send parsed data back to main thread
    self.postMessage({
      success: true,
      data: rows,
      rowCount: rows.length
    });
  } catch (error) {
    self.postMessage({
      success: false,
      error: error.message
    });
  }
};

// Parse CSV line handling quoted values
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}