import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';

// Assuming Env is set up in the main Hono instance and accessible via c.env
// or that process.env is appropriately populated.

export const authRoutes = new Hono<any>(); // Use the same Env binding as your main app if possible

// Password validation function
function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  
  // Check for at least one uppercase letter
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter.' };
  }
  
  // Check for at least one symbol (special character)
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one special character.' };
  }
  
  return { valid: true };
}

authRoutes.post('/auth/login', async (c) => {
  try {
    const { email, password } = await c.req.json();
    
    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return c.json({ error: 'Supabase URL and Anon Key must be provided.' }, 500);
    }
    const url = `${supabaseUrl}/auth/v1/token?grant_type=password`;
    let externalResponse;
    try {
      externalResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': supabaseAnonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password })
      });
    } catch (fetchError: any) {
      console.error("[Auth Login] Fetch error:", fetchError);
      return c.json({ error: "Failed to contact authentication server." }, 503);
    }

    let data: any;
    const contentType = externalResponse.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await externalResponse.json();
    } else {
      const text = await externalResponse.text();
      console.error("[Auth Login] Non-JSON response from Supabase:", text);
      return c.json(
        {
          code: externalResponse.status || 500,
          error_code: "invalid_supabase_response",
          message: "Supabase returned a non-JSON response. Check your SUPABASE_URL and SUPABASE_ANON_KEY.",
          supabase_response: text,
        },
        (externalResponse.status || 500) as 400 | 401 | 403 | 404 | 429 | 500
      );
    }
    
    // Check if there's an error response
    if (data?.error || data?.error_code) {
      // Check for email not confirmed error
      if (data.error_code === "email_not_confirmed") {
        return c.json(
          {
            code: 403,
            error_code: "email_not_confirmed",
            message: data.msg || "Please confirm your email before logging in",
          },
          403 as 403
        );
      }

      // Check for invalid credentials
      if (data.error_code === "invalid_credentials") {
        return c.json(
          {
            code: 400,
            error_code: "invalid_credentials",
            message: data.msg || "Invalid login credentials",
          },
          400 as 400
        );
      }

      // For other errors, return the original error
      return c.json(
        {
          code: data.code || externalResponse.status || 400,
          error_code: data.error_code || "auth_error",
          message: data.msg || data.error_description || data.error || "Authentication failed",
        },
        (data.code || externalResponse.status || 400) as 400 | 401 | 403 | 404 | 429 | 500
      );
    }

    // Check if we got user data
    if (!data?.user) {
      return c.json(
        {
          code: 400,
          error_code: "invalid_credentials",
          message: "Invalid login credentials",
        },
        400 as 400
      );
    }

    // Log successful login
    console.log("[Login Success]", {
      userId: data.user.id,
      email: data.user.email,
      timestamp: new Date().toISOString(),
    });

    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', 
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });

    return new Response(JSON.stringify(data), { status: externalResponse.status, headers: responseHeaders });
  } catch (error) {
    // Log unexpected errors
    console.error("[Login Unexpected Error]", {
      error: error instanceof Error ? {
        message: error.message,
        name: error.name,
        stack: error.stack,
      } : error,
      timestamp: new Date().toISOString(),
    });

    return c.json(
      {
        code: 500,
        error_code: "internal_error",
        message: "An unexpected error occurred during login",
      },
      500 as 500
    );
  }
});

