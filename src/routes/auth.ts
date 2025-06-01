import { Hono } from 'hono';

// Assuming Env is set up in the main Hono instance and accessible via c.env
// or that process.env is appropriately populated.

export const authRoutes = new Hono<any>(); // Use the same Env binding as your main app if possible

authRoutes.post('/auth/login', async (c) => {
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

  const data = await externalResponse.json() as any;
  
  // --- Enforce email confirmation before login ---
  // Supabase user object may be in data.user or data (depending on response)
  const user = data?.user || data;
  // Check for confirmed_at or email_confirmed_at (Supabase may use either)
  const isConfirmed = !!(user && (user.confirmed_at || user.email_confirmed_at));
  if (user && !isConfirmed) {
    return c.json({ error: 'Please confirm your email before logging in.' }, 403);
  }
  // --- End email confirmation check ---

  const responseHeaders = new Headers({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*', 
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });

  return new Response(JSON.stringify(data), { status: externalResponse.status, headers: responseHeaders });
});

authRoutes.post('/auth/signup', async (c) => {
  const { email, password } = await c.req.json();
  const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return c.json({ error: 'Supabase URL and Anon Key must be provided.' }, 500);
  }
  const url = `${supabaseUrl}/auth/v1/signup`;
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
    console.error("[Auth Signup] Fetch error:", fetchError);
    return c.json({ error: "Failed to contact authentication server." }, 503);
  }
  
  const data = await externalResponse.json() as any;

  // --- Add default free plan subscription ---
  try {
    // Only proceed if signup was successful and user exists
    const userId = data?.user?.id || data?.id || data?.user_id;
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

  return new Response(JSON.stringify(data), { status: externalResponse.status, headers: responseHeaders });
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