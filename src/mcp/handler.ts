// handler.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import {
  CompleteRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { supabase } from "../lib/supabaseClient";
import { checkAndIncrementUsage } from "../routes/management";
import { registerResources } from "./resources";
import { registerTools } from "./tools";
import { registerPrompts } from "./prompts";

// ============================ CONFIG / CONSTANTS ============================

const NON_BILLABLE_METHODS = [
  "initialize",
  "notifications/initialized",
  "resources/list",
  "tools/list",
  "prompts/list",
  "completion/complete",
];

const SESSION_TIMEOUT = 4 * 60 * 1000; // 4 minutes

// ============================ JSON-RPC 2.0 HELPERS ============================

function createJsonRpcResponse(id: string | number | null, result?: any, error?: any) {
  const response: any = {
    jsonrpc: "2.0",
    id: id
  };
  
  if (error) {
    response.error = {
      code: error.code || -32603,
      message: error.message || "Internal error",
      data: error.data
    };
  } else if (result !== undefined) {
    response.result = result;
  }
  
  return response;
}

function createJsonRpcError(id: string | number | null, code: number, message: string, data?: any) {
  return createJsonRpcResponse(id, undefined, { code, message, data });
}

// ============================ SESSION MANAGEMENT FOR STATEFUL SESSIONS ============================

type SessionData = {
  server: McpServer;
  transport: StreamableHTTPTransport;
  created: number;
  lastActivity: number;
  projectId: string;
};

const statefulSessions = new Map<string, SessionData>();

function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of statefulSessions.entries()) {
    if (now - session.lastActivity >= SESSION_TIMEOUT) {
      try {
        console.log(`[Session Cleanup] Expiring session ${sessionId}`);
        session.transport.close?.();
      } catch (e) {
        console.log(`[Session Cleanup] Error closing ${sessionId}:`, e);
      }
      statefulSessions.delete(sessionId);
    }
  }
}

function validateAndRefreshSession(sessionId: string): SessionData | null {
  const session = statefulSessions.get(sessionId);
  if (!session) return null;
  const now = Date.now();
  if (now - session.lastActivity >= SESSION_TIMEOUT) {
    statefulSessions.delete(sessionId);
    return null;
  }
  session.lastActivity = now;
  return session;
}

function logSessionStats(): void {
  const now = Date.now();
  console.log(`[Session Stats] count=${statefulSessions.size} timeout=${SESSION_TIMEOUT / 1000}s`);
  for (const [sid, session] of statefulSessions.entries()) {
    console.log(
      `[Session Stats] ${sid} age=${Math.round((now - session.created) / 1000)}s last=${Math.round(
        (now - session.lastActivity) / 1000
      )}s project=${session.projectId}`
    );
  }
}

async function createAndConfigureMcpServer(project: any): Promise<McpServer> {
  const mcpServer = new McpServer(
    {
      name: project.name || "Dynamic MCP Server",
      version: "1.0.0",
      description: project.description || "Dynamically configured MCP server",
    },
    { capabilities: { resources: {}, tools: {}, prompts: {} } }
  );

  // Register resources, tools, prompts
  await registerResources(mcpServer, project);
  await registerTools(mcpServer, project);
  await registerPrompts(mcpServer, project);

  // Add completion handler
  try {
    const server = (mcpServer as any).server;
    server.setRequestHandler(CompleteRequestSchema, async (request: any) => {
      const { ref, argument } = request.params || {};
      if (ref?.type === "ref/resource" && argument?.name === "uri") {
        const partial = (argument.value || "").toLowerCase();
        const vals: string[] = [];
        for (const r of project.mcp_resources || []) {
          const pat = (r.uri || r.uri_pattern || r.template_pattern || "").toLowerCase();
          if (pat && (pat.startsWith(partial) || partial.startsWith(pat))) vals.push(r.uri || r.uri_pattern || r.template_pattern);
        }
        return { completion: { values: vals.slice(0, 100), total: vals.length, hasMore: vals.length > 100 } };
      }
      return { completion: { values: [], total: 0, hasMore: false } };
    });
  } catch (e) {
    console.log("[createAndConfigureMcpServer] completion handler set error:", e);
  }

  return mcpServer;
}

// ============================ MAIN HANDLER ============================