authRoutes.post('/auth/signup', async (c) => {
  const { email, password, name } = await c.req.json();
  // Validate password
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    return c.json({ error: passwordValidation.error }, 400);
  }
  const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const siteUrl = c.env?.SITE_URL || process.env.SITE_URL || 'https://mcpdploy.com';
  if (!supabaseUrl || !supabaseAnonKey) {
    return c.json({ error: 'Supabase URL and Anon Key must be provided.' }, 500);
  }
  // Build the redirect URL for email confirmation
  const finalRedirect = `${siteUrl}/auth/verify`;
  // Use Supabase JS Client for signup
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  let signupResult;
  try {
    signupResult = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: finalRedirect,
        data: name ? { name } : undefined
      }
    });
  } catch (jsClientError) {
    console.error('[Auth Signup] Supabase JS Client error:', jsClientError);
    return c.json({ error: 'Failed to contact authentication server.' }, 503);
  }
  const { data, error } = signupResult;
  if (error) {
    return c.json({ error: error.message || 'Failed to sign up.' }, 400);
  }
  // --- Add default free plan subscription ---
  try {
    // Only proceed if signup was successful and user exists
    const userId = data?.user?.id;
    if (userId) {
      // Find the free plan (name = 'Free' and price = 0)
      const { data: freePlan, error: planError } = await import('../lib/supabaseClient').then(({ supabase }) =>
        supabase.from('subscription_plans')
          .select('*')
          .eq('name', 'Free')
          .eq('price', 0)
          .limit(1)
          .single()
      );
      if (!planError && freePlan && freePlan.id) {
        // Upsert user_subscriptions if not already present
        const { data: existing, error: existingError } = await import('../lib/supabaseClient').then(({ supabase }) =>
          supabase.from('user_subscriptions').select('id').eq('user_id', userId).single()
        );
        if (existingError || !existing) {
          // Insert new subscription with comprehensive usage tracking
          await import('../lib/supabaseClient').then(({ supabase }) =>
            supabase.from('user_subscriptions').upsert([
              {
                user_id: userId,
                plan_id: freePlan.id,
                status: 'active',
                current_period_end: null,
                usage: {},
                usage_v2: {
                  requests_today: 0,
                  requests_today_date: null,
                  requests_this_month: 0,
                  requests_this_month_date: null,
                  requests_this_year: 0,
                  requests_this_year_date: null,
                  total_requests: 0,
                  last_request_at: null,
                  custom_domains: 0,
                  projects: 0
                }
              }
            ], { onConflict: 'user_id' })
          );
        }
      } else {
        console.error('[Auth Signup] Could not find free plan (name="Free" and price=0):', planError);
      }
    } else {
      console.warn('[Auth Signup] No user id found in signup response:', data);
    }
  } catch (err: any) {
    console.error('[Auth Signup] Error assigning free plan:', err);
  }
  // --- End free plan logic ---
  const responseHeaders = new Headers({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*', 
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  return new Response(JSON.stringify(data), { status: 200, headers: responseHeaders });
});

authRoutes.post('/auth/refresh', async (c) => {
  const { refresh_token } = await c.req.json();
  const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseAnonKey) {
    return c.json({ error: 'Supabase URL and Anon Key must be provided.' }, 500);
  }

  if (!refresh_token) {
    return c.json({ error: 'Refresh token is required.' }, 400);
  }

  const url = `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`;
  let externalResponse;
  
  try {
    externalResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token })
    });
  } catch (fetchError: any) {
    console.error("[Auth Refresh] Fetch error:", fetchError);
    return c.json({ error: "Failed to contact authentication server." }, 503);
  }
  
  const data = await externalResponse.json() as any;

  const responseHeaders = new Headers({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*', 
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });

  return new Response(JSON.stringify(data), { 
    status: externalResponse.status, 
    headers: responseHeaders 
  });
});

authRoutes.post('/auth/verify-token', async (c) => {
  try {
    const { access_token } = await c.req.json();
    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return c.json({ error: 'Supabase URL and Anon Key must be provided.' }, 500);
    }
    if (!access_token) {
      return c.json({ error: 'Access token is required.' }, 400);
    }
    // Use Supabase JS Client to get user from token
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.auth.getUser(access_token);
    if (error || !data?.user) {
      return c.json({ error: 'Invalid or expired access token.' }, 403);
    }
    console.log("line 291", data)
    const user = data.user;
    const isConfirmed = !!(user && (user.confirmed_at || user.email_confirmed_at));
    if (!isConfirmed) {
      return c.json({ error: 'Email not confirmed.' }, 403);
    }
    // Optionally, get session info (refresh_token, expires_in, etc.)
    // But getUser does not return session, so we return only access_token and user
    // If you want to get a new session, you must use refresh_token grant
    const response = {
      access_token,
      token_type: 'bearer',
      expires_in: null, // Not available from getUser
      refresh_token: null, // Not available from getUser
      user
    };
    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    console.log("line 313", response)
    return new Response(JSON.stringify(response), { status: 200, headers: responseHeaders });
  } catch (err) {
    console.error('[Auth Verify] Unexpected error:', err);
    return c.json({ error: 'Internal server error.' }, 500);
  }
});

