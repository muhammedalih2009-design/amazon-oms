import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { token } = await req.json();

    if (!token) {
      return Response.json({ error: 'Token required' }, { status: 400 });
    }

    // Find invite
    const invites = await base44.asServiceRole.entities.PlatformInvite.filter({ token });

    if (invites.length === 0) {
      return Response.json({ error: 'Invalid invite token' }, { status: 404 });
    }

    const invite = invites[0];

    // Validate invite
    if (invite.status !== 'pending') {
      return Response.json({ 
        error: `Invite already ${invite.status}` 
      }, { status: 400 });
    }

    if (new Date(invite.expires_at) < new Date()) {
      await base44.asServiceRole.entities.PlatformInvite.update(invite.id, {
        status: 'expired'
      });
      return Response.json({ error: 'Invite has expired' }, { status: 400 });
    }

    // Verify email matches
    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      return Response.json({ 
        error: 'Invite email does not match your account' 
      }, { status: 403 });
    }

    // Mark invite as accepted
    await base44.asServiceRole.entities.PlatformInvite.update(invite.id, {
      status: 'accepted',
      accepted_at: new Date().toISOString()
    });

    // Update PlatformUser status
    const platformUsers = await base44.asServiceRole.entities.PlatformUser.filter({ 
      email: invite.email.toLowerCase() 
    });

    if (platformUsers.length > 0) {
      await base44.asServiceRole.entities.PlatformUser.update(platformUsers[0].id, {
        status: 'active',
        last_login_at: new Date().toISOString()
      });
    }

    return Response.json({
      success: true,
      message: 'Invite accepted successfully'
    });

  } catch (error) {
    console.error('Accept platform invite error:', error);
    return Response.json({ 
      error: error.message || 'Failed to accept invite' 
    }, { status: 500 });
  }
});