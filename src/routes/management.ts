import { Hono } from 'hono';
import { validator } from 'hono/validator'; // Ensure this is present
import { createClient } from "@supabase/supabase-js"; // For getPrivilegedSupabaseClient
import { supabase } from "../lib/supabaseClient"; // For read operations respecting RLS
import {
    mcpProjectCreateSchema, 
    mcpProjectUpdateSchema
} from '../lib/schemas';
import Stripe from 'stripe';
import { ContentfulStatusCode } from 'hono/utils/http-status';

// Define types for Hono context if not already available globally
// Assuming Env and Variables (like userId) are compatible with the main app
// For instance:
// type AppEnv = { Bindings: Env, Variables: { userId: string | null } };
// export const managementRoutes = new Hono<AppEnv>();
export const managementRoutes = new Hono<any>(); // Using <any> for broader compatibility for now

// Helper function to get Stripe instance with proper environment variables
function getStripeClient(c: any) {
  const secretKey = c.env?.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY environment variable is required');
  }
  return new Stripe(secretKey, { apiVersion: '2025-05-28.basil' });
}

//===============================================================================================================
// --- Helper: Get User ID from context ---
async function getUserIdFromContext(c: any): Promise<string | null> {
  return c.var.userId;
}
//===============================================================================================================

//===============================================================================================================
// Helper to get a privileged Supabase client (bypasses RLS)
function getPrivilegedSupabaseClient(c: any) {
  const serviceRoleKey = c.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) {
    throw new Error('Supabase service role key and URL must be provided.');
  }
  return createClient(supabaseUrl as string, serviceRoleKey as string);
}

// Helper to get an authenticated Supabase client (respects RLS)
function getAuthenticatedSupabaseClient(c: any) {
  const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL and anon key must be provided.');
  }
  
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error('Authorization header required');
  }
  
  const userJwt = authHeader.replace("Bearer ", "");
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } }
  });
}
//===============================================================================================================

// --- USAGE TRACKING & LIMITING HELPERS ---
export async function checkAndIncrementUsage({ userId, usageType, increment = 1, customDate }: { userId: string, usageType: string, increment?: number, customDate?: Date }) {
  console.log(`[checkAndIncrementUsage] >>> Enter function - userId=${userId}, usageType=${usageType}, increment=${increment}`);
  
  // Create service role client for admin usage tracking operations
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[checkAndIncrementUsage] Missing Supabase configuration for service role');
    return { allowed: false, error: 'Server configuration error', status: 500 };
  }
  
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  
  // Fetch user subscription and plan (using service role client)
  const { data: userSub, error: userSubError } = await serviceClient
    .from('user_subscriptions')
    .select('*, plan:subscription_plans(*)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();
  if (userSubError || !userSub) {
    console.error(`[Usage Limit] No active subscription found for user:`, userId, userSubError);
    return { allowed: false, error: 'No active subscription found', status: 403 };
  }
  const plan = userSub.plan;
  if (!plan) {
    console.error('[Usage Limit] No plan found for user subscription:', userSub);
    return { allowed: false, error: 'No plan found for user subscription', status: 500 };
  }
  
  // Use usage_v2 if available, fallback to usage
  let usage = userSub.usage_v2 || userSub.usage || {};
  let now = customDate || new Date();
  let today = now.toISOString().slice(0, 10); // YYYY-MM-DD
  let month = now.toISOString().slice(0, 7); // YYYY-MM
  let year = now.toISOString().slice(0, 4); // YYYY

  // Handle daily/monthly/yearly resets
  if (usage.requests_today_date !== today) {
    usage.requests_today = 0;
    usage.requests_today_date = today;
  }
  if (usage.requests_this_month_date !== month) {
    usage.requests_this_month = 0;
    usage.requests_this_month_date = month;
  }
  if (usage.requests_this_year_date !== year) {
    usage.requests_this_year = 0;
    usage.requests_this_year_date = year;
  }

  // Check limits
  if (usageType === 'requests_today' && typeof plan.max_requests_per_day === 'number' && usage.requests_today + increment > plan.max_requests_per_day) {
    console.warn(`[Usage Limit] User ${userId} exceeded max_requests_per_day (${plan.max_requests_per_day})`);
    return { allowed: false, error: `Daily request limit reached (${plan.max_requests_per_day}).`, status: 429 };
  }
  if (usageType === 'requests_this_month' && typeof plan.max_requests_per_month === 'number' && usage.requests_this_month + increment > plan.max_requests_per_month) {
    console.warn(`[Usage Limit] User ${userId} exceeded max_requests_per_month (${plan.max_requests_per_month})`);
    return { allowed: false, error: `Monthly request limit reached (${plan.max_requests_per_month}).`, status: 429 };
  }
  if (usageType === 'custom_domains' && typeof plan.max_custom_domains === 'number' && (usage.custom_domains || 0) + increment > plan.max_custom_domains) {
    console.warn(`[Usage Limit] User ${userId} exceeded max_custom_domains (${plan.max_custom_domains})`);
    return { allowed: false, error: `Custom domain limit reached (${plan.max_custom_domains}).`, status: 429 };
  }
  // --- PROJECT LIMIT ENFORCEMENT ---
  if (usageType === 'projects' && typeof plan.max_projects === 'number') {
    // Count current projects for this user (using service role client)
    const { count, error: countError } = await serviceClient
      .from('mcp_servers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (countError) {
      console.error('[Usage Limit] Failed to count projects for user:', userId, countError);
      return { allowed: false, error: 'Failed to check project limit. Please try again.', status: 500 };
    }
    if ((count || 0) + increment > plan.max_projects) {
      console.warn(`[Usage Limit] User ${userId} exceeded max_projects (${plan.max_projects})`);
      return { allowed: false, error: `Project limit reached (${plan.max_projects}).`, status: 403 };
    }
  }

  // Increment usage based on type
  if (usageType === 'requests_today') {
    usage.requests_today = (usage.requests_today || 0) + increment;
    usage.requests_this_month = (usage.requests_this_month || 0) + increment;
    usage.requests_this_year = (usage.requests_this_year || 0) + increment;
    usage.total_requests = (usage.total_requests || 0) + increment;
    usage.last_request_at = now.toISOString();
  }
  if (usageType === 'requests_this_month') {
    usage.requests_this_month = (usage.requests_this_month || 0) + increment;
    usage.requests_this_year = (usage.requests_this_year || 0) + increment;
    usage.total_requests = (usage.total_requests || 0) + increment;
    usage.last_request_at = now.toISOString();
  }
  if (usageType === 'custom_domains') usage.custom_domains = (usage.custom_domains || 0) + increment;

  // Log usage object before update
  console.log(`[checkAndIncrementUsage] Usage object before DB update:`, JSON.stringify(usage, null, 2));

  // Save usage - update to use usage_v2 (using service role client)
  const { error: usageUpdateError } = await serviceClient
    .from('user_subscriptions')
    .update({ usage_v2: usage, usage: usage })
    .eq('user_id', userId)
    .eq('status', 'active');
  if (usageUpdateError) {
    console.error('[Usage Limit] Failed to update usage for user:', userId, usageUpdateError);
    return { allowed: false, error: 'Failed to update usage. Please try again.', status: 500 };
  }
  if (usageUpdateError) {
    console.log(`[checkAndIncrementUsage] <<< Exit with failure (usageUpdateError)`);
  } else {
    console.log(`[checkAndIncrementUsage] <<< Exit success - updated usage.`);
  }
  return { allowed: true, usage, plan };
}

