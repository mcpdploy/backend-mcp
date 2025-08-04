import { createClient } from "@supabase/supabase-js";
import type { MiddlewareHandler } from 'hono';

// Define Env for middleware if not already globally available or to keep it self-contained
// Assuming Env is defined in a way that c.env or process.env can access SUPABASE_URL and SUPABASE_ANON_KEY
// If Env is imported from Hono, ensure correct type usage.

// Helper function to assign free plan to users without subscription
// This is a safety net that ensures all authenticated users have a subscription
// It's particularly important for OAuth users who might bypass the normal signup flow
async function ensureUserHasSubscription(userId: string, supabaseUrl: string, supabaseAnonKey: string, userJwt: string) {
  try {
    // Create authenticated Supabase client using user's JWT token
    const authenticatedSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${userJwt}` } }
    });
    
    // Check if user already has a subscription
    const { data: existingSub, error: subError } = await authenticatedSupabase
      .from('user_subscriptions')
      .select('id, status')
      .eq('user_id', userId)
      .single();

    // If user already has a subscription, no action needed
    if (!subError && existingSub) {
      console.log(`[Auth Middleware] User ${userId} already has subscription (status: ${existingSub.status})`);
      return;
    }

    // Log this as it should mainly happen for OAuth users or edge cases
    console.log(`[Auth Middleware] No subscription found for user ${userId}, assigning free plan (likely OAuth user or edge case)`);

    // Find the free plan (use anonymous client for this since subscription_plans has public read access)
    const { supabase: anonSupabase } = await import('../lib/supabaseClient');
    const { data: freePlan, error: planError } = await anonSupabase
      .from('subscription_plans')
      .select('*')
      .eq('name', 'Free')
      .eq('price', 0)
      .limit(1)
      .single();

    if (planError || !freePlan) {
      console.error('[Auth Middleware] Could not find free plan:', planError);
      return;
    }

    // Insert new subscription using authenticated client
    const { error: insertError } = await authenticatedSupabase
      .from('user_subscriptions')
      .upsert([
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
      ], { onConflict: 'user_id' });

    if (insertError) {
      console.error('[Auth Middleware] Failed to assign free plan to user:', userId, insertError);
    } else {
      console.log(`[Auth Middleware] Successfully assigned free plan to user ${userId} (safety net activation)`);
    }
  } catch (error) {
    console.error('[Auth Middleware] Error in ensureUserHasSubscription:', error);
  }
}

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
          
          // Calculate days since deactivation
          const deactivatedAt = new Date(userMetadata.deactivated_at);
          const now = new Date();
          const daysSinceDeactivation = (now.getTime() - deactivatedAt.getTime()) / (1000 * 60 * 60 * 24);
          
          // If within grace period, auto-reactivate the account (safety net for OAuth users)
          if (daysSinceDeactivation <= 30) {
            console.log("[supabaseAuthMiddleware] Auto-reactivating account within grace period for user:", user.id);
            
            const supabaseServiceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
            
            if (supabaseServiceKey) {
              try {
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
                updatedMetadata.reactivation_method = 'middleware_auto';

                const { error: metadataError } = await serviceClient.auth.admin.updateUserById(user.id, {
                  user_metadata: updatedMetadata
                });

                if (metadataError) {
                  console.error("[supabaseAuthMiddleware] Failed to auto-reactivate account:", metadataError.message);
                } else {
                  // Log the reactivation
                  try {
                    await supabase.from('usage_analytics').insert([{
                      user_id: user.id,
                      method: c.req.method,
                      endpoint: c.req.url,
                      status_code: 200,
                      metadata: {
                        action: 'account_auto_reactivated_middleware',
                        reactivated_at: reactivatedAt,
                        days_since_deactivation: Math.floor(daysSinceDeactivation),
                        reactivation_method: 'middleware_auto'
                      }
                    }]);
                  } catch (logError) {
                    console.error("[supabaseAuthMiddleware] Failed to log auto-reactivation:", logError);
                  }

                  console.log("[supabaseAuthMiddleware] Successfully auto-reactivated account for user:", user.id);
                  
                  // Continue with normal flow - account is now active
                  c.set('userId', user.id);
                  console.log("[supabaseAuthMiddleware] User ID from token (reactivated):", user.id);
                  
                  // Ensure user has a subscription
                  ensureUserHasSubscription(user.id, supabaseUrl, supabaseAnonKey, token)
                    .catch(err => console.error("[supabaseAuthMiddleware] Background subscription check failed:", err));
                  
                  await next();
                  return;
                }
              } catch (reactivationError) {
                console.error("[supabaseAuthMiddleware] Error during auto-reactivation:", reactivationError);
              }
            } else {
              console.error("[supabaseAuthMiddleware] Service key not available for auto-reactivation");
            }
          }
          
          // If we get here, either reactivation failed or account is past grace period
          const scheduledDeletionAt = new Date(userMetadata.scheduled_deletion_at);
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
        
        // Account is active, set user ID
        c.set('userId', user.id);
        console.log("[supabaseAuthMiddleware] User ID from token:", user.id);
        
        // Ensure user has a subscription (safety net for all users)
        // - Email/password users: Should already have subscription from signup, this does nothing
        // - OAuth users: May need subscription assigned if OAuth callback failed
        // - Edge cases: Handles any users who somehow lost their subscription
        // Run this asynchronously to not block the request
        ensureUserHasSubscription(user.id, supabaseUrl, supabaseAnonKey, token)
          .catch(err => console.error("[supabaseAuthMiddleware] Background subscription check failed:", err));
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