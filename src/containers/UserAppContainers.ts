// import { Container } from '@cloudflare/containers';

// // Define StopParams locally since it's not exported from the main package
// type StopParams = {
//   exitCode: number;
//   reason: 'exit' | 'runtime_signal';
// };

// // Base interface for user application metadata
// interface UserAppMetadata {
//   userId: string;
//   projectId: string;
//   fileName: string;
//   fileContent: string;
//   requirements?: string[];
//   createdAt: string;
// }

// /**
//  * Node.js Application Container
//  * Handles deployment and execution of TypeScript/JavaScript files
//  */
// export class NodeAppContainer extends Container {
//   defaultPort = 8000;
//   sleepAfter = "10m"; // Keep alive for 10 minutes after inactivity
//   envVars: Record<string, string> = {
//     NODE_ENV: 'production',
//     RUNTIME: 'node'
//   };
//   // Hint the Containers runtime which ports must become ready
//   declare requiredPorts: number[];

//   private appMetadata?: UserAppMetadata;
//   private static readonly META_KEY = '__APP_METADATA__';

//   constructor(ctx: any, env: any) {
//     super(ctx, env);
//     this.requiredPorts = [this.defaultPort];
//   }

//   /**
//    * Deploy a Node.js application to this container
//    */
//   async deployApp(metadata: UserAppMetadata): Promise<{ success: boolean; port: number; error?: string }> {
//     try {
//       this.appMetadata = metadata;
//       // Persist metadata so /info survives DO restarts
//       await this.ctx.storage.put(NodeAppContainer.META_KEY, metadata);
      
//       // Determine runtime details and requirements
//       const isTypeScript = metadata.fileName.toLowerCase().endsWith('.ts');
//       const inferredDeps: string[] = [];
//       const usesExpress = /from\s+['\"]express['\"]/i.test(metadata.fileContent) || /require\(\s*['\"]express['\"]\s*\)/i.test(metadata.fileContent);
//       const usesMcpSdk = /@modelcontextprotocol\/sdk/.test(metadata.fileContent);
//       const importsWithJsSuffix = /from\s+['\"][^'\"]+\.js['\"]/i.test(metadata.fileContent);
//       const esmStyleImports = usesMcpSdk || importsWithJsSuffix;
//       if (usesExpress) inferredDeps.push('express');
//       if (usesMcpSdk) inferredDeps.push('@modelcontextprotocol/sdk', 'zod');
//       const requirementsList = Array.from(new Set([...(metadata.requirements || []), ...inferredDeps, ...(isTypeScript ? ['ts-node', 'typescript'] : [])]));
      
//       // Update environment variables
//       this.envVars = {
//         ...this.envVars,
//         USER_ID: metadata.userId,
//         PROJECT_ID: metadata.projectId,
//         FILE_NAME: metadata.fileName,
//         FILE_CONTENT: metadata.fileContent,
//         PORT: String(this.defaultPort),
//         REQUIREMENTS: requirementsList.join(' '),
//         RUN_TS: isTypeScript ? '1' : '0',
//         RUN_ESM: '0'
//       };

//       console.log(`[NodeAppContainer] Deploying ${metadata.fileName} for user ${metadata.userId}`);
//       // Let image CMD (/runner/boot.js) handle startup; do not override entrypoint here
//       delete (this as any).entrypoint;

//       // Start the container with the application
//       await this.startAndWaitForPorts([this.defaultPort], {
//         // Allow time for dependency install + app boot
//         portReadyTimeoutMS: 180000,
//         waitInterval: 500,
//         instanceGetTimeoutMS: 30000,
//       } as any);

//       return { success: true, port: this.defaultPort };
//     } catch (error) {
//       console.error('[NodeAppContainer] Deployment failed:', error);
//       return { success: false, port: -1, error: String(error) };
//     }
//   }