// New function to log detailed analytics
export async function logDetailedAnalytics({
  userId,
  projectId,
  method,
  endpoint,
  statusCode,
  responseTimeMs,
  requestSize,
  responseSize,
  errorType,
  errorMessage,
  userAgent,
  ipAddress,
  resourceType,
  resourceId,
  metadata = {}
}: {
  userId: string;
  projectId?: string;
  method: string;
  endpoint: string;
  statusCode: number;
  responseTimeMs?: number;
  requestSize?: number;
  responseSize?: number;
  errorType?: string;
  errorMessage?: string;
  userAgent?: string;
  ipAddress?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, any>;
}) {
  try {
    const { error } = await supabase
      .from('usage_analytics')
      .insert([{
        user_id: userId,
        project_id: projectId,
        method,
        endpoint,
        status_code: statusCode,
        response_time_ms: responseTimeMs,
        request_size_bytes: requestSize,
        response_size_bytes: responseSize,
        error_type: errorType,
        error_message: errorMessage,
        user_agent: userAgent,
        ip_address: ipAddress,
        resource_type: resourceType,
        resource_id: resourceId,
        metadata
      }]);

    if (error) {
      console.error('[Analytics] Failed to log analytics:', error);
    }
  } catch (err) {
    console.error('[Analytics] Exception logging analytics:', err);
  }
}
// --- END USAGE TRACKING & LIMITING HELPERS ---
//=====================================================================================================================================================

// == MCP Projects ==
managementRoutes.post('/mcp-projects', validator('json', (value) => mcpProjectCreateSchema.parse(value)), async (c) => {
  const rawAuth = c.req.header('Authorization') || '';
  const maskedAuth = rawAuth ? `${rawAuth.substring(0, 7)}...${rawAuth.substring(rawAuth.length - 4)}` : 'missing';
  console.log("[POST /mcp-projects] Incoming Authorization header (masked):", maskedAuth);
  try {
    const userId = await getUserIdFromContext(c);
    if (!userId) {
      console.log("[POST /mcp-projects] getUserIdFromContext returned null, returning 401");
      return c.json({ error: "Unauthorized: Invalid or missing token" }, 401 as ContentfulStatusCode);
    }

    // --- USAGE TRACKING & LIMITING ---
    // 1. Check project limit
    const { allowed: allowedProjects, error: errorProjects, status: statusProjects } = await checkAndIncrementUsage({ userId, usageType: 'projects' });
    if (!allowedProjects) return c.json({ error: errorProjects }, statusProjects ?? 500 as any);
    // 2. Check custom domain limit (if custom domains are part of projectData)
    const projectData = c.req.valid('json');
    const sessionManagement = (projectData as any).session_management ?? false;
    if (Array.isArray((projectData as any).custom_domains) && (projectData as any).custom_domains.length > 0) {
      const { allowed: allowedDomains, error: errorDomains, status: statusDomains } = await checkAndIncrementUsage({ userId, usageType: 'custom_domains', increment: (projectData as any).custom_domains.length });
      if (!allowedDomains) return c.json({ error: errorDomains }, statusDomains ?? 500 as any);
    }
    // --- END USAGE TRACKING & LIMITING ---

    const isPrivate = (projectData as any).is_private ?? false;
    const visible = (projectData as any).visible ?? false;
    const tags = (projectData as any).tags || null;
    const category = (projectData as any).category || null;
    const projectId = crypto.randomUUID();
    const apiKey = isPrivate ? crypto.randomUUID() : null;
    const slug = projectData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    const frontendUrl = (c.env as any)?.MCP_FRONTEND_BASE_URL || 'http://localhost:3001'; // fallback
    //'https://mcpdploy.com'; // fallback
    const endpoint = `${frontendUrl}/mcp/${slug}-${projectId}`;

    const supabasePrivileged = getPrivilegedSupabaseClient(c);

    const { data: newProject, error: projectInsertError } = await supabasePrivileged
      .from("mcp_servers")
      .insert([{
        id: projectId,
        name: projectData.name,
        description: projectData.description,
        version: projectData.version,
        user_id: userId,
        is_private: isPrivate,
        visible: visible,
        tags: tags,
        category: category,
        api_key: apiKey,
        endpoint,
        session_management: sessionManagement,
        is_active: true
      }])
      .select()
      .single();

    if (projectInsertError) {
      console.error("[POST /mcp-projects] Supabase project insert error:", projectInsertError);
      return c.json({ error: projectInsertError.message, details: projectInsertError }, 500);
    }

    if (projectData.resources && projectData.resources.length > 0) {
      const resourcesToInsert = projectData.resources.map(r => ({ ...r, server_id: projectId }));
      const { error: resError } = await supabasePrivileged.from("mcp_resources").insert(resourcesToInsert);
      if (resError) console.error("[POST /mcp-projects] Supabase resources insert error:", resError);
    }
    if (projectData.tools && projectData.tools.length > 0) {
      const toolsToInsert = projectData.tools.map(t => ({ ...t, server_id: projectId })); 
      const { error: toolError } = await supabasePrivileged.from("mcp_tools").insert(toolsToInsert);
      if (toolError) console.error("[POST /mcp-projects] Supabase tools insert error:", toolError);
    }
    if (projectData.prompts && projectData.prompts.length > 0) {
      const promptsToInsert = projectData.prompts.map(p => ({ ...p, server_id: projectId }));
      const { error: promptError } = await supabasePrivileged.from("mcp_prompts").insert(promptsToInsert);
      if (promptError) console.error("[POST /mcp-projects] Supabase prompts insert error:", promptError);
    }
    
    const { data: createdProjectWithSubItems, error: fetchError } = await supabasePrivileged
      .from("mcp_servers")
      .select("*, mcp_resources(*), mcp_tools(*), mcp_prompts(*)")
      .eq("id", projectId)
      .eq("user_id", userId) 
      .single();
      
    if (fetchError) {
        console.error("[POST /mcp-projects] Error fetching newly created project with sub-items:", fetchError);
        return c.json(newProject, 201); 
    }

    return c.json(createdProjectWithSubItems || newProject, 201);

  } catch (err: any) {
    console.error("[POST /mcp-projects] Handler error:", err);
    return c.json({ error: err.message || String(err) }, 500);
  }
});

