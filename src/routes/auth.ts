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
          // Insert new subscription
          await import('../lib/supabaseClient').then(({ supabase }) =>
            supabase.from('user_subscriptions').upsert([
              {
                user_id: userId,
                plan_id: freePlan.id,
                status: 'active',
                current_period_end: null,
                usage: {},
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