authRoutes.post('/auth/resend-confirmation', async (c) => {
  try {
    const { email } = await c.req.json();
    console.log('[Resend Confirmation] Step 1: Received request', { email });
    
    if (!email) {
      console.error('[Resend Confirmation] Step 2: Missing email');
      return c.json({ error: 'Email is required.' }, 400);
    }

    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const siteUrl = c.env?.SITE_URL || process.env.SITE_URL || 'https://mcpdploy.com';
    
    console.log('[Resend Confirmation] Step 3: Env config', { supabaseUrl, supabaseAnonKey: !!supabaseAnonKey, siteUrl });

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[Resend Confirmation] Step 4: Missing Supabase URL or Anon Key');
      return c.json({ error: 'Supabase URL and Anon Key must be provided.' }, 500);
    }

    // Build the redirect URL for email confirmation
    const finalRedirect = `${siteUrl}/auth/verify`;
    console.log('[Resend Confirmation] Step 5: Final redirect URL', { finalRedirect });

    // Use Supabase JS Client for resending confirmation
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    let error = null;
    try {
      const { error: resendError } = await supabase.auth.resend({
        email,
        type: 'signup',
        options: { emailRedirectTo: finalRedirect }
      });
      error = resendError;
      console.log('[Resend Confirmation] Step 6: Supabase JS Client response', { error });
    } catch (jsClientError) {
      console.error('[Resend Confirmation] Step 7: Supabase JS Client error', jsClientError);
      return c.json({ error: 'Failed to contact authentication server.' }, 503);
    }

    if (error) {
      console.error('[Resend Confirmation] Step 8: Supabase error', error);
      // Still return success for security reasons
    }

    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', 
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });

    console.log('[Resend Confirmation] Step 9: Returning success response to client');
    return new Response(
      JSON.stringify({ 
        message: 'Confirmation email sent successfully. Please check your inbox.',
        debug: {
          email,
          redirectTo: finalRedirect,
          supabaseError: error
        }
      }), 
      { 
        status: 200, 
        headers: responseHeaders 
      }
    );
  } catch (error) {
    console.error('[Resend Confirmation] Step 10: Unexpected error', error);
    return c.json({ error: 'Internal server error.' }, 500);
  }
}); 

authRoutes.post('/auth/change-password', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Authorization header required' }, 401);
    }
    
    const accessToken = authHeader.substring(7);
    const { currentPassword, newPassword } = await c.req.json();
    
    if (!currentPassword || !newPassword) {
      return c.json({ error: 'Current password and new password are required.' }, 400);
    }

    // Validate new password
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return c.json({ error: passwordValidation.error }, 400);
    }

    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return c.json({ error: 'Supabase URL and Anon Key must be provided.' }, 500);
    }

    // First, get the user's email to verify current password
    const userUrl = `${supabaseUrl}/auth/v1/user`;
    let userResponse;
    
    try {
      userResponse = await fetch(userUrl, {
        method: 'GET',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (fetchError) {
      console.error('[Change Password] Fetch error getting user:', fetchError);
      return c.json({ error: 'Failed to contact authentication server.' }, 503);
    }

    if (!userResponse.ok) {
      return c.json({ error: 'Invalid or expired access token.' }, 401);
    }

    const userData = await userResponse.json() as any;
    const userEmail = userData?.email;

    if (!userEmail) {
      return c.json({ error: 'Could not retrieve user email.' }, 500);
    }

    // Verify current password by attempting to sign in
    const verifyUrl = `${supabaseUrl}/auth/v1/token?grant_type=password`;
    let verifyResponse;
    
    try {
      verifyResponse = await fetch(verifyUrl, {
        method: 'POST',
        headers: {
          'apikey': supabaseAnonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: userEmail, password: currentPassword })
      });
    } catch (fetchError) {
      console.error('[Change Password] Fetch error verifying password:', fetchError);
      return c.json({ error: 'Failed to verify current password.' }, 503);
    }

    const verifyData = await verifyResponse.json() as any;
    
    if (!verifyResponse.ok || verifyData?.error) {
      return c.json({ error: 'Current password is incorrect.' }, 400);
    }

    // Update password
    const updateUrl = `${supabaseUrl}/auth/v1/user`;
    let updateResponse;
    
    try {
      updateResponse = await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: newPassword })
      });
    } catch (fetchError) {
      console.error('[Change Password] Fetch error updating password:', fetchError);
      return c.json({ error: 'Failed to update password.' }, 503);
    }

    const updateData = await updateResponse.json() as any;

    if (!updateResponse.ok || updateData?.error) {
      return c.json(
        { 
          error: updateData?.error_description || updateData?.error || 'Failed to update password.',
        }, 
        updateResponse.status as 400 | 401 | 403 | 404 | 429 | 500
      );
    }

    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', 
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });

    return new Response(
      JSON.stringify({ 
        message: 'Password updated successfully.',
        user: updateData.user
      }), 
      { 
        status: 200, 
        headers: responseHeaders 
      }
    );
  } catch (error) {
    console.error('[Change Password] Unexpected error:', error);
    return c.json({ error: 'Internal server error.' }, 500);
  }
});

