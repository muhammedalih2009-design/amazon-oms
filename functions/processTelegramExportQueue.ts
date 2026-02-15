import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

const DELAY_BETWEEN_MESSAGES_MS = 600;
const PAUSE_EVERY_N_ITEMS = 25;
const PAUSE_DURATION_MS = 2000;

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML'
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Telegram API error: ${error.description || response.statusText}`);
  }

  return response.json();
}

async function sendTelegramPhoto(photoUrl, caption) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  
  try {
    // Download image
    const imageResponse = await fetch(photoUrl);
    if (!imageResponse.ok) {
      throw new Error('Failed to download image');
    }
    
    const imageBlob = await imageResponse.blob();
    
    // Send as multipart form data
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('photo', imageBlob, 'product.jpg');
    formData.append('caption', caption);
    
    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      if (error.error_code === 429) {
        // Rate limit hit
        const retryAfter = error.parameters?.retry_after || 30;
        throw new Error(`RATE_LIMIT:${retryAfter}`);
      }
      throw new Error(`Telegram API error: ${error.description || response.statusText}`);
    }

    return response.json();
  } catch (error) {
    if (error.message.startsWith('RATE_LIMIT:')) {
      throw error;
    }
    // If image fails, fall back to text
    throw new Error(`Image upload failed: ${error.message}`);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { jobId } = await req.json();

    if (!jobId) {
      return Response.json({ error: 'Missing jobId' }, { status: 400 });
    }

    // Get job
    const jobs = await base44.asServiceRole.entities.TelegramExportJob.filter({ id: jobId });
    if (!jobs || jobs.length === 0) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    let job = jobs[0];

    // Check if already processing or completed
    if (job.status === 'completed') {
      return Response.json({ success: true, message: 'Job already completed' });
    }

    // Update to processing
    await base44.asServiceRole.entities.TelegramExportJob.update(jobId, {
      status: 'processing'
    });

    // Parse rows
    const rows = JSON.parse(job.rows_data);

    // Group by supplier
    const groupedBySupplier = {};
    rows.forEach(item => {
      const supplier = item.supplier || 'Unassigned';
      if (!groupedBySupplier[supplier]) groupedBySupplier[supplier] = [];
      groupedBySupplier[supplier].push(item);
    });

    const supplierNames = Object.keys(groupedBySupplier).sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b, 'en', { sensitivity: 'base' });
    });

    let sentCount = job.sent_items;
    let failedCount = job.failed_items;
    const failedLog = job.failed_items_log || [];
    let currentIndex = job.current_index;
    let globalIndex = 0;

    // Process each supplier
    for (const supplierName of supplierNames) {
      const items = groupedBySupplier[supplierName];

      // Update current supplier
      await base44.asServiceRole.entities.TelegramExportJob.update(jobId, {
        current_supplier: supplierName
      });

      // Send supplier header
      try {
        const supplierTotal = items.reduce((sum, item) => sum + (item.toBuy * item.unitCost), 0);
        const headerText = `<b>📦 ${supplierName}</b>\n${items.length} SKUs | ${items.reduce((s, i) => s + i.toBuy, 0)} items | $${supplierTotal.toFixed(2)}`;
        await sendTelegramMessage(headerText);
        await sleep(DELAY_BETWEEN_MESSAGES_MS);
      } catch (error) {
        console.error('Failed to send supplier header:', error);
      }

      // Send each item
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        globalIndex++;

        // Skip if already sent (resume logic)
        if (globalIndex <= currentIndex) {
          continue;
        }

        const caption = `<b>SKU:</b> ${item.sku || 'N/A'}\n<b>Qty:</b> ${item.toBuy}\n<b>Unit Cost:</b> $${(item.unitCost || 0).toFixed(2)}`;

        let success = false;
        let retryCount = 0;
        const maxRetries = 3;

        while (!success && retryCount < maxRetries) {
          try {
            if (item.imageUrl) {
              await sendTelegramPhoto(item.imageUrl, caption);
            } else {
              await sendTelegramMessage(caption);
            }
            success = true;
            sentCount++;

            // Update progress every 5 items
            if (sentCount % 5 === 0) {
              await base44.asServiceRole.entities.TelegramExportJob.update(jobId, {
                sent_items: sentCount,
                current_index: globalIndex
              });
            }

          } catch (error) {
            retryCount++;

            // Handle rate limit
            if (error.message.startsWith('RATE_LIMIT:')) {
              const retryAfter = parseInt(error.message.split(':')[1]);
              console.log(`Rate limit hit, waiting ${retryAfter}s`);
              await sleep(retryAfter * 1000);
              continue;
            }

            // If image failed, try text fallback on last retry
            if (retryCount === maxRetries && item.imageUrl) {
              try {
                await sendTelegramMessage(`${caption}\n\n<i>(Image failed to load)</i>`);
                success = true;
                sentCount++;
              } catch (fallbackError) {
                console.error('Fallback message also failed:', fallbackError);
              }
            }

            if (retryCount >= maxRetries) {
              failedCount++;
              failedLog.push({
                sku: item.sku,
                product: item.product,
                supplier: supplierName,
                reason: error.message
              });
            }
          }
        }

        // Rate limiting
        await sleep(DELAY_BETWEEN_MESSAGES_MS);

        // Extra pause every N items
        if (sentCount % PAUSE_EVERY_N_ITEMS === 0) {
          await sleep(PAUSE_DURATION_MS);
        }
      }
    }

    // Final update
    await base44.asServiceRole.entities.TelegramExportJob.update(jobId, {
      status: 'completed',
      sent_items: sentCount,
      failed_items: failedCount,
      failed_items_log: failedLog,
      completed_at: new Date().toISOString()
    });

    return Response.json({ 
      success: true,
      sentItems: sentCount,
      failedItems: failedCount
    });

  } catch (error) {
    console.error('Process telegram export queue error:', error);

    // Try to update job status to failed
    try {
      const { jobId } = await req.json();
      if (jobId) {
        await base44.asServiceRole.entities.TelegramExportJob.update(jobId, {
          status: 'failed'
        });
      }
    } catch (updateError) {
      console.error('Failed to update job status:', updateError);
    }

    return Response.json({ error: error.message }, { status: 500 });
  }
});