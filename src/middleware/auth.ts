import { createClient } from "@supabase/supabase-js";
import type { MiddlewareHandler } from 'hono';

// Define Env for middleware if not already globally available or to keep it self-contained
// Assuming Env is defined in a way that c.env or process.env can access SUPABASE_URL and SUPABASE_ANON_KEY
// If Env is imported from Hono, ensure correct type usage.

export const supabaseAuthMiddleware: MiddlewareHandler<any> = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  console.log("[supabaseAuthMiddleware] Incoming Authorization header:", authHeader ? (authHeader.substring(0, 7) + "..." + (authHeader?.substring(authHeader.length - 4) || "")) : "missing");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    try {
      // Prefer c.env for Cloudflare Workers, fallback to process.env for other environments
      const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL || "";
      const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
      
      if (!supabaseUrl || !supabaseAnonKey) {
        console.error("[supabaseAuthMiddleware] Supabase URL or Anon Key is missing.");
        c.set('userId', null);
        await next();
        return;
      }

      console.log("[supabaseAuthMiddleware] Using Supabase URL (masked):", supabaseUrl ? (supabaseUrl.substring(0, 8) + "..." + supabaseUrl.substring(supabaseUrl.length - 4)) : "missing");
      console.log("[supabaseAuthMiddleware] Using Supabase anon key (masked):", supabaseAnonKey ? (supabaseAnonKey.substring(0, 4) + "..." + supabaseAnonKey.substring(supabaseAnonKey.length - 4)) : "missing");
      
      const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error) {
        console.error("[supabaseAuthMiddleware] Supabase auth error:", error.message, error);
        c.set('userId', null);
      } else {
        c.set('userId', user?.id || null);
        console.log("[supabaseAuthMiddleware] User ID from token:", user?.id || null);
      }
    } catch (e: any) {
      console.error("[supabaseAuthMiddleware] Exception during Supabase auth:", e.message, e);
      c.set('userId', null);
    }
  } else {
    c.set('userId', null); // No token, no user
  }
  await next();
}; 