authRoutes.post('/auth/forgot-password', async (c) => {
  try {
    const { email, redirectTo } = await c.req.json();
    console.log('[Forgot Password] Step 1: Received request', { email, redirectTo });
    
    if (!email) {
      console.error('[Forgot Password] Step 2: Missing email');
      return c.json({ error: 'Email is required.' }, 400);
    }

    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const siteUrl = c.env?.SITE_URL || process.env.SITE_URL || 'https://mcpdploy.com';
    
    console.log('[Forgot Password] Step 3: Env config', { supabaseUrl, supabaseAnonKey: !!supabaseAnonKey, siteUrl });

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[Forgot Password] Step 4: Missing Supabase URL or Anon Key');
      return c.json({ error: 'Supabase URL and Anon Key must be provided.' }, 500);
    }

    // Build the redirect URL
    const finalRedirect = redirectTo || `${siteUrl}/auth/reset-password`;
    console.log('[Forgot Password] Step 5: Final redirect URL', { finalRedirect });

    // Use Supabase JS Client for password reset
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    let error = null;
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: finalRedirect
      });
      error = resetError;
      console.log('[Forgot Password] Step 6: Supabase JS Client response', { error });
    } catch (jsClientError) {
      console.error('[Forgot Password] Step 7: Supabase JS Client error', jsClientError);
      return c.json({ error: 'Failed to contact authentication server.' }, 503);
    }

    if (error) {
      console.error('[Forgot Password] Step 8: Supabase error', error);
      // Still return success for security reasons
    }

    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', 
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });

    console.log('[Forgot Password] Step 9: Returning success response to client');
    return new Response(
      JSON.stringify({ 
        message: 'If an account exists with this email, a password reset link has been sent.',
        debug: {
          email,
          redirectTo: finalRedirect,
          supabaseError: error
        }
      }), 
      { 
        status: 200, 
        headers: responseHeaders 
      }
    );
  } catch (error) {
    console.error('[Forgot Password] Step 10: Unexpected error', error);
    return c.json({ error: 'Internal server error.' }, 500);
  }
});

authRoutes.post('/auth/reset-password', async (c) => {
  try {
    const { accessToken, newPassword } = await c.req.json();
    
    if (!accessToken || !newPassword) {
      return c.json({ error: 'Access token and new password are required.' }, 400);
    }

    // Validate new password
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return c.json({ error: passwordValidation.error }, 400);
    }

    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return c.json({ error: 'Supabase URL and Anon Key must be provided.' }, 500);
    }

    // Update password using the recovery token
    const url = `${supabaseUrl}/auth/v1/user`;
    let externalResponse;
    
    try {
      externalResponse = await fetch(url, {
        method: 'PUT',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: newPassword })
      });
    } catch (fetchError: any) {
      console.error("[Reset Password] Fetch error:", fetchError);
      return c.json({ error: "Failed to contact authentication server." }, 503);
    }
    
    const data = await externalResponse.json() as any;

    if (!externalResponse.ok || data?.error) {
      console.error("[Reset Password] Error:", data);
      return c.json(
        { 
          error: data?.error_description || data?.error || 'Failed to reset password. The reset link may be expired or invalid.',
        }, 
        (externalResponse.status || 400) as 400 | 401 | 403 | 404 | 429 | 500
      );
    }

    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', 
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });

    return new Response(
      JSON.stringify({ 
        message: 'Password has been reset successfully.',
        user: data.user
      }), 
      { 
        status: 200, 
        headers: responseHeaders 
      }
    );
  } catch (error) {
    console.error('[Reset Password] Unexpected error:', error);
    return c.json({ error: 'Internal server error.' }, 500);
  }
}); 

authRoutes.post('/auth/google', async (c) => {
  try {
    const { redirectTo } = await c.req.json();
    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const siteUrl = c.env?.SITE_URL || process.env.SITE_URL || 'https://mcpdploy.com';
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return c.json({ error: 'Supabase URL and Anon Key must be provided.' }, 500);
    }

    // Build the OAuth URL for Google
    const finalRedirectTo = redirectTo || `${siteUrl}/auth/callback`;
    
    // Use Supabase JS Client to get OAuth URL
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: finalRedirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      }
    });

    if (error) {
      console.error('[Google OAuth] Error:', error);
      return c.json({ error: error.message || 'Failed to initiate Google login.' }, 400);
    }

    if (!data?.url) {
      return c.json({ error: 'Failed to generate OAuth URL.' }, 500);
    }

    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });

    return new Response(
      JSON.stringify({ 
        url: data.url,
        provider: 'google'
      }), 
      { 
        status: 200, 
        headers: responseHeaders 
      }
    );
  } catch (error) {
    console.error('[Google OAuth] Unexpected error:', error);
    return c.json({ error: 'Internal server error.' }, 500);
  }
});

