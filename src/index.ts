import { Hono } from "hono";
import { DurableObject } from 'cloudflare:workers';
import { cors } from "hono/cors";
import { supabaseAuthMiddleware } from './middleware/auth';
import { analyticsMiddleware } from './middleware/analytics';
import { authRoutes } from './routes/auth';
import { openapiRoutes } from './routes/openapi';
import { managementRoutes } from './routes/management';
import { mcpDynamicHandler } from './mcp/handler';
import { supportRoutes } from './routes/support';
import { analyticsRoutes } from './routes/analytics';
import { supabase } from './lib/supabaseClient';
import { createClient } from '@supabase/supabase-js';
// Export container classes for Wrangler
export { NodeAppContainer, PythonAppContainer } from './containers/UserAppContainers';

// Define environment bindings for Cloudflare Workers
type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  // Container bindings for user applications
  NODE_CONTAINERS: DurableObjectNamespace;
  PYTHON_CONTAINERS: DurableObjectNamespace;
  // Add other bindings if necessary
};

const app = new Hono<{ Bindings: Env, Variables: { userId: string | null } }>();

// CORS middleware
app.use('*', cors({
  origin: '*', // In production, you might want to restrict this to specific domains
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'Accept',
    'Origin',
    'X-Requested-With',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers',
    'mcp-session-id'
  ],
  exposeHeaders: ['Content-Length', 'X-Kuma-Revision','mcp-session-id'],
  maxAge: 86400, // 24 hours
  credentials: true,
}));

// Add OPTIONS handler for preflight requests
app.options('*', (c) => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, Accept, Origin, X-Requested-With, Access-Control-Request-Method, Access-Control-Request-Headers',
      'Access-Control-Max-Age': '86400',
      'Access-Control-Allow-Credentials': 'true'
    }
  });
});

// Apply auth middleware to protected routes
app.use('/mcp-projects', supabaseAuthMiddleware);
app.use('/mcp-projects/*', supabaseAuthMiddleware);
app.use('/subscription/plan', supabaseAuthMiddleware);
app.use('/subscription/cancel', supabaseAuthMiddleware);
app.use('/subscription/resume', supabaseAuthMiddleware);
app.use('/stripe/create-checkout-session', supabaseAuthMiddleware);
app.use('/auth/change-password', supabaseAuthMiddleware);
app.use('/support/tickets', supabaseAuthMiddleware);
app.use('/analytics/*', supabaseAuthMiddleware);

// Apply analytics middleware after auth for protected routes
app.use('/mcp-projects', analyticsMiddleware);
app.use('/mcp-projects/*', analyticsMiddleware);
// Note: /mcp/* routes have their own usage tracking in mcpDynamicHandler
app.use('/subscription/*', analyticsMiddleware);
app.use('/analytics/*', analyticsMiddleware);
app.use('/support/*', analyticsMiddleware);
// Protect container management endpoints
app.use('/containers/upload', supabaseAuthMiddleware);
app.use('/containers/servers', supabaseAuthMiddleware);
app.use('/containers/servers/*', supabaseAuthMiddleware);
app.use('/containers/*', analyticsMiddleware);

// NOTE: Container proxy route is registered AFTER management routes

// Dynamic MCP server routes (match any identifier)
app.all('/mcp/:mcpIdentifier/*', mcpDynamicHandler);
app.all('/mcp/:mcpIdentifier', mcpDynamicHandler);

// Container apps routes - forward to the deployed container applications
app.all('/container-apps/:appIdentifier/*', async (c) => {
  const { appIdentifier } = c.req.param();
  
  // Extract projectId from the app identifier (expects trailing UUID)
  const uuidMatch = appIdentifier.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const projectId = uuidMatch ? uuidMatch[0] : null;
  if (!projectId) {
    return c.json({ error: 'Invalid container app identifier' }, 400);
  }
  
  // Get the container instance and forward the request
  const supabaseUrl = c.env.SUPABASE_URL;
  const serviceRoleKey = c.env.SUPABASE_SERVICE_ROLE_KEY;
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: project } = await serviceClient
    .from('container_servers')
    .select('runtime')
    .eq('id', projectId)
    .single();

  if (!project) {
    return c.json({ error: 'Container app not found' }, 404);
  }

  const runtime = project.runtime === 'node' ? 'node' : 'python';
  const containerNamespace = runtime === 'node' ? c.env.NODE_CONTAINERS : c.env.PYTHON_CONTAINERS;

  if (!containerNamespace) {
    return c.json({ error: 'Container namespace not available' }, 500);
  }

  const containerId = containerNamespace.idFromName(projectId);
  const containerInstance = containerNamespace.get(containerId);

  // Create forwarded request with path stripped of container-apps prefix
  const originalUrl = new URL(c.req.url);
  const newPath = originalUrl.pathname.replace(`/container-apps/${appIdentifier}`, '') || '/';
  const newUrl = `${originalUrl.protocol}//${originalUrl.host}${newPath}${originalUrl.search}`;

  const forwardedRequest = new Request(newUrl, {
    method: c.req.method,
    headers: c.req.header(),
    body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? await c.req.raw.arrayBuffer() : undefined
  });

  return await containerInstance.fetch(forwardedRequest);
});

