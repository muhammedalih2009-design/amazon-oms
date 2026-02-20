/**
 * Shared cancellation check for long-running jobs
 * Call this inside loops to allow Force Stop to work
 * 
 * Usage:
 *   const cancelled = await checkCancellation(base44, jobId, entityName);
 *   if (cancelled) {
 *     await finalizeJob(base44, jobId, entityName, 'cancelled');
 *     return Response.json({ ok: true, cancelled: true });
 *   }
 */

export async function checkCancellation(base44, jobId, entityName) {
  if (!jobId || !entityName) return false;
  
  try {
    const job = await base44.asServiceRole.entities[entityName].get(jobId);
    
    if (!job) return false;
    
    // Check for cancellation request
    if (job.status === 'cancelling' || job.cancel_requested === true) {
      console.log(`🛑 Cancellation detected for ${entityName} ${jobId}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`Error checking cancellation for ${jobId}:`, error);
    return false;
  }
}

export async function finalizeJob(base44, jobId, entityName, finalStatus = 'cancelled') {
  try {
    await base44.asServiceRole.entities[entityName].update(jobId, {
      status: finalStatus,
      finished_at: new Date().toISOString(),
      progress: {
        message: finalStatus === 'cancelled' ? 'Job cancelled by user' : 'Job completed',
        cancelled: finalStatus === 'cancelled'
      }
    });
  } catch (error) {
    console.error(`Error finalizing job ${jobId}:`, error);
  }
}