authRoutes.get('/auth/providers', async (c) => {
  try {
    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return c.json({ error: 'Supabase URL and Anon Key must be provided.' }, 500);
    }

    // Return available OAuth providers
    const providers = [
      {
        name: 'google',
        displayName: 'Google',
        icon: 'https://www.google.com/favicon.ico',
        enabled: true
      }
      // Add more providers here as you enable them in Supabase
      // {
      //   name: 'github',
      //   displayName: 'GitHub',
      //   icon: 'https://github.com/favicon.ico',
      //   enabled: true
      // }
    ];

    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });

    return new Response(
      JSON.stringify({ providers }), 
      { 
        status: 200, 
        headers: responseHeaders 
      }
    );
  } catch (error) {
    console.error('[Auth Providers] Unexpected error:', error);
    return c.json({ error: 'Internal server error.' }, 500);
  }
});

authRoutes.post('/auth/oauth-callback', async (c) => {
  try {
    const { access_token, refresh_token, provider_token, provider_refresh_token } = await c.req.json();
    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const supabaseServiceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return c.json({ error: 'Supabase URL and Anon Key must be provided.' }, 500);
    }

    // Verify the session and get user details
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error } = await supabase.auth.getUser(access_token);

    if (error || !user) {
      console.error('[OAuth Callback] Error verifying user:', error);
      return c.json({ error: 'Invalid OAuth session.' }, 401);
    }

    const userId = user.id;
    const userMetadata = user.user_metadata || {};

    // Check if account is deactivated and reactivate if within grace period
    if (userMetadata.account_status === 'deactivated') {
      console.log('[OAuth Callback] Deactivated account detected for user:', userId);
      
      // Check if the account is past the 30-day deletion period
      const deactivatedAt = new Date(userMetadata.deactivated_at);
      const now = new Date();
      const daysSinceDeactivation = (now.getTime() - deactivatedAt.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceDeactivation > 30) {
        console.log('[OAuth Callback] Account is past 30-day grace period for user:', userId);
        return c.json({ error: 'Account is past the 30-day reactivation period and scheduled for deletion' }, 410);
      }

      // Reactivate the account
      if (supabaseServiceKey) {
        const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
        const reactivatedAt = new Date().toISOString();

        // Remove deactivation metadata and set account to active
        const updatedMetadata = { ...userMetadata };
        updatedMetadata.account_status = 'active';
        delete updatedMetadata.deactivated_at;
        delete updatedMetadata.deactivation_reason;
        delete updatedMetadata.scheduled_deletion_at;

        updatedMetadata.reactivated_at = reactivatedAt;
        updatedMetadata.reactivation_count = (updatedMetadata.reactivation_count || 0) + 1;
        updatedMetadata.reactivation_method = 'oauth';

        const { error: metadataError } = await serviceClient.auth.admin.updateUserById(userId, {
          user_metadata: updatedMetadata
        });

        if (metadataError) {
          console.error('[OAuth Callback] Failed to reactivate account:', metadataError.message);
          return c.json({ error: 'Failed to reactivate account' }, 500);
        }

        // Log the reactivation for audit purposes
        try {
          await import('../lib/supabaseClient').then(({ supabase }) =>
            supabase.from('usage_analytics').insert([{
              user_id: userId,
              method: 'POST',
              endpoint: '/auth/oauth-callback',
              status_code: 200,
              metadata: {
                action: 'account_reactivated_via_oauth',
                reactivated_at: reactivatedAt,
                days_since_deactivation: Math.floor(daysSinceDeactivation),
                reactivation_method: 'oauth'
              }
            }])
          );
        } catch (logError) {
          console.error('[OAuth Callback] Failed to log reactivation:', logError);
          // Don't fail the request if logging fails
        }

        console.log('[OAuth Callback] Successfully reactivated account via OAuth for user:', userId);
        
        // Update the user object with the new metadata for the response
        user.user_metadata = updatedMetadata;
      } else {
        console.error('[OAuth Callback] Service key not available for account reactivation');
        return c.json({ error: 'Unable to reactivate account - server configuration error' }, 500);
      }
    }

    // Check if user has a subscription (more reliable than trying to detect "new user")
    let isNewUser = false;
    
    try {
      // Check if subscription already exists
      const { data: existingSub, error: existingError } = await import('../lib/supabaseClient').then(({ supabase }) =>
        supabase.from('user_subscriptions').select('id').eq('user_id', userId).single()
      );

      // If no subscription exists, user needs the free plan
      if (existingError || !existingSub) {
        isNewUser = true;
        console.log(`[OAuth Callback] No subscription found for user ${userId}, assigning free plan`);
        
        // Find the free plan
        const { data: freePlan, error: planError } = await import('../lib/supabaseClient').then(({ supabase }) =>
          supabase.from('subscription_plans')
            .select('*')
            .eq('name', 'Free')
            .eq('price', 0)
            .limit(1)
            .single()
        );

        if (!planError && freePlan && freePlan.id) {
          // Insert new subscription
          const { error: insertError } = await import('../lib/supabaseClient').then(({ supabase }) =>
            supabase.from('user_subscriptions').upsert([
              {
                user_id: userId,
                plan_id: freePlan.id,
                status: 'active',
                current_period_end: null,
                usage: {},
                usage_v2: {
                  requests_today: 0,
                  requests_today_date: null,
                  requests_this_month: 0,
                  requests_this_month_date: null,
                  requests_this_year: 0,
                  requests_this_year_date: null,
                  total_requests: 0,
                  last_request_at: null,
                  custom_domains: 0,
                  projects: 0
                }
              }
            ], { onConflict: 'user_id' })
          );
          
          if (insertError) {
            console.error('[OAuth Callback] Failed to assign free plan:', insertError);
          } else {
            console.log(`[OAuth Callback] Successfully assigned free plan to user ${userId}`);
          }
        } else {
          console.error('[OAuth Callback] Could not find free plan:', planError);
        }
      } else {
        console.log(`[OAuth Callback] User ${userId} already has subscription`);
      }
    } catch (err: any) {
      console.error('[OAuth Callback] Error checking/assigning subscription:', err);
    }

    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });

    return new Response(
      JSON.stringify({
        user,
        access_token,
        refresh_token,
        provider_token,
        provider_refresh_token,
        isNewUser
      }), 
      { 
        status: 200, 
        headers: responseHeaders 
      }
    );
  } catch (error) {
    console.error('[OAuth Callback] Unexpected error:', error);
    return c.json({ error: 'Internal server error.' }, 500);
  }
}); 

