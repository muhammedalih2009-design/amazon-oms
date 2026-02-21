import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
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
      started_at: new Date().toISOString()
    });

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
    let sentCount = 0;
    let failedCount = 0;
    const failedItems = [];
    let processedCount = 0;

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
        await new Promise(resolve => setTimeout(resolve, 100));

        // Send each item under this supplier
        for (const item of items) {
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
            await new Promise(resolve => setTimeout(resolve, 100));

          } catch (itemError) {
            console.error(`[Telegram Export] Failed to send item ${item.sku}:`, itemError);
            failedCount++;
            processedCount++;
            failedItems.push({
              sku_code: item.sku,
              product: item.product,
              supplier: supplier,
              error_message: itemError.message
            });
          }

          // Update job progress
          const progress = Math.round((processedCount / totalItems) * 100);
          await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
            processed_count: processedCount,
            success_count: sentCount,
            failed_count: failedCount,
            progress_percent: progress
          }).catch(() => {});
        }

      } catch (supplierError) {
        console.error(`[Telegram Export] Failed to send supplier header ${supplier}:`, supplierError);
        failedCount++;
        processedCount++;
        
        // Mark all items in this supplier as failed
        items.forEach(item => {
          failedItems.push({
            sku_code: item.sku,
            product: item.product,
            supplier: supplier,
            error_message: supplierError.message
          });
        });
      }
    }

    // Mark job as complete
    await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
      status: 'completed',
      processed_count: totalItems,
      success_count: sentCount,
      failed_count: failedCount,
      progress_percent: 100,
      completed_at: new Date().toISOString(),
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
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});