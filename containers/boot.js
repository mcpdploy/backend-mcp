// const fs = require('fs');
// const cp = require('child_process');
// const path = require('path');
// const http = require('http');

// const workspaceDir = '/home/nodeuser/workspace';
// const defaultPort = Number(process.env.PORT || 8000);
// const isTS = process.env.RUN_TS === '1';
// // Keep ESM off by default for stability; CommonJS path via ts-node is more reliable under Node 20/22
// const runESM = process.env.RUN_ESM === '1' && false; // force false unless explicitly enabled later
// const fileName = process.env.FILE_NAME || (isTS ? 'app.ts' : (runESM ? 'app.mjs' : 'app.js'));
// const fileContent = process.env.FILE_CONTENT || '';
// const requirements = (process.env.REQUIREMENTS || '').trim().split(/\s+/).filter(Boolean);

// function log(...args) { console.log('[runner]', ...args); }
// function logErr(...args) { console.error('[runner]', ...args); }

// (async () => {
//   try {
//     fs.mkdirSync(workspaceDir, { recursive: true });
//     const appPath = path.join(workspaceDir, fileName);
//     fs.writeFileSync(appPath, fileContent);
//     log('wrote app to', appPath, 'bytes=', fileContent.length);

//     // Initialize package.json for local installs when needed
//     const pkgJsonPath = path.join(workspaceDir, 'package.json');
//     if (!fs.existsSync(pkgJsonPath)) {
//       fs.writeFileSync(pkgJsonPath, JSON.stringify({ name: 'user-app', version: '1.0.0', type: runESM ? 'module' : 'commonjs' }, null, 2));
//     }

//     if (requirements.length) {
//       try {
//         log('installing requirements:', requirements.join(' '));
//         cp.execSync('npm install ' + requirements.join(' '), { cwd: workspaceDir, stdio: 'inherit' });
//       } catch (e) {
//         logErr('npm install failed:', e && e.message ? e.message : String(e));
//       }
//     }

//     // Start the user app in a child process
//     const env = { ...process.env };
//     env.NODE_PATH = (env.NODE_PATH ? env.NODE_PATH + ':' : '') + '/usr/local/lib/node_modules';
//     if (isTS) {
//       env.TS_NODE_TRANSPILE_ONLY = '1';
//       env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, target: 'ES2020' });
//     }

//     const cmd = 'node';
//     const args = isTS
//       ? ['-r', 'ts-node/register/transpile-only', appPath]
//       : [appPath];

//     log('starting app:', cmd, args.join(' '));

//     const child = cp.spawn(cmd, args, { cwd: workspaceDir, env, stdio: 'inherit' });
//     child.on('error', (err) => logErr('spawn error', err && err.message ? err.message : String(err)));
//     child.on('exit', (code) => log('child exited with code', code));

//     // Keep parent alive
//     setInterval(() => {}, 1 << 30);

//   } catch (e) {
//     logErr('boot failure:', e && e.message ? e.message : String(e));
//     // Keep the process alive for logs even if boot errored
//     setInterval(() => {}, 1 << 30);
//   }
// })();








// // /runner/boot.js
// const fs = require('fs');
// const cp = require('child_process');
// const path = require('path');

// const workspaceDir = '/home/nodeuser/workspace';
// const defaultPort = Number(process.env.PORT || 8000);
// const isTS = process.env.RUN_TS === '1';
// // Keep ESM off by default for stability (Node 20/22 custom loader quirks)
// const runESM = process.env.RUN_ESM === '1' && false;
// const fileName = process.env.FILE_NAME || (isTS ? 'app.ts' : (runESM ? 'app.mjs' : 'app.js'));
// const fileContent = process.env.FILE_CONTENT || '';
// const requirements = (process.env.REQUIREMENTS || '').trim().split(/\s+/).filter(Boolean);

// function log(...args) { console.log('[runner]', ...args); }
// function logErr(...args) { console.error('[runner]', ...args); }

// (async () => {
//   try {
//     fs.mkdirSync(workspaceDir, { recursive: true });
//     const appPath = path.join(workspaceDir, fileName);
//     fs.writeFileSync(appPath, fileContent);
//     log('wrote app to', appPath, 'bytes=', fileContent.length);

//     // Minimal package.json when local installs happen
//     const pkgJsonPath = path.join(workspaceDir, 'package.json');
//     if (!fs.existsSync(pkgJsonPath)) {
//       fs.writeFileSync(pkgJsonPath, JSON.stringify({
//         name: 'user-app',
//         version: '1.0.0',
//         type: runESM ? 'module' : 'commonjs'
//       }, null, 2));
//     }

//     // Optional: install only user-requested requirements (keeps boot fast)
//     if (requirements.length) {
//       try {
//         log('installing requirements:', requirements.join(' '));
//         cp.execSync('npm install ' + requirements.join(' '), { cwd: workspaceDir, stdio: 'inherit' });
//       } catch (e) {
//         logErr('npm install failed:', e && e.message ? e.message : String(e));
//       }
//     }

//     // Child process env
//     const env = { ...process.env };
//     const port = Number(process.env.PORT ?? defaultPort ?? 8000);
//     env.PORT = String(port);
//     env.HOST = env.HOST || '0.0.0.0'; // ensure we bind to all interfaces inside the container
//     env.NODE_PATH = (env.NODE_PATH ? env.NODE_PATH + ':' : '') + '/usr/local/lib/node_modules';