// Account Deactivation Endpoints

// Deactivate user account (30-day grace period)
authRoutes.post('/auth/deactivate', async (c) => {
  try {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("[Account Deactivation] No authorization header provided");
      return c.json({ error: 'Authorization header required' }, 401);
    }

    const token = authHeader.substring(7);
    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const supabaseServiceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error("[Account Deactivation] Missing Supabase configuration");
      return c.json({ error: 'Server configuration error' }, 500);
    }

    // Verify user token
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      console.error("[Account Deactivation] Invalid user token:", userError?.message);
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    const userId = user.id;
    console.log("[Account Deactivation] Starting deactivation process for user:", userId);

    // Use service role client to update user metadata
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const deactivatedAt = new Date().toISOString();

    // Update user metadata with deactivation information
    const { error: metadataError } = await serviceClient.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...user.user_metadata,
        account_status: 'deactivated',
        deactivated_at: deactivatedAt,
        deactivation_reason: 'user_requested',
        scheduled_deletion_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }
    });

    if (metadataError) {
      console.error("[Account Deactivation] Failed to update user metadata:", metadataError.message);
      return c.json({ error: 'Failed to deactivate account' }, 500);
    }

    // Log the deactivation for audit purposes
    try {
      await import('../lib/supabaseClient').then(({ supabase }) =>
        supabase.from('usage_analytics').insert([{
          user_id: userId,
          method: 'POST',
          endpoint: '/auth/deactivate',
          status_code: 200,
          metadata: {
            action: 'account_deactivated',
            deactivated_at: deactivatedAt,
            reason: 'user_requested'
          }
        }])
      );
    } catch (logError) {
      console.error("[Account Deactivation] Failed to log deactivation:", logError);
      // Don't fail the request if logging fails
    }

    // Revoke all user sessions
    try {
      await serviceClient.auth.admin.signOut(userId);
    } catch (signOutError) {
      console.error("[Account Deactivation] Failed to revoke sessions:", signOutError);
      // Don't fail the request if sign out fails
    }

    console.log("[Account Deactivation] Successfully deactivated account for user:", userId);

    return c.json({
      message: 'Account deactivated successfully. You have 30 days to reactivate your account before permanent deletion.',
      deactivated_at: deactivatedAt,
      scheduled_deletion_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });

  } catch (error) {
    console.error("[Account Deactivation] Unexpected error:", error);
    return c.json({ error: 'Internal server error during account deactivation' }, 500);
  }
});

