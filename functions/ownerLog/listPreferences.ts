import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Strict owner-only check
    if (!user || user.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
      return Response.json({ error: 'Forbidden: Owner access only' }, { status: 403 });
    }

    const preferences = await base44.asServiceRole.entities.OwnerPreference.filter({}, '-pinned,-updated_date');

    return Response.json({ preferences });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});