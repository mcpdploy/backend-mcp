import { Hono } from 'hono';
import { Resend } from 'resend';

export const supportRoutes = new Hono<any>();

supportRoutes.post('/support/contact', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    const { subject, message, category, email } = await c.req.json();
    
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
    
    // Use provided email if user is not authenticated or if email is explicitly provided
    if (email && !userEmail) {
      userEmail = email;
    }

    // Store support ticket in database
    const { createClient } = await import('@supabase/supabase-js');
    
    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    
    // Use service role key for database operations to bypass RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
    
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
      replyTo: userEmail || email || 'noreply@mcpdploy.com',
      subject: `[Support] ${category ? `[${category}] ` : ''}${subject}`,
      text: `
Support Request - mcpDploy
==========================

From: ${userName || 'Anonymous'} (${userEmail || email || 'Not logged in'})
User ID: ${userId || 'N/A'}
Category: ${category || 'general'}
Date: ${new Date().toLocaleString()}
Ticket ID: ${ticket?.id || 'N/A'}

Subject: ${subject}

Message:
${message}

---
mcpDploy Support Team
Zero-code, MCP Service platform
      `,
      html: `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Support Request - mcpDploy</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #000000;
            background-color: #ffffff;
            margin: 0;
            padding: 0;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            padding: 40px 20px;
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
            border-bottom: 2px solid #FF6600;
            padding-bottom: 20px;
        }
        .logo {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .logo-mcp {
            color: #000000;
        }
        .logo-dploy {
            color: #FF6600;
        }
        .tagline {
            color: #666666;
            font-size: 14px;
            margin: 0;
        }
        .ticket-info {
            background-color: #f8f9fa;
            border-left: 4px solid #FF6600;
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 4px;
        }
        .ticket-info h2 {
            color: #000000;
            margin: 0 0 15px 0;
            font-size: 20px;
            font-weight: 600;
        }
        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-bottom: 20px;
        }
        .info-item {
            margin: 0;
        }
        .info-label {
            font-weight: 600;
            color: #333333;
            font-size: 14px;
        }
        .info-value {
            color: #000000;
            font-size: 14px;
            margin-top: 2px;
        }
        .subject-section {
            margin-bottom: 25px;
        }
        .subject-section h3 {
            color: #000000;
            margin: 0 0 10px 0;
            font-size: 18px;
            font-weight: 600;
        }
        .message-section {
            background-color: #ffffff;
            border: 1px solid #e9ecef;
            border-radius: 6px;
            padding: 20px;
            margin-bottom: 30px;
        }
        .message-section h4 {
            color: #000000;
            margin: 0 0 15px 0;
            font-size: 16px;
            font-weight: 600;
        }
        .message-content {
            color: #333333;
            line-height: 1.7;
            white-space: pre-wrap;
        }
        .footer {
            text-align: center;
            padding-top: 20px;
            border-top: 1px solid #e9ecef;
            color: #666666;
            font-size: 12px;
        }
        .ticket-id {
            background-color: #FF6600;
            color: #ffffff;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            display: inline-block;
            margin-top: 10px;
        }
        @media only screen and (max-width: 600px) {
            .container {
                padding: 20px 15px;
            }
            .info-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">
                <span class="logo-mcp">mcp</span><span class="logo-dploy">Dploy</span>
            </div>
            <p class="tagline">Zero-code, MCP Service platform</p>
        </div>
        
        <div class="ticket-info">
            <h2>📧 New Support Request</h2>
            <div class="info-grid">
                <div class="info-item">
                    <div class="info-label">From:</div>
                    <div class="info-value">${userName || 'Anonymous'} (${userEmail || email || 'Not logged in'})</div>
                </div>
                <div class="info-item">
                    <div class="info-label">User ID:</div>
                    <div class="info-value">${userId || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Category:</div>
                    <div class="info-value">${category || 'general'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Date:</div>
                    <div class="info-value">${new Date().toLocaleString()}</div>
                </div>
            </div>
        </div>
        
        <div class="subject-section">
            <h3>📋 Subject: ${subject}</h3>
        </div>
        
        <div class="message-section">
            <h4>💬 Message:</h4>
            <div class="message-content">${message.replace(/\n/g, '<br>')}</div>
        </div>
        
        <div class="footer">
            <p>This is an automated support request from mcpDploy</p>
            <div class="ticket-id">Ticket ID: ${ticket?.id || 'N/A'}</div>
        </div>
    </div>
</body>
</html>
      `
    };

    // Send email notification using Resend
    try {
      const resendApiKey = c.env?.RESEND_API_KEY || process.env.RESEND_API_KEY;
      const supportEmail = c.env?.SUPPORT_EMAIL || process.env.SUPPORT_EMAIL || 'support@mcpdploy.com';
      
      if (resendApiKey) {
        const resend = new Resend(resendApiKey);
        
        await resend.emails.send({
          from: 'MCPDploy Support <noreply@mcpdploy.com>',
          to: [supportEmail],
          replyTo: userEmail || email || 'noreply@mcpdploy.com',
          subject: `[Support] ${category ? `[${category}] ` : ''}${subject}`,
          text: emailData.text,
          html: emailData.html,
        });
        
        console.log('[Support] Email sent successfully to:', supportEmail);
      } else {
        console.warn('[Support] RESEND_API_KEY not configured, email not sent');
      }
    } catch (emailError) {
      console.error('[Support] Error sending email:', emailError);
      // Continue even if email fails - the ticket is still created
    }

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
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Get user info from token
    const accessToken = authHeader.substring(7);
    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    
    let userId = null;
    
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
          userId = userData?.id;
        } else {
          return c.json({ error: 'Invalid token' }, 401);
        }
      } catch (error) {
        console.error('[Support] Error fetching user data:', error);
        return c.json({ error: 'Invalid token' }, 401);
      }
    }

    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Create Supabase client with service role key
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseServiceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);

    console.log('[Support] Fetching tickets for user:', userId);
    const { data: tickets, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Support] Error fetching tickets:', error);
      return c.json({ error: 'Failed to fetch support tickets.' }, 500);
    }

    console.log('[Support] Tickets fetched successfully:', tickets);
    return c.json(tickets || []);
  } catch (error) {
    console.error('[Support] Unexpected error:', error);
    return c.json({ error: 'Internal server error.' }, 500);
  }
}); 