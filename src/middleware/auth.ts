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
      } else if (user) {
        // Check if account is deactivated
        const userMetadata = user.user_metadata || {};
        const accountStatus = userMetadata.account_status;
        
        if (accountStatus === 'deactivated') {
          console.log("[supabaseAuthMiddleware] Deactivated account attempted access:", user.id);
          
          // Calculate days until deletion
          const deactivatedAt = new Date(userMetadata.deactivated_at);
          const scheduledDeletionAt = new Date(userMetadata.scheduled_deletion_at);
          const now = new Date();
          const daysUntilDeletion = Math.ceil((scheduledDeletionAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          
          // Log the blocked access attempt
          try {
            await supabase.from('usage_analytics').insert([{
              user_id: user.id,
              method: c.req.method,
              endpoint: c.req.url,
              status_code: 403,
              metadata: {
                action: 'deactivated_account_blocked',
                deactivated_at: userMetadata.deactivated_at,
                days_until_deletion: Math.max(0, daysUntilDeletion),
                blocked_at: new Date().toISOString()
              }
            }]);
          } catch (logError) {
            console.error("[supabaseAuthMiddleware] Failed to log blocked access:", logError);
          }
          
          // Return appropriate error response based on deletion status
          if (daysUntilDeletion > 0) {
            return c.json({
              error: 'Account is deactivated',
              code: 'ACCOUNT_DEACTIVATED',
              message: `Your account is deactivated and will be permanently deleted in ${daysUntilDeletion} days. You can reactivate it at any time before then.`,
              deactivated_at: userMetadata.deactivated_at,
              scheduled_deletion_at: userMetadata.scheduled_deletion_at,
              days_until_deletion: daysUntilDeletion,
              can_reactivate: true,
              reactivation_endpoint: '/auth/reactivate'
            }, 403);
          } else {
            return c.json({
              error: 'Account is scheduled for deletion',
              code: 'ACCOUNT_SCHEDULED_FOR_DELETION',
              message: 'Your account is past the 30-day reactivation period and is scheduled for permanent deletion.',
              deactivated_at: userMetadata.deactivated_at,
              scheduled_deletion_at: userMetadata.scheduled_deletion_at,
              can_reactivate: false
            }, 410);
          }
        }
        
        // Account is active, proceed normally
        c.set('userId', user.id);
        console.log("[supabaseAuthMiddleware] User ID from token:", user.id);
      } else {
        c.set('userId', null);
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