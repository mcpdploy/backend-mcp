import { Hono } from 'hono';
import { swaggerUI } from '@hono/swagger-ui';
import { openApiSpec } from '../lib/openapi'; // Adjusted path

export const openapiRoutes = new Hono();
 
// --- Swagger/OpenAPI Spec ---
openapiRoutes.get('/', swaggerUI({ urls: [{ url: '/docs/openapi.json', name: 'MCP API' }], spec: openApiSpec }));
openapiRoutes.get('/docs/openapi.json', (c) => c.json(openApiSpec)); 