//========================================================================================================================================================================

managementRoutes.get('/mcp-projects', async (c) => {
  const userId = await getUserIdFromContext(c);
  if (!userId) return c.json({ error: "Unauthorized: Invalid or missing token" }, 401 as any);
  const { data, error } = await supabase.from("mcp_servers").select("*").eq("user_id", userId);
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

//========================================================================================================================================================================

managementRoutes.get('/mcp-projects/:id', async (c) => {
  const userId = await getUserIdFromContext(c);
  if (!userId) return c.json({ error: "Unauthorized: Invalid or missing token" }, 401 as ContentfulStatusCode);
  const { id } = c.req.param();
  const { data, error } = await supabase
    .from("mcp_servers")
    .select("*, mcp_resources(*), mcp_tools(*), mcp_prompts(*)")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  
  if (error || !data) return c.json({ error: "https://mcpdploy.comt found or access denied" }, 404);
  return c.json(data);
});

//========================================================================================================================================================================

managementRoutes.put('/mcp-projects/:id', validator('json', (value) => mcpProjectUpdateSchema.parse(value)), async (c) => {
  const userId = await getUserIdFromContext(c);
  if (!userId) return c.json({ error: "Unauthorized: Invalid or missing token" }, 401 as ContentfulStatusCode);
  const { id: projectId } = c.req.param();
  const projectUpdateData = c.req.valid('json');
  const supabasePrivileged = getPrivilegedSupabaseClient(c);

  try {
    const { name, description, version, is_private, visible, is_active, tags, category, resources, tools, prompts } = projectUpdateData;
    const mainProjectDataToUpdate: any = {};
    if (name !== undefined) mainProjectDataToUpdate.name = name;
    if (description !== undefined) mainProjectDataToUpdate.description = description;
    if (version !== undefined) mainProjectDataToUpdate.version = version;
    if (is_private !== undefined) mainProjectDataToUpdate.is_private = is_private;
    if (visible !== undefined) mainProjectDataToUpdate.visible = visible;
    if (projectUpdateData.session_management !== undefined) mainProjectDataToUpdate.session_management = projectUpdateData.session_management;
    if (is_active !== undefined) mainProjectDataToUpdate.is_active = is_active;
    if (tags !== undefined) mainProjectDataToUpdate.tags = tags;
    if (category !== undefined) mainProjectDataToUpdate.category = category; 

    if (Object.keys(mainProjectDataToUpdate).length > 0) {
      const { error: mainUpdateError } = await supabasePrivileged
        .from("mcp_servers")
        .update(mainProjectDataToUpdate)
        .eq("id", projectId)
        .eq("user_id", userId); 
      if (mainUpdateError) throw new Error(`Error updating main project: ${mainUpdateError.message}`);
    }

    const syncSubItems = async (itemName: string, itemsInRequest: any[] | undefined, dbTableName: string, fkName: string) => {
      if (!itemsInRequest) return;

      const { data: existingItems, error: fetchError } = await supabasePrivileged
        .from(dbTableName)
        .select("id")
        .eq(fkName, projectId);
      if (fetchError) throw new Error(`Error fetching existing ${itemName}: ${fetchError.message}`);

      const existingItemIds = new Set(existingItems?.map((item: { id: string }) => item.id) || []);
      const requestItemIds = new Set();
      const itemsToCreate = [];
      const itemsToUpdate = [];

      for (const item of itemsInRequest) {
        const { id, ...itemData } = item;
        if (id && existingItemIds.has(id)) { 
          itemsToUpdate.push({ id, ...itemData });
          requestItemIds.add(id);
        } else { 
          itemsToCreate.push({ ...itemData, [fkName]: projectId });
        }
      }

      const itemsToDelete = Array.from(existingItemIds).filter(id => !requestItemIds.has(id));

      if (itemsToCreate.length > 0) {
        const { error } = await supabasePrivileged.from(dbTableName).insert(itemsToCreate);
        if (error) throw new Error(`Error creating ${itemName}: ${error.message}`);
      }
      for (const itemToUpdate of itemsToUpdate) {
        const { error } = await supabasePrivileged.from(dbTableName).update(itemToUpdate).eq("id", itemToUpdate.id).eq(fkName, projectId);
        if (error) throw new Error(`Error updating ${itemName} ${itemToUpdate.id}: ${error.message}`);
      }
      if (itemsToDelete.length > 0) {
        const { error } = await supabasePrivileged.from(dbTableName).delete().in("id", itemsToDelete).eq(fkName, projectId);
        if (error) throw new Error(`Error deleting ${itemName}: ${error.message}`);
      }
    };

    await syncSubItems('resources', resources, 'mcp_resources', 'server_id');
    await syncSubItems('tools', tools, 'mcp_tools', 'server_id');
    await syncSubItems('prompts', prompts, 'mcp_prompts', 'server_id');

    const { data: updatedProject, error: fetchUpdatedError } = await supabasePrivileged
      .from("mcp_servers")
      .select("*, mcp_resources(*), mcp_tools(*), mcp_prompts(*)")
      .eq("id", projectId)
      .eq("user_id", userId) 
      .single();
    
    if (fetchUpdatedError) throw new Error(`Failed to fetch updated project: ${fetchUpdatedError.message}`);
    return c.json(updatedProject);

  } catch (err: any) {
    console.error(`[PUT /mcp-projects/:id] Handler error for ID ${projectId}:`, err);
    return c.json({ error: err.message || String(err) }, err.message?.includes("not found") ? 404 : 500);
  }
});

//========================================================================================================================================================================

managementRoutes.delete('/mcp-projects/:id', async (c) => {
  const userId = await getUserIdFromContext(c);
  if (!userId) return c.json({ error: "Unauthorized: Invalid or missing token" }, 401 as ContentfulStatusCode);
  const { id } = c.req.param();
  const supabasePrivileged = getPrivilegedSupabaseClient(c);

  const { error } = await supabasePrivileged
    .from("mcp_servers")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) return c.json({ error: error.message }, error.message?.includes("not found") || error.code === 'PGRST116' ? 404 : 500);
  return c.json({ message: "Project deleted successfully" }, 200);
});

//========================================================================================================================================================================

// Create Stripe Checkout Session
managementRoutes.post('/stripe/create-checkout-session', async (c) => {
  const { plan_id } = await c.req.json();
  const userId = await getUserIdFromContext(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401 as ContentfulStatusCode);

  // Fetch plan from Supabase
  const { data: plan, error: planError } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('id', plan_id)
    .single();
  if (planError || !plan) return c.json({ error: 'Invalid plan' }, 400);

  // Create Stripe Checkout Session with metadata
  const stripe = getStripeClient(c);
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    success_url: `${c.env?.MCP_FRONTEND_BASE_URL || 'https://mcpdploy.com'}/dashboard?success=true`,
    cancel_url: `${c.env?.MCP_FRONTEND_BASE_URL || 'https://mcpdploy.com'}/dashboard?canceled=true`,
    customer_email: c.req.header('x-user-email') || undefined,
    metadata: {
      user_id: userId,
      plan_id: plan_id
    },
    subscription_data: {
      metadata: {
        user_id: userId,
        plan_id: plan_id
      }
    }
  });
  return c.json({ url: session.url });
});

