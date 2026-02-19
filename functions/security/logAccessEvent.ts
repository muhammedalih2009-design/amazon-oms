import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * P0 SECURITY: Log workspace access events
 * Used internally by security functions and access guards
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      workspace_id,
      action,
      entity_type = 'workspace',
      entity_id,
      metadata = {}
    } = await req.json();

    if (!workspace_id || !action) {
      return Response.json({ 
        error: 'workspace_id and action required' 
      }, { status: 400 });
    }

    // Log the event
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id,
      user_id: user.id,
      user_email: user.email,
      action,
      entity_type,
      entity_id: entity_id || workspace_id,
      metadata: {
        ...metadata,
        ip_address: req.headers.get('x-forwarded-for') || 'unknown',
        user_agent: req.headers.get('user-agent') || 'unknown',
        timestamp: new Date().toISOString()
      }
    });

    return Response.json({ success: true });

  } catch (error) {
    console.error('Access event logging error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});