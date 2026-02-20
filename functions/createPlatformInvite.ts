import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PLATFORM_ADMIN_EMAIL = 'muhammedalih.2009@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // SECURITY: Platform admin only
    if (user.email.toLowerCase() !== PLATFORM_ADMIN_EMAIL.toLowerCase()) {
      return Response.json({ error: 'Forbidden: Platform admin access required' }, { status: 403 });
    }

    const { email } = await req.json();
    
    if (!email || !email.includes('@')) {
      return Response.json({ error: 'Valid email required' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Create or update PlatformUser
    const existingUsers = await base44.asServiceRole.entities.PlatformUser.filter({ 
      email: normalizedEmail 
    });

    let platformUser;
    if (existingUsers.length > 0) {
      platformUser = existingUsers[0];
      // Update status to invited if disabled
      if (platformUser.status === 'disabled') {
        await base44.asServiceRole.entities.PlatformUser.update(platformUser.id, {
          status: 'invited',
          invited_at: new Date().toISOString(),
          invited_by_user_id: user.id
        });
      }
    } else {
      platformUser = await base44.asServiceRole.entities.PlatformUser.create({
        email: normalizedEmail,
        status: 'invited',
        invited_at: new Date().toISOString(),
        invited_by_user_id: user.id
      });
    }

    // Generate unique token
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    // Create invite
    const invite = await base44.asServiceRole.entities.PlatformInvite.create({
      token,
      email: normalizedEmail,
      status: 'pending',
      invited_by_user_id: user.id,
      expires_at: expiresAt.toISOString()
    });

    // Generate invite link
    const origin = new URL(req.url).origin;
    const inviteLink = `${origin}/AcceptPlatformInvite?token=${token}`;

    return Response.json({
      success: true,
      invite_link: inviteLink,
      token,
      email: normalizedEmail,
      expires_at: expiresAt.toISOString()
    });

  } catch (error) {
    console.error('Create platform invite error:', error);
    return Response.json({ 
      error: error.message || 'Failed to create invite' 
    }, { status: 500 });
  }
});