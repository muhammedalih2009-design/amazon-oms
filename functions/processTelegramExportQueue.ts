import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

const DELAY_BETWEEN_MESSAGES_MS = 600;
const PAUSE_EVERY_N_ITEMS = 25;
const PAUSE_DURATION_MS = 2000;
const DEBUG_ITEMS_COUNT = 3;
const MIN_IMAGE_SIZE_BYTES = 1024; // 1KB minimum
const FETCH_TIMEOUT_MS = 10000;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB max

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

function normalizeImageUrl(rawUrl) {
  if (!rawUrl) return null;
  
  const trimmed = String(rawUrl).trim();
  
  // Reject invalid values
  if (!trimmed || 
      trimmed === 'null' || 
      trimmed === 'undefined' || 
      trimmed.length < 5) {
    return null;
  }
  
  // Decode if accidentally escaped
  try {
    const decoded = decodeURIComponent(trimmed);
    return decoded;
  } catch {
    return trimmed;
  }
}

function isBase44PrivateFile(url) {
  return url.includes('storage.googleapis.com') || 
         url.includes('base44.com/files/') ||
         url.includes('base44-storage') ||
         url.startsWith('/files/') ||
         (!url.startsWith('http://') && !url.startsWith('https://'));
}

function extractFileUriForSigning(url) {
  // Handle Google Storage URLs
  if (url.includes('storage.googleapis.com')) {
    const match = url.match(/\/o\/([^?]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  
  // Handle /files/ paths
  if (url.startsWith('/files/')) {
    return url;
  }
  
  // Handle base44 storage references
  if (url.includes('base44-storage')) {
    const match = url.match(/base44-storage\/([^?]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  
  // Return as-is if nothing matched
  return url;
}

async function resolvePublicImageBytes(imageUrl, base44, sku, debugMode = false) {
  const debugLog = [];
  
  const normalized = normalizeImageUrl(imageUrl);
  if (!normalized) {
    debugLog.push('Invalid or empty imageUrl');
    return { success: false, debugLog, reason: 'Invalid URL', strategy: 'none' };
  }

  try {
    const isPrivate = isBase44PrivateFile(normalized);
    let fetchUrl = normalized;
    let strategy = isPrivate ? 'signed-url' : 'direct';

    if (isPrivate) {
      debugLog.push(`Private file detected: ${normalized.substring(0, 60)}...`);
      
      try {
        const fileUri = extractFileUriForSigning(normalized);
        debugLog.push(`Extracted file URI: ${fileUri.substring(0, 60)}...`);
        
        const signedResponse = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
          file_uri: fileUri,
          expires_in: 600
        });
        
        if (signedResponse?.signed_url) {
          fetchUrl = signedResponse.signed_url;
          debugLog.push(`✓ Generated signed URL (10min TTL)`);
        } else {
          debugLog.push(`✗ No signed_url in response`);
          return { success: false, debugLog, reason: 'Signed URL generation returned empty', strategy };
        }
      } catch (signError) {
        debugLog.push(`✗ Signed URL failed: ${signError.message}`);
        return { success: false, debugLog, reason: `Signed URL error: ${signError.message}`, strategy };
      }
    } else {
      debugLog.push(`Public URL: ${normalized.substring(0, 60)}...`);
    }

    // Fetch with timeout and size limit
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const imageResponse = await fetch(fetchUrl, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TelegramBot/1.0)'
        }
      });

      clearTimeout(timeoutId);
      debugLog.push(`HTTP ${imageResponse.status}`);

      if (!imageResponse.ok) {
        return { 
          success: false, 
          debugLog, 
          reason: `HTTP ${imageResponse.status}`,
          strategy
        };
      }

      const contentType = imageResponse.headers.get('content-type') || '';
      debugLog.push(`Content-Type: ${contentType}`);

      // Validate image content-type
      const validImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      const isValidImage = validImageTypes.some(type => contentType.includes(type)) || 
                          contentType.startsWith('image/');
      
      if (!isValidImage) {
        return { 
          success: false, 
          debugLog, 
          reason: `Not an image (${contentType})`,
          strategy
        };
      }

      const imageBuffer = await imageResponse.arrayBuffer();
      const sizeBytes = imageBuffer.byteLength;
      const sizeKB = Math.round(sizeBytes / 1024);
      debugLog.push(`Size: ${sizeKB} KB`);

      // Validate size bounds
      if (sizeBytes < MIN_IMAGE_SIZE_BYTES) {
        return { 
          success: false, 
          debugLog, 
          reason: `Too small (${sizeKB} KB < 1KB)`,
          strategy
        };
      }

      if (sizeBytes > MAX_IMAGE_SIZE_BYTES) {
        return { 
          success: false, 
          debugLog, 
          reason: `Too large (${sizeKB} KB > 10MB)`,
          strategy
        };
      }

      const imageBytes = new Uint8Array(imageBuffer);
      const ext = contentType.includes('png') ? 'png' : 
                  contentType.includes('gif') ? 'gif' : 
                  contentType.includes('webp') ? 'webp' : 'jpg';

      return {
        success: true,
        buffer: imageBytes,
        mime: contentType,
        filename: `${sku || 'product'}.${ext}`,
        debugLog,
        sizeKB,
        strategy
      };

    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        debugLog.push(`✗ Timeout after ${FETCH_TIMEOUT_MS}ms`);
        return { success: false, debugLog, reason: 'Fetch timeout', strategy };
      }
      
      throw fetchError;
    }

  } catch (error) {
    debugLog.push(`✗ Error: ${error.message}`);
    return { 
      success: false, 
      debugLog, 
      reason: error.message,
      strategy: 'error'
    };
  }
}

