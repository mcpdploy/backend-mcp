import type { MiddlewareHandler } from 'hono';
import { logDetailedAnalytics } from '../routes/management';

export const analyticsMiddleware: MiddlewareHandler<any> = async (c, next) => {
  const startTime = Date.now();
  const method = c.req.method;
  const path = c.req.path;
  const userAgent = c.req.header('user-agent');
  const userId = c.var.userId;

  // Skip analytics for non-authenticated requests or certain paths
  if (!userId || path.startsWith('/auth/') || path === '/docs' || path.startsWith('/stripe/webhook')) {
    await next();
    return;
  }

  // Capture request size (if available)
  let requestSize: number | undefined;
  try {
    const contentLength = c.req.header('content-length');
    if (contentLength) {
      requestSize = parseInt(contentLength);
    }
  } catch (e) {
    // Ignore errors
  }

  // Determine resource type and ID from path
  let resourceType: string | undefined;
  let resourceId: string | undefined;
  let projectId: string | undefined;

  // Parse path to extract resource information
  if (path.startsWith('/mcp-projects')) {
    resourceType = 'project';
    const match = path.match(/\/mcp-projects\/([a-f0-9-]+)/);
    if (match) {
      resourceId = match[1];
    }
  } else if (path.startsWith('/mcp/')) {
    resourceType = 'mcp_call';
    // Extract project ID from MCP path
    const match = path.match(/\/mcp\/([^\/]+)/);
    if (match) {
      const mcpIdentifier = match[1];
      const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      const uuidMatch = mcpIdentifier.match(uuidPattern);
      projectId = uuidMatch ? uuidMatch[0] : undefined;
    }
  } else if (path.startsWith('/subscription')) {
    resourceType = 'subscription';
  } else if (path.startsWith('/analytics')) {
    resourceType = 'analytics';
  } else if (path.startsWith('/support')) {
    resourceType = 'support';
  }

  try {
    await next();

    // After response
    const responseTime = Date.now() - startTime;
    const statusCode = c.res.status;

    // Capture response size
    let responseSize: number | undefined;
    const responseHeaders = c.res.headers;
    const contentLength = responseHeaders.get('content-length');
    if (contentLength) {
      responseSize = parseInt(contentLength);
    }

    // Determine error type if applicable
    let errorType: string | undefined;
    let errorMessage: string | undefined;
    
    if (statusCode >= 400) {
      if (statusCode === 401) {
        errorType = 'auth_error';
      } else if (statusCode === 429) {
        errorType = 'rate_limit';
      } else if (statusCode === 403) {
        errorType = 'forbidden';
      } else if (statusCode >= 400 && statusCode < 500) {
        errorType = 'client_error';
      } else if (statusCode >= 500) {
        errorType = 'server_error';
      }

      // Try to extract error message from response
      try {
        const clonedResponse = c.res.clone();
        const responseText = await clonedResponse.text();
        const responseJson = JSON.parse(responseText);
        if (responseJson.error) {
          errorMessage = typeof responseJson.error === 'string' ? responseJson.error : JSON.stringify(responseJson.error);
        }
      } catch (e) {
        // Ignore parsing errors
      }
    }

    // Get client IP (works in Cloudflare Workers)
    const ipAddress = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0];

    // Log analytics
    await logDetailedAnalytics({
      userId,
      projectId,
      method,
      endpoint: path,
      statusCode,
      responseTimeMs: responseTime,
      requestSize,
      responseSize,
      errorType,
      errorMessage,
      userAgent,
      ipAddress,
      resourceType,
      resourceId,
      metadata: {
        country: c.req.header('cf-ipcountry'),
        region: c.req.header('cf-region'),
        city: c.req.header('cf-city')
      }
    });
  } catch (error) {
    console.error('[Analytics Middleware] Error:', error);
    // Don't throw - we don't want analytics to break the request
  }
}; 