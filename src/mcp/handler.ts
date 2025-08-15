import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import {
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
  CompleteRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { supabase } from "../lib/supabaseClient";
import { checkAndIncrementUsage } from "../routes/management";

// Session-based transport storage (for stateful projects only)
const sessionTransports: Record<string, StreamableHTTPTransport> = {};
const sessionServers: Record<string, any> = {};

// Single stateless transport (for stateless projects)
let statelessTransport: StreamableHTTPTransport | null = null;
let statelessServer: any = null;

// --------------------------- Safe completion logic shim ---------------------------
function evaluateCompletionLogic(logic: string, value: string, context: any): string[] {
  try {
    // if (context?.arguments?.["owner"] === "org1") { return ["x","y"].filter(r => r.startsWith(value)); }
    const conditionalMatch = logic.match(
      /if\s*\(\s*context\?\.\s*arguments\?\.\s*\[\s*["']([^"']+)["']\s*\]\s*===\s*["']([^"']+)["']\s*\)\s*{\s*return\s*\[(.*?)\]\.filter\([^)]+\)\s*;\s*}/
    );
    if (conditionalMatch) {
      const [, paramName, paramValue, itemsStr] = conditionalMatch;
      const ctxVal = context?.arguments?.[paramName];
      if (ctxVal === paramValue) {
        const items = itemsStr.split(",").map((s) => s.trim().replace(/["']/g, ""));
        return items.filter((s) => s.toLowerCase().startsWith((value || "").toLowerCase()));
      }
    }

    // return ["a","b"].filter(...); OR return ["a","b"]
    const returnArrayMatch = logic.match(/return\s*\[(.*?)\]/);
    if (returnArrayMatch) {
      const items = returnArrayMatch[1].split(",").map((s) => s.trim().replace(/["']/g, ""));
      if (logic.includes(".filter(")) {
        return items.filter((s) => s.toLowerCase().startsWith((value || "").toLowerCase()));
      }
      return items;
    }

    // multi if {...return[...] } ... final return [...]
    const hasConditional = logic.includes("if (") || logic.includes("if(");
    const hasReturn = logic.includes("return");
    if (hasConditional && hasReturn) {
      const ifMatches = [
        ...logic.matchAll(
          /if\s*\(\s*context\?\.\s*arguments\?\.\s*\[\s*["']([^"']+)["']\s*\]\s*===\s*["']([^"']+)["']\s*\)\s*{\s*return\s*\[(.*?)\](?:\.filter\([^)]+\))?\s*;\s*}/g
        ),
      ];
      for (const match of ifMatches) {
        const [, paramName, paramValue, itemsStr] = match;
        const ctxVal = context?.arguments?.[paramName];
        if (ctxVal === paramValue) {
          const items = itemsStr.split(",").map((s) => s.trim().replace(/["']/g, ""));
          const withFilter = String(match[0]).includes(".filter(");
          return withFilter
            ? items.filter((s) => s.toLowerCase().startsWith((value || "").toLowerCase()))
            : items;
        }
      }
      const finalReturnMatch = logic.match(/}\s*return\s*\[(.*?)\](?:\.filter\([^)]+\))?\s*;?\s*$/);
      if (finalReturnMatch) {
        const items = finalReturnMatch[1].split(",").map((s) => s.trim().replace(/["']/g, ""));
        const withFilter = String(finalReturnMatch[0]).includes(".filter(");
        return withFilter
          ? items.filter((s) => s.toLowerCase().startsWith((value || "").toLowerCase()))
          : items;
      }
    }
    return [];
  } catch {
    return [];
  }
}

// --------------------------- Caching & session plumbing ---------------------------

const NON_BILLABLE_METHODS = [
  "initialize",
  "notifications/initialized",
  "resources/list",
  "tools/list",
  "prompts/list",
  "completion/complete",
];

// --------------------------- Info page (unchanged styling) ---------------------------
function generateInfoPage(
  mcpIdentifier: string,
  project: any,
  resources: any[] = [],
  tools: any[] = [],
  prompts: any[] = [],
  baseUrl: string
) {
  const projectBaseUrl = `${baseUrl}/mcp/${mcpIdentifier}`;
  const sseEndpoint = `${projectBaseUrl}/sse`;
  return `<!DOCTYPE html>...${/* snipped for brevity if you already have this function in your codebase */""}`;
}

// --------------------------- Helpers ---------------------------
const buildZodFromParam = (config: any): z.ZodTypeAny => {
  let schema: z.ZodTypeAny;
  switch ((config?.type || "string") as string) {
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "array":
      schema = z.array(z.string());
      break;
    case "object":
      schema = z.object({});
      break;
    default:
      schema = z.string();
  }
  if (config?.description) schema = schema.describe(config.description);
  if (config?.required === false) schema = schema.optional();
  return schema;
};

const applyTemplateVars = (text: string, vars: Record<string, any>) => {
  let out = text;
  for (const [k, v] of Object.entries(vars || {})) {
    out = out.replace(new RegExp(`{{${k}}}`, "g"), String(Array.isArray(v) ? v[0] : v));
  }
  return out;
};

const replaceUrlParams = (url: string, vars: Record<string, any>) => {
  let out = url;
  for (const [k, v] of Object.entries(vars || {})) {
    out = out.replace(new RegExp(`{${k}}`, "g"), String(Array.isArray(v) ? v[0] : v));
  }
  return out;
};

// Build complete() functions from completion_config
const makeCompleters = (completionConfig?: any) => {
  if (!completionConfig?.complete) return undefined;
  const completeFns: Record<string, (value: string, context: any) => string[]> = {};
  for (const [param, cfg] of Object.entries<any>(completionConfig.complete)) {
    if (cfg?.type === "static" && Array.isArray(cfg.values)) {
      completeFns[param] = (value: string) =>
        cfg.values.filter((x: string) => x.toLowerCase().startsWith((value || "").toLowerCase()));
    } else if (cfg?.type === "conditional" && Array.isArray(cfg.conditions)) {
      completeFns[param] = (value: string, context: any) => {
        for (const cond of cfg.conditions) {
          if (cond.when && cond.values) {
            let ok = true;
            for (const [k, expected] of Object.entries(cond.when)) {
              // completion context can pass args in different shapes; check both named and positional
              const ctxArgs = context?.arguments || {};
              const actual = ctxArgs[k] ?? ctxArgs[String(k)];
              if (actual !== expected) {
                ok = false;
                break;
              }
            }
            if (ok) {
              return cond.values.filter((x: string) =>
                x.toLowerCase().startsWith((value || "").toLowerCase())
              );
            }
          }
        }
        const fallback = Array.isArray(cfg.default) ? cfg.default : [];
        return fallback.filter((x: string) => x.toLowerCase().startsWith((value || "").toLowerCase()));
      };
    } else if (cfg?.type === "function" && cfg.logic) {
      completeFns[param] = (value: string, context: any) =>
        evaluateCompletionLogic(cfg.logic as string, value, context);
    }
  }
  return Object.keys(completeFns).length ? completeFns : undefined;
};

// --------------------------- Capability registration ---------------------------
async function registerCapabilities(mcpServer: any, project: any) {
  console.log("Registering capabilities for project:", project.name);
  console.log("Resources:", project.mcp_resources?.length || 0);
  console.log("Tools:", project.mcp_tools?.length || 0);
  console.log("Prompts:", project.mcp_prompts?.length || 0);

  // ---------- Resources ----------
  for (const res of project.mcp_resources || []) {
    console.log("Registering resource:", res.name);
    const resourceType = res.resource_type || "static";
    const metadata = {
      mimeType: res.mime_type || "application/json",
      description: res.description,
      title: res.title,
    };
    const pattern =
      res.uri || res.uri_pattern || res.template_pattern || `/${res.name.toLowerCase().replace(/\s+/g, "-")}`;

    const handlerTemplate = async (uri: URL, vars: any): Promise<ReadResourceResult> => {
      // static content
      if (res.static_content) {
        const text = applyTemplateVars(res.static_content, vars || {});
        return { contents: [{ type: "text", text, uri: uri.toString() }] };
      }
      // api fetch
      if (res.api_url) {
        try {
          const url = replaceUrlParams(res.api_url, vars || {});
          const r = await fetch(url, { method: "GET", headers: res.headers || {} });
          const text = await r.text();
          if (!r.ok) {
            return {
              contents: [],
              error: { code: "FETCH_ERROR", message: `Failed: ${r.status} ${r.statusText}` },
            };
          }
          return { contents: [{ type: "text", text, uri: uri.toString() }] };
        } catch (e: any) {
          return { contents: [], error: { code: "FETCH_ERROR", message: e?.message || String(e) } };
        }
      }
      // default echo
      return {
        contents: [
          {
            type: "text",
            text: `Resource ${res.name} called with ${JSON.stringify(vars || {})}`,
            uri: uri.toString(),
          },
        ],
      };
    };

    if ((resourceType === "dynamic" || resourceType === "context_aware") && (res.uri || res.template_pattern)) {
      const templateOptions: any = {};
      const completes = makeCompleters(res.completion_config);
      if (completes) templateOptions.complete = completes;
      const tmpl = new ResourceTemplate(pattern, templateOptions);
      mcpServer.registerResource(res.name, tmpl, metadata, async (uri: URL, vars: any) => {
        // vars are already parsed from template
        return handlerTemplate(uri, vars);
      });
    } else {
      // static resource
      mcpServer.registerResource(res.name, pattern, metadata, async (mcpUri: URL) => {
        // extract params if the pattern used {var} even in "static" mode
        const vars: Record<string, string> = {};
        if (/{[^}]+}/.test(pattern)) {
          const names: string[] = [];
          const reNames = /{([^}]+)}/g;
          let m;
          while ((m = reNames.exec(pattern)) !== null) names.push(m[1]);
          let re = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\{([^}]+)\\}/g, "([^/]+)");
          const match = mcpUri.toString().match(new RegExp("^" + re + "$"));
          if (match) names.forEach((n, i) => (vars[n] = match[i + 1]));
        }
        return handlerTemplate(mcpUri, vars);
      });
    }
  }

  // ---------- Tools ----------
  for (const tool of project.mcp_tools || []) {
    console.log("Registering tool:", tool.name);
    const inputSchema: Record<string, z.ZodTypeAny> = {};
    if (tool.parameters) {
      for (const [k, cfg] of Object.entries<any>(tool.parameters)) {
        inputSchema[k] = buildZodFromParam(cfg ?? {});
      }
    }

    mcpServer.registerTool(
      tool.name,
      {
        title: tool.title || tool.name,
        description: tool.description || "",
        inputSchema,
      },
      async (params: any): Promise<CallToolResult> => {
        console.log("Tool called:", tool.name, "with params:", params);
        
        // 1) Static Tool
        if (tool.static_result !== undefined) {
          const raw = String(tool.static_result);
          const text =
            typeof tool.static_result === "string" ? applyTemplateVars(raw, params || {}) : JSON.stringify(tool.static_result);
          return { content: [{ type: "text", text }] };
        }

        // 2) Resource Link Tools
        if (Array.isArray(tool.resource_links)) {
          const content: any[] = [];
          if (tool.resource_links_header) {
            content.push({ type: "text", text: applyTemplateVars(tool.resource_links_header, params || {}) });
          }
          for (const link of tool.resource_links) {
            content.push({
              type: "resource_link",
              uri: link.uri,
              name: link.name,
              mimeType: link.mimeType,
              description: link.description,
            });
          }
          return { content };
        }

        // 3) API Tools
        if (tool.api_url) {
          try {
            const method = (tool.http_method || "GET").toUpperCase();
            let url = replaceUrlParams(tool.api_url, params || {});
            const headers = { ...(tool.headers || {}) };
            const fetchInit: RequestInit = { method, headers };

            if (["POST", "PUT", "PATCH"].includes(method)) {
              fetchInit.headers = { ...headers, "Content-Type": "application/json" };
              fetchInit.body = JSON.stringify(params || {});
            }

            const r = await fetch(url, fetchInit);
            const text = await r.text();
            if (!r.ok) {
              return {
                isError: true,
                content: [{ type: "text", text: `Error: ${r.status} ${r.statusText}\n${text}` }],
              };
            }
            return { content: [{ type: "text", text }] };
          } catch (e: any) {
            return { isError: true, content: [{ type: "text", text: `Error: ${e?.message || String(e)}` }] };
          }
        }

        return {
          isError: true,
          content: [{ type: "text", text: `Tool ${tool.name} has no implementation defined.` }],
        };
      }
    );
  }

  // ---------- Prompts ----------
  for (const prompt of project.mcp_prompts || []) {
    console.log("Registering prompt:", prompt.name);
    const argsSchema: Record<string, z.ZodTypeAny> = {};
    const src = prompt.arguments || prompt.parameters;
    const argNameMap: Record<string, string> = {};
    let i = 0;

    if (src) {
      for (const [key, cfg] of Object.entries<any>(src)) {
        const pos = String(i++);
        argNameMap[pos] = key;

        let schema = buildZodFromParam(cfg ?? {});
        // add completable if present
        const complCfg = prompt?.completion_config?.complete?.[key];
        if (complCfg) {
          schema = completable(schema, (value: string, context: any) => {
            // rebuild "named" context from positional indices, if any
            const namedCtx: Record<string, any> = {};
            if (context?.arguments) {
              for (const [posKey, val] of Object.entries(context.arguments)) {
                const namedKey = argNameMap[String(posKey)];
                if (namedKey) namedCtx[namedKey] = val;
              }
            }
            if (complCfg.type === "static") {
              return (complCfg.values || []).filter((x: string) =>
                x.toLowerCase().startsWith((value || "").toLowerCase())
              );
            }
            if (complCfg.type === "conditional") {
              for (const cond of cfg.conditions || []) {
                let ok = true;
                for (const [k, v] of Object.entries(cond.when || {})) {
                  if (namedCtx[k] !== v) {
                    ok = false;
                    break;
                  }
                }
                if (ok)
                  return (cond.values || []).filter((x: string) =>
                    x.toLowerCase().startsWith((value || "").toLowerCase())
                  );
              }
              return (complCfg.default || []).filter((x: string) =>
                x.toLowerCase().startsWith((value || "").toLowerCase())
              );
            }
            if (complCfg.type === "function" && complCfg.logic) {
              // legacy string logic
              return evaluateCompletionLogic(complCfg.logic, value, { arguments: namedCtx });
            }
            return [];
          });
        } else if (cfg?.completion) {
          // legacy inline completion string
          schema = completable(schema, (value: string, context: any) =>
            evaluateCompletionLogic(cfg.completion, value, context)
          );
        }

        argsSchema[pos] = schema;
      }
    }

    mcpServer.registerPrompt(
      prompt.name,
      {
        title: prompt.title || prompt.name,
        description: prompt.description || "",
        argsSchema,
      },
      async (args: any): Promise<GetPromptResult> => {
        const named: Record<string, any> = {};
        for (const [pos, val] of Object.entries(args || {})) {
          const name = argNameMap[String(pos)];
          if (name) named[name] = val;
        }

        const role: "user" | "assistant" = prompt.role || "user";
        let content = prompt.template || "";
        content = applyTemplateVars(content, named);

        return {
          messages: [{ role, content: { type: "text", text: content } }],
        };
      }
    );
  }

  // ---------- Completion handler (URIs + prompt args) ----------
  const server = (mcpServer as any).server;
  server.setRequestHandler(CompleteRequestSchema, async (request: any) => {
    const { ref, argument, context } = request.params || {};
    // URI completion for resources
    if (ref?.type === "ref/resource" && argument?.name === "uri") {
      const partial = String(argument.value || "");
      const values: string[] = [];
      for (const res of project.mcp_resources || []) {
        const patt =
          res.uri || res.uri_pattern || res.template_pattern || `/${res.name.toLowerCase().replace(/\s+/g, "-")}`;

        // naive static-head matching
        const staticHead = patt.split("{")[0];
        if (
          partial.toLowerCase().startsWith(staticHead.toLowerCase()) ||
          staticHead.toLowerCase().startsWith(partial.toLowerCase())
        ) {
          // propose an example by replacing {var} → "example"
          const suggestion = patt.replace(/{[^}]+}/g, "example");
          if (suggestion.toLowerCase().startsWith(partial.toLowerCase())) values.push(suggestion);
        }
      }
      return { completion: { values: values.slice(0, 100), total: values.length, hasMore: values.length > 100 } };
    }

    // Prompt argument completion (context-aware via completion_config handled above),
    // but we also try to serve from config here if needed
    if (ref?.type === "ref/prompt" && ref?.name && argument?.name != null) {
      const promptCfg = (project.mcp_prompts || []).find((p: any) => p.name === ref.name);
      if (!promptCfg) return { completion: { values: [], total: 0, hasMore: false } };

      const src = promptCfg.arguments || promptCfg.parameters;
      const posIndex = String(argument.name);
      const argNames = src ? Object.keys(src) : [];
      const namedKey =
        isFinite(Number(posIndex)) && argNames[Number(posIndex)] ? argNames[Number(posIndex)] : String(argument.name);
      const complCfg = promptCfg?.completion_config?.complete?.[namedKey];

      const ctxArgs: Record<string, string> = {};
      if (context?.arguments && argNames.length) {
        for (const [pos, val] of Object.entries(context.arguments)) {
          const n = argNames[Number(pos)];
          if (n) ctxArgs[n] = val as string;
        }
      }

      let vals: string[] = [];
      const val = String(argument.value || "");
      if (complCfg?.type === "static") {
        vals = (complCfg.values || []).filter((x: string) => x.toLowerCase().startsWith(val.toLowerCase()));
      } else if (complCfg?.type === "conditional") {
        for (const cond of complCfg.conditions || []) {
          let ok = true;
          for (const [k, expected] of Object.entries(cond.when || {})) {
            if (ctxArgs[k] !== expected) {
              ok = false;
              break;
            }
          }
          if (ok) {
            vals = (cond.values || []).filter((x: string) => x.toLowerCase().startsWith(val.toLowerCase()));
            break;
          }
        }
        if (!vals.length) {
          vals = (complCfg.default || []).filter((x: string) => x.toLowerCase().startsWith(val.toLowerCase()));
        }
      } else if (complCfg?.type === "function" && complCfg.logic) {
        vals = evaluateCompletionLogic(complCfg.logic, val, { arguments: ctxArgs });
      }
      return { completion: { values: vals.slice(0, 100), total: vals.length, hasMore: vals.length > 100 } };
    }

    return { completion: { values: [], total: 0, hasMore: false } };
  });
}

// --------------------------- Main dynamic handler ---------------------------
export const mcpDynamicHandler = async (c: any) => {
  const path = c.req.path;
  const segs = path.split("/").filter(Boolean);
  if (segs.length < 2 || segs[0] !== "mcp") {
    return c.json({ error: "Invalid MCP path structure. Expected /mcp/<identifier>" }, 400);
  }
  const mcpIdentifier = segs[1];
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = mcpIdentifier.match(uuidPattern);
  const projectId = match ? match[0] : mcpIdentifier;

  // Fetch project + config from Supabase
  const { data: project, error: fetchError } = await supabase
    .from("mcp_servers")
    .select(`*, mcp_resources(*), mcp_tools(*), mcp_prompts(*)`)
    .eq("id", projectId)
    .single();

  if (fetchError || !project) return c.json({ error: "Project not found" }, 404);
  if (project.is_private) {
    const key = c.req.header("X-API-Key");
    if (!key || key !== project.api_key) return c.json({ error: "Unauthorized: Invalid or missing API key" }, 401);
  }
  if (!project.is_active) return c.json({ error: "MCP project is not active." }, 503);

  // OPTIONS preflight
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

  // HTML info page
  const basePath = `/mcp/${mcpIdentifier}`;
  if (
    c.req.method === "GET" &&
    (path === basePath || path === `${basePath}/`) &&
    (c.req.header("accept") || "").includes("text/html")
  ) {
    const baseUrl = c.env?.MCP_FRONTEND_BASE_URL || "http://localhost:3001";
    const html = generateInfoPage(mcpIdentifier, project, project.mcp_resources || [], project.mcp_tools || [], project.mcp_prompts || [], baseUrl);
    return c.html(html);
  }

  // Protocol requires POST for RPC
  if (c.req.method !== "POST") {
    return c.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. MCP expects POST for RPC calls." }, id: null },
      405
    );
  }

  // Parse payload first
  let payload: any = null;
  try {
    if (c.req.header("content-type")?.includes("application/json")) {
      payload = await c.req.json();
    }
  } catch (parseError) {
    return c.json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, 400);
  }

  // Usage tracking for billable methods
  try {
    const methodName: string | undefined = payload?.method;
    const isBillable = methodName ? !NON_BILLABLE_METHODS.includes(methodName) : false;
    if (isBillable) {
      const ownerId = project.user_id;
      if (!ownerId) return c.json({ error: "Project misconfigured: missing owner." }, 500);

      const day = await checkAndIncrementUsage({ userId: ownerId, usageType: "requests_today" });
      if (!day.allowed) return c.json({ error: day.error }, day.status ?? 429);

      const month = await checkAndIncrementUsage({ userId: ownerId, usageType: "requests_this_month", increment: 0 });
      if (!month.allowed) return c.json({ error: month.error }, month.status ?? 429);
    }
  } catch (e) {
    console.error("Usage tracking error:", e);
  }

  // Handle based on project type
  if ((project as any).session_management) {
    // STATEFUL: Per-session transport (following Muppet stateful pattern)
    const sessionId = c.req.header("mcp-session-id") || crypto.randomUUID();
    const sessionKey = `${projectId}:${sessionId}`;
    
    let transport = sessionTransports[sessionKey];
    let mcpServer = sessionServers[sessionKey];
    
    if (!transport || !mcpServer) {
      // Create new session-specific server and transport
      mcpServer = new McpServer(
        {
          name: project.name || "Dynamic MCP Server",
          version: project.version || "1.0.0",
          description: project.description || "Dynamically configured MCP server",
        },
        { capabilities: { resources: {}, tools: {}, prompts: {} } }
      );
      
      await registerCapabilities(mcpServer, project);
      
      transport = new StreamableHTTPTransport({
        sessionIdGenerator: () => sessionId,
        enableJsonResponse: false,
      });
      
      mcpServer.connect(transport);
      
      // Store for reuse
      sessionTransports[sessionKey] = transport;
      sessionServers[sessionKey] = mcpServer;
      
      // Cleanup on transport close
      transport.onclose = () => {
        delete sessionTransports[sessionKey];
        delete sessionServers[sessionKey];
      };
    }
    
    return await transport.handleRequest(c, payload);
  } else {
    // STATELESS: Single shared transport (following Muppet stateless pattern)
    if (!statelessTransport || !statelessServer) {
      statelessServer = new McpServer(
        {
          name: project.name || "Dynamic MCP Server",
          version: project.version || "1.0.0",
          description: project.description || "Dynamically configured MCP server",
        },
        { capabilities: { resources: {}, tools: {}, prompts: {} } }
      );
      
      await registerCapabilities(statelessServer, project);
      
      statelessTransport = new StreamableHTTPTransport();
      
      statelessServer.connect(statelessTransport);
    }
    
    return await statelessTransport.handleRequest(c, payload);
  }
};
