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
    const sourceWs = await base44.asServiceRole.entities.Tenant.read(source_workspace_id);
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
        copy_operational_data: false,
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

        // PHASE 5: PURCHASE REQUESTS
        if (options.copy_operational_data) {
          await updateJobStep(base44, cloneJob.id, 'purchase_requests');
          // Note: PurchaseRequest entity structure depends on actual schema
          // This is a placeholder - adjust based on real schema
          const prqs = await base44.asServiceRole.entities.PurchaseRequest?.filter?.({ tenant_id: source_workspace_id }) || [];
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

        // PHASE 7: RETURNS
        if (options.copy_operational_data) {
          await updateJobStep(base44, cloneJob.id, 'returns');
          const returns = await base44.asServiceRole.entities.Return?.filter?.({ tenant_id: source_workspace_id }) || [];
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
        }

        // PHASE 8: MEMBERSHIPS (if enabled)
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
            suppliers: { view: true, edit: true }
          }
        });

        // Mark as completed
        await base44.asServiceRole.entities.CloneJob.update(cloneJob.id, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          id_map: idMap
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
  const job = await base44.asServiceRole.entities.CloneJob.read(jobId);
  const progress = job.progress || {};
  progress[entity] = count;
  await base44.asServiceRole.entities.CloneJob.update(jobId, { progress, id_map: idMap });
}