//   /**
//    * Get application status and metadata
//    */
//   async getAppInfo(): Promise<UserAppMetadata | null> {
//     if (!this.appMetadata) {
//       const saved = await this.ctx.storage.get<UserAppMetadata>(NodeAppContainer.META_KEY);
//       if (saved) this.appMetadata = saved;
//     }
//     return this.appMetadata || null;
//   }

//   override async onStart() {
//     console.log(`[NodeAppContainer] Container started for ${this.appMetadata?.fileName || 'unknown app'}`);
    
//     if (this.appMetadata) {
//       // In a real implementation, this would:
//       // 1. Write the file content to the container filesystem
//       // 2. Install dependencies if specified in requirements
//       // 3. Start the Node.js application
      
//       console.log(`[NodeAppContainer] Setting up Node.js environment...`);
//       console.log(`[NodeAppContainer] File: ${this.appMetadata.fileName}`);
//       console.log(`[NodeAppContainer] Requirements: ${this.appMetadata.requirements?.join(', ') || 'none'}`);
      
//       // The container is now ready to receive HTTP requests
//       this.renewActivityTimeout();
//     }
//   }

//   override async onStop(params: StopParams) {
//     console.log(`[NodeAppContainer] Container stopped - Exit code: ${params.exitCode}, Reason: ${params.reason}`);
//   }

//   override async onError(error: unknown) {
//     console.error('[NodeAppContainer] Container error:', error);
//     // Log error details for debugging
//     if (this.appMetadata) {
//       console.error(`[NodeAppContainer] Error in app: ${this.appMetadata.fileName} (User: ${this.appMetadata.userId})`);
//     }
//     throw error;
//   }

//   override async fetch(request: Request): Promise<Response> {
//     const url = new URL(request.url);
    
//     // Handle deployment requests
//     if (url.pathname === '/deploy' && request.method === 'POST') {
//       const metadata = await request.json() as UserAppMetadata;
//       const result = await this.deployApp(metadata);
//       return new Response(JSON.stringify(result), {
//         headers: { 'Content-Type': 'application/json' }
//       });
//     }
    
//     // Handle info requests
//     if (url.pathname === '/info' && request.method === 'GET') {
//       const info = await this.getAppInfo();
//       return new Response(JSON.stringify(info), {
//         headers: { 'Content-Type': 'application/json' }
//       });
//     }
    
//     // Renew activity timeout on each request
//     this.renewActivityTimeout();
    
//     // Forward all other requests to the containerized application
//     // The Container class handles the routing to the correct port
//     return await this.containerFetch(request, this.defaultPort);
//   }
// }

// /**
//  * Python Application Container  
//  * Handles deployment and execution of Python files
//  */
// export class PythonAppContainer extends Container {
//   defaultPort = 8000;
//   sleepAfter = "10m"; // Keep alive for 10 minutes after inactivity  
//   envVars: Record<string, string> = {
//     PYTHONPATH: '/workspace',
//     RUNTIME: 'python'
//   };
//   declare requiredPorts: number[];

//   private appMetadata?: UserAppMetadata;
//   private static readonly META_KEY = '__APP_METADATA__';

//   constructor(ctx: any, env: any) {
//     super(ctx, env);
//     this.requiredPorts = [this.defaultPort];
//   }

//   /**
//    * Deploy a Python application to this container
//    */
//   async deployApp(metadata: UserAppMetadata): Promise<{ success: boolean; port: number; error?: string }> {
//     try {
//       this.appMetadata = metadata;
//       // Persist metadata so /info survives DO restarts
//       await this.ctx.storage.put(PythonAppContainer.META_KEY, metadata);
      
//       // Update environment variables
//       this.envVars = {
//         ...this.envVars,
//         USER_ID: metadata.userId,
//         PROJECT_ID: metadata.projectId,
//         FILE_NAME: metadata.fileName,
//         ...(metadata.requirements ? { REQUIREMENTS: metadata.requirements.join(' ') } : {})
//       };

//       console.log(`[PythonAppContainer] Deploying ${metadata.fileName} for user ${metadata.userId}`);
//       // Minimal entrypoint to ensure the container listens on defaultPort.
//       const pyServerScript = `
// import json, time
// from http.server import BaseHTTPRequestHandler, HTTPServer