// Reactivate user account (remove deactivation status)
authRoutes.post('/auth/reactivate', async (c) => {
  try {
    const { email, password } = await c.req.json();

    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400);
    }

    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const supabaseServiceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error("[Account Reactivation] Missing Supabase configuration");
      return c.json({ error: 'Server configuration error' }, 500);
    }

    // First, authenticate the user to verify credentials
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (signInError || !signInData.user) {
      console.log("[Account Reactivation] Authentication failed for email:", email);
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const userId = signInData.user.id;
    const userMetadata = signInData.user.user_metadata || {};

    // Check if account is actually deactivated
    if (userMetadata.account_status !== 'deactivated') {
      console.log("[Account Reactivation] Account is not deactivated for user:", userId);
      return c.json({ error: 'Account is not deactivated' }, 400);
    }

    // Check if the account is past the 30-day deletion period
    const deactivatedAt = new Date(userMetadata.deactivated_at);
    const now = new Date();
    const daysSinceDeactivation = (now.getTime() - deactivatedAt.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceDeactivation > 30) {
      console.log("[Account Reactivation] Account is past 30-day grace period for user:", userId);
      return c.json({ error: 'Account is past the 30-day reactivation period and scheduled for deletion' }, 410);
    }

    // Use service role client to update user metadata
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const reactivatedAt = new Date().toISOString();

    // Remove deactivation metadata and set account to active
    const updatedMetadata = { ...userMetadata };
    updatedMetadata.account_status = 'active';  // Explicitly set to active
    delete updatedMetadata.deactivated_at;
    delete updatedMetadata.deactivation_reason;
    delete updatedMetadata.scheduled_deletion_at;

    updatedMetadata.reactivated_at = reactivatedAt;
    updatedMetadata.reactivation_count = (updatedMetadata.reactivation_count || 0) + 1;

    const { error: metadataError } = await serviceClient.auth.admin.updateUserById(userId, {
      user_metadata: updatedMetadata
    });

    if (metadataError) {
      console.error("[Account Reactivation] Failed to update user metadata:", metadataError.message);
      return c.json({ error: 'Failed to reactivate account' }, 500);
    }

    // Log the reactivation for audit purposes
    try {
      await import('../lib/supabaseClient').then(({ supabase }) =>
        supabase.from('usage_analytics').insert([{
          user_id: userId,
          method: 'POST',
          endpoint: '/auth/reactivate',
          status_code: 200,
          metadata: {
            action: 'account_reactivated',
            reactivated_at: reactivatedAt,
            days_since_deactivation: Math.floor(daysSinceDeactivation)
          }
        }])
      );
    } catch (logError) {
      console.error("[Account Reactivation] Failed to log reactivation:", logError);
      // Don't fail the request if logging fails
    }

    console.log("[Account Reactivation] Successfully reactivated account for user:", userId);

    return c.json({
      message: 'Account reactivated successfully. You can now login normally.',
      reactivated_at: reactivatedAt,
      access_token: signInData.session?.access_token,
      refresh_token: signInData.session?.refresh_token,
      user: signInData.user
    });

  } catch (error) {
    console.error("[Account Reactivation] Unexpected error:", error);
    return c.json({ error: 'Internal server error during account reactivation' }, 500);
  }
});

