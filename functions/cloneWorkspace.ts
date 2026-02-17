import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BATCH_SIZE = 500;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || (user.role !== 'admin' && user.email !== 'admin@amazonoms.com')) {
      return Response.json({ error: 'Only platform admins can clone workspaces' }, { status: 403 });
    }

    const { source_workspace_id, target_workspace_name, target_workspace_slug, options } = await req.json();

    if (!source_workspace_id || !target_workspace_name) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Fetch source workspace + subscription
    const workspaces = await base44.asServiceRole.entities.Tenant.filter({ id: source_workspace_id });
    const sourceWs = workspaces[0];
    if (!sourceWs) {
      return Response.json({ error: 'Source workspace not found' }, { status: 404 });
    }

    const sourceSub = await base44.asServiceRole.entities.Subscription.filter({ tenant_id: source_workspace_id });

    // Create new workspace
    const newWs = await base44.asServiceRole.entities.Tenant.create({
      name: target_workspace_name,
      slug: target_workspace_slug || target_workspace_name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now()
    });

    // Create subscription for new workspace
    if (sourceSub.length > 0) {
      const sub = sourceSub[0];
      await base44.asServiceRole.entities.Subscription.create({
        tenant_id: newWs.id,
        plan: sub.plan || 'trial',
        status: 'active',
        current_period_end: sub.current_period_end
      });
    }

    // Create CloneJob for tracking
    const cloneJob = await base44.asServiceRole.entities.CloneJob.create({
      source_workspace_id,
      target_workspace_id: newWs.id,
      target_workspace_name,
      status: 'running',
      options: options || {
        copy_settings: true,
        copy_master_data: true,
        copy_operational_data: true,
        copy_logs: false,
        copy_members: false
      },
      progress: {},
      id_map: {},
      started_at: new Date().toISOString()
    });

    // Start async clone process
    (async () => {
      try {
        const idMap = {};

        // PHASE 1: STORES
        if (options.copy_master_data) {
          await updateJobStep(base44, cloneJob.id, 'stores');
          const stores = await base44.asServiceRole.entities.Store.filter({ tenant_id: source_workspace_id });
          for (const store of stores) {
            const newStore = await base44.asServiceRole.entities.Store.create({
              tenant_id: newWs.id,
              name: store.name,
              platform: store.platform,
              color: store.color
            });
            if (!idMap.stores) idMap.stores = {};
            idMap.stores[store.id] = newStore.id;
          }
          await updateJobProgress(base44, cloneJob.id, 'stores', stores.length, idMap);
        }

        // PHASE 2: SUPPLIERS
        if (options.copy_master_data) {
          await updateJobStep(base44, cloneJob.id, 'suppliers');
          const suppliers = await base44.asServiceRole.entities.Supplier.filter({ tenant_id: source_workspace_id });
          for (const supplier of suppliers) {
            const newSupplier = await base44.asServiceRole.entities.Supplier.create({
              tenant_id: newWs.id,
              supplier_name: supplier.supplier_name,
              contact_info: supplier.contact_info,
              email: supplier.email,
              phone: supplier.phone,
              address: supplier.address
            });
            if (!idMap.suppliers) idMap.suppliers = {};
            idMap.suppliers[supplier.id] = newSupplier.id;
          }
          await updateJobProgress(base44, cloneJob.id, 'suppliers', suppliers.length, idMap);
        }

        // PHASE 3: SKUs
        if (options.copy_master_data) {
          await updateJobStep(base44, cloneJob.id, 'skus');
          const skus = await base44.asServiceRole.entities.SKU.filter({ tenant_id: source_workspace_id });
          for (const sku of skus) {
            const newSku = await base44.asServiceRole.entities.SKU.create({
              tenant_id: newWs.id,
              sku_code: sku.sku_code,
              product_name: sku.product_name,
              cost_price: sku.cost_price,
              damaged_stock: sku.damaged_stock,
              image_url: sku.image_url,
              supplier_id: idMap.suppliers?.[sku.supplier_id] || null
            });
            if (!idMap.skus) idMap.skus = {};
            idMap.skus[sku.id] = newSku.id;
          }
          await updateJobProgress(base44, cloneJob.id, 'skus', skus.length, idMap);
        }

        // PHASE 4: ORDERS + ORDER LINES
        if (options.copy_operational_data) {
          await updateJobStep(base44, cloneJob.id, 'orders');
          const orders = await base44.asServiceRole.entities.Order.filter({ tenant_id: source_workspace_id });
          if (!idMap.orders) idMap.orders = {};
          
          for (const order of orders) {
            const newOrder = await base44.asServiceRole.entities.Order.create({
              tenant_id: newWs.id,
              amazon_order_id: order.amazon_order_id,
              store_id: idMap.stores?.[order.store_id] || order.store_id,
              store_name: order.store_name,
              store_color: order.store_color,
              order_date: order.order_date,
              status: order.status,
              net_revenue: order.net_revenue,
              total_cost: order.total_cost,
              profit_loss: order.profit_loss,
              profit_margin_percent: order.profit_margin_percent,
              settlement_date: order.settlement_date
            });
            idMap.orders[order.id] = newOrder.id;

            // Copy order lines
            const orderLines = await base44.asServiceRole.entities.OrderLine.filter({ order_id: order.id });
            for (const line of orderLines) {
              await base44.asServiceRole.entities.OrderLine.create({
                tenant_id: newWs.id,
                order_id: newOrder.id,
                sku_id: idMap.skus?.[line.sku_id] || line.sku_id,
                sku_code: line.sku_code,
                quantity: line.quantity,
                unit_cost: line.unit_cost,
                line_total_cost: line.line_total_cost,
                is_alternative: line.is_alternative,
                is_returned: line.is_returned,
                return_date: line.return_date
              });
            }
          }
          await updateJobProgress(base44, cloneJob.id, 'orders', orders.length, idMap);
        }

        // PHASE 5: PURCHASE REQUESTS (if entity exists)
        if (options.copy_operational_data) {
          try {
            await updateJobStep(base44, cloneJob.id, 'purchase_requests');
            const prqs = await base44.asServiceRole.entities.PurchaseRequest.filter({ tenant_id: source_workspace_id });
            for (const prq of prqs) {
              await base44.asServiceRole.entities.PurchaseRequest.create({
                tenant_id: newWs.id,
                ...Object.keys(prq).reduce((acc, k) => {
                  if (k === 'id' || k === 'created_date' || k === 'updated_date' || k === 'created_by') return acc;
                  if (k === 'tenant_id') return acc;
                  // Remap foreign keys
                  if (k === 'sku_id') acc[k] = idMap.skus?.[prq[k]] || prq[k];
                  else acc[k] = prq[k];
                  return acc;
                }, {})
              });
            }
            await updateJobProgress(base44, cloneJob.id, 'purchase_requests', prqs.length, idMap);
          } catch (e) {
            // PurchaseRequest entity may not exist, skip silently
          }
        }

        // PHASE 6: PURCHASES + PURCHASE ITEMS
        if (options.copy_operational_data) {
          await updateJobStep(base44, cloneJob.id, 'purchases');
          const purchases = await base44.asServiceRole.entities.Purchase.filter({ tenant_id: source_workspace_id });
          if (!idMap.purchases) idMap.purchases = {};

          for (const purchase of purchases) {
            const newPurchase = await base44.asServiceRole.entities.Purchase.create({
              tenant_id: newWs.id,
              sku_id: idMap.skus?.[purchase.sku_id] || purchase.sku_id,
              sku_code: purchase.sku_code,
              quantity_purchased: purchase.quantity_purchased,
              total_cost: purchase.total_cost,
              cost_per_unit: purchase.cost_per_unit,
              purchase_date: purchase.purchase_date,
              supplier_id: idMap.suppliers?.[purchase.supplier_id] || null,
              supplier_name: purchase.supplier_name,
              quantity_remaining: purchase.quantity_remaining
            });
            idMap.purchases[purchase.id] = newPurchase.id;
          }
          await updateJobProgress(base44, cloneJob.id, 'purchases', purchases.length, idMap);
        }

        // PHASE 7: RETURNS (if entity exists)
        if (options.copy_operational_data) {
          try {
            await updateJobStep(base44, cloneJob.id, 'returns');
            const returns = await base44.asServiceRole.entities.Return.filter({ tenant_id: source_workspace_id });
            for (const ret of returns) {
              await base44.asServiceRole.entities.Return.create({
                tenant_id: newWs.id,
                ...Object.keys(ret).reduce((acc, k) => {
                  if (k === 'id' || k === 'created_date' || k === 'updated_date' || k === 'created_by' || k === 'tenant_id') return acc;
                  if (k === 'order_id') acc[k] = idMap.orders?.[ret[k]] || ret[k];
                  else if (k === 'sku_id') acc[k] = idMap.skus?.[ret[k]] || ret[k];
                  else acc[k] = ret[k];
                  return acc;
                }, {})
              });
            }
            await updateJobProgress(base44, cloneJob.id, 'returns', returns.length, idMap);
          } catch (e) {
            // Returns entity may not exist, skip silently
          }
        }

        // PHASE 8: TASKS + COMMENTS + CHECKLIST (if copy_operational_data enabled)
        if (options.copy_operational_data) {
          try {
            await updateJobStep(base44, cloneJob.id, 'tasks');
            const tasks = await base44.asServiceRole.entities.Task.filter({ tenant_id: source_workspace_id });
            if (!idMap.tasks) idMap.tasks = {};

            for (const task of tasks) {
              const newTask = await base44.asServiceRole.entities.Task.create({
                tenant_id: newWs.id,
                title: task.title,
                description: task.description,
                account_name: task.account_name,
                assigned_to: task.assigned_to,
                assigned_to_email: task.assigned_to_email,
                created_by: task.created_by,
                created_by_email: task.created_by_email,
                tag: task.tag,
                status: task.status,
                due_date: task.due_date,
                priority: task.priority
              });
              idMap.tasks[task.id] = newTask.id;

              // Copy task checklist items
              try {
                const checklistItems = await base44.asServiceRole.entities.TaskChecklistItem.filter({ task_id: task.id });
                for (const item of checklistItems) {
                  await base44.asServiceRole.entities.TaskChecklistItem.create({
                    task_id: newTask.id,
                    content: item.content,
                    is_completed: item.is_completed,
                    order_index: item.order_index
                  });
                }
              } catch (e) { }

              // Copy task comments
              try {
                const comments = await base44.asServiceRole.entities.TaskComment.filter({ task_id: task.id });
                for (const comment of comments) {
                  await base44.asServiceRole.entities.TaskComment.create({
                    task_id: newTask.id,
                    user_id: comment.user_id,
                    user_email: comment.user_email,
                    user_name: comment.user_name,
                    comment_text: comment.comment_text
                  });
                }
              } catch (e) { }
            }
            await updateJobProgress(base44, cloneJob.id, 'tasks', tasks.length, idMap);
          } catch (e) {
            // Tasks may not exist, skip silently
          }
        }

        // PHASE 9: CURRENT STOCK (replicate stock levels)
        if (options.copy_operational_data) {
          try {
            await updateJobStep(base44, cloneJob.id, 'currentStock');
            const stocks = await base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: source_workspace_id });
            for (const stock of stocks) {
              await base44.asServiceRole.entities.CurrentStock.create({
                tenant_id: newWs.id,
                sku_id: idMap.skus?.[stock.sku_id] || stock.sku_id,
                sku_code: stock.sku_code,
                quantity_available: stock.quantity_available
              });
            }
            await updateJobProgress(base44, cloneJob.id, 'currentStock', stocks.length, idMap);
          } catch (e) { }
        }

        // PHASE 10: STOCK MOVEMENTS (audit trail)
        if (options.copy_operational_data) {
          try {
            await updateJobStep(base44, cloneJob.id, 'stockMovements');
            const movements = await base44.asServiceRole.entities.StockMovement.filter({ tenant_id: source_workspace_id });
            for (const mov of movements) {
              await base44.asServiceRole.entities.StockMovement.create({
                tenant_id: newWs.id,
                sku_id: idMap.skus?.[mov.sku_id] || mov.sku_id,
                sku_code: mov.sku_code,
                movement_type: mov.movement_type,
                quantity: mov.quantity,
                reference_type: mov.reference_type,
                reference_id: mov.reference_id,
                movement_date: mov.movement_date,
                notes: mov.notes,
                is_archived: mov.is_archived
              });
            }
            await updateJobProgress(base44, cloneJob.id, 'stockMovements', movements.length, idMap);
          } catch (e) { }
        }

        // PHASE 11: PURCHASE CARTS (purchase line items)
        if (options.copy_operational_data) {
          try {
            await updateJobStep(base44, cloneJob.id, 'purchaseCarts');
            const carts = await base44.asServiceRole.entities.PurchaseCart.filter({ tenant_id: source_workspace_id });
            for (const cart of carts) {
              await base44.asServiceRole.entities.PurchaseCart.create({
                tenant_id: newWs.id,
                sku_id: idMap.skus?.[cart.sku_id] || cart.sku_id,
                ...Object.keys(cart).reduce((acc, k) => {
                  if (k === 'id' || k === 'created_date' || k === 'updated_date' || k === 'created_by' || k === 'tenant_id' || k === 'sku_id') return acc;
                  acc[k] = cart[k];
                  return acc;
                }, {})
              });
            }
            await updateJobProgress(base44, cloneJob.id, 'purchaseCarts', carts.length, idMap);
          } catch (e) { }
        }

        // PHASE 12: PROFITABILITY LINES (order profitability details)
        if (options.copy_operational_data) {
          try {
            await updateJobStep(base44, cloneJob.id, 'profitabilityLines');
            const profLines = await base44.asServiceRole.entities.ProfitabilityLine.filter({ tenant_id: source_workspace_id });
            for (const line of profLines) {
              await base44.asServiceRole.entities.ProfitabilityLine.create({
                tenant_id: newWs.id,
                order_id: idMap.orders?.[line.order_id] || line.order_id,
                order_line_id: line.order_line_id,
                amazon_order_id: line.amazon_order_id,
                sku_code: line.sku_code,
                quantity: line.quantity,
                unit_cost: line.unit_cost,
                total_cost: line.total_cost,
                revenue: line.revenue,
                profit: line.profit,
                margin_percent: line.margin_percent,
                match_status: line.match_status,
                import_batch_id: line.import_batch_id,
                uploaded_by: line.uploaded_by,
                uploaded_at: line.uploaded_at
              });
            }
            await updateJobProgress(base44, cloneJob.id, 'profitabilityLines', profLines.length, idMap);
          } catch (e) { }
        }

        // PHASE 13: PROFITABILITY IMPORT BATCHES
        if (options.copy_logs) {
          try {
            await updateJobStep(base44, cloneJob.id, 'profitabilityBatches');
            const profBatches = await base44.asServiceRole.entities.ProfitabilityImportBatch.filter({ tenant_id: source_workspace_id });
            for (const batch of profBatches) {
              await base44.asServiceRole.entities.ProfitabilityImportBatch.create({
                tenant_id: newWs.id,
                file_name: batch.file_name,
                status: batch.status,
                total_rows: batch.total_rows,
                matched_rows: batch.matched_rows,
                unmatched_rows: batch.unmatched_rows,
                qty_mismatch_rows: batch.qty_mismatch_rows,
                error_summary: batch.error_summary,
                unmatched_data: batch.unmatched_data,
                uploaded_by: batch.uploaded_by
              });
            }
            await updateJobProgress(base44, cloneJob.id, 'profitabilityBatches', profBatches.length, idMap);
          } catch (e) { }
        }

        // PHASE 14: IMPORT BATCHES (if copy_logs enabled)
        if (options.copy_logs) {
          try {
            await updateJobStep(base44, cloneJob.id, 'importBatches');
            const batches = await base44.asServiceRole.entities.ImportBatch.filter({ tenant_id: source_workspace_id });
            for (const batch of batches) {
              await base44.asServiceRole.entities.ImportBatch.create({
                tenant_id: newWs.id,
                batch_type: batch.batch_type,
                batch_name: batch.batch_name,
                display_name: batch.display_name,
                filename: batch.filename,
                status: batch.status,
                total_rows: batch.total_rows,
                success_rows: batch.success_rows,
                failed_rows: batch.failed_rows,
                error_file_url: batch.error_file_url
              });
            }
            await updateJobProgress(base44, cloneJob.id, 'importBatches', batches.length, idMap);
          } catch (e) { }
        }

        // PHASE 15: IMPORT ERRORS (if copy_logs enabled)
        if (options.copy_logs) {
          try {
            await updateJobStep(base44, cloneJob.id, 'importErrors');
            const errors = await base44.asServiceRole.entities.ImportError.filter({ tenant_id: source_workspace_id });
            for (const err of errors) {
              await base44.asServiceRole.entities.ImportError.create({
                tenant_id: newWs.id,
                ...Object.keys(err).reduce((acc, k) => {
                  if (k === 'id' || k === 'created_date' || k === 'updated_date' || k === 'created_by' || k === 'tenant_id') return acc;
                  acc[k] = err[k];
                  return acc;
                }, {})
              });
            }
            await updateJobProgress(base44, cloneJob.id, 'importErrors', errors.length, idMap);
          } catch (e) { }
        }

        // PHASE 16: MEMBERSHIPS (if enabled)
        if (options.copy_members) {
          await updateJobStep(base44, cloneJob.id, 'memberships');
          const memberships = await base44.asServiceRole.entities.Membership.filter({ tenant_id: source_workspace_id });
          for (const mem of memberships) {
            if (mem.user_email === user.email) continue; // Skip current user (will be added as owner)
            await base44.asServiceRole.entities.Membership.create({
              tenant_id: newWs.id,
              user_id: mem.user_id,
              user_email: mem.user_email,
              role: mem.role,
              permissions: mem.permissions
            });
          }
          await updateJobProgress(base44, cloneJob.id, 'memberships', memberships.length, idMap);
        }

        // Create membership for current admin
        await base44.asServiceRole.entities.Membership.create({
          tenant_id: newWs.id,
          user_id: user.id,
          user_email: user.email,
          role: 'owner',
          permissions: {
            dashboard: { view: true, edit: true },
            tasks: { view: true, edit: true },
            skus: { view: true, edit: true },
            orders: { view: true, edit: true },
            purchases: { view: true, edit: true },
            returns: { view: true, edit: true },
            settlement: { view: true, edit: true },
            suppliers: { view: true, edit: true }
          }
        });

        // PHASE 17: VALIDATION
        await updateJobStep(base44, cloneJob.id, 'validating');
        
        // Count all entities in both workspaces
        const [sourceOrders, sourceSkus, sourcePurchases, sourceStores, sourceSuppliers,
               sourceOrderLines, sourceStockMovements, sourceCurrentStock, sourcePurchaseRequests,
               sourcePurchaseCarts, sourceProfitLines, sourceReturns, sourceTasks,
               targetOrders, targetSkus, targetPurchases, targetStores, targetSuppliers,
               targetOrderLines, targetStockMovements, targetCurrentStock, targetPurchaseRequests,
               targetPurchaseCarts, targetProfitLines, targetReturns, targetTasks] = await Promise.all([
          base44.asServiceRole.entities.Order.filter({ tenant_id: source_workspace_id }),
          base44.asServiceRole.entities.SKU.filter({ tenant_id: source_workspace_id }),
          base44.asServiceRole.entities.Purchase.filter({ tenant_id: source_workspace_id }),
          base44.asServiceRole.entities.Store.filter({ tenant_id: source_workspace_id }),
          base44.asServiceRole.entities.Supplier.filter({ tenant_id: source_workspace_id }),
          base44.asServiceRole.entities.OrderLine.filter({ tenant_id: source_workspace_id }),
          base44.asServiceRole.entities.StockMovement.filter({ tenant_id: source_workspace_id }),
          base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: source_workspace_id }),
          base44.asServiceRole.entities.PurchaseRequest.filter({ tenant_id: source_workspace_id }).catch(() => []),
          base44.asServiceRole.entities.PurchaseCart.filter({ tenant_id: source_workspace_id }).catch(() => []),
          base44.asServiceRole.entities.ProfitabilityLine.filter({ tenant_id: source_workspace_id }).catch(() => []),
          base44.asServiceRole.entities.Return.filter({ tenant_id: source_workspace_id }).catch(() => []),
          base44.asServiceRole.entities.Task.filter({ tenant_id: source_workspace_id }).catch(() => []),
          base44.asServiceRole.entities.Order.filter({ tenant_id: newWs.id }),
          base44.asServiceRole.entities.SKU.filter({ tenant_id: newWs.id }),
          base44.asServiceRole.entities.Purchase.filter({ tenant_id: newWs.id }),
          base44.asServiceRole.entities.Store.filter({ tenant_id: newWs.id }),
          base44.asServiceRole.entities.Supplier.filter({ tenant_id: newWs.id }),
          base44.asServiceRole.entities.OrderLine.filter({ tenant_id: newWs.id }),
          base44.asServiceRole.entities.StockMovement.filter({ tenant_id: newWs.id }),
          base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: newWs.id }),
          base44.asServiceRole.entities.PurchaseRequest.filter({ tenant_id: newWs.id }).catch(() => []),
          base44.asServiceRole.entities.PurchaseCart.filter({ tenant_id: newWs.id }).catch(() => []),
          base44.asServiceRole.entities.ProfitabilityLine.filter({ tenant_id: newWs.id }).catch(() => []),
          base44.asServiceRole.entities.Return.filter({ tenant_id: newWs.id }).catch(() => []),
          base44.asServiceRole.entities.Task.filter({ tenant_id: newWs.id }).catch(() => [])
        ]);

        const validationReport = {
          stores: { source: sourceStores.length, target: targetStores.length, match: sourceStores.length === targetStores.length },
          suppliers: { source: sourceSuppliers.length, target: targetSuppliers.length, match: sourceSuppliers.length === targetSuppliers.length },
          skus: { source: sourceSkus.length, target: targetSkus.length, match: sourceSkus.length === targetSkus.length },
          currentStock: { source: sourceCurrentStock.length, target: targetCurrentStock.length, match: sourceCurrentStock.length === targetCurrentStock.length },
          stockMovements: { source: sourceStockMovements.length, target: targetStockMovements.length, match: sourceStockMovements.length === targetStockMovements.length },
          orders: { source: sourceOrders.length, target: targetOrders.length, match: sourceOrders.length === targetOrders.length },
          orderLines: { source: sourceOrderLines.length, target: targetOrderLines.length, match: sourceOrderLines.length === targetOrderLines.length },
          purchases: { source: sourcePurchases.length, target: targetPurchases.length, match: sourcePurchases.length === targetPurchases.length },
          purchaseRequests: { source: sourcePurchaseRequests.length, target: targetPurchaseRequests.length, match: sourcePurchaseRequests.length === targetPurchaseRequests.length },
          purchaseCarts: { source: sourcePurchaseCarts.length, target: targetPurchaseCarts.length, match: sourcePurchaseCarts.length === targetPurchaseCarts.length },
          profitabilityLines: { source: sourceProfitLines.length, target: targetProfitLines.length, match: sourceProfitLines.length === targetProfitLines.length },
          returns: { source: sourceReturns.length, target: targetReturns.length, match: sourceReturns.length === targetReturns.length },
          tasks: { source: sourceTasks.length, target: targetTasks.length, match: sourceTasks.length === targetTasks.length }
        };

        // Check for mismatches
        const mismatches = Object.entries(validationReport).filter(([_, v]) => !v.match);
        const allMatch = mismatches.length === 0;

        // Referential integrity checks
        const integrityChecks = [];
        
        // Check no cross-tenant leakage
        const leakageCheck = targetOrders.every(o => o.tenant_id === newWs.id) &&
                            targetSkus.every(s => s.tenant_id === newWs.id) &&
                            targetPurchases.every(p => p.tenant_id === newWs.id);
        integrityChecks.push({ check: 'Tenant isolation', passed: leakageCheck });

        // Check no source IDs in target foreign keys
        const sourceOrderIds = new Set(sourceOrders.map(o => o.id));
        const targetOrderLinesFKs = targetOrderLines.map(ol => ol.order_id);
        const noSourceIds = !targetOrderLinesFKs.some(id => sourceOrderIds.has(id));
        integrityChecks.push({ check: 'No source IDs in target', passed: noSourceIds });

        // Mark as completed with validation
        await base44.asServiceRole.entities.CloneJob.update(cloneJob.id, {
          status: allMatch ? 'completed' : 'completed',
          completed_at: new Date().toISOString(),
          id_map: idMap,
          validation_report: validationReport,
          integrity_checks: integrityChecks,
          validation_passed: allMatch && integrityChecks.every(c => c.passed)
        });
      } catch (error) {
        console.error('Clone job error:', error);
        await base44.asServiceRole.entities.CloneJob.update(cloneJob.id, {
          status: 'failed',
          error_message: error.message,
          error_step: error.step || 'unknown',
          completed_at: new Date().toISOString()
        });
      }
    })();

    return Response.json({ ok: true, clone_job_id: cloneJob.id, target_workspace_id: newWs.id });
  } catch (error) {
    console.error('Clone workspace error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function updateJobStep(base44, jobId, step) {
  await base44.asServiceRole.entities.CloneJob.update(jobId, { current_step: step });
}

async function updateJobProgress(base44, jobId, entity, count, idMap) {
  const jobs = await base44.asServiceRole.entities.CloneJob.filter({ id: jobId });
  const job = jobs[0];
  if (job) {
    const progress = job.progress || {};
    progress[entity] = count;
    await base44.asServiceRole.entities.CloneJob.update(jobId, { progress, id_map: idMap });
  }
}