// PORT = ${this.defaultPort}
// PROJECT_ID = '${metadata.projectId}'

// class Handler(BaseHTTPRequestHandler):
//     def do_GET(self):
//         if self.path.startswith('/health'):
//             body = json.dumps({
//                 'status': 'ok',
//                 'uptimeSeconds': int(time.monotonic()),
//                 'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
//                 'projectId': PROJECT_ID,
//             }).encode('utf-8')
//             self.send_response(200)
//             self.send_header('Content-Type', 'application/json')
//             self.send_header('Content-Length', str(len(body)))
//             self.end_headers()
//             self.wfile.write(body)
//             return
//         body = ('python container ' + PROJECT_ID).encode('utf-8')
//         self.send_response(200)
//         self.send_header('Content-Type', 'text/plain; charset=utf-8')
//         self.send_header('Content-Length', str(len(body)))
//         self.end_headers()
//         self.wfile.write(body)

// HTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
// `;
//       this.entrypoint = ['python', '-c', pyServerScript];

//       // Start the container with the application
//       await this.startAndWaitForPorts([this.defaultPort], {
//         portReadyTimeoutMS: 180000,
//         waitInterval: 500,
//         instanceGetTimeoutMS: 30000,
//       } as any);

//       return { success: true, port: this.defaultPort };
//     } catch (error) {
//       console.error('[PythonAppContainer] Deployment failed:', error);
//       return { success: false, port: -1, error: String(error) };
//     }
//   }

//   /**
//    * Get application status and metadata
//    */
//   async getAppInfo(): Promise<UserAppMetadata | null> {
//     if (!this.appMetadata) {
//       const saved = await this.ctx.storage.get<UserAppMetadata>(PythonAppContainer.META_KEY);
//       if (saved) this.appMetadata = saved;
//     }
//     return this.appMetadata || null;
//   }

//   override async onStart() {
//     console.log(`[PythonAppContainer] Container started for ${this.appMetadata?.fileName || 'unknown app'}`);
    
//     if (this.appMetadata) {
//       // In a real implementation, this would:
//       // 1. Write the file content to the container filesystem
//       // 2. Install pip dependencies if specified in requirements
//       // 3. Start the Python application (with uvicorn for FastAPI, or directly)
      
//       console.log(`[PythonAppContainer] Setting up Python environment...`);
//       console.log(`[PythonAppContainer] File: ${this.appMetadata.fileName}`);
//       console.log(`[PythonAppContainer] Requirements: ${this.appMetadata.requirements?.join(', ') || 'none'}`);
      
//       // The container is now ready to receive HTTP requests
//       this.renewActivityTimeout();
//     }
//   }

//   override async onStop(params: StopParams) {
//     console.log(`[PythonAppContainer] Container stopped - Exit code: ${params.exitCode}, Reason: ${params.reason}`);
//   }

//   override async onError(error: unknown) {
//     console.error('[PythonAppContainer] Container error:', error);
//     // Log error details for debugging
//     if (this.appMetadata) {
//       console.error(`[PythonAppContainer] Error in app: ${this.appMetadata.fileName} (User: ${this.appMetadata.userId})`);
//     }
//     throw error;
//   }

//   override async fetch(request: Request): Promise<Response> {
//     const url = new URL(request.url);
    
//     // Handle deployment requests
//     if (url.pathname === '/deploy' && request.method === 'POST') {
//       const metadata = await request.json() as UserAppMetadata;
//       const result = await this.deployApp(metadata);
//       return new Response(JSON.stringify(result), {
//         headers: { 'Content-Type': 'application/json' }
//       });
//     }
    
//     // Handle info requests
//     if (url.pathname === '/info' && request.method === 'GET') {
//       const info = await this.getAppInfo();
//       return new Response(JSON.stringify(info), {
//         headers: { 'Content-Type': 'application/json' }
//       });
//     }
    