app.all('/container-apps/:appIdentifier', async (c) => {
  const { appIdentifier } = c.req.param();
  
  // Extract projectId from the app identifier (expects trailing UUID)
  const uuidMatch = appIdentifier.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const projectId = uuidMatch ? uuidMatch[0] : null;
  if (!projectId) {
    return c.json({ error: 'Invalid container app identifier' }, 400);
  }
  
  // Get the container instance and forward the request
  const supabaseUrl = c.env.SUPABASE_URL;
  const serviceRoleKey = c.env.SUPABASE_SERVICE_ROLE_KEY;
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: project } = await serviceClient
    .from('container_servers')
    .select('runtime')
    .eq('id', projectId)
    .single();

  if (!project) {
    return c.json({ error: 'Container app not found' }, 404);
  }

  const runtime = project.runtime === 'node' ? 'node' : 'python';
  const containerNamespace = runtime === 'node' ? c.env.NODE_CONTAINERS : c.env.PYTHON_CONTAINERS;

  if (!containerNamespace) {
    return c.json({ error: 'Container namespace not available' }, 500);
  }

  const containerId = containerNamespace.idFromName(projectId);
  const containerInstance = containerNamespace.get(containerId);

  // Forward to root of container
  const originalUrl = new URL(c.req.url);
  const newUrl = `${originalUrl.protocol}//${originalUrl.host}/${originalUrl.search}`;

  const forwardedRequest = new Request(newUrl, {
    method: c.req.method,
    headers: c.req.header(),
    body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? await c.req.raw.arrayBuffer() : undefined
  });

  return await containerInstance.fetch(forwardedRequest);
});

// Fallback for /mcp if no identifier matches
app.all('/mcp', (c) => c.json({ error: 'MCP Project identifier missing or invalid. Format: /mcp/name-uuid' }, 400));
app.all('/mcp/', (c) => c.json({ error: 'MCP Project identifier missing or invalid. Format: /mcp/name-uuid' }, 400));

// Mount routes
app.route('/', openapiRoutes);
app.route('/', authRoutes);
app.route('/', managementRoutes);
app.route('/', supportRoutes);
app.route('/', analyticsRoutes);

// Container proxy route - forwards requests to containerized applications
// IMPORTANT: This must be registered AFTER management routes to avoid
// intercepting /containers/upload and /containers/servers/*
app.all('/containers/:projectId/*', async (c) => {
  const { projectId } = c.req.param();

  // Use service role to bypass RLS for internal routing lookups
  const supabaseUrl = c.env.SUPABASE_URL;
  const serviceRoleKey = c.env.SUPABASE_SERVICE_ROLE_KEY;
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  // Read from the new container_servers table
  const { data: project } = await serviceClient
    .from('container_servers')
    .select('runtime')
    .eq('id', projectId)
    .single();

  if (!project) {
    return c.json({ error: 'Container not found' }, 404);
  }

  // Determine runtime directly
  const runtime = project.runtime === 'node' ? 'node' : 'python';
  const containerNamespace = runtime === 'node' ? c.env.NODE_CONTAINERS : c.env.PYTHON_CONTAINERS;

  if (!containerNamespace) {
    return c.json({ error: 'Container namespace not available' }, 500);
  }

  // Get the container instance
  const containerId = containerNamespace.idFromName(projectId);
  const containerInstance = containerNamespace.get(containerId);

  // Create a new request with the path stripped of the container prefix
  const originalUrl = new URL(c.req.url);
  const newPath = originalUrl.pathname.replace(`/containers/${projectId}`, '') || '/';
  const newUrl = `${originalUrl.protocol}//${originalUrl.host}${newPath}${originalUrl.search}`;

  const forwardedRequest = new Request(newUrl, {
    method: c.req.method,
    headers: c.req.header(),
    body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? await c.req.raw.arrayBuffer() : undefined
  });

  return await containerInstance.fetch(forwardedRequest);
});

export default app;