//========================================================================================================================================================================

// Stripe Webhook
managementRoutes.post('/stripe/webhook', async (c) => {
  const sig = c.req.header('stripe-signature');
  const rawBody = await c.req.text();
  console.log('[Stripe Webhook] Signature:', sig);
  console.log('[Stripe Webhook] Raw body length:', rawBody.length);
  
  // Get webhook secret from environment
  const webhookSecret = c.env?.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  console.log("line 543 [Stripe Webhook] >>> Enter function - webhookSecret:", webhookSecret);
  if (!webhookSecret) {
    console.error('[Stripe Webhook] Missing STRIPE_WEBHOOK_SECRET');
    return c.json({ error: 'Webhook secret not configured' }, 500);
  }
  
  // Initialize Stripe client
  const stripe = getStripeClient(c);
  
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig!, webhookSecret);
  } catch (err: any) {
    console.error('[Stripe Webhook] Error constructing event:', err.message, err);
    return c.json({ error: `Webhook Error: ${err.message}` }, 400);
  }

  console.log('[Stripe Webhook] Event type:', event.type);

  // Helper to upsert subscription
  async function upsertSubscription({ userId, planId, status = 'active', periodEnd }: { userId: string, planId: string, status?: string, periodEnd?: string }) {
    try {
      // Use service role client for admin operations
      const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
      const supabaseServiceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      if (!supabaseUrl || !supabaseServiceKey) {
        console.error('[Stripe Webhook] Missing Supabase configuration');
        return;
      }
      
      const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
      
      const { error: upsertError } = await serviceClient.from('user_subscriptions').upsert([
        {
          user_id: userId,
          plan_id: planId,
          status,
          current_period_end: periodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }
      ], { onConflict: 'user_id' });
      if (upsertError) {
        console.error('[Stripe Webhook] Upsert error:', upsertError);
      } else {
        console.log(`[Stripe Webhook] Upserted subscription for user_id=${userId}, plan_id=${planId}, status=${status}`);
      }
    } catch (err: any) {
      console.error('[Stripe Webhook] Exception during upsert:', err.message, err);
    }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id;
    const planId = session.metadata?.plan_id;
    const stripeSubscriptionId = session.subscription as string;
    console.log('[Stripe Webhook] checkout.session.completed:', { userId, planId, customer: session.customer, customer_email: session.customer_email, stripeSubscriptionId });
    if (userId && planId && stripeSubscriptionId) {
      const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
      const supabaseServiceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      if (supabaseUrl && supabaseServiceKey) {
        const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
        
        await serviceClient.from('user_subscriptions').upsert([
          {
            user_id: userId,
            plan_id: planId,
            status: 'active',
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            stripe_subscription_id: stripeSubscriptionId
          }
        ], { onConflict: 'user_id' });
      }
    } else {
      console.warn('[Stripe Webhook] Missing user_id, plan_id, or stripeSubscriptionId in session metadata.');
    }
  }

  if (event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice;
    const userId = invoice.metadata?.user_id;
    let planId = invoice.metadata?.plan_id;
    const customer = invoice.customer;
    const customerEmail = invoice.customer_email;
    console.log('[Stripe Webhook] invoice.paid:', { userId, planId, customer, customerEmail });
    // Try to get planId from invoice lines if not present
    if (!planId && invoice.lines && invoice.lines.data && invoice.lines.data.length > 0) {
      // Stripe types may not include 'price' on InvoiceLineItem, but it exists in the API response
      const firstLine = invoice.lines.data[0] as any;
      if (firstLine && firstLine.price && firstLine.price.id) {
        planId = firstLine.price.id;
        console.log('[Stripe Webhook] Extracted planId from invoice lines:', planId);
      } else {
        console.warn('[Stripe Webhook] Could not extract planId from invoice lines.');
      }
    }
    if (!userId) {
      console.warn('[Stripe Webhook] invoice.paid: userId missing in metadata. This can happen for the first invoice after subscription creation. Skipping upsert.');
      return c.json({ received: true });
    }
    if (planId) {
      await upsertSubscription({ userId, planId, status: 'active', periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : undefined });
    } else {
      console.warn('[Stripe Webhook] Could not upsert subscription: missing planId in metadata.');
    }
  }

  // Handle subscription updates (including cancellations)
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription;
    console.log('[Stripe Webhook] 🔄 customer.subscription.updated EVENT RECEIVED');
    console.log('[Stripe Webhook] 📋 Event Details:', { 
      subscriptionId: subscription.id, 
      status: subscription.status, 
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd: (subscription as any).current_period_end,
      customerId: subscription.customer,
      metadata: subscription.metadata
    });

    try {
      // Use service role client for admin operations
      const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
      const supabaseServiceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      if (!supabaseUrl || !supabaseServiceKey) {
        console.error('[Stripe Webhook] ❌ Missing Supabase configuration');
        return c.json({ error: 'Server configuration error' }, 500);
      }
      
      console.log('[Stripe Webhook] 🔍 Searching for user subscription in database...');
      const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
      
      // Find the user subscription by Stripe subscription ID
      const { data: userSub, error: findError } = await serviceClient
        .from('user_subscriptions')
        .select('*')
        .eq('stripe_subscription_id', subscription.id)
        .single();
      
      if (findError || !userSub) {
        console.warn('[Stripe Webhook] ⚠️ No user subscription found for Stripe subscription:', subscription.id);
        console.warn('[Stripe Webhook] 🔍 Search query:', { stripe_subscription_id: subscription.id });
        return c.json({ received: true });
      }

      console.log('[Stripe Webhook] ✅ Found user subscription:', {
        userId: userSub.user_id,
        planId: userSub.plan_id,
        currentStatus: userSub.status,
        currentCancelAtPeriodEnd: userSub.cancel_at_period_end
      });

      // Update subscription status and cancellation info
      const updateData: any = {
        status: subscription.status,
        current_period_end: (subscription as any).current_period_end ? new Date((subscription as any).current_period_end * 1000).toISOString() : null,
        updated_at: new Date().toISOString()
      };

      // Handle cancellation at period end
      if (subscription.cancel_at_period_end) {
        updateData.cancel_at_period_end = true;
        updateData.canceled_at = new Date().toISOString();
        console.log(`[Stripe Webhook] 🚫 Subscription ${subscription.id} marked to cancel at period end for user ${userSub.user_id}`);
        console.log(`[Stripe Webhook] 📅 Cancellation scheduled for: ${updateData.current_period_end}`);
      } else if (subscription.status === 'active' && userSub.cancel_at_period_end) {
        // Subscription was reactivated
        updateData.cancel_at_period_end = false;
        updateData.canceled_at = null;
        console.log(`[Stripe Webhook] ✅ Subscription ${subscription.id} reactivated for user ${userSub.user_id}`);
      }

      // Handle plan changes from Stripe Portal
      if (subscription.items && subscription.items.data && subscription.items.data.length > 0) {
        const currentItem = subscription.items.data[0];
        const currentPriceId = currentItem.price?.id;
        
        if (currentPriceId) {
          console.log('[Stripe Webhook] 🔍 Checking for plan changes...');
          console.log('[Stripe Webhook] 📊 Current Stripe price ID:', currentPriceId);
          console.log('[Stripe Webhook] 📊 Current database plan ID:', userSub.plan_id);
          
          // Find the plan that matches this Stripe price ID
          const { data: planMatch, error: planError } = await serviceClient
            .from('subscription_plans')
            .select('id, name, price, stripe_price_id')
            .eq('stripe_price_id', currentPriceId)
            .single();
          
          if (planError) {
            console.warn('[Stripe Webhook] ⚠️ Could not find plan for Stripe price ID:', currentPriceId);
          } else if (planMatch && planMatch.id !== userSub.plan_id) {
            // Plan has changed - update the database
            updateData.plan_id = planMatch.id;
            console.log(`[Stripe Webhook] 🔄 Plan change detected!`);
            console.log(`[Stripe Webhook] 📈 From plan: ${userSub.plan_id}`);
            console.log(`[Stripe Webhook] 📉 To plan: ${planMatch.id} (${planMatch.name})`);
            console.log(`[Stripe Webhook] 💰 New price: $${(planMatch.price / 100).toFixed(2)}`);
          } else if (planMatch) {
            console.log('[Stripe Webhook] ✅ Plan unchanged - same Stripe price ID');
          }
        }
      }

      console.log('[Stripe Webhook] 🔄 Attempting database update with data:', updateData);

      // Update the subscription in database
      const { error: updateError } = await serviceClient
        .from('user_subscriptions')
        .update(updateData)
        .eq('stripe_subscription_id', subscription.id);
      
      if (updateError) {
        console.error('[Stripe Webhook] ❌ Failed to update subscription:', updateError);
        console.error('[Stripe Webhook] 🔍 Update query details:', {
          table: 'user_subscriptions',
          stripe_subscription_id: subscription.id,
          updateData
        });
      } else {
        console.log(`[Stripe Webhook] ✅ Successfully updated subscription ${subscription.id} for user ${userSub.user_id}`);
        console.log(`[Stripe Webhook] 📊 Final status: ${updateData.status}, Cancel at period end: ${updateData.cancel_at_period_end}`);
      }
    } catch (err: any) {
      console.error('[Stripe Webhook] 💥 Error handling subscription update:', err.message);
      console.error('[Stripe Webhook] 🔍 Error details:', {
        errorType: err.type,
        errorCode: err.code,
        stack: err.stack
      });
    }
  }

  // Handle subscription deletions
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;
    console.log('[Stripe Webhook] 🗑️ customer.subscription.deleted EVENT RECEIVED');
    console.log('[Stripe Webhook] 📋 Event Details:', { 
      subscriptionId: subscription.id, 
      status: subscription.status,
      customerId: subscription.customer,
      metadata: subscription.metadata
    });

    try {
      // Use service role client for admin operations
      const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
      const supabaseServiceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      if (!supabaseUrl || !supabaseServiceKey) {
        console.error('[Stripe Webhook] ❌ Missing Supabase configuration');
        return c.json({ error: 'Server configuration error' }, 500);
      }
      
      console.log('[Stripe Webhook] 🔍 Searching for user subscription in database...');
      const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
      
      // Find and update the user subscription
      const { data: userSub, error: findError } = await serviceClient
        .from('user_subscriptions')
        .select('*')
        .eq('stripe_subscription_id', subscription.id)
        .single();
      
      if (findError || !userSub) {
        console.warn('[Stripe Webhook] ⚠️ No user subscription found for deleted Stripe subscription:', subscription.id);
        console.warn('[Stripe Webhook] 🔍 Search query:', { stripe_subscription_id: subscription.id });
        return c.json({ received: true });
      }

      console.log('[Stripe Webhook] ✅ Found user subscription:', {
        userId: userSub.user_id,
        planId: userSub.plan_id,
        currentStatus: userSub.status,
        currentCancelAtPeriodEnd: userSub.cancel_at_period_end
      });

      const updateData = {
        status: 'canceled',
        canceled_at: new Date().toISOString(),
        cancel_at_period_end: false,
        updated_at: new Date().toISOString()
      };

      console.log('[Stripe Webhook] 🔄 Attempting database update with data:', updateData);

      // Update subscription status to canceled
      const { error: updateError } = await serviceClient
        .from('user_subscriptions')
        .update(updateData)
        .eq('stripe_subscription_id', subscription.id);
      
      if (updateError) {
        console.error('[Stripe Webhook] ❌ Failed to update deleted subscription:', updateError);
        console.error('[Stripe Webhook] 🔍 Update query details:', {
          table: 'user_subscriptions',
          stripe_subscription_id: subscription.id,
          updateData
        });
      } else {
        console.log(`[Stripe Webhook] ✅ Successfully marked subscription ${subscription.id} as canceled for user ${userSub.user_id}`);
        console.log(`[Stripe Webhook] 📊 Final status: canceled, Canceled at: ${updateData.canceled_at}`);
        
        // Verify the update by fetching the updated record
        const { data: updatedSub, error: verifyError } = await serviceClient
          .from('user_subscriptions')
          .select('status, canceled_at, cancel_at_period_end, updated_at')
          .eq('stripe_subscription_id', subscription.id)
          .single();
        
        if (verifyError) {
          console.warn('[Stripe Webhook] ⚠️ Could not verify update:', verifyError);
        } else {
          console.log('[Stripe Webhook] 🔍 Verification - Updated record:', updatedSub);
        }
      }
    } catch (err: any) {
      console.error('[Stripe Webhook] 💥 Error handling subscription deletion:', err.message);
      console.error('[Stripe Webhook] 🔍 Error details:', {
        errorType: err.type,
        errorCode: err.code,
        stack: err.stack
      });
    }
  }

  // Handle other events (subscription updated, canceled, etc.) as needed
  return c.json({ received: true });
});

