import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Support both GET and POST methods
    let jobId;
    if (req.method === 'GET') {
      const url = new URL(req.url);
      jobId = url.searchParams.get('jobId');
    } else if (req.method === 'POST') {
      const body = await req.json();
      jobId = body.jobId;
    } else {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    if (!jobId) {
      return Response.json({ error: 'jobId required' }, { status: 400 });
    }

    // Fetch print job
    const jobs = await base44.asServiceRole.entities.PrintJob.filter({
      job_id: jobId
    });

    if (jobs.length === 0) {
      return Response.json({ error: 'Print job not found' }, { status: 404 });
    }

    const job = jobs[0];

    // Check expiration
    if (new Date(job.expires_at) < new Date()) {
      return Response.json({ error: 'Print job expired' }, { status: 410 });
    }

    return Response.json({ payload: job.payload });
  } catch (error) {
    console.error('Get print job error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});