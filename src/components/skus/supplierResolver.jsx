import { base44 } from '@/api/base44Client';

/**
 * Resolves a supplier value to a supplier_id.
 * - If value looks like an ID and exists -> return it
 * - If value is a name -> search by name (case-insensitive)
 * - If not found -> auto-create supplier in workspace
 * - If empty -> return null
 * 
 * @param {string} tenantId - workspace ID
 * @param {string|null} supplierValue - supplier_id, supplier_name, or empty
 * @param {Map} supplierCache - optional cache of existing suppliers (to avoid repeat queries)
 * @returns {Promise<string|null>} supplier_id or null
 */
export async function resolveOrCreateSupplier(tenantId, supplierValue, supplierCache = null) {
  if (!supplierValue || supplierValue.trim() === '') {
    return null;
  }

  const normalizedValue = supplierValue.trim();

  // Get or fetch all suppliers in this workspace
  let suppliers = supplierCache;
  if (!suppliers) {
    const allSuppliers = await base44.entities.Supplier.filter({ 
      tenant_id: tenantId 
    });
    suppliers = new Map();
    allSuppliers.forEach(sup => {
      // Map by ID and by name (case-insensitive)
      suppliers.set(sup.id, sup);
      suppliers.set(sup.supplier_name.toLowerCase(), sup);
    });
  }

  // Try exact ID match first
  if (suppliers.has(normalizedValue)) {
    const supplier = suppliers.get(normalizedValue);
    return supplier.id || normalizedValue;
  }

  // Try name match (case-insensitive)
  const nameLower = normalizedValue.toLowerCase();
  if (suppliers.has(nameLower)) {
    const supplier = suppliers.get(nameLower);
    return supplier.id;
  }

  // Not found -> create new supplier
  try {
    const newSupplier = await base44.entities.Supplier.create({
      tenant_id: tenantId,
      supplier_name: normalizedValue,
      contact_info: ''
    });
    
    // Add to cache
    if (supplierCache) {
      supplierCache.set(newSupplier.id, newSupplier);
      supplierCache.set(normalizedValue.toLowerCase(), newSupplier);
    }

    return newSupplier.id;
  } catch (error) {
    console.error(`Failed to create supplier "${normalizedValue}":`, error);
    throw new Error(`Failed to create supplier: ${error.message}`);
  }
}