//========================================================================================================================================================================

// Get current user's subscription plan
managementRoutes.get('/subscription/plan', async (c) => {
  const userId = await getUserIdFromContext(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401 as ContentfulStatusCode);
  
  try {
    // Use authenticated client that respects RLS
    const authenticatedSupabase = getAuthenticatedSupabaseClient(c);
    
    const { data: sub, error } = await authenticatedSupabase
      .from('user_subscriptions')
      .select('*, plan:subscription_plans(*)')
      .eq('user_id', userId)
      .single();
    if (error || !sub) return c.json({ error: 'No subscription found' }, 404);
    
    // Count current projects for this user
    const { count: projectCount, error: countError } = await authenticatedSupabase
      .from('mcp_servers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    if (countError) {
      console.error('[Subscription Plan] Failed to count projects for user:', userId, countError);
    }
    
    // Add project count to the usage object
    const enhancedSub = {
      ...sub,
      usage: {
        ...sub.usage,
        mcp_server_count: projectCount || 0
      }
    };
    
    return c.json(enhancedSub);
  } catch (error: any) {
    if (error.message === 'Authorization header required') {
      return c.json({ error: 'Authorization header required' }, 401 as ContentfulStatusCode);
    }
    return c.json({ error: 'Server configuration error' }, 500 as ContentfulStatusCode);
  }
});

