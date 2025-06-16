import { z } from 'zod'; // For paramSchema construction
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { toFetchResponse, toReqRes } from "fetch-to-node";
import { supabase } from "../lib/supabaseClient"; // Path to supabase client
import { checkAndIncrementUsage } from '../routes/management';
// Schemas might be needed if project data structure is validated or used for registration logic beyond simple iteration
// import { baseResourceSchema, baseToolSchema, basePromptSchema } from '../lib/schemas';

// Helper: Generate HTML Info Page (Copied from index.ts)
function generateInfoPage(
  mcpIdentifier: string,
  project: any, // Consider defining a more specific type for project if possible
  resources: any[] = [],
  tools: any[] = [],
  prompts: any[] = [],
  baseUrl: string,
) {
  const projectBaseUrl = `${baseUrl}/mcp/${mcpIdentifier}`;
  const sseEndpoint = `${projectBaseUrl}/sse`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP Server: ${project.name}</title>
  <style>
    body { font-family: sans-serif; line-height: 1.6; padding: 20px; background-color: #f4f4f4; color: #333; }
    .container { max-width: 800px; margin: auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
    h1, h2 { color: #333; }
    pre { background: #eee; padding: 10px; border-radius: 4px; overflow-x: auto; }
    .api-key { font-family: monospace; background: #eee; padding: 2px 5px; border-radius: 3px; }
    .badge { display: inline-block; padding: 0.25em 0.5em; font-size: 75%; font-weight: 700; line-height: 1; text-align: center; white-space: nowrap; vertical-align: baseline; border-radius: 0.25rem; }
    .badge-active { color: #fff; background-color: #28a745; }
    .badge-inactive { color: #fff; background-color: #dc3545; }
  </style>
</head>
<body>
  <div class="container">
    <h1>MCP Server: ${project.name} <span class="badge ${project.is_active ? 'badge-active' : 'badge-inactive'}">${project.is_active ? 'Active' : 'Inactive'}</span></h1>
    <p><strong>Version:</strong> ${project.version || "N/A"}</p>
    <p><strong>Description:</strong> ${project.description || "N/A"}</p>
    <p><strong>Project ID (Instance ID):</strong> ${project.id}</p>
    ${project.api_key ? `<p><strong>API Key:</strong> <span class="api-key">******** (Set in headers)</span></p>` : ''}

    <h2>Endpoints</h2>
    <p>Base URL: <code>${projectBaseUrl}</code></p>
    <p>SSE URL: <code>${sseEndpoint}</code> (if applicable)</p>
    
    <h2>Resources (${resources.length})</h2>
    ${resources.length > 0 ? '<ul>' + resources.map(r => `<li><strong>${r.name}</strong>: <code>${r.uri_pattern || r.uri}</code> ${r.api_url ? '(Proxies: ' + r.api_url + ')' : ''}</li>`).join('') + '</ul>' : '<p>No resources configured.</p>'}
    
    <h2>Tools (${tools.length})</h2>
    ${tools.length > 0 ? '<ul>' + tools.map(t => `<li><strong>${t.name}</strong> ${t.api_url ? '(Calls: ' + t.api_url + ')' : ''}</li>`).join('') + '</ul>' : '<p>No tools configured.</p>'}
    
    <h2>Prompts (${prompts.length})</h2>
    ${prompts.length > 0 ? '<ul>' + prompts.map(p => `<li><strong>${p.name}</strong> ${p.api_url ? '(Calls: ' + p.api_url + ')' : ''}</li>`).join('') + '</ul>' : '<p>No prompts configured.</p>'}
  </div>
</body>
</html>`;
}

// Dynamic MCP Server Handler (Copied and adapted from index.ts)
export const mcpDynamicHandler = async (c: any) => { // c should be typed with Hono Context, e.g., Context<Env>
  console.log(`[mcpDynamicHandler] ENTERED. Path: ${c.req.path}, Method: ${c.req.method}`);
  const mcpIdentifier = c.req.param('mcpIdentifier');
  console.log(`[mcpDynamicHandler] Received mcpIdentifier from param: "${mcpIdentifier}"`);
  const path = c.req.path; 

  if (!mcpIdentifier || typeof mcpIdentifier !== 'string') {
    console.error(`[mcpDynamicHandler] mcpIdentifier is invalid or missing: `, mcpIdentifier);
    return c.json({ error: "MCP identifier missing or invalid in path parameter." }, 400);
  }

  const idMatch = mcpIdentifier.match(/-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/);
  if (!idMatch) {
    console.log(`[mcpDynamicHandler] Invalid MCP identifier format for "${mcpIdentifier}". Expected slug-UUID. No UUID match.`);
    return c.json({ error: "Invalid MCP identifier format." }, 400);
  }
  const projectId = idMatch[1];
  console.log(`[mcpDynamicHandler] Extracted projectId: "${projectId}" from mcpIdentifier: "${mcpIdentifier}"`);

  console.log(`[mcpDynamicHandler] Attempting to fetch project from Supabase with id: "${projectId}"`);
  let project: any, projectError: any;
  try {
    const supabaseClient = supabase; // Use the imported supabase client
    const result = await supabaseClient
      .from("mcp_servers")
      .select("*, mcp_resources(*), mcp_tools(*), mcp_prompts(*)")
      .eq("id", projectId)
      .single();
    project = result.data;
    projectError = result.error;
  } catch (e: any) {
    console.error(`[mcpDynamicHandler] EXCEPTION during Supabase call for projectId "${projectId}":`, e.message, e);
    return c.json({ error: "Internal server error during database access." }, 500);
  }

  if (projectError || !project) {
    console.log(`[mcpDynamicHandler] MCP project not found or error for projectId: "${projectId}". Returning 404.`);
    if (projectError) console.error(`[mcpDynamicHandler] Supabase error:`, projectError.message);
    return c.json({ error: "MCP project not found." }, 404);
  }

  console.log(`[mcpDynamicHandler] Successfully fetched project: "${project.name}" (ID: ${project.id})`);

  // --- API Key Enforcement for private projects ---
  if (project.is_private) {
    const apiKeyHeader = c.req.header("X-API-Key");
    if (!apiKeyHeader || apiKeyHeader !== project.api_key) {
      console.warn(`[mcpDynamicHandler] Invalid or missing API key for private project ${project.id}`);
      return c.json({ error: "Unauthorized: Invalid or missing API key" }, 401);
    }
  }
  // --- End API Key Enforcement ---

  if (!project.is_active) {
    console.log(`[mcpDynamicHandler] Project "${project.name}" (ID: ${project.id}) is not active. Returning 503.`);
    return c.json({ error: "MCP project is not active." }, 503);
  }
  
  // --- USAGE TRACKING & LIMITING (per project owner) ---
  const projectOwnerId = project.user_id;
  if (!projectOwnerId) {
    console.error(`[mcpDynamicHandler] Project ${project.id} has no user_id (owner). Cannot track usage.`);
    return c.json({ error: "Project misconfigured: missing owner." }, 500);
  }
  // Daily limit
  const { allowed: allowedDay, error: errorDay, status: statusDay } = await checkAndIncrementUsage({ userId: projectOwnerId, usageType: 'requests_today' });
  if (!allowedDay) {
    console.warn(`[mcpDynamicHandler] Daily quota exceeded for project ${project.id} (owner ${projectOwnerId}): ${errorDay}`);
    return c.json({ error: errorDay }, statusDay ?? 429);
  }
  // Monthly limit
  const { allowed: allowedMonth, error: errorMonth, status: statusMonth } = await checkAndIncrementUsage({ userId: projectOwnerId, usageType: 'requests_this_month' });
  if (!allowedMonth) {
    console.warn(`[mcpDynamicHandler] Monthly quota exceeded for project ${project.id} (owner ${projectOwnerId}): ${errorMonth}`);
    return c.json({ error: errorMonth }, statusMonth ?? 429);
  }
  // --- END USAGE TRACKING & LIMITING ---
  
  const mcpServer = new McpServer(
    { name: project.name, version: project.version || "1.0.0" },
    { capabilities: { logging: {} } }
  );

  console.log("[mcpDynamicHandler] Registering capabilities...");
  
  (project.mcp_resources || []).forEach((resConfig: any) => { 
    console.log(`[mcpDynamicHandler] Registering resource: ${resConfig.name}`, resConfig);
    mcpServer.resource(
      resConfig.name, 
      resConfig.uri_pattern || resConfig.uri, 
      { mimeType: "application/json", description: resConfig.description }, 
      async (mcpUri: URL, opts?: { headers?: Record<string, string>, signal?: AbortSignal }): Promise<ReadResourceResult> => { 
        console.log(`[MCP Resource: ${resConfig.name}] Called for URI: ${mcpUri.toString()}`);
        console.log(`[MCP Resource: ${resConfig.name}] Config: `, resConfig);
        if (resConfig.api_url) {
          console.log(`[MCP Resource: ${resConfig.name}] Would fetch from external API: ${resConfig.api_url} for MCP URI ${mcpUri.toString()}`);
          return { contents: [{type: "text", text: `Placeholder for ${resConfig.name} from ${resConfig.api_url}`, uri: mcpUri.toString() }] };
        }
        return { contents: [], error: { code: "NOT_IMPLEMENTED", message: "Resource direct access not implemented without api_url."}};
      }
    );
  });

  (project.mcp_tools || []).forEach((toolConfig: any) => { 
    console.log(`[mcpDynamicHandler] Registering tool: ${toolConfig.name}`, toolConfig);
    const paramSchema: Record<string, z.ZodTypeAny> = {};
    if (toolConfig.parameters) { 
      Object.entries(toolConfig.parameters).forEach(([key, value]) => { 
        paramSchema[key] = z.string().describe(value as string); 
      }); 
    }
    mcpServer.tool(
      toolConfig.name, 
      toolConfig.description || '', 
      paramSchema, 
      async (params: any): Promise<CallToolResult> => { 
        console.log(`[MCP Tool: ${toolConfig.name}] Called with params:`, params);
        console.log(`[MCP Tool: ${toolConfig.name}] Tool Config:`, toolConfig);
        if (toolConfig.api_url) {
          try {
            const method = (toolConfig.http_method || 'POST').toUpperCase();
            let url = toolConfig.api_url;
            let fetchOptions: RequestInit = { method };
            // Set headers
            fetchOptions.headers = { ...(toolConfig.headers || {}), 'Content-Type': 'application/json' };
            // Handle params
            if (['GET', 'DELETE'].includes(method)) {
              const query = new URLSearchParams(params).toString();
              if (query) url += (url.includes('?') ? '&' : '?') + query;
            } else {
              fetchOptions.body = JSON.stringify(params);
            }
            const response = await fetch(url, fetchOptions);
            let text: string;
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              const data = await response.json();
              text = JSON.stringify(data, null, 2);
            } else {
              text = await response.text();
            }
            if (!response.ok) {
              return {
                content: [{ type: 'text', text: `Error: ${response.status} ${response.statusText}\n${text}` }],
                isError: true
              };
            }
            return { content: [{ type: 'text', text }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Error fetching tool data: ${error instanceof Error ? error.message : String(error)}` }],
              isError: true
            };
          }
        }
        return { content: [], _meta: { isError: true, error: { code: "ACTION_NOT_DEFINED", message: `Tool ${toolConfig.name} has no api_url defined for execution.` } } };
      }
    );
  });

  (project.mcp_prompts || []).forEach((promptConfig: any) => { 
    console.log(`[mcpDynamicHandler] Registering prompt: ${promptConfig.name}`, promptConfig);
    const paramSchema: Record<string, z.ZodTypeAny> = {};
    if (promptConfig.parameters) { 
      Object.entries(promptConfig.parameters).forEach(([key, value]) => { 
        paramSchema[key] = z.string().describe(value as string); 
      }); 
    }
    mcpServer.prompt(
      promptConfig.name, 
      promptConfig.description || '', 
      paramSchema, 
      async (args: any): Promise<GetPromptResult> => { 
        console.log(`[MCP Prompt: ${promptConfig.name}] Called with args:`, args);
        console.log(`[MCP Prompt: ${promptConfig.name}] Prompt Config:`, promptConfig);
        let renderedTemplate: string = promptConfig.template as string;
        for (const key in args) {
          if (typeof args[key] === 'string') {
             renderedTemplate = renderedTemplate.replace(new RegExp(`{{${key}}}`, 'g'), args[key] as string);
          }
        }
        return { messages: [{ role: "assistant", content: { type: "text", text: renderedTemplate } }] };
      }
    );
  });
  
  console.log("[mcpDynamicHandler] Capabilities registration phase complete.");

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  
  try {
    console.log("[mcpDynamicHandler] Connecting McpServer to transport...");
    await mcpServer.connect(transport);
    console.log("[mcpDynamicHandler] McpServer connected to transport.");

    transport.onerror = console.error.bind(console);
    mcpServer.server.onerror = console.error.bind(console);

    const mcpBasePath = `/mcp/${mcpIdentifier}`;
    if (c.req.method === 'GET' && (path === mcpBasePath || path === `${mcpBasePath}/`) && (c.req.header("accept") || "").includes("text/html")) {
      console.log(`[mcpDynamicHandler] Serving HTML info page for project "${project.name}"`);
     // const requestUrl = new URL(c.req.url);
      const baseUrl = process.env.MCP_FRONTEND_BASE_URL || 'https://mcpdploy.com'; 
      //|| 'http://localhost:3001';
      //`${requestUrl.protocol}//${requestUrl.host}`;
      // Ensure generateInfoPage uses project.mcp_resources etc directly
      const htmlContent = generateInfoPage(mcpIdentifier, project, project.mcp_resources || [], project.mcp_tools || [], project.mcp_prompts || [], baseUrl);
      mcpServer.close();
      transport.close();
      return c.html(htmlContent);
    }

    if (c.req.method === 'GET') {
      console.log(`[mcpDynamicHandler] Received GET request for MCP endpoint (not HTML). Returning 405 Method Not Allowed.`);
      mcpServer.close(); 
      transport.close();
      return c.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. MCP expects POST for RPC calls." }, id: null }, 
        405
      );
    }
    
    const { req, res } = toReqRes(c.req.raw);
    let mcpPayload: any;
    if (c.req.header('content-type')?.includes('application/json')) {
        try {
            mcpPayload = await c.req.json();
            if (mcpPayload) {
                console.log("[mcpDynamicHandler] MCP Payload to be handled (from c.req.json()):", JSON.stringify(mcpPayload, null, 2));
            }
        } catch (e) {
            console.error("[mcpDynamicHandler] Failed to parse JSON body for MCP request:", e);
            mcpServer.close();
            transport.close();
            return c.json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, 400);
        }
    } else if (c.req.method !== "GET") {
         console.log("[mcpDynamicHandler] MCP request with non-JSON content type or GET method, passing null payload.");
         mcpPayload = null;
    } else {
        mcpPayload = undefined; 
    }

    if (c.req.method === 'POST' && !mcpPayload && c.req.header('content-length') && c.req.header('content-length') !== '0') {
        console.warn("[mcpDynamicHandler] POST request with Content-Length but mcpPayload is not set. Body parsing might have failed silently or was not JSON.");
    }

    try {
      console.log(`[mcpDynamicHandler] Forwarding to transport.handleRequest. Method: ${req.method}, Payload defined: ${mcpPayload !== undefined}`);
      await transport.handleRequest(req, res, mcpPayload);
      console.log("[mcpDynamicHandler] transport.handleRequest completed. Converting to FetchResponse.");
      return toFetchResponse(res);
    } catch (transportError: any) {
      console.error("[mcpDynamicHandler] CRITICAL ERROR during transport.handleRequest:", transportError.message, transportError.stack, transportError);
      mcpServer.close();
      transport.close();
      const requestId = (typeof mcpPayload === 'object' && mcpPayload !== null && 'id' in mcpPayload) ? mcpPayload.id : null;
      return c.json(
          { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error during MCP transport." }, id: requestId },
          500
      );
    }

  } catch (e: any) {
    console.error("[mcpDynamicHandler] Outer error during MCP processing or response generation:", e);
    // Ensure server/transport are closed if an error occurs before or outside transport.handleRequest
    if (mcpServer) mcpServer.close();
    if (transport) transport.close();
    return c.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null },
      { status: 500 }
    );
  }
}; 