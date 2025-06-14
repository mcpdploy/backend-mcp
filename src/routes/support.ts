import { Hono } from 'hono';

export const supportRoutes = new Hono<any>();

supportRoutes.post('/support/contact', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    const { subject, message, category } = await c.req.json();
    
    if (!subject || !message) {
      return c.json({ error: 'Subject and message are required.' }, 400);
    }

    // Get user info if authenticated
    let userEmail = null;
    let userName = null;
    let userId = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.substring(7);
      const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
      const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
      
      if (supabaseUrl && supabaseAnonKey) {
        try {
          const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
            method: 'GET',
            headers: {
              'apikey': supabaseAnonKey,
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          });
          
          if (userResponse.ok) {
            const userData = await userResponse.json() as any;
            userEmail = userData?.email;
            userName = userData?.user_metadata?.name;
            userId = userData?.id;
          }
        } catch (error) {
          console.error('[Support] Error fetching user data:', error);
        }
      }
    }

    // Store support ticket in database
    const { supabase } = await import('../lib/supabaseClient');
    
    // First, ensure the support_tickets table exists
    // You'll need to create this table in your Supabase dashboard
    const ticketData = {
      user_id: userId,
      user_email: userEmail,
      user_name: userName,
      subject,
      message,
      category: category || 'general',
      status: 'open',
      created_at: new Date().toISOString()
    };

    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .insert([ticketData])
      .select()
      .single();

    if (ticketError) {
      console.error('[Support] Error creating ticket:', ticketError);
      // Continue even if database insert fails - we'll still try to send email
    }

    // Send email notification
    // This is where you'd integrate with your email service
    // For now, we'll prepare the email data
    const emailData = {
      to: process.env.SUPPORT_EMAIL || 'support@mcpdploy.com',
      from: userEmail || 'noreply@mcpdploy.com',
      replyTo: userEmail,
      subject: `[Support] ${category ? `[${category}] ` : ''}${subject}`,
      text: `
Support Request
===============

From: ${userName || 'Anonymous'} (${userEmail || 'Not logged in'})
User ID: ${userId || 'N/A'}
Category: ${category || 'general'}
Date: ${new Date().toISOString()}

Subject: ${subject}

Message:
${message}

---
Ticket ID: ${ticket?.id || 'N/A'}
      `,
      html: `
<h2>Support Request</h2>
<p><strong>From:</strong> ${userName || 'Anonymous'} (${userEmail || 'Not logged in'})<br>
<strong>User ID:</strong> ${userId || 'N/A'}<br>
<strong>Category:</strong> ${category || 'general'}<br>
<strong>Date:</strong> ${new Date().toISOString()}</p>

<h3>Subject: ${subject}</h3>

<p><strong>Message:</strong></p>
<p>${message.replace(/\n/g, '<br>')}</p>

<hr>
<p><small>Ticket ID: ${ticket?.id || 'N/A'}</small></p>
      `
    };

    // TODO: Integrate with your chosen email service
    // For example, with Resend:
    // const resend = new Resend(process.env.RESEND_API_KEY);
    // await resend.emails.send(emailData);

    console.log('[Support] Email data prepared:', emailData);

    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });

    return new Response(
      JSON.stringify({
        message: 'Support request received. We\'ll get back to you soon.',
        ticketId: ticket?.id,
        estimatedResponseTime: '24-48 hours'
      }),
      {
        status: 200,
        headers: responseHeaders
      }
    );
  } catch (error) {
    console.error('[Support] Unexpected error:', error);
    return c.json({ error: 'Failed to submit support request.' }, 500);
  }
});

// Get user's support tickets
supportRoutes.get('/support/tickets', async (c) => {
  try {
    const userId = c.var.userId;
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { supabase } = await import('../lib/supabaseClient');
    
    const { data: tickets, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Support] Error fetching tickets:', error);
      return c.json({ error: 'Failed to fetch support tickets.' }, 500);
    }

    return c.json(tickets || []);
  } catch (error) {
    console.error('[Support] Unexpected error:', error);
    return c.json({ error: 'Internal server error.' }, 500);
  }
}); 