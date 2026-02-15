import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');

    return Response.json({ 
      configured: !!(botToken && chatId),
      hasToken: !!botToken,
      hasChatId: !!chatId
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});