async function sendTelegramPhotoByUrl(imageUrl, caption) {
  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  
  const response = await fetch(telegramUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      photo: imageUrl,
      caption,
      parse_mode: 'HTML'
    })
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
}

async function sendTelegramPhotoByBytes(imageBytes, mime, filename, caption) {
  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  
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
    let debugCounter = 0;
    let photoSentCount = 0;
    let textFallbackCount = 0;

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

        const isDebugItem = debugCounter < DEBUG_ITEMS_COUNT;
        if (isDebugItem) debugCounter++;

        let success = false;
        let retryCount = 0;
        const maxRetries = 3;
        const attemptLog = [];

        while (!success && retryCount < maxRetries) {
          try {
            if (item.imageUrl) {
              const normalized = normalizeImageUrl(item.imageUrl);
              
              if (!normalized) {
                // Invalid URL, send as text
                await sendTelegramMessage(`${fullCaption}\n\n<i>(No valid image URL)</i>`);
                success = true;
                sentCount++;
                textFallbackCount++;
                attemptLog.push('Invalid URL, sent as text');
                break;
              }

              // ATTEMPT A: Send photo by URL (Telegram fetches)
              try {
                await sendTelegramPhotoByUrl(normalized, fullCaption);
                success = true;
                sentCount++;
                photoSentCount++;
                attemptLog.push('✓ Method A: Telegram URL fetch');
                
                if (isDebugItem) {
                  console.log(`=== DEBUG ${debugCounter}/${DEBUG_ITEMS_COUNT} (${item.sku}) ===`);
                  console.log(`URL: ${normalized.substring(0, 80)}`);
                  console.log(`Result: Photo sent via URL`);
                }
                break;
              } catch (urlError) {
                attemptLog.push(`✗ Method A failed: ${urlError.message}`);
                
                // ATTEMPT B: Fetch bytes and send multipart
                const imageResult = await resolvePublicImageBytes(
                  normalized, 
                  base44, 
                  item.sku,
                  isDebugItem
                );

                if (isDebugItem) {
                  console.log(`=== DEBUG ${debugCounter}/${DEBUG_ITEMS_COUNT} (${item.sku}) ===`);
                  console.log(`URL: ${normalized.substring(0, 80)}`);
                  console.log(`Method A: ${urlError.message}`);
                  console.log(`Method B:`, imageResult.debugLog.join(' | '));
                }

                if (imageResult.success) {
                  await sendTelegramPhotoByBytes(
                    imageResult.buffer,
                    imageResult.mime,
                    imageResult.filename,
                    fullCaption
                  );
                  success = true;
                  sentCount++;
                  photoSentCount++;
                  attemptLog.push(`✓ Method B: Server fetch (${imageResult.strategy}, ${imageResult.sizeKB}KB)`);
                  
                  if (isDebugItem) {
                    console.log(`Result: Photo sent via bytes (${imageResult.sizeKB}KB)`);
                  }
                  break;
                } else {
                  attemptLog.push(`✗ Method B failed: ${imageResult.reason}`);
                  
                  // ATTEMPT C: Text fallback
                  await sendTelegramMessage(`${fullCaption}\n\n<i>(Image unavailable)</i>`);
                  success = true;
                  sentCount++;
                  textFallbackCount++;
                  attemptLog.push('✓ Method C: Text fallback');
                  
                  failedLog.push({
                    sku: item.sku,
                    product: item.product,
                    supplier: supplierName,
                    imageUrl: normalized,
                    strategy: imageResult.strategy,
                    attemptA: urlError.message,
                    attemptB: imageResult.reason,
                    debugLog: isDebugItem ? imageResult.debugLog : undefined
                  });
                  
                  if (isDebugItem) {
                    console.log(`Result: Text fallback - A: ${urlError.message}, B: ${imageResult.reason}`);
                  }
                }
              }
            } else {
              // No image URL provided
              await sendTelegramMessage(`${fullCaption}\n\n<i>(No image available)</i>`);
              success = true;
              sentCount++;
              textFallbackCount++;
              attemptLog.push('No imageUrl provided');
              
              if (isDebugItem) {
                console.log(`=== DEBUG ${debugCounter}/${DEBUG_ITEMS_COUNT} (${item.sku}) ===`);
                console.log(`Result: No imageUrl field`);
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

            // Hard failure after max retries
            if (retryCount === maxRetries) {
              try {
                await sendTelegramMessage(`${fullCaption}\n\n<i>(Send failed)</i>`);
                success = true;
                sentCount++;
                textFallbackCount++;
                
                failedLog.push({
                  sku: item.sku,
                  product: item.product,
                  supplier: supplierName,
                  imageUrl: item.imageUrl || 'N/A',
                  attempts: attemptLog,
                  finalError: error.message
                });
              } catch (fallbackError) {
                console.error('Complete failure:', fallbackError);
                failedCount++;
                failedLog.push({
                  sku: item.sku,
                  product: item.product,
                  supplier: supplierName,
                  imageUrl: item.imageUrl || 'N/A',
                  attempts: attemptLog,
                  completeFailure: fallbackError.message
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
      failedItems: failedCount,
      photoSentCount,
      textFallbackCount
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