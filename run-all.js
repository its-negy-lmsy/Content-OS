import { spawn, exec } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('\n\x1b[36m=====================================================\x1b[0m');
console.log('\x1b[1m\x1b[38;2;255;119;0m  🚀 CONTENT OS — LOCAL COMMAND CENTER LAUNCHER \x1b[0m');
console.log('\x1b[36m=====================================================\x1b[0m\n');

// Detect Python virtualenv executable if present
const venvPythonWin = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
const venvPythonUnix = path.join(__dirname, '.venv', 'bin', 'python');
let pythonCmd = 'python';

if (process.platform === 'win32' && fs.existsSync(venvPythonWin)) {
  pythonCmd = venvPythonWin;
} else if (fs.existsSync(venvPythonUnix)) {
  pythonCmd = venvPythonUnix;
}

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let browserOpened = false;

function openBrowser(url) {
  if (browserOpened) return;
  browserOpened = true;
  console.log(`\n\x1b[32m✔ Opening Content OS UI in browser at ${url} ...\x1b[0m\n`);
  if (process.platform === 'win32') {
    exec(`start ${url}`);
  } else if (process.platform === 'darwin') {
    exec(`open ${url}`);
  } else {
    exec(`xdg-open ${url}`);
  }
}

// Poll server readiness via HTTP GET before opening browser to eliminate blank page delay
function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  const check = () => {
    http.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
        openBrowser(url);
      } else if (Date.now() - start < timeoutMs) {
        setTimeout(check, 150);
      } else {
        openBrowser(url);
      }
    }).on('error', () => {
      if (Date.now() - start < timeoutMs) {
        setTimeout(check, 150);
      } else {
        openBrowser(url);
      }
    });
  };
  check();
}

// 1. Launch FastAPI Backend Server
console.log(`\x1b[36m[System]\x1b[0m Starting Backend API on http://localhost:8000 ...`);
const backendProcess = spawn(
  pythonCmd,
  ['-m', 'uvicorn', 'backend.main:app', '--reload', '--port', '8000'],
  { cwd: __dirname }
);

backendProcess.stderr?.on('data', (data) => {
  const str = data.toString();
  if (str.includes('Traceback (most recent call last)')) {
    console.error(`\x1b[31m[Backend Error]\x1b[0m ${str.trim()}`);
  }
});

// 2. Launch Astro Web Workspace (Use prebuilt dist/ for 0.06s instant load if available, or dev mode)
const hasPrebuilt = fs.existsSync(path.join(__dirname, 'dist', 'index.html'));
const astroArgs = hasPrebuilt
  ? ['astro', 'preview', '--port', '4321']
  : ['astro', 'dev', '--port', '4321'];

console.log(`\x1b[36m[System]\x1b[0m Starting Astro Web Workspace on http://localhost:4321 ${hasPrebuilt ? '(Instant Build)' : '(Dev Mode)'}...`);
const frontendProcess = spawn(
  npxCmd,
  astroArgs,
  { cwd: __dirname, shell: true }
);

let chatterboxProcess = null;

// Delay Chatterbox TTS startup slightly so Astro & FastAPI initialize with zero CPU contention
setTimeout(() => {
  console.log(`\x1b[36m[System]\x1b[0m Starting Chatterbox TTS Local Web Studio on http://localhost:8001 ...`);
  chatterboxProcess = spawn(
    pythonCmd,
    [path.join(__dirname, 'backend', 'chatterbox_server.py')],
    { cwd: __dirname }
  );

  chatterboxProcess.stderr?.on('data', (data) => {
    const str = data.toString();
    if (str.includes('Traceback (most recent call last)')) {
      console.error(`\x1b[31m[Chatterbox Error]\x1b[0m ${str.trim()}`);
    }
  });
}, 2000);

// Wait for HTTP response on port 4321 before popping browser tab
waitForServer('http://localhost:4321');

// Cleanup processes on termination
function cleanup() {
  console.log('\n\x1b[33m[System] Shutting down Content OS services...\x1b[0m');
  try {
    backendProcess.kill();
    frontendProcess.kill();
    if (chatterboxProcess) chatterboxProcess.kill();
  } catch (e) {}
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
