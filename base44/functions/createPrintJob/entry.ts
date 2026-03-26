import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function generateJobId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { tenantId, mode, dateRange, rows } = body;

    if (!tenantId || !mode || !rows) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Generate unique job ID
    const jobId = generateJobId();

    // Set expiration to 10 minutes
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    // Create print job record
    const printJob = await base44.asServiceRole.entities.PrintJob.create({
      tenant_id: tenantId,
      job_id: jobId,
      mode,
      payload: {
        mode,
        dateRange,
        generatedAt: new Date().toISOString(),
        rows
      },
      expires_at: expiresAt.toISOString()
    });

    return Response.json({ jobId });
  } catch (error) {
    console.error('Create print job error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});