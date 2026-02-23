import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let heartbeatInterval = null;
  let jobId = null;

  try {
    const payload = await req.json();
    jobId = payload.jobId;
    const tenantId = payload.tenantId;
    const resumeFromCheckpoint = payload.resumeFromCheckpoint;

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

    // Heartbeat sender - sends every 5 seconds to prevent timeout
    heartbeatInterval = setInterval(async () => {
      try {
        await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
          last_heartbeat_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      } catch (err) {
        console.error('[Heartbeat] Failed to send heartbeat:', err);
      }
    }, 5000);

    // Get workspace settings for Telegram credentials
    const settingsData = await base44.asServiceRole.entities.WorkspaceSettings.filter({
      workspace_id: tenantId
    });

    if (!settingsData || settingsData.length === 0) {
      clearInterval(heartbeatInterval);
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
      clearInterval(heartbeatInterval);
      await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
        status: 'failed',
        error_message: 'Telegram bot token or chat ID not configured',
        completed_at: new Date().toISOString()
      });
      return Response.json({ error: 'Telegram credentials missing' }, { status: 400 });
    }

    console.log('[Telegram Export] Using bot token and chat ID from WorkspaceSettings');

    // Check if this is a new job or resume
    const existingItems = await base44.asServiceRole.entities.TelegramExportItem.filter({
      job_id: jobId
    });

    const rows = job.params?.rows || [];
    const totalItems = rows.length;

    // If no items exist yet, create all items as pending
    if (existingItems.length === 0) {
      console.log(`[Telegram Export] Creating ${totalItems} checkpoint items...`);
      
      const itemsToCreate = rows.map((item, index) => {
        const supplier = item.supplier || 'Unassigned';
        const itemKey = `${supplier}:${item.sku || index}:${index}`;
        
        return {
          workspace_id: tenantId,
          job_id: jobId,
          supplier_id: supplier,
          item_key: itemKey,
          index,
          sku_code: item.sku || 'N/A',
          product_name: item.product || 'N/A',
          quantity: item.toBuy || 0,
          unit_cost: item.unitCost || 0,
          image_url: item.imageUrl || '',
          status: 'pending'
        };
      });

      // Bulk create all items
      await base44.asServiceRole.entities.TelegramExportItem.bulkCreate(itemsToCreate);
      console.log(`[Telegram Export] Created ${itemsToCreate.length} checkpoint items`);
    }

    // Get all pending items (resume-safe)
    const pendingItems = await base44.asServiceRole.entities.TelegramExportItem.filter({
      job_id: jobId,
      status: 'pending'
    });

    // Sort by index to maintain order
    pendingItems.sort((a, b) => a.index - b.index);

    console.log(`[Telegram Export] Starting send: ${pendingItems.length} pending items out of ${totalItems} total`);

    // Group by supplier for organized sending
    const groupedBySupplier = {};
    pendingItems.forEach(item => {
      const supplier = item.supplier_id || 'Unassigned';
      if (!groupedBySupplier[supplier]) {
        groupedBySupplier[supplier] = [];
      }
      groupedBySupplier[supplier].push(item);
    });

    let sentCount = 0;
    let failedCount = 0;
    let itemsSentInCurrentBatch = 0;

    // Get current stats from DB
    const allItems = await base44.asServiceRole.entities.TelegramExportItem.filter({ job_id: jobId });
    const alreadySent = allItems.filter(i => i.status === 'sent').length;
    const alreadyFailed = allItems.filter(i => i.status === 'failed').length;
    sentCount = alreadySent;
    failedCount = alreadyFailed;

    // Process each supplier group
    for (const [supplier, items] of Object.entries(groupedBySupplier)) {
      try {
        // Send supplier header
        const totalSkus = items.length;
        const totalQty = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
        const totalCost = items.reduce((sum, item) => sum + ((item.quantity || 0) * (item.unit_cost || 0)), 0);

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

        // Update job with current supplier
        await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
          result: {
            currentSupplier: supplier,
            lastSentAt: new Date().toISOString()
          }
        });

        await new Promise(resolve => setTimeout(resolve, 1500));

        // Send each item
        for (const item of items) {
          try {
            const itemCaption = `SKU: \`${item.sku_code}\`\nProduct: ${item.product_name}\nQty: ${item.quantity}\nUnit Cost: $${item.unit_cost.toFixed(2)}\nEst. Total: $${(item.quantity * item.unit_cost).toFixed(2)}`;

            // Send photo if URL exists, otherwise text
            if (item.image_url && item.image_url.trim().length > 0) {
              const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  photo: item.image_url,
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

            // Mark item as sent
            await base44.asServiceRole.entities.TelegramExportItem.update(item.id, {
              status: 'sent',
              sent_at: new Date().toISOString()
            });

            sentCount++;
            itemsSentInCurrentBatch++;

            // Check if we need to pause after 50 items
            if (itemsSentInCurrentBatch >= 50) {
              console.log(`[Telegram Export] Sent 50 items in batch. Pausing for 60 seconds...`);
              await new Promise(resolve => setTimeout(resolve, 60000)); // 60 seconds pause
              itemsSentInCurrentBatch = 0; // Reset batch counter
              console.log(`[Telegram Export] Resuming after 60 second pause`);
            }

            // Update job progress immediately after each send
            const progressDone = sentCount + failedCount;
            const progressPercent = Math.floor((progressDone / totalItems) * 100);
            
            await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
              progress_done: progressDone,
              progress_total: totalItems,
              progress_percent: progressPercent,
              success_count: sentCount,
              failed_count: failedCount,
              last_heartbeat_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              result: {
                currentSupplier: supplier,
                lastSentItem: item.sku_code,
                lastSentAt: new Date().toISOString(),
                totalItems,
                sentCount,
                failedCount
              }
            });

            console.log(`[Telegram Export] Sent ${sentCount}/${totalItems}: ${item.sku_code}`);

            // Wait 1 second between items
            await new Promise(resolve => setTimeout(resolve, 1000));

          } catch (itemError) {
            console.error(`[Telegram Export] Failed to send item ${item.sku_code}:`, itemError);
            
            // Mark item as failed
            await base44.asServiceRole.entities.TelegramExportItem.update(item.id, {
              status: 'failed',
              error_message: itemError.message
            });

            failedCount++;

            // Update job with failure
            const progressDone = sentCount + failedCount;
            const progressPercent = Math.floor((progressDone / totalItems) * 100);
            
            await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
              progress_done: progressDone,
              progress_total: totalItems,
              progress_percent: progressPercent,
              success_count: sentCount,
              failed_count: failedCount,
              last_heartbeat_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
          }
        }

        // Wait 10 seconds between suppliers (heartbeat runs automatically)
        const remainingSuppliers = Object.keys(groupedBySupplier).filter(s => s !== supplier);
        if (remainingSuppliers.length > 0) {
          console.log(`[Telegram Export] Completed supplier: ${supplier}. Waiting 10 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 10000));
        }

      } catch (supplierError) {
        console.error(`[Telegram Export] Failed supplier header ${supplier}:`, supplierError);
        
        // Mark all items in this supplier as failed
        for (const item of items) {
          await base44.asServiceRole.entities.TelegramExportItem.update(item.id, {
            status: 'failed',
            error_message: `Supplier header failed: ${supplierError.message}`
          });
          failedCount++;
        }
      }
    }

    // Check completion
    const finalPendingItems = await base44.asServiceRole.entities.TelegramExportItem.filter({
      job_id: jobId,
      status: 'pending'
    });

    const isComplete = finalPendingItems.length === 0;
    const finalStatus = isComplete ? 'completed' : 'failed';

    clearInterval(heartbeatInterval);
    
    await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
      status: finalStatus,
      progress_done: sentCount + failedCount,
      progress_total: totalItems,
      progress_percent: 100,
      success_count: sentCount,
      failed_count: failedCount,
      completed_at: new Date().toISOString(),
      can_resume: !isComplete,
      error_message: !isComplete ? `Stopped at ${sentCount}/${totalItems}. ${finalPendingItems.length} items pending.` : null,
      result: {
        totalItems,
        sentCount,
        failedCount,
        pendingCount: finalPendingItems.length
      }
    });

    return Response.json({
      success: isComplete,
      jobId,
      totalItems,
      sentCount,
      failedCount,
      pendingCount: finalPendingItems.length
    });

  } catch (error) {
    console.error('[Telegram Export Queue] Error:', error);
    
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    
    // Mark job as failed but resumable
    try {
      if (jobId) {
        await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
          status: 'failed',
          error_message: error.message,
          completed_at: new Date().toISOString(),
          can_resume: true
        });
      }
    } catch (e) {
      console.error('[Error] Failed to update job on error:', e);
    }
    
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});