//========================================================================================================================================================================

// Get all available subscription plans
managementRoutes.get('/subscription/plans', async (c) => {
  const { data: plans, error } = await supabase.from('subscription_plans').select('*');
  if (error) return c.json({ error: error.message }, 500);
  return c.json(plans);
});

//========================================================================================================================================================================

// Cancel Subscription Endpoint
managementRoutes.post('/subscription/cancel', async (c) => {
  const userId = await getUserIdFromContext(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401 as ContentfulStatusCode);

  // 1. Look up the user's active subscription
  const { data: sub, error: subError } = await supabase
    .from('user_subscriptions')
    .select('*, plan:subscription_plans(*), stripe_subscription_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();
  if (subError || !sub) {
    console.error('[Cancel Subscription] No active subscription found:', subError);
    return c.json({ error: 'No active subscription found' }, 404);
  }
  const stripeSubId = sub.stripe_subscription_id;
  if (!stripeSubId) {
    console.error('[Cancel Subscription] No Stripe subscription ID found for user:', userId);
    return c.json({ error: 'No Stripe subscription ID found' }, 500);
  }

  // 2. Set cancel_at_period_end in Stripe
  try {
    const stripe = getStripeClient(c);
    await stripe.subscriptions.update(stripeSubId, { cancel_at_period_end: true });
    console.log(`[Cancel Subscription] Stripe subscription ${stripeSubId} set to cancel at period end for user ${userId}`);
  } catch (err: any) {
    console.error('[Cancel Subscription] Stripe API error:', err.message, err);
    return c.json({ error: 'Failed to set cancel at period end in Stripe' }, 500);
  }

  // 3. Optionally, update Supabase to reflect cancel_at_period_end (not status)
  const { error: updateError } = await supabase
    .from('user_subscriptions')
    .update({ cancel_at_period_end: true })
    .eq('user_id', userId)
    .eq('plan_id', sub.plan_id);
  if (updateError) {
    console.error('[Cancel Subscription] Failed to update Supabase record:', updateError);
    return c.json({ error: 'Failed to update subscription cancel flag' }, 500);
  }

  return c.json({ message: 'Subscription will remain active until the end of the billing period and then be canceled.' });
});

//========================================================================================================================================================================

// Resume (Uncancel) Subscription Endpoint
managementRoutes.post('/subscription/resume', async (c) => {
  const userId = await getUserIdFromContext(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401 as ContentfulStatusCode);

  // 1. Look up the user's subscription set to cancel at period end
  const { data: sub, error: subError } = await supabase
    .from('user_subscriptions')
    .select('*, plan:subscription_plans(*), stripe_subscription_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('cancel_at_period_end', true)
    .single();
  if (subError || !sub) {
    console.error('[Resume Subscription] No canceling subscription found:', subError);
    return c.json({ error: 'No canceling subscription found' }, 404);
  }
  const stripeSubId = sub.stripe_subscription_id;
  if (!stripeSubId) {
    console.error('[Resume Subscription] No Stripe subscription ID found for user:', userId);
    return c.json({ error: 'No Stripe subscription ID found' }, 500);
  }

  // 2. Set cancel_at_period_end to false in Stripe
  try {
    const stripe = getStripeClient(c);
    await stripe.subscriptions.update(stripeSubId, { cancel_at_period_end: false });
    console.log(`[Resume Subscription] Stripe subscription ${stripeSubId} uncanceled for user ${userId}`);
  } catch (err: any) {
    console.error('[Resume Subscription] Stripe API error:', err.message, err);
    return c.json({ error: 'Failed to resume subscription in Stripe' }, 500);
  }

  // 3. Update Supabase to reflect cancel_at_period_end = false
  const { error: updateError } = await supabase
    .from('user_subscriptions')
    .update({ cancel_at_period_end: false })
    .eq('user_id', userId)
    .eq('plan_id', sub.plan_id);
  if (updateError) {
    console.error('[Resume Subscription] Failed to update Supabase record:', updateError);
    return c.json({ error: 'Failed to update subscription resume flag' }, 500);
  }

  return c.json({ message: 'Subscription will continue and will not be canceled at period end.' });
});

//========================================================================================================================================================================

// Public endpoint to get all visible projects (no authentication required)
managementRoutes.get('/public/mcp-projects', async (c) => {
  try {
    // Query all projects where visible=true and is_active=true
    // Return only basic project information
    const { data, error } = await supabase
      .from("mcp_servers")
      .select(`
        name,
        description,
        version,
        tags,
        category,
        endpoint,
        created_at
      `)
      .eq('visible', true)
      .eq('is_active', true);

    if (error) {
      console.error("[GET /public/mcp-projects] Supabase error:", error);
      return c.json({ error: "Failed to fetch visible projects" }, 500);
    }

    return c.json(data || []);
  } catch (err: any) {
    console.error("[GET /public/mcp-projects] Handler error:", err);
    return c.json({ error: err.message || String(err) }, 500);
  }
});

//========================================================================================================================================================================

// NOTE: MCP API request usage tracking has been moved to mcpDynamicHandler to avoid double counting
//========================================================================================================================================================================

// Get user payment history from Stripe with invoice details
managementRoutes.get('/stripe/payment-history', async (c) => {
  const userId = await getUserIdFromContext(c);
  console.log('line 821 User ID:', userId);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401 as ContentfulStatusCode);

  try {

    const authenticatedSupabase =  getAuthenticatedSupabaseClient(c)
    
    // Get user's Stripe customer ID from their subscription
    const { data: subscription, error: subError } = await authenticatedSupabase
      .from('user_subscriptions')
      .select('stripe_subscription_id, plan:subscription_plans(*)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    console.log('[Stripe Payment History] Subscription query result:', { subscription, subError, userId });

    // Check if this is a free plan (no Stripe subscription)
    console.log('line 839', (subscription?.plan as any)?.price);
    if ((subscription?.plan as any)?.price === 0) {
      return c.json({ 
        error: 'Free plan users have no payment history',
        message: 'Payment history is only available for paid subscriptions'
      }, 400);
    }

    if (subError || !subscription?.stripe_subscription_id) {
      return c.json({ error: 'No active paid subscription found' }, 404);
    }

    // Initialize Stripe client
    const stripe = getStripeClient(c);
    
    // Get the subscription to find the customer ID
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
    const customerId = stripeSubscription.customer as string;

    // Fetch all invoices for this customer
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 100, // Adjust as needed
      status: 'paid',
    });

    // Fetch all charges for this customer (includes failed payments)
    const charges = await stripe.charges.list({
      customer: customerId,
      limit: 100, // Adjust as needed
    });

    // Combine and format the payment history
    const paymentHistory = [];

    // Add successful payments from invoices with full details
    for (const invoice of invoices.data) {
      if (invoice.status === 'paid' && invoice.amount_paid > 0) {
        paymentHistory.push({
          date: new Date(invoice.created * 1000).toISOString(),
          status: 'Paid',
          amount: (invoice.amount_paid / 100).toFixed(2), // Convert from cents
          currency: invoice.currency.toUpperCase(),
          invoice: {
            id: invoice.id,
            number: invoice.number,
            url: invoice.hosted_invoice_url,
            pdf_url: invoice.invoice_pdf,
            description: invoice.description || `Subscription payment`,
            lines: invoice.lines.data.map(line => ({
              description: line.description,
              amount: (line.amount / 100).toFixed(2),
              quantity: line.quantity,
              unit_amount: (line as any).unit_amount ? ((line as any).unit_amount / 100).toFixed(2) : null,
            })),
            customer: {
              email: invoice.customer_email,
              name: invoice.customer_name,
            },
            subscription_id: (invoice as any).subscription,
          },
        });
      }
    }

    // Add failed payments from charges
    for (const charge of charges.data) {
      if (charge.status === 'failed') {
        paymentHistory.push({
          date: new Date(charge.created * 1000).toISOString(),
          status: 'Failed',
          amount: (charge.amount / 100).toFixed(2), // Convert from cents
          currency: charge.currency.toUpperCase(),
          invoice: null, // Failed charges don't have invoices
          description: charge.description || `Payment attempt`,
          charge_id: charge.id,
        });
      }
    }

    // Sort by date (newest first)
    paymentHistory.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return c.json({
      customer_id: customerId,
      payment_history: paymentHistory,
      total_payments: paymentHistory.filter(p => p.status === 'Paid').length,
      total_failed: paymentHistory.filter(p => p.status === 'Failed').length,
      summary: {
        total_paid: paymentHistory
          .filter(p => p.status === 'Paid')
          .reduce((sum, p) => sum + parseFloat(p.amount), 0)
          .toFixed(2),
        total_failed: paymentHistory
          .filter(p => p.status === 'Failed')
          .reduce((sum, p) => sum + parseFloat(p.amount), 0)
          .toFixed(2),
      }
    });

  } catch (error: any) {
    console.error('[Stripe Payment History] Error:', error);
    
    if (error.type === 'StripeInvalidRequestError') {
      return c.json({ error: 'Invalid Stripe request' }, 400);
    }
    
    return c.json({ 
      error: 'Failed to fetch payment history',
      details: error.message 
    }, 500);
  }
});

