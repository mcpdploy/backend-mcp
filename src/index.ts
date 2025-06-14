import { Hono } from "hono";
import { cors } from "hono/cors";
import { supabaseAuthMiddleware } from './middleware/auth'; // Import the middleware
import { authRoutes } from './routes/auth'; // Import the auth routes
import { openapiRoutes } from './routes/openapi'; // Import the openapi routes
import { managementRoutes } from './routes/management'; // Import management routes
import { mcpDynamicHandler } from './mcp/handler'; // Import the new MCP dynamic handler
import { supportRoutes } from './routes/support';

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
    'Access-Control-Request-Headers'
  ],
  exposeHeaders: ['Content-Length', 'X-Kuma-Revision'],
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

// --- Auth Middleware Configuration ---
// Middleware to verify Supabase token and add userId to context
// REMOVED old supabaseAuthMiddleware definition

// Apply auth middleware to /mcp-projects and all its subroutes
app.use('/mcp-projects', supabaseAuthMiddleware);
app.use('/mcp-projects/*', supabaseAuthMiddleware);
// Only apply auth middleware to /subscription/plan and /stripe/create-checkout-session
app.use('/subscription/plan', supabaseAuthMiddleware);
app.use('/subscription/cancel', supabaseAuthMiddleware);
app.use('/subscription/resume', supabaseAuthMiddleware);
app.use('/stripe/create-checkout-session', supabaseAuthMiddleware);
app.use('/auth/change-password', supabaseAuthMiddleware);
app.use('/support/tickets', supabaseAuthMiddleware);

// --- Helper: Generate HTML Info Page ---
// REMOVE generateInfoPage function

// --- Helper: Get User ID from context ---
// async function getUserIdFromContext(c: any): Promise<string | null> {
//   return c.var.userId;
// }

// --- Management API Endpoints ---

// == MCP Projects ==
// REMOVE Management API Endpoints (POST, GET, PUT, DELETE for /mcp-projects and /mcp-projects/:id)
// REMOVE Helper: getPrivilegedSupabaseClient (if not used by mcpDynamicHandler, which it isn't currently)

// --- Dynamic MCP Server Handler ---
// Route pattern: /mcp/someName-projectUUID/optional/sub/path
// The mcpDynamicHandler function and its helpers (like generateInfoPage)
// have been moved to src/mcp/handler.ts. The old code below should be deleted.

/* DELETE THE FOLLOWING ENTIRE FUNCTION BLOCK FOR generateInfoPage */
/* function generateInfoPage(...) { ... } */

/* DELETE THE FOLLOWING ENTIRE ASYNC FUNCTION BLOCK FOR mcpDynamicHandler */
/* const mcpDynamicHandler = async (c: any) => { ... }; */

// Dynamic MCP server routes (match any identifier)
app.all('/mcp/:mcpIdentifier/*', mcpDynamicHandler); // Uses imported handler
app.all('/mcp/:mcpIdentifier', mcpDynamicHandler);  // Uses imported handler
// Fallback for /mcp if no identifier matches
app.all('/mcp', (c) => c.json({ error: 'MCP Project identifier missing or invalid. Format: /mcp/name-uuid' }, 400));
app.all('/mcp/', (c) => c.json({ error: 'MCP Project identifier missing or invalid. Format: /mcp/name-uuid' }, 400));

// --- Swagger/OpenAPI Spec ---
// REMOVED old openapi/swagger handlers

// Mount the openapi routes
app.route('/', openapiRoutes);

// Mount the auth routes
app.route('/', authRoutes);

// Mount management routes
app.route('/', managementRoutes);
app.route('/', supportRoutes);

export default app;
