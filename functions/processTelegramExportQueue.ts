import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { jobId, tenantId, resumeFromCheckpoint } = await req.json();

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
      started_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString()
    });

    // Heartbeat sender - sends every 10 seconds to prevent timeout
    const heartbeatInterval = setInterval(async () => {
      try {
        await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
          last_heartbeat_at: new Date().toISOString()
        });
      } catch (err) {
        console.error('[Heartbeat] Failed to send heartbeat:', err);
      }
    }, 10000);

    // Get workspace settings for Telegram credentials
    const settingsData = await base44.asServiceRole.entities.WorkspaceSettings.filter({
      workspace_id: tenantId
    });

    if (!settingsData || settingsData.length === 0) {
      await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
        status: 'failed',
        error_message: 'Telegram settings not configured',
        completed_at: new Date().toISOString()
      });
      return Response.json({ error: 'Telegram settings not found' }, { status: 400 });
    }

    const settings = settingsData[0];
    const botToken = settings.telegram_bot_token;
    const chatId = settings.telegram_chat_id;

    if (!botToken || !chatId) {
      await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
        status: 'failed',
        error_message: 'Telegram bot token or chat ID not configured',
        completed_at: new Date().toISOString()
      });
      return Response.json({ error: 'Telegram credentials missing' }, { status: 400 });
    }

    const rows = job.params?.rows || [];
    const totalItems = rows.length;
    let sentCount = job.success_count || 0;
    let failedCount = job.failed_count || 0;
    const failedItems = job.result?.failedItems || [];
    let processedCount = job.processed_count || 0;

    // Parse checkpoint to know where we left off
    let checkpoint = null;
    if (job.checkpoint_json) {
      try {
        checkpoint = JSON.parse(job.checkpoint_json);
      } catch (e) {
        console.log('[Checkpoint] Failed to parse checkpoint');
      }
    }

    // Group items by supplier
    const groupedBySupplier = {};
    rows.forEach(item => {
      const supplier = item.supplier || 'Unassigned';
      if (!groupedBySupplier[supplier]) {
        groupedBySupplier[supplier] = [];
      }
      groupedBySupplier[supplier].push(item);
    });

    // Process each supplier group
    for (const [supplier, items] of Object.entries(groupedBySupplier)) {
      // Skip suppliers that were already fully processed
      if (checkpoint && checkpoint.completedSuppliers && checkpoint.completedSuppliers.includes(supplier)) {
        continue;
      }
      try {
        // Calculate supplier summary
        const totalSkus = items.length;
        const totalQty = items.reduce((sum, item) => sum + (item.toBuy || 0), 0);
        const totalCost = items.reduce((sum, item) => sum + ((item.toBuy || 0) * (item.unitCost || 0)), 0);

        // Send supplier header message
        const headerCaption = `📦 *${supplier}*\n${totalSkus} SKUs | ${totalQty} items | $${totalCost.toFixed(2)}`;

        const headerResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: headerCaption,
            parse_mode: 'Markdown'
          })
        });

        if (!headerResponse.ok) {
          throw new Error(`Failed to send supplier header: ${headerResponse.statusText}`);
        }

        sentCount++;
        processedCount++;
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Send each item under this supplier
        let itemIndex = 0;
        for (const item of items) {
          // Skip items already processed in this supplier (for resume)
          if (checkpoint && checkpoint.lastProcessedSupplier === supplier && itemIndex < (checkpoint.lastProcessedItemIndex || 0)) {
            itemIndex++;
            continue;
          }

          try {
            const itemCaption = `SKU: \`${item.sku || 'N/A'}\`\nProduct: ${item.product || 'N/A'}\nQty: ${item.toBuy}\nUnit Cost: $${(item.unitCost || 0).toFixed(2)}\nEst. Total: $${((item.toBuy || 0) * (item.unitCost || 0)).toFixed(2)}`;

            // Try to send photo if URL exists, otherwise send text message
            if (item.imageUrl && item.imageUrl.trim().length > 0) {
              const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  photo: item.imageUrl,
                  caption: itemCaption,
                  parse_mode: 'Markdown'
                })
              });

              if (!response.ok) {
                throw new Error(`Telegram API error: ${response.statusText}`);
              }
            } else {
              const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: itemCaption,
                  parse_mode: 'Markdown'
                })
              });

              if (!response.ok) {
                throw new Error(`Telegram API error: ${response.statusText}`);
              }
            }

            sentCount++;
            processedCount++;
            await new Promise(resolve => setTimeout(resolve, 3000));

          } catch (itemError) {
            console.error(`[Telegram Export] Failed to send item ${item.sku}:`, itemError);
            failedCount++;
            processedCount++;
            
            // Log detailed failure information
            const failureLog = {
              sku_code: item.sku,
              product: item.product,
              supplier: supplier,
              error_message: itemError.message,
              failed_at: new Date().toISOString(),
              item_index: itemIndex,
              image_url: item.imageUrl || 'N/A'
            };
            
            failedItems.push(failureLog);
            console.error('[Telegram Export] Detailed failure log:', JSON.stringify(failureLog));
          }

          itemIndex++;

          // Update job progress and checkpoint every 5 items
          if (itemIndex % 5 === 0) {
            const progress = Math.round((processedCount / totalItems) * 100);
            const checkpointData = {
              lastProcessedSupplier: supplier,
              lastProcessedItemIndex: itemIndex,
              completedSuppliers: checkpoint?.completedSuppliers || []
            };
            
            await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
              processed_count: processedCount,
              success_count: sentCount,
              failed_count: failedCount,
              progress_percent: progress,
              checkpoint_json: JSON.stringify(checkpointData),
              result: {
                totalItems,
                sentCount,
                failedCount,
                failedItems,
                currentSupplier: supplier,
                lastSentAt: new Date().toISOString()
              }
            }).catch(() => {});
          }
        }

        // Mark this supplier as completed
        checkpoint = checkpoint || { completedSuppliers: [] };
        if (!checkpoint.completedSuppliers) checkpoint.completedSuppliers = [];
        checkpoint.completedSuppliers.push(supplier);
        
        await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
          checkpoint_json: JSON.stringify(checkpoint)
        }).catch(() => {});
        
        // Wait 10 seconds between supplier batches with heartbeats
        const remainingSuppliers = Object.keys(groupedBySupplier).filter(s => 
          !checkpoint.completedSuppliers.includes(s)
        );
        
        if (remainingSuppliers.length > 0) {
          console.log(`[Telegram Export] Completed supplier: ${supplier}. Waiting 10 seconds before next supplier...`);
          await new Promise(resolve => setTimeout(resolve, 10000));
          
          // Send heartbeat after wait
          await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
            last_heartbeat_at: new Date().toISOString()
          }).catch(() => {});
        }

      } catch (supplierError) {
        console.error(`[Telegram Export] Failed to send supplier header ${supplier}:`, supplierError);
        failedCount++;
        processedCount++;
        
        // Mark all items in this supplier as failed with detailed logging
        items.forEach((item, idx) => {
          const failureLog = {
            sku_code: item.sku,
            product: item.product,
            supplier: supplier,
            error_message: `Supplier header failed: ${supplierError.message}`,
            failed_at: new Date().toISOString(),
            item_index: idx,
            reason: 'supplier_header_failure'
          };
          failedItems.push(failureLog);
        });
        
        console.error(`[Telegram Export] Marked ${items.length} items as failed for supplier: ${supplier}`);
      }
    }

    // Mark job as complete only if all items were processed
    clearInterval(heartbeatInterval);
    
    const finalStatus = sentCount === totalItems ? 'completed' : 'failed';
    
    await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
      status: finalStatus,
      processed_count: totalItems,
      success_count: sentCount,
      failed_count: failedCount,
      progress_percent: 100,
      completed_at: new Date().toISOString(),
      checkpoint_json: finalStatus === 'failed' ? job.checkpoint_json : null, // Keep checkpoint if failed for resume
      can_resume: finalStatus === 'failed' && sentCount < totalItems,
      result: {
        totalItems,
        sentCount,
        failedCount,
        failedItems
      }
    });

    return Response.json({
      success: true,
      jobId,
      totalItems,
      sentCount,
      failedCount
    });

  } catch (error) {
    console.error('[Telegram Export Queue] Error:', error);
    clearInterval(heartbeatInterval);
    
    // Save error and make job resumable
    await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
      status: 'failed',
      error_message: error.message,
      completed_at: new Date().toISOString(),
      can_resume: true
    }).catch(() => {});
    
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});