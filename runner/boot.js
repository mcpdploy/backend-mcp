const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const http = require('http');

const workspaceDir = '/home/nodeuser/workspace';
const defaultPort = Number(process.env.PORT || 8000);
const isTS = process.env.RUN_TS === '1';
// Keep ESM off by default for stability; CommonJS path via ts-node is more reliable under Node 20/22
const runESM = process.env.RUN_ESM === '1' && false; // force false unless explicitly enabled later
const fileName = process.env.FILE_NAME || (isTS ? 'app.ts' : (runESM ? 'app.mjs' : 'app.js'));
const fileContent = process.env.FILE_CONTENT || '';
const requirements = (process.env.REQUIREMENTS || '').trim().split(/\s+/).filter(Boolean);

function log(...args) { console.log('[runner]', ...args); }
function logErr(...args) { console.error('[runner]', ...args); }

(async () => {
  try {
    fs.mkdirSync(workspaceDir, { recursive: true });
    const appPath = path.join(workspaceDir, fileName);
    fs.writeFileSync(appPath, fileContent);
    log('wrote app to', appPath, 'bytes=', fileContent.length);

    // Initialize package.json for local installs when needed
    const pkgJsonPath = path.join(workspaceDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      fs.writeFileSync(pkgJsonPath, JSON.stringify({ name: 'user-app', version: '1.0.0', type: runESM ? 'module' : 'commonjs' }, null, 2));
    }

    if (requirements.length) {
      try {
        log('installing requirements:', requirements.join(' '));
        cp.execSync('npm install ' + requirements.join(' '), { cwd: workspaceDir, stdio: 'inherit' });
      } catch (e) {
        logErr('npm install failed:', e && e.message ? e.message : String(e));
      }
    }

    // Start the user app in a child process
    const env = { ...process.env };
    env.NODE_PATH = (env.NODE_PATH ? env.NODE_PATH + ':' : '') + '/usr/local/lib/node_modules';
    if (isTS) {
      env.TS_NODE_TRANSPILE_ONLY = '1';
      env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, target: 'ES2020' });
    }

    const cmd = 'node';
    const args = isTS
      ? ['-r', 'ts-node/register/transpile-only', appPath]
      : [appPath];

    log('starting app:', cmd, args.join(' '));

    const child = cp.spawn(cmd, args, { cwd: workspaceDir, env, stdio: 'inherit' });
    child.on('error', (err) => logErr('spawn error', err && err.message ? err.message : String(err)));
    child.on('exit', (code) => log('child exited with code', code));

    // Keep parent alive
    setInterval(() => {}, 1 << 30);

  } catch (e) {
    logErr('boot failure:', e && e.message ? e.message : String(e));
    // Keep the process alive for logs even if boot errored
    setInterval(() => {}, 1 << 30);
  }
})();