export const mcpDynamicHandler = async (c: any) => {
  console.log(`[mcpDynamicHandler] ENTER ${c.req.method} ${c.req.path}`);

  // ---------- Path & lookup ----------
  const path = c.req.path;
  const segs = path.split("/").filter(Boolean);
  if (segs.length < 2 || segs[0] !== "mcp") {
    return c.json(createJsonRpcError(null, -32600, "Invalid MCP path. Expected /mcp/<identifier>"), 400);
  }
  const mcpIdentifier = segs[1];
  const uuid = (mcpIdentifier.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0];
  const projectId = uuid || mcpIdentifier;
  console.log(`[mcpDynamicHandler] projectId=${projectId} ident=${mcpIdentifier}`);

  // ---------- Fetch project ----------
  const { data: project, error: fetchError } = await supabase
    .from("mcp_servers")
    .select(`*, mcp_resources(*), mcp_tools(*), mcp_prompts(*)`)
    .eq("id", projectId)
    .single();

  if (fetchError || !project) {
    console.error("[mcpDynamicHandler] Project lookup failed:", fetchError);
    return c.json(createJsonRpcError(null, -32601, "Project not found"), 404);
  }
  if (project.is_private) {
    const apiKey = c.req.header("X-API-Key");
    if (!apiKey || apiKey !== project.api_key) {
      return c.json(createJsonRpcError(null, -32001, "Unauthorized"), 401);
    }
  }
  if (!project.is_active) {
    return c.json(createJsonRpcError(null, -32002, "MCP project is not active."), 503);
  }

  // ---------- CORS / HTML info ----------
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, mcp-session-id",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const basePath = `/mcp/${mcpIdentifier}`;
  if (c.req.method === "GET" && (path === basePath || path === `${basePath}/`)) {
    const acceptHeader = c.req.header("accept") || "";
    
    // Return HTML info page for browser requests
    if (acceptHeader.includes("text/html")) {
      const baseUrl = process.env.MCP_FRONTEND_BASE_URL || "https://mcpdploy.com";
      const html = `<!doctype html><html><body><pre>${JSON.stringify(
        {
          name: project.name,
          id: project.id,
          active: project.is_active,
          endpoints: { base: `${baseUrl}/mcp/${mcpIdentifier}`, sse: `${baseUrl}/mcp/${mcpIdentifier}/sse` },
          resources: (project.mcp_resources || []).map((r: any) => r.name),
          tools: (project.mcp_tools || []).map((t: any) => t.name),
          prompts: (project.mcp_prompts || []).map((p: any) => p.name),
        },
        null,
        2
      )}</pre></body></html>`;
      return c.html(html);
    }
    
    // Return JSON info for other GET requests (MCP clients, API calls, etc.)
    const baseUrl = process.env.MCP_FRONTEND_BASE_URL || "https://mcpdploy.com";
    return c.json({
      name: project.name,
      id: project.id,
      active: project.is_active,
      endpoints: { 
        base: `${baseUrl}/mcp/${mcpIdentifier}`, 
        sse: `${baseUrl}/mcp/${mcpIdentifier}/sse` 
      },
      resources: (project.mcp_resources || []).map((r: any) => r.name),
      tools: (project.mcp_tools || []).map((t: any) => t.name),
      prompts: (project.mcp_prompts || []).map((p: any) => p.name),
    });
  }

  // Only allow POST requests for MCP JSON-RPC
  if (c.req.method !== "POST") {
    console.log(`[mcpDynamicHandler] Invalid method ${c.req.method} for MCP endpoint`);
    return c.json(createJsonRpcError(null, -32600, "MCP endpoints only accept POST requests for JSON-RPC communication"), 405);
  }

  // ---------- Usage tracking (billable only) ----------
  let usageTracked = false;
  const ownerId = project.user_id;
  let mcpPayload: any = undefined;

  if (c.req.header("content-type")?.includes("application/json")) {
    try {
      mcpPayload = await c.req.json();
      console.log("[mcpDynamicHandler] JSON-RPC payload:", JSON.stringify(mcpPayload, null, 2));
    } catch (e) {
      return c.json(createJsonRpcError(null, -32700, "Parse error"), 400);
    }
  }

  // Validate JSON-RPC request format
  if (!mcpPayload || typeof mcpPayload !== "object") {
    return c.json(createJsonRpcError(null, -32600, "Invalid JSON-RPC request"), 400);
  }

  if (mcpPayload.jsonrpc !== "2.0") {
    return c.json(createJsonRpcError(mcpPayload.id, -32600, "Invalid JSON-RPC version"), 400);
  }

  if (!mcpPayload.method || typeof mcpPayload.method !== "string") {
    return c.json(createJsonRpcError(mcpPayload.id, -32600, "Method is required and must be a string"), 400);
  }

  try {
    const methodName: string | undefined = mcpPayload?.method;
    const isBillable = methodName ? !NON_BILLABLE_METHODS.includes(methodName) : false;
    if (ownerId && isBillable) {
      const d1 = await checkAndIncrementUsage({ userId: ownerId, usageType: "requests_today" });
      if (!d1.allowed) return c.json(createJsonRpcError(mcpPayload?.id || null, -32003, d1.error ?? "Usage limit exceeded"), d1.status ?? 429);
      const d2 = await checkAndIncrementUsage({
        userId: ownerId,
        usageType: "requests_this_month",
        increment: 0,
      });
      if (!d2.allowed) return c.json(createJsonRpcError(mcpPayload?.id || null, -32004, d2.error ?? "Usage limit exceeded"), d2.status ?? 429);
      usageTracked = true;
    }
  } catch (e) {
    console.error("[mcpDynamicHandler] usage tracking error:", e);
  }

  // Handle JSON-RPC notifications (no id field means no response expected)
  const isNotification = mcpPayload.id === undefined || mcpPayload.id === null;
  console.log(`[mcpDynamicHandler] Processing ${isNotification ? 'notification' : 'request'}: ${mcpPayload.method}`);
  
  // Log more details about the request structure
  console.log("[mcpDynamicHandler] Request details:", {
    method: mcpPayload.method,
    hasId: mcpPayload.id !== undefined,
    idValue: mcpPayload.id,
    hasParams: !!mcpPayload.params,
    isNotification
  });

  // ============================ REQUEST HANDLING ============================

  // Session-aware branch
  if ((project as any).session_management) {
    console.log("==================== STATEFUL SESSION MANAGEMENT ENABLED ====================");

    cleanupExpiredSessions();
    logSessionStats();

    // Use project ID as the session identifier for consistency
    const sessionId = projectId;
    let session = validateAndRefreshSession(sessionId);

    if (session) {
      console.log(`[mcpDynamicHandler] Reusing existing session ${sessionId}`);
      // Use existing server and transport
      try {
        const res = await session.transport.handleRequest(c);
        session.lastActivity = Date.now();
        return res;
      } catch (e: any) {
        console.error("[mcpDynamicHandler] Error with existing session, creating new one:", e);
        // Clean up broken session
        statefulSessions.delete(sessionId);
        session = null;
      }
    }

    if (!session) {
      console.log(`[mcpDynamicHandler] Creating new session ${sessionId}`);
      
      // Create new server and transport
      const mcpServer = await createAndConfigureMcpServer(project);
      const transport = new StreamableHTTPTransport({
        sessionIdGenerator: () => sessionId,
        enableJsonResponse: true,
        onsessioninitialized: (sid: string) => {
          console.log(`[mcpDynamicHandler] SESSION INITIALIZED ${sid}`);
        },
      });

      transport.onclose = () => {
        console.log(`[mcpDynamicHandler] Session ${sessionId} transport closed`);
        statefulSessions.delete(sessionId);
      };

      transport.onerror = (err: Error) => {
        console.error(`[Transport] Session ${sessionId} error:`, err);
      };

      // Connect server to transport
      await mcpServer.connect(transport);
      console.log(`[mcpDynamicHandler] Server connected to transport for session ${sessionId}`);

      // Cache the session
      const now = Date.now();
      session = {
        server: mcpServer,
        transport,
        created: now,
        lastActivity: now,
        projectId
      };
      statefulSessions.set(sessionId, session);
    }

    // Handle this request via the session
    try {
      const res = await session.transport.handleRequest(c);
      session.lastActivity = Date.now();
      return res;
    } catch (e: any) {
      console.error("[mcpDynamicHandler] transport.handleRequest error:", e);
      if (e?.res) return e.res;
      return c.json(
        createJsonRpcError(mcpPayload.id, -32603, "Internal server error during MCP transport."),
        500
      );
    }
  }

  // Stateless branch
  console.log("==================== STATELESS MODE ====================");
  
  try {
    // Create fresh server and transport for each request in stateless mode
    const mcpServer = await createAndConfigureMcpServer(project);
    const transport = new StreamableHTTPTransport({ 
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    transport.onerror = (err: Error) => {
      console.error("[Transport] Stateless error:", err);
    };

    await mcpServer.connect(transport);
    console.log(`[mcpDynamicHandler] Stateless server connected, handling ${mcpPayload.method}`);
    
    return await transport.handleRequest(c);
  } catch (e: any) {
    console.error("[mcpDynamicHandler] stateless transport error:", e);
    return c.json(
      createJsonRpcError(mcpPayload.id, -32603, "Internal server error"),
      500
    );
  }
};
