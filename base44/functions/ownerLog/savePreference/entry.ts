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

    const { id, key, title, content_markdown, pinned } = await req.json();

    let preference;
    if (id) {
      // Update existing
      preference = await base44.asServiceRole.entities.OwnerPreference.update(id, {
        title,
        content_markdown,
        pinned: pinned || false
      });
    } else {
      // Create new
      preference = await base44.asServiceRole.entities.OwnerPreference.create({
        key,
        title,
        content_markdown,
        pinned: pinned || false
      });
    }

    return Response.json({ preference });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});