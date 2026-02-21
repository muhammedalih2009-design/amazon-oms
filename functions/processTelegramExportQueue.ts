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

    // Process each item
    for (let i = 0; i < rows.length; i++) {
      const item = rows[i];
      
      try {
        // Build caption with supplier grouping
        const caption = `
📦 *${item.supplier || 'Unassigned'}*

SKU: \`${item.sku || 'N/A'}\`
Product: ${item.product || 'N/A'}
Qty: ${item.toBuy}
Unit Cost: $${(item.unitCost || 0).toFixed(2)}
Est. Total: $${((item.toBuy || 0) * (item.unitCost || 0)).toFixed(2)}
        `.trim();

        // Try to send photo if URL exists, otherwise send text message
        if (item.imageUrl && item.imageUrl.trim().length > 0) {
          const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              photo: item.imageUrl,
              caption: caption,
              parse_mode: 'Markdown'
            })
          });

          if (!response.ok) {
            throw new Error(`Telegram API error: ${response.statusText}`);
          }

          sentCount++;
        } else {
          // Send text message if no image
          const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: caption,
              parse_mode: 'Markdown'
            })
          });

          if (!response.ok) {
            throw new Error(`Telegram API error: ${response.statusText}`);
          }

          sentCount++;
        }

        // Rate limiting - 100ms between messages to avoid Telegram throttling
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (itemError) {
        console.error(`[Telegram Export] Failed to send item ${i + 1}:`, itemError);
        failedCount++;
        failedItems.push({
          sku_code: item.sku,
          product: item.product,
          error_message: itemError.message
        });
      }

      // Update job progress
      const progress = Math.round(((i + 1) / totalItems) * 100);
      await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
        processed_count: i + 1,
        success_count: sentCount,
        failed_count: failedCount,
        progress_percent: progress
      }).catch(() => {});
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