import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * List background jobs - Platform Admin only
 * Used by BackgroundJobManager component
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      console.error('[listBackgroundJobs] No authenticated user');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // SECURITY: Platform Admin only
    const isPlatformAdmin = user.email?.toLowerCase() === 'muhammedalih.2009@gmail.com';
    
    if (!isPlatformAdmin) {
      console.warn('[listBackgroundJobs] Access denied for user:', user.email);
      return Response.json({ 
        error: 'Access denied. This endpoint is for platform administrators only.' 
      }, { status: 403 });
    }

    console.log('[listBackgroundJobs] Fetching jobs for platform admin:', user.email);

    // Fetch all active jobs across all workspaces
    const activeJobs = await base44.asServiceRole.entities.BackgroundJob.filter(
      {
        status: { $in: ['queued', 'running', 'throttled', 'paused', 'cancelling'] }
      },
      '-created_date',
      50
    );

    console.log(`[listBackgroundJobs] Found ${activeJobs.length} active jobs`);

    return Response.json({
      ok: true,
      jobs: activeJobs,
      count: activeJobs.length
    });
  } catch (error) {
    console.error('[listBackgroundJobs] Error:', error);
    return Response.json({ 
      error: error.message || 'Failed to fetch jobs' 
    }, { status: 500 });
  }
});