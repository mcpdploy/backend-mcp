import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function registerResources(mcpServer: McpServer, project: any): Promise<void> {
  // ---------- Resources (safe/simple) ----------
  for (const res of project.mcp_resources || []) {
    try {
      if (!res.name) {
        console.error(`[MCP] Resource config missing name:`, res);
        continue;
      }
      
      const meta = {
        mimeType: res.mime_type || "application/json",
        description: res.description,
        title: res.title,
      };
      const pattern = res.uri || res.uri_pattern || res.template_pattern || `/${res.name.toLowerCase()}`;

      if ((res.resource_type === "dynamic" || res.resource_type === "context_aware") && (res.uri || res.template_pattern)) {
        // Template form
        const tmpl = new ResourceTemplate(res.uri || res.template_pattern, { list: undefined });
        mcpServer.registerResource(
          res.name,
          tmpl,
          meta,
          async (_uri: URL, variables: Record<string, string | string[]>): Promise<ReadResourceResult> => {
            console.log(`[MCP Resource:${res.name}] variables:`, variables);
            if (res.static_content) {
              let out = res.static_content as string;
              for (const [k, v] of Object.entries(variables || {})) {
                out = out.replace(new RegExp(`{{${k}}}`, "g"), String(v));
              }
              return { contents: [{ type: "text", text: out, uri: _uri.toString() }] };
            }
            if (res.api_url) {
              let url = res.api_url as string;
              for (const [k, v] of Object.entries(variables || {})) {
                url = url.replace(new RegExp(`{${k}}`, "g"), String(v));
              }
              const resp = await fetch(url, { method: "GET", headers: res.headers || {} });
              const text = await resp.text();
              if (!resp.ok) return { contents: [], error: { code: "FETCH_ERROR", message: text } };
              return { contents: [{ type: "text", text, uri: _uri.toString() }] };
            }
            return { contents: [{ type: "text", text: `Resource ${res.name}`, uri: _uri.toString() }] };
          }
        );
      } else {
        // Static URI form
        mcpServer.registerResource(
          res.name,
          pattern,
          meta,
          async (uri: URL): Promise<ReadResourceResult> => {
            if (res.static_content) {
              return { contents: [{ type: "text", text: res.static_content, uri: uri.toString() }] };
            }
            if (res.api_url) {
              const resp = await fetch(res.api_url, { method: "GET", headers: res.headers || {} });
              const text = await resp.text();
              if (!resp.ok) return { contents: [], error: { code: "FETCH_ERROR", message: text } };
              return { contents: [{ type: "text", text, uri: uri.toString() }] };
            }
            return { contents: [{ type: "text", text: `Resource ${res.name}`, uri: uri.toString() }] };
          }
        );
      }
      console.log(`[MCP] Resource registered: ${res.name}`);
    } catch (e: any) {
      console.error(`[MCP] Resource register error for ${res?.name || 'unknown'}:`, {
        message: e?.message || 'Unknown error',
        stack: e?.stack,
        name: e?.name,
        resourceConfig: res,
        fullError: e
      });
      // Continue with next resource instead of failing completely
    }
  }
}