//     if (isTS) {
//       env.TS_NODE_TRANSPILE_ONLY = '1';
//       env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
//         module: 'commonjs',
//         moduleResolution: 'node',
//         esModuleInterop: true,
//         target: 'ES2020'
//       });
//     }

//     log('will listen on PORT=', env.PORT, 'HOST=', env.HOST);

//     const cmd = 'node';
//     const args = isTS
//       ? ['-r', 'ts-node/register/transpile-only', appPath]
//       : [appPath];

//     log('starting app:', cmd, args.join(' '));
//     const child = cp.spawn(cmd, args, { cwd: workspaceDir, env, stdio: 'inherit' });
//     child.on('error', (err) => logErr('spawn error', err && err.message ? err.message : String(err)));
//     child.on('exit', (code) => log('child exited with code', code));

//     // Keep parent alive for logs
//     setInterval(() => {}, 1 << 30);

//   } catch (e) {
//     logErr('boot failure:', e && e.message ? e.message : String(e));
//     setInterval(() => {}, 1 << 30);
//   }
// })();






// /runner/boot.js
const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const http = require('http');

const workspaceDir = '/home/nodeuser/workspace';

// Parent binds to PORT instantly:
const port = Number(process.env.PORT || 8000);
// Child app will bind to a side port to avoid conflicts:
const childPort = Number(process.env.PORT_CHILD || port + 1);

const isTS = process.env.RUN_TS === '1';
const runESM = false; // keep CommonJS for stability
const fileName = process.env.FILE_NAME || (isTS ? 'app.ts' : 'app.js');
const fileContent = process.env.FILE_CONTENT || '';
const requirements = (process.env.REQUIREMENTS || '').trim().split(/\s+/).filter(Boolean);

function log(...args) { console.log('[runner]', ...args); }
function logErr(...args) { console.error('[runner]', ...args); }

// --- tiny reverse proxy that binds immediately on PORT ---
let childReady = false;

const proxy = http.createServer((req, res) => {
  if (!childReady) {
    res.statusCode = 503;
    res.setHeader('Retry-After', '1');
    res.end('Starting up');
    return;
  }

  const opts = {
    hostname: '127.0.0.1',
    port: childPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${childPort}` },
  };

  const upstream = http.request(opts, (uRes) => {
    res.writeHead(uRes.statusCode || 502, uRes.headers);
    uRes.pipe(res);
  });

  upstream.on('error', (err) => {
    logErr('upstream error', err?.message || String(err));
    res.statusCode = 502;
    res.end('Upstream error');
  });

  req.pipe(upstream);
});

proxy.listen(port, '0.0.0.0', () => log('front proxy listening on', port));

// (Optional) If you need WebSockets, add explicit 'upgrade' handling here.

// --- boot the user app on childPort ---
(async () => {
  try {
    fs.mkdirSync(workspaceDir, { recursive: true });
    const appPath = path.join(workspaceDir, fileName);
    fs.writeFileSync(appPath, fileContent);
    log('wrote app to', appPath, 'bytes=', fileContent.length);

    const pkgJsonPath = path.join(workspaceDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      fs.writeFileSync(pkgJsonPath, JSON.stringify({
        name: 'user-app', version: '1.0.0', type: 'commonjs'
      }, null, 2));
    }

    if (requirements.length) {
      try {
        log('installing requirements:', requirements.join(' '));
        cp.execSync('npm install ' + requirements.join(' '), { cwd: workspaceDir, stdio: 'inherit' });
      } catch (e) {
        logErr('npm install failed:', e && e.message ? e.message : String(e));
      }
    }

    const env = { ...process.env };
    env.PORT = String(childPort);         // child binds here
    env.HOST = env.HOST || '127.0.0.1';
    env.NODE_PATH = (env.NODE_PATH ? env.NODE_PATH + ':' : '') + '/usr/local/lib/node_modules';
    if (isTS) {
      env.TS_NODE_TRANSPILE_ONLY = '1';
      env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
        module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, target: 'ES2020'
      });
    }

    const cmd = 'node';
    const args = isTS ? ['-r', 'ts-node/register/transpile-only', appPath] : [appPath];

    log(`starting child app on ${childPort}:`, cmd, args.join(' '));
    const child = cp.spawn(cmd, args, { cwd: workspaceDir, env, stdio: 'inherit' });
    child.on('error', (err) => logErr('spawn error', err?.message || String(err)));
    child.on('exit', (code) => log('child exited with code', code));

    // poll child until ready (prefers /health, falls back to TCP connect)
    const poll = () => {
      const req = http.get({ hostname: '127.0.0.1', port: childPort, path: '/health', timeout: 1000 }, (res) => {
        if (res.statusCode && res.statusCode < 500) {
          childReady = true;
          log('child is ready on', childPort);
        } else {
          setTimeout(poll, 200);
        }
      });
      req.on('error', () => setTimeout(poll, 200));
    };
    poll();

    // keep parent alive for logs
    setInterval(() => {}, 1 << 30);
  } catch (e) {
    logErr('boot failure:', e?.message || String(e));
    setInterval(() => {}, 1 << 30);
  }
})();
