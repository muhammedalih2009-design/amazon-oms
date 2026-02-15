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

async function resolvePublicImageBytes(imageUrl, base44, sku, debugMode = false) {
  const debugLog = [];
  
  if (!imageUrl) {
    debugLog.push('No imageUrl provided');
    return { success: false, debugLog, reason: 'No image URL' };
  }

  try {
    // Check if it's a Base44 private file URL (needs signed URL)
    const isBase44File = imageUrl.includes('storage.googleapis.com') || 
                         imageUrl.includes('base44.com/files/') ||
                         imageUrl.startsWith('/files/') ||
                         !imageUrl.startsWith('http');

    let fetchUrl = imageUrl;

    if (isBase44File) {
      debugLog.push(`Detected Base44 file: ${imageUrl.substring(0, 60)}...`);
      
      // Try to generate signed URL if it's a storage path
      try {
        // Extract file path from URL
        let filePath = imageUrl;
        if (imageUrl.includes('storage.googleapis.com')) {
          const match = imageUrl.match(/\/([^?]+)/);
          filePath = match ? match[1] : imageUrl;
        }
        
        // Generate signed URL with 10 min TTL
        const signedResponse = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
          file_uri: filePath,
          expires_in: 600
        });
        
        if (signedResponse?.signed_url) {
          fetchUrl = signedResponse.signed_url;
          debugLog.push(`Generated signed URL (600s TTL)`);
        }
      } catch (signError) {
        debugLog.push(`Signed URL generation failed: ${signError.message}`);
        // Continue with original URL as fallback
      }
    }

    debugLog.push(`Fetching: ${fetchUrl.substring(0, 80)}...`);

    // Fetch image with redirects
    const imageResponse = await fetch(fetchUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'TelegramBot/1.0'
      }
    });

    debugLog.push(`Fetch status: ${imageResponse.status}`);

    if (!imageResponse.ok) {
      return { 
        success: false, 
        debugLog, 
        reason: `HTTP ${imageResponse.status}` 
      };
    }

    const contentType = imageResponse.headers.get('content-type') || '';
    debugLog.push(`Content-Type: ${contentType}`);

    // Validate it's actually an image
    if (!contentType.startsWith('image/')) {
      return { 
        success: false, 
        debugLog, 
        reason: `Not an image (${contentType})` 
      };
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const sizeKB = Math.round(imageBuffer.byteLength / 1024);
    debugLog.push(`Size: ${sizeKB} KB`);

    // Check minimum size (avoid broken images)
    if (imageBuffer.byteLength < 2048) {
      return { 
        success: false, 
        debugLog, 
        reason: `Too small (${sizeKB} KB)` 
      };
    }

    const imageBytes = new Uint8Array(imageBuffer);
    const ext = contentType.includes('png') ? 'png' : 
                contentType.includes('gif') ? 'gif' : 'jpg';

    return {
      success: true,
      buffer: imageBytes,
      mime: contentType,
      filename: `${sku || 'product'}.${ext}`,
      debugLog,
      sizeKB
    };

  } catch (error) {
    debugLog.push(`Error: ${error.message}`);
    return { 
      success: false, 
      debugLog, 
      reason: error.message 
    };
  }
}

async function sendTelegramPhoto(imageBytes, mime, filename, caption) {
  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  
  try {
    const blob = new Blob([imageBytes], { type: mime });
    
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('photo', blob, filename);
    formData.append('caption', caption);
    formData.append('parse_mode', 'HTML');
    
    const response = await fetch(telegramUrl, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      if (error.error_code === 429) {
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
    throw new Error(`Photo upload failed: ${error.message}`);
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
    const debugMode = true; // Enable debug for first 5 items
    let debugCounter = 0;

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
        const productName = item.product ? `\n<b>Product:</b> ${item.product.substring(0, 50)}${item.product.length > 50 ? '...' : ''}` : '';
        const fullCaption = `${caption}${productName}`;

        const isDebugItem = debugMode && debugCounter < 5;
        if (isDebugItem) debugCounter++;

        let success = false;
        let retryCount = 0;
        const maxRetries = 3;

        while (!success && retryCount < maxRetries) {
          try {
            if (item.imageUrl) {
              // Resolve image bytes with signed URL support
              const imageResult = await resolvePublicImageBytes(
                item.imageUrl, 
                base44, 
                item.sku,
                isDebugItem
              );

              if (isDebugItem) {
                console.log(`=== DEBUG ITEM ${debugCounter} (${item.sku}) ===`);
                console.log(`Image URL: ${item.imageUrl}`);
                console.log(`Debug log:`, imageResult.debugLog);
                console.log(`Success: ${imageResult.success}`);
              }

              if (imageResult.success) {
                // Send as photo
                await sendTelegramPhoto(
                  imageResult.buffer,
                  imageResult.mime,
                  imageResult.filename,
                  fullCaption
                );
                success = true;
                sentCount++;

                if (isDebugItem) {
                  console.log(`✓ Sent as photo (${imageResult.sizeKB} KB)`);
                }
              } else {
                // Image resolution failed, send as text
                await sendTelegramMessage(`${fullCaption}\n\n<i>(Image unavailable: ${imageResult.reason})</i>`);
                success = true;
                sentCount++;

                failedLog.push({
                  sku: item.sku,
                  product: item.product,
                  supplier: supplierName,
                  reason: `Image failed: ${imageResult.reason}`,
                  debugLog: isDebugItem ? imageResult.debugLog : undefined
                });

                if (isDebugItem) {
                  console.log(`✗ Sent as text, reason: ${imageResult.reason}`);
                }
              }
            } else {
              // No image URL, send text only
              await sendTelegramMessage(`${fullCaption}\n\n<i>(No image available)</i>`);
              success = true;
              sentCount++;

              if (isDebugItem) {
                console.log(`✗ No imageUrl provided, sent as text`);
              }
            }

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

            // If failed and it's last retry, try text fallback
            if (retryCount === maxRetries) {
              try {
                await sendTelegramMessage(`${fullCaption}\n\n<i>(Send failed: ${error.message})</i>`);
                success = true;
                sentCount++;
                
                failedLog.push({
                  sku: item.sku,
                  product: item.product,
                  supplier: supplierName,
                  reason: `Send failed, sent as text: ${error.message}`
                });
              } catch (fallbackError) {
                console.error('Fallback message also failed:', fallbackError);
                failedCount++;
                failedLog.push({
                  sku: item.sku,
                  product: item.product,
                  supplier: supplierName,
                  reason: `Complete failure: ${fallbackError.message}`
                });
              }
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