// Admin endpoint for permanent account cleanup (should be called by a cron job)
authRoutes.post('/auth/cleanup-deactivated-accounts', async (c) => {
  try {
    // Check for admin authentication or API key
    const adminKey = c.req.header('X-Admin-Key') || c.req.header('X-API-Key');
    const expectedAdminKey = c.env?.ADMIN_API_KEY || process.env.ADMIN_API_KEY;

    if (!adminKey || !expectedAdminKey || adminKey !== expectedAdminKey) {
      console.log("[Account Cleanup] Unauthorized cleanup attempt");
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[Account Cleanup] Missing Supabase configuration");
      return c.json({ error: 'Server configuration error' }, 500);
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    console.log("[Account Cleanup] Starting cleanup process for accounts deactivated before:", thirtyDaysAgo);

    // Get all users with deactivated accounts older than 30 days
    const { data: users, error: listError } = await serviceClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000 // Process in batches if you have many users
    });

    if (listError) {
      console.error("[Account Cleanup] Failed to list users:", listError.message);
      return c.json({ error: 'Failed to list users' }, 500);
    }

    const usersToDelete = users.users.filter(user => {
      const metadata = user.user_metadata || {};
      return metadata.account_status === 'deactivated' && 
             metadata.deactivated_at && 
             new Date(metadata.deactivated_at) < new Date(thirtyDaysAgo);
    });

    console.log("[Account Cleanup] Found", usersToDelete.length, "accounts to delete");

    const deletionResults = {
      successful: 0,
      failed: 0,
      errors: [] as any[]
    };

    // Process each user for deletion
    for (const user of usersToDelete) {
      const userId = user.id;
      console.log("[Account Cleanup] Processing deletion for user:", userId);

      try {
        // Delete all user-related data in correct order (foreign key constraints)
        const { supabase } = await import('../lib/supabaseClient');

        // 1. Delete user analytics
        const { error: analyticsError } = await supabase
          .from('usage_analytics')
          .delete()
          .eq('user_id', userId);

        if (analyticsError) {
          console.error("[Account Cleanup] Failed to delete analytics for user:", userId, analyticsError.message);
        }

        // 2. Delete support tickets
        const { error: ticketsError } = await supabase
          .from('support_tickets')
          .delete()
          .eq('user_id', userId);

        if (ticketsError) {
          console.error("[Account Cleanup] Failed to delete support tickets for user:", userId, ticketsError.message);
        }

        // 3. Get user projects to cascade delete sub-items
        const { data: projects, error: projectsError } = await supabase
          .from('mcp_servers')
          .select('id')
          .eq('user_id', userId);

        if (projectsError) {
          console.error("[Account Cleanup] Failed to get projects for user:", userId, projectsError.message);
        } else if (projects && projects.length > 0) {
          const projectIds = projects.map(p => p.id);

          // Delete project sub-items
          const { error: resourcesError } = await supabase
            .from('mcp_resources')
            .delete()
            .in('server_id', projectIds);

          const { error: toolsError } = await supabase
            .from('mcp_tools')
            .delete()
            .in('server_id', projectIds);

          const { error: promptsError } = await supabase
            .from('mcp_prompts')
            .delete()
            .in('server_id', projectIds);

          if (resourcesError || toolsError || promptsError) {
            console.error("[Account Cleanup] Failed to delete project sub-items for user:", userId, {
              resourcesError: resourcesError?.message,
              toolsError: toolsError?.message,
              promptsError: promptsError?.message
            });
          }

          // Delete projects
          const { error: projectDeleteError } = await supabase
            .from('mcp_servers')
            .delete()
            .eq('user_id', userId);

          if (projectDeleteError) {
            console.error("[Account Cleanup] Failed to delete projects for user:", userId, projectDeleteError.message);
          }
        }

        // 4. Delete user subscription
        const { error: subscriptionError } = await supabase
          .from('user_subscriptions')
          .delete()
          .eq('user_id', userId);

        if (subscriptionError) {
          console.error("[Account Cleanup] Failed to delete subscription for user:", userId, subscriptionError.message);
        }

        // 5. Log the deletion before deleting the user
        await supabase.from('usage_analytics').insert([{
          user_id: userId,
          method: 'DELETE',
          endpoint: '/auth/cleanup-deactivated-accounts',
          status_code: 200,
          metadata: {
            action: 'account_permanently_deleted',
            deleted_at: new Date().toISOString(),
            deactivated_at: user.user_metadata?.deactivated_at,
            projects_deleted: projects?.length || 0
          }
        }]);

        // 6. Finally, delete the user from Supabase Auth
        const { error: userDeleteError } = await serviceClient.auth.admin.deleteUser(userId);

        if (userDeleteError) {
          console.error("[Account Cleanup] Failed to delete user from auth:", userId, userDeleteError.message);
          deletionResults.failed++;
          deletionResults.errors.push({
            userId,
            error: userDeleteError.message,
            step: 'auth_deletion'
          });
        } else {
          console.log("[Account Cleanup] Successfully deleted user:", userId);
          deletionResults.successful++;
        }

      } catch (error) {
        console.error("[Account Cleanup] Unexpected error deleting user:", userId, error);
        deletionResults.failed++;
        deletionResults.errors.push({
          userId,
          error: error instanceof Error ? error.message : String(error),
          step: 'unexpected_error'
        });
      }
    }

    console.log("[Account Cleanup] Cleanup process completed:", deletionResults);

    return c.json({
      message: 'Account cleanup completed',
      processed: usersToDelete.length,
      successful: deletionResults.successful,
      failed: deletionResults.failed,
      errors: deletionResults.errors
    });

  } catch (error) {
    console.error("[Account Cleanup] Unexpected error in cleanup process:", error);
    return c.json({ error: 'Internal server error during cleanup' }, 500);
  }
});

// Helper endpoint to check account status
authRoutes.get('/auth/account-status', async (c) => {
  try {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: 'Authorization header required' }, 401);
    }

    const token = authHeader.substring(7);
    const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return c.json({ error: 'Server configuration error' }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    const userMetadata = user.user_metadata || {};
    const accountStatus = userMetadata.account_status || 'active';

    let response: any = {
      user_id: user.id,
      email: user.email,
      account_status: accountStatus,
      created_at: user.created_at
    };

    if (accountStatus === 'deactivated') {
      const deactivatedAt = new Date(userMetadata.deactivated_at);
      const scheduledDeletionAt = new Date(userMetadata.scheduled_deletion_at);
      const now = new Date();
      const daysUntilDeletion = Math.ceil((scheduledDeletionAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      response = {
        ...response,
        deactivated_at: userMetadata.deactivated_at,
        scheduled_deletion_at: userMetadata.scheduled_deletion_at,
        days_until_deletion: Math.max(0, daysUntilDeletion),
        can_reactivate: daysUntilDeletion > 0
      };
    }

    return c.json(response);

  } catch (error) {
    console.error("[Account Status] Unexpected error:", error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}); 