import { Hono } from "hono";
import { cors } from "hono/cors";
import { supabaseAuthMiddleware } from './middleware/auth';
import { analyticsMiddleware } from './middleware/analytics';
import { authRoutes } from './routes/auth';
import { openapiRoutes } from './routes/openapi';
import { managementRoutes } from './routes/management';
import { mcpDynamicHandler } from './mcp/handler';
import { supportRoutes } from './routes/support';
import { analyticsRoutes } from './routes/analytics';

// Define environment bindings for Cloudflare Workers
type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
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
app.use('/stripe/create-portal-session', supabaseAuthMiddleware);
app.use('/stripe/payment-history', supabaseAuthMiddleware);
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

// Dynamic MCP server routes (match any identifier)
app.all('/mcp/:mcpIdentifier/*', mcpDynamicHandler);
app.all('/mcp/:mcpIdentifier', mcpDynamicHandler);

// Fallback for /mcp if no identifier matches
app.all('/mcp', (c) => c.json({ error: 'MCP Project identifier missing or invalid. Format: /mcp/name-uuid' }, 400));
app.all('/mcp/', (c) => c.json({ error: 'MCP Project identifier missing or invalid. Format: /mcp/name-uuid' }, 400));

// Mount routes
app.route('/', openapiRoutes);
app.route('/', authRoutes);
app.route('/', managementRoutes);
app.route('/', supportRoutes);
app.route('/', analyticsRoutes);

export default app;
