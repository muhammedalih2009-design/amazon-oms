import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, sku_code } = await req.json();

    if (!workspace_id || !sku_code) {
      return Response.json({ 
        ok: false, 
        error: 'workspace_id and sku_code required' 
      }, { status: 400 });
    }

    console.log(`[Fix SKU] Starting fix for ${sku_code} in workspace ${workspace_id}`);

    // Fetch all data for this SKU
    const [skus, currentStock, movements, purchases] = await Promise.all([
      base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id, sku_code }),
      base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: workspace_id, sku_code }),
      base44.asServiceRole.entities.StockMovement.filter({ tenant_id: workspace_id, sku_code, is_archived: false }),
      base44.asServiceRole.entities.Purchase.filter({ tenant_id: workspace_id, sku_code })
    ]);

    // Fetch all orders (not just fulfilled) and their lines
    const orders = await base44.asServiceRole.entities.Order.filter({ 
      tenant_id: workspace_id,
      is_deleted: false 
    });
    
    const orderLines = await base44.asServiceRole.entities.OrderLine.filter({ 
      tenant_id: workspace_id,
      sku_code,
      is_returned: false 
    });

    const sku = skus[0];
    if (!sku) {
      return Response.json({ ok: false, error: 'SKU not found' }, { status: 404 });
    }

    const stock = currentStock[0];
    const before_stock = stock?.quantity_available || 0;
    const before_movements_count = movements.length;

    console.log(`[Fix SKU] Before: stock=${before_stock}, movements=${before_movements_count}`);

    // Calculate expected stock from movement history
    const calculated_stock = movements.reduce((sum, m) => sum + (m.quantity || 0), 0);

    const fixedIssues = [];
    let createdMovementsCount = 0;

    // Fix 1: Create missing OUT movements for all non-returned order lines
    const linesForThisSku = orderLines.filter(line => line.sku_id === sku.id);
    
    console.log(`[Fix SKU] Found ${linesForThisSku.length} order lines for this SKU`);

    for (const line of linesForThisSku) {
      const hasMovement = movements.some(m => 
        m.reference_type === 'order_line' && 
        m.reference_id === line.id &&
        m.movement_type === 'order_fulfillment'
      );

      if (!hasMovement) {
        console.log(`[Fix SKU] Missing OUT movement for order line ${line.id} (qty: ${line.quantity})`);
        
        // Create missing movement (idempotent - check again before insert)
        const doubleCheck = await base44.asServiceRole.entities.StockMovement.filter({
          tenant_id: workspace_id,
          reference_type: 'order_line',
          reference_id: line.id,
          movement_type: 'order_fulfillment'
        });

        if (doubleCheck.length === 0) {
          const orderData = orders.find(o => o.id === line.order_id);
          const movementDate = orderData?.order_date || new Date().toISOString().split('T')[0];
          
          const newMovement = await base44.asServiceRole.entities.StockMovement.create({
            tenant_id: workspace_id,
            sku_id: sku.id,
            sku_code: sku.sku_code,
            movement_type: 'order_fulfillment',
            quantity: -line.quantity,
            reference_type: 'order_line',
            reference_id: line.id,
            movement_date: movementDate,
            notes: `Auto-fix: Missing OUT movement for order line`,
            is_archived: false
          });
          createdMovementsCount++;
          fixedIssues.push('missing_out_movement');
          console.log(`[Fix SKU] ✓ Created movement ${newMovement.id}: -${line.quantity} units`);
        }
      }
    }
    
    // Fix 1b: Create IN movements for purchases (if they exist but no movement record)
    console.log(`[Fix SKU] Found ${purchases.length} purchase records`);
    
    for (const purchase of purchases) {
      const hasMovement = movements.some(m => 
        m.reference_type === 'purchase' && 
        m.reference_id === purchase.id &&
        m.movement_type === 'purchase'
      );

      if (!hasMovement && purchase.quantity_remaining > 0) {
        console.log(`[Fix SKU] Missing IN movement for purchase ${purchase.id} (qty: ${purchase.quantity_remaining})`);
        
        const doubleCheck = await base44.asServiceRole.entities.StockMovement.filter({
          tenant_id: workspace_id,
          reference_type: 'purchase',
          reference_id: purchase.id,
          movement_type: 'purchase'
        });

        if (doubleCheck.length === 0) {
          const newMovement = await base44.asServiceRole.entities.StockMovement.create({
            tenant_id: workspace_id,
            sku_id: sku.id,
            sku_code: sku.sku_code,
            movement_type: 'purchase',
            quantity: purchase.quantity_remaining,
            reference_type: 'purchase',
            reference_id: purchase.id,
            movement_date: purchase.purchase_date,
            notes: `Auto-fix: Missing IN movement for purchase`,
            is_archived: false
          });
          createdMovementsCount++;
          fixedIssues.push('missing_in_movement');
          console.log(`[Fix SKU] ✓ Created movement ${newMovement.id}: +${purchase.quantity_remaining} units`);
        }
      }
    }

    // Recalculate stock after creating movements
    const allMovementsNow = await base44.asServiceRole.entities.StockMovement.filter({
      tenant_id: workspace_id,
      sku_id: sku.id,
      is_archived: false
    });
    
    const expected_stock = Math.max(0, allMovementsNow.reduce((sum, m) => sum + (m.quantity || 0), 0));

    console.log(`[Fix SKU] Expected stock calculated: ${expected_stock} from ${allMovementsNow.length} movements`);

    // Fix 2: Force current stock to match expected (clamp to 0)
    if (stock) {
      await base44.asServiceRole.entities.CurrentStock.update(stock.id, {
        quantity_available: expected_stock
      });
      fixedIssues.push('stock_mismatch');
      console.log(`[Fix SKU] Updated stock record ${stock.id}: ${stock.quantity_available} → ${expected_stock}`);
    } else {
      // Create stock record if missing
      const newStock = await base44.asServiceRole.entities.CurrentStock.create({
        tenant_id: workspace_id,
        sku_id: sku.id,
        sku_code: sku.sku_code,
        quantity_available: expected_stock
      });
      fixedIssues.push('missing_stock_record');
      console.log(`[Fix SKU] Created stock record ${newStock.id} with quantity ${expected_stock}`);
    }

    // Verify the update
    const verifyStock = await base44.asServiceRole.entities.CurrentStock.filter({
      tenant_id: workspace_id,
      sku_id: sku.id
    });
    console.log(`[Fix SKU] Verification: stock after update = ${verifyStock[0]?.quantity_available}`);
    
    if (verifyStock[0]?.quantity_available !== expected_stock) {
      console.error(`[Fix SKU] VERIFICATION FAILED: Expected ${expected_stock}, got ${verifyStock[0]?.quantity_available}`);
      throw new Error('Stock update verification failed');
    }

    // Fix 3: Negative stock is already handled by clamping to 0
    if (expected_stock === 0 && calculated_stock < 0) {
      fixedIssues.push('negative_stock_clamped');
    }

    const after_stock = expected_stock;
    const after_movements_count = allMovementsNow.length;

    console.log(`[Fix SKU] After: stock=${after_stock}, movements=${after_movements_count}, created=${createdMovementsCount}`);

    // Log audit entry
    console.log(`[Fix SKU] Audit: ${JSON.stringify({
      action: 'STOCK_FIX_NOW',
      sku_code,
      workspace_id,
      user: user.email,
      before_values: { stock: before_stock, movements: before_movements_count },
      after_values: { stock: after_stock, movements: after_movements_count },
      fixed_issue_types: [...new Set(fixedIssues)],
      created_movements_count: createdMovementsCount
    })}`);

    return Response.json({
      ok: true,
      sku_code,
      fixed_issues: [...new Set(fixedIssues)],
      before: { stock: before_stock, movements: before_movements_count },
      after: { stock: after_stock, movements: after_movements_count },
      created_movements: createdMovementsCount
    });

  } catch (error) {
    console.error('[Fix SKU] Error:', error);
    return Response.json({
      ok: false,
      error: error.message || 'Fix failed'
    }, { status: 500 });
  }
});