//     // Renew activity timeout on each request
//     this.renewActivityTimeout();
    
//     // Forward all other requests to the containerized application
//     // The Container class handles the routing to the correct port
//     return await this.containerFetch(request, this.defaultPort);
//   }
// }

// // Export type for use in other modules
// export type { UserAppMetadata };












// UserAppContainers.ts
import { Container } from '@cloudflare/containers';

// Define StopParams locally since it's not exported from the main package
type StopParams = {
  exitCode: number;
  reason: 'exit' | 'runtime_signal';
};

// Base interface for user application metadata
interface UserAppMetadata {
  userId: string;
  projectId: string;
  fileName: string;
  fileContent: string;
  requirements?: string[];
  createdAt: string;
}

/**
 * Node.js Application Container
 * Handles deployment and execution of TypeScript/JavaScript files
 */
export class NodeAppContainer extends Container {
  defaultPort = 8000;
  sleepAfter = "10m"; // Keep alive for 10 minutes after inactivity
  envVars: Record<string, string> = {
    NODE_ENV: 'production',
    RUNTIME: 'node'
  };
  declare requiredPorts: number[];

  private appMetadata?: UserAppMetadata;
  private static readonly META_KEY = '__APP_METADATA__';

  constructor(ctx: any, env: any) {
    super(ctx, env);
    this.requiredPorts = [this.defaultPort];
  }

  /**
   * Deploy a Node.js application to this container
   */
  async deployApp(metadata: UserAppMetadata): Promise<{ success: boolean; port: number; error?: string }> {
    try {
      this.appMetadata = metadata;
      await this.ctx.storage.put(NodeAppContainer.META_KEY, metadata);

      const isTypeScript = metadata.fileName.toLowerCase().endsWith('.ts');

      // *** Only install what the user explicitly requested ***
      const requirementsList = Array.from(new Set(metadata.requirements ?? []));

      // Pass env to runner; keep ESM off for stability
      this.envVars = {
        ...this.envVars,
        USER_ID: metadata.userId,
        PROJECT_ID: metadata.projectId,
        FILE_NAME: metadata.fileName,
        FILE_CONTENT: metadata.fileContent,
        PORT: String(this.defaultPort),
        REQUIREMENTS: requirementsList.join(' '),
        RUN_TS: isTypeScript ? '1' : '0',
        RUN_ESM: '0'
      };

      // Let image CMD (/runner/boot.js) handle startup; do not override entrypoint
      delete (this as any).entrypoint;

      // Start and wait until the port opens
      await this.startAndWaitForPorts([this.defaultPort], {
        portReadyTimeoutMS: 180000,
        waitInterval: 500,
        instanceGetTimeoutMS: 30000,
      } as any);

      return { success: true, port: this.defaultPort };
    } catch (error) {
      console.error('[NodeAppContainer] Deployment failed:', error);
      return { success: false, port: -1, error: String(error) };
    }
  }

  async getAppInfo(): Promise<UserAppMetadata | null> {
    if (!this.appMetadata) {
      const saved = await this.ctx.storage.get<UserAppMetadata>(NodeAppContainer.META_KEY);
      if (saved) this.appMetadata = saved;
    }
    return this.appMetadata || null;
  }

  override async onStart() {
    console.log(`[NodeAppContainer] Container started for ${this.appMetadata?.fileName || 'unknown app'}`);
    if (this.appMetadata) {
      console.log(`[NodeAppContainer] Setting up Node.js environment...`);
      console.log(`[NodeAppContainer] File: ${this.appMetadata.fileName}`);
      console.log(`[NodeAppContainer] Requirements: ${this.appMetadata.requirements?.join(', ') || 'none'}`);
      this.renewActivityTimeout();
    }
  }

  override async onStop(params: StopParams) {
    console.log(`[NodeAppContainer] Container stopped - Exit code: ${params.exitCode}, Reason: ${params.reason}`);
  }

