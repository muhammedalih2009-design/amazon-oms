import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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

    // Generate unique job ID using Web Crypto API
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const jobId = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

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