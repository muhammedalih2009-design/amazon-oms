import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let heartbeatInterval = null;

  try {
    const { jobId, tenantId } = await req.json();

    if (!jobId || !tenantId) {
      return Response.json({ error: 'Missing jobId or tenantId' }, { status: 400 });
    }

    // Get the background job
    const job = await base44.asServiceRole.entities.BackgroundJob.get(jobId);
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    // Update job status to running
    await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
      status: 'running',
      started_at: job.started_at || new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString()
    });

    // Heartbeat sender - sends every 3 seconds to prevent timeout
    heartbeatInterval = setInterval(async () => {
      try {
        await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
          last_heartbeat_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      } catch (err) {
        console.error('[Heartbeat] Failed:', err);
      }
    }, 3000);

    // Get workspace settings for Telegram credentials
    const settingsData = await base44.asServiceRole.entities.WorkspaceSettings.filter({
      workspace_id: tenantId
    });

    if (!settingsData || settingsData.length === 0) {
      throw new Error('Telegram settings not configured');
    }

    const settings = settingsData[0];
    const botToken = settings.telegram_bot_token;
    const chatId = settings.telegram_chat_id;

    if (!botToken || !chatId) {
      throw new Error('Telegram bot token or chat ID not configured');
    }

    // Check if plan exists
    const existingPlan = await base44.asServiceRole.entities.TelegramExportPlanItem.filter({
      job_id: jobId
    });

    // Build send plan if doesn't exist
    if (existingPlan.length === 0) {
      console.log('[Telegram Export] Building send plan...');
      
      const rows = job.params?.rows || [];
      
      // Group products by supplier
      const supplierGroups = {};
      const unassignedProducts = [];

      rows.forEach((item, idx) => {
        const supplier = item.supplier?.trim();
        if (!supplier || supplier === '') {
          unassignedProducts.push({ ...item, originalIndex: idx });
        } else {
          if (!supplierGroups[supplier]) {
            supplierGroups[supplier] = [];
          }
          supplierGroups[supplier].push({ ...item, originalIndex: idx });
        }
      });

      // Build plan items
      const planItems = [];
      let sortIndex = 0;

      // Add assigned suppliers first
      for (const [supplier, products] of Object.entries(supplierGroups)) {
        // Add supplier header
        planItems.push({
          workspace_id: tenantId,
          job_id: jobId,
          supplier_id: supplier,
          supplier_name_display: supplier,
          item_type: 'supplier_header',
          item_key: `supplier:${supplier}`,
          sort_index: sortIndex++,
          status: 'pending'
        });

        // Add products for this supplier
        products.forEach(product => {
          planItems.push({
            workspace_id: tenantId,
            job_id: jobId,
            supplier_id: supplier,
            supplier_name_display: supplier,
            item_type: 'product',
            item_key: `product:${product.sku || product.originalIndex}`,
            sort_index: sortIndex++,
            sku_code: product.sku || 'N/A',
            product_name: product.product || 'N/A',
            quantity: product.toBuy || 0,
            unit_cost: product.unitCost || 0,
            image_url: product.imageUrl || '',
            status: 'pending'
          });
        });
      }

      // Add Unassigned group LAST
      if (unassignedProducts.length > 0) {
        // Add Unassigned header
        planItems.push({
          workspace_id: tenantId,
          job_id: jobId,
          supplier_id: null,
          supplier_name_display: 'Unassigned',
          item_type: 'supplier_header',
          item_key: 'supplier:Unassigned',
          sort_index: sortIndex++,
          status: 'pending'
        });

        // Add unassigned products
        unassignedProducts.forEach(product => {
          planItems.push({
            workspace_id: tenantId,
            job_id: jobId,
            supplier_id: null,
            supplier_name_display: 'Unassigned',
            item_type: 'product',
            item_key: `product:${product.sku || product.originalIndex}`,
            sort_index: sortIndex++,
            sku_code: product.sku || 'N/A',
            product_name: product.product || 'N/A',
            quantity: product.toBuy || 0,
            unit_cost: product.unitCost || 0,
            image_url: product.imageUrl || '',
            status: 'pending'
          });
        });
      }

      // Bulk create plan
      await base44.asServiceRole.entities.TelegramExportPlanItem.bulkCreate(planItems);
      
      const totalProducts = planItems.filter(p => p.item_type === 'product').length;
      console.log(`[Telegram Export] Created plan: ${planItems.length} items (${totalProducts} products)`);

      // Update job with total
      await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
        progress_total: totalProducts,
        progress_done: 0
      });
    }

    // Get all plan items ordered by sort_index
    const allPlanItems = await base44.asServiceRole.entities.TelegramExportPlanItem.filter({
      job_id: jobId
    });
    allPlanItems.sort((a, b) => a.sort_index - b.sort_index);

    const totalProducts = allPlanItems.filter(p => p.item_type === 'product').length;

    // Get pending items
    const pendingItems = allPlanItems.filter(p => p.status === 'pending');
    console.log(`[Telegram Export] Processing ${pendingItems.length} pending items`);

    let currentSupplier = null;
    let lastSupplierSentIndex = -1;

    // Process each pending item in order
    for (const planItem of pendingItems) {
      try {
        // Send item based on type
        if (planItem.item_type === 'supplier_header') {
          // Send supplier header
          const supplierProducts = allPlanItems.filter(p => 
            p.supplier_name_display === planItem.supplier_name_display && 
            p.item_type === 'product'
          );
          const totalSkus = supplierProducts.length;
          const totalQty = supplierProducts.reduce((sum, p) => sum + (p.quantity || 0), 0);
          const totalCost = supplierProducts.reduce((sum, p) => sum + ((p.quantity || 0) * (p.unit_cost || 0)), 0);

          const headerCaption = `📦 *${planItem.supplier_name_display}*\n${totalSkus} SKUs | ${totalQty} items | $${totalCost.toFixed(2)}`;

          const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: headerCaption,
              parse_mode: 'Markdown'
            })
          });

          if (!response.ok) {
            throw new Error(`Telegram API error: ${response.statusText}`);
          }

          const result = await response.json();
          
          // Mark header as sent
          await base44.asServiceRole.entities.TelegramExportPlanItem.update(planItem.id, {
            status: 'sent',
            sent_at: new Date().toISOString(),
            telegram_message_id: result.result?.message_id?.toString()
          });

          currentSupplier = planItem.supplier_name_display;
          lastSupplierSentIndex = planItem.sort_index;
          
          console.log(`[Telegram Export] Sent header: ${planItem.supplier_name_display}`);

        } else if (planItem.item_type === 'product') {
          // Send product
          const itemCaption = `SKU: \`${planItem.sku_code}\`\nProduct: ${planItem.product_name}\nQty: ${planItem.quantity}\nUnit Cost: $${planItem.unit_cost.toFixed(2)}\nEst. Total: $${(planItem.quantity * planItem.unit_cost).toFixed(2)}`;

          let response;
          if (planItem.image_url && planItem.image_url.trim().length > 0) {
            response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                photo: planItem.image_url,
                caption: itemCaption,
                parse_mode: 'Markdown'
              })
            });
          } else {
            response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: itemCaption,
                parse_mode: 'Markdown'
              })
            });
          }

          if (!response.ok) {
            throw new Error(`Telegram API error: ${response.statusText}`);
          }

          const result = await response.json();

          // Mark product as sent
          await base44.asServiceRole.entities.TelegramExportPlanItem.update(planItem.id, {
            status: 'sent',
            sent_at: new Date().toISOString(),
            telegram_message_id: result.result?.message_id?.toString()
          });

          // Update progress
          const sentProducts = allPlanItems.filter(p => p.item_type === 'product' && p.status === 'sent').length + 1;
          const failedProducts = allPlanItems.filter(p => p.item_type === 'product' && p.status === 'failed').length;
          const progressPercent = Math.floor((sentProducts / totalProducts) * 100);

          await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
            progress_done: sentProducts,
            progress_total: totalProducts,
            progress_percent: progressPercent,
            success_count: sentProducts,
            failed_count: failedProducts,
            last_heartbeat_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            result: {
              currentSupplier: planItem.supplier_name_display,
              lastSentItem: planItem.sku_code,
              lastSentAt: new Date().toISOString()
            }
          });

          console.log(`[Telegram Export] Sent product ${sentProducts}/${totalProducts}: ${planItem.sku_code}`);
        }

        // Wait 1 second between items
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if we just finished a supplier group (next item is a new supplier or we're done)
        const nextItem = allPlanItems.find(p => p.sort_index === planItem.sort_index + 1);
        if (nextItem && nextItem.item_type === 'supplier_header') {
          // Wait 30 seconds between suppliers
          console.log(`[Telegram Export] Completed supplier: ${currentSupplier}. Waiting 30 seconds...`);
          
          // During 30s wait, send heartbeat every 3 seconds (already covered by interval)
          await new Promise(resolve => setTimeout(resolve, 30000));
        }

      } catch (itemError) {
        console.error(`[Telegram Export] Failed item:`, itemError);
        
        // Mark item as failed
        await base44.asServiceRole.entities.TelegramExportPlanItem.update(planItem.id, {
          status: 'failed',
          error_message: itemError.message
        });

        if (planItem.item_type === 'product') {
          const failedProducts = allPlanItems.filter(p => p.item_type === 'product' && p.status === 'failed').length + 1;
          await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
            failed_count: failedProducts,
            last_heartbeat_at: new Date().toISOString()
          });
        }
      }
    }

    // Check completion - ONLY complete when ALL products are sent
    const finalPlanItems = await base44.asServiceRole.entities.TelegramExportPlanItem.filter({
      job_id: jobId
    });

    const productItems = finalPlanItems.filter(p => p.item_type === 'product');
    const sentProducts = productItems.filter(p => p.status === 'sent').length;
    const failedProducts = productItems.filter(p => p.status === 'failed').length;
    const pendingProducts = productItems.filter(p => p.status === 'pending').length;

    const allProductsSent = sentProducts === productItems.length;
    const finalStatus = allProductsSent ? 'completed' : 'failed';

    clearInterval(heartbeatInterval);
    
    await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
      status: finalStatus,
      progress_done: sentProducts,
      progress_total: productItems.length,
      progress_percent: 100,
      success_count: sentProducts,
      failed_count: failedProducts,
      completed_at: new Date().toISOString(),
      can_resume: !allProductsSent,
      error_message: !allProductsSent ? `Incomplete: ${sentProducts}/${productItems.length} products sent. ${pendingProducts} pending, ${failedProducts} failed.` : null,
      result: {
        totalProducts: productItems.length,
        sentProducts,
        failedProducts,
        pendingProducts
      }
    });

    return Response.json({
      success: allProductsSent,
      jobId,
      totalProducts: productItems.length,
      sentProducts,
      failedProducts,
      pendingProducts
    });

  } catch (error) {
    console.error('[Telegram Export Queue] Error:', error);
    
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    
    try {
      await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
        status: 'failed',
        error_message: error.message,
        completed_at: new Date().toISOString(),
        can_resume: true
      });
    } catch (e) {
      console.error('[Error] Failed to update job:', e);
    }
    
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});