  override async onError(error: unknown) {
    console.error('[NodeAppContainer] Container error:', error);
    if (this.appMetadata) {
      console.error(`[NodeAppContainer] Error in app: ${this.appMetadata.fileName} (User: ${this.appMetadata.userId})`);
    }
    throw error;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/deploy' && request.method === 'POST') {
      const metadata = await request.json() as UserAppMetadata;
      const result = await this.deployApp(metadata);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/info' && request.method === 'GET') {
      const info = await this.getAppInfo();
      return new Response(JSON.stringify(info), { headers: { 'Content-Type': 'application/json' } });
    }

    this.renewActivityTimeout();
    return await this.containerFetch(request, this.defaultPort);
  }
}

/**
 * Python Application Container (unchanged)
 */
export class PythonAppContainer extends Container {
  defaultPort = 8000;
  sleepAfter = "10m";
  envVars: Record<string, string> = {
    PYTHONPATH: '/workspace',
    RUNTIME: 'python'
  };
  declare requiredPorts: number[];

  private appMetadata?: UserAppMetadata;
  private static readonly META_KEY = '__APP_METADATA__';

  constructor(ctx: any, env: any) {
    super(ctx, env);
    this.requiredPorts = [this.defaultPort];
  }

  async deployApp(metadata: UserAppMetadata): Promise<{ success: boolean; port: number; error?: string }> {
    try {
      this.appMetadata = metadata;
      await this.ctx.storage.put(PythonAppContainer.META_KEY, metadata);

      const pyServerScript = `
import json, time
from http.server import BaseHTTPRequestHandler, HTTPServer
PORT = ${this.defaultPort}
PROJECT_ID = '${metadata.projectId}'
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/health'):
            body = json.dumps({
                'status': 'ok',
                'uptimeSeconds': int(time.monotonic()),
                'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'projectId': PROJECT_ID,
            }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        body = ('python container ' + PROJECT_ID).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
HTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
`;
      this.entrypoint = ['python', '-c', pyServerScript];

      await this.startAndWaitForPorts([this.defaultPort], {
        portReadyTimeoutMS: 180000,
        waitInterval: 500,
        instanceGetTimeoutMS: 30000,
      } as any);

      return { success: true, port: this.defaultPort };
    } catch (error) {
      console.error('[PythonAppContainer] Deployment failed:', error);
      return { success: false, port: -1, error: String(error) };
    }
  }

  async getAppInfo(): Promise<UserAppMetadata | null> {
    if (!this.appMetadata) {
      const saved = await this.ctx.storage.get<UserAppMetadata>(PythonAppContainer.META_KEY);
      if (saved) this.appMetadata = saved;
    }
    return this.appMetadata || null;
  }

  override async onStart() {
    console.log(`[PythonAppContainer] Container started for ${this.appMetadata?.fileName || 'unknown app'}`);
    if (this.appMetadata) {
      console.log(`[PythonAppContainer] Setting up Python environment...`);
      console.log(`[PythonAppContainer] File: ${this.appMetadata.fileName}`);
      console.log(`[PythonAppContainer] Requirements: ${this.appMetadata.requirements?.join(', ') || 'none'}`);
      this.renewActivityTimeout();
    }
  }

  override async onStop(params: StopParams) {
    console.log(`[PythonAppContainer] Container stopped - Exit code: ${params.exitCode}, Reason: ${params.reason}`);
  }

  override async onError(error: unknown) {
    console.error('[PythonAppContainer] Container error:', error);
    if (this.appMetadata) {
      console.error(`[PythonAppContainer] Error in app: ${this.appMetadata.fileName} (User: ${this.appMetadata.userId})`);
    }
    throw error;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/deploy' && request.method === 'POST') {
      const metadata = await request.json() as UserAppMetadata;
      const result = await this.deployApp(metadata);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/info' && request.method === 'GET') {
      const info = await this.getAppInfo();
      return new Response(JSON.stringify(info), { headers: { 'Content-Type': 'application/json' } });
    }

    this.renewActivityTimeout();
    return await this.containerFetch(request, this.defaultPort);
  }
}

export type { UserAppMetadata };