//========================================================================================================================================================================
// Add this new endpoint to create a Customer Portal session
//========================================================================================================================================================================

managementRoutes.post('/stripe/create-portal-session', async (c) => {
  const userId = await getUserIdFromContext(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401 as ContentfulStatusCode);

  try {
    const authenticatedSupabase = getAuthenticatedSupabaseClient(c);
    
    // Get user's subscription and plan details
    const { data: subscription, error: subError } = await authenticatedSupabase
      .from('user_subscriptions')
      .select('stripe_subscription_id, stripe_customer_id, plan:subscription_plans(*)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (subError || !subscription) {
      return c.json({ error: 'No active subscription found' }, 404);
    }

    // Check if user has a paid plan (has Stripe subscription)
    if (!subscription.stripe_subscription_id) {
      // Free user - provide upgrade option instead of portal access
      return c.json({
        error: 'Portal access requires a paid subscription',
        message: 'Free users cannot access the billing portal. Please upgrade to a paid plan to manage billing.',
        action: 'upgrade',
        current_plan: subscription.plan,
        upgrade_url: `${c.env?.MCP_FRONTEND_BASE_URL || 'https://mcpdploy.com'}/dashboard/billing`
      }, 403);
    }

    // Initialize Stripe client
    const stripe = getStripeClient(c);
    
    // Get the subscription to find the customer ID
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
    const customerId = stripeSubscription.customer as string;

    // Create a Customer Portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${c.env?.MCP_FRONTEND_BASE_URL || 'https://mcpdploy.com'}/dashboard`,
    });

    return c.json({ url: session.url });

  } catch (error: any) {
    console.error('[Stripe Portal Session] Error:', error);
    return c.json({ 
      error: 'Failed to create portal session',
      details: error.message 
    }, 500);
  }
});