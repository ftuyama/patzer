// `npm run tunnel:start` / `tunnel:stop` — put the Vite dev server on a public
// ngrok URL so a phone or a remote tester can reach the local app.
//
// Two details matter and are handled here instead of in docs:
//  - Vite refuses requests whose Host header it does not recognise, so the
//    tunnel boots with `--host-header=rewrite` (no vite.config.ts change).
//  - ngrok's free plan gives one endpoint per account, so a tunnel that is
//    already online elsewhere must be stopped first; the error is translated.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, 'node_modules', '.cache');
const pidFile = join(cacheDir, `tunnel-${process.env.TUNNEL_PORT ?? '5173'}.pid`);
const logFile = join(cacheDir, `tunnel-${process.env.TUNNEL_PORT ?? '5173'}.log`);
const port = process.env.TUNNEL_PORT ?? '5173';
const api = 'http://127.0.0.1:4040/api/tunnels';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function findConfig() {
  if (process.env.NGROK_CONFIG) return process.env.NGROK_CONFIG;
  const candidates = [
    join(homedir(), '.config', 'ngrok', 'ngrok.yml'),
    join(homedir(), '.ngrok2', 'ngrok.yml'),
  ];
  if (platform() === 'darwin') {
    candidates.push(join(homedir(), 'Library', 'Application Support', 'ngrok', 'ngrok.yml'));
  }
  if (platform() === 'win32' && process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, 'ngrok', 'ngrok.yml'));
  }
  return candidates.find((file) => existsSync(file)) ?? null;
}

function readPid() {
  try {
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function tunnels() {
  try {
    const response = await fetch(api, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body.tunnels) ? body.tunnels : [];
  } catch {
    return [];
  }
}

async function tunnelFor(target) {
  const list = await tunnels();
  return list.find((tunnel) => (tunnel.config?.addr ?? '').endsWith(`:${target}`)) ?? null;
}

async function check(url) {
  try {
    const response = await fetch(url, {
      headers: { 'ngrok-skip-browser-warning': 'true' },
      signal: AbortSignal.timeout(8000),
    });
    const body = response.status === 200 ? '' : (await response.text()).slice(0, 200).replace(/\s+/g, ' ');
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: error.message };
  }
}

async function start() {
  if (spawnSync('ngrok', ['version'], { stdio: 'ignore' }).status !== 0) {
    fail('ngrok not found on PATH. Install it with `brew install ngrok` (macOS) or see https://ngrok.com/download.');
  }

  const runningPid = readPid();
  if (isAlive(runningPid)) {
    const tunnel = await tunnelFor(port);
    console.log(`ngrok already running (pid ${runningPid})${tunnel ? `: ${tunnel.public_url}` : ''}`);
    console.log(`Log: ${logFile}`);
    return;
  }

  if (!existsSync(join(root, 'node_modules'))) {
    fail('node_modules missing — run `npm install` first.');
  }
  mkdirSync(cacheDir, { recursive: true });

  // A leftover agent on another port owns the account's single free endpoint;
  // spawning a second one only produces ERR_NGROK_334.
  for (const tunnel of await tunnels()) {
    const addr = tunnel.config?.addr ?? '';
    console.log(`note: ngrok is already serving ${addr} — stopping it first (free plan allows one endpoint).`);
    stopByPid(readPid());
    const stray = tunnel.name === 'command_line' ? pidsForPattern(`ngrok http`) : [];
    stray.forEach(stopByPid);
    for (let i = 0; i < 20 && (await tunnels()).length > 0; i += 1) await sleep(250);
  }

  const args = ['http', port, '--host-header=rewrite', '--log=stdout'];
  const config = findConfig();
  if (config) args.push('--config', config);
  else console.warn('warning: no ngrok config found; the free plan needs an authtoken (`ngrok config add-authtoken …`).');

  const log = openSync(logFile, 'a');
  const child = spawn('ngrok', args, { cwd: root, detached: true, stdio: ['ignore', log, log] });
  closeSync(log);
  child.unref();

  let tunnel = null;
  for (let i = 0; i < 40 && !tunnel; i += 1) {
    await sleep(250);
    if (!isAlive(child.pid)) break;
    tunnel = await tunnelFor(port);
  }

  if (!tunnel) {
    const output = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').slice(-6).join('\n') : '';
    if (output.includes('ERR_NGROK_334')) {
      fail(`ngrok refused to start: the endpoint is already online somewhere else.\nStop it (\`npm run tunnel:stop\`, or kill the other ngrok process) and try again.\n\n${output}`);
    }
    fail(`ngrok did not come up; last lines of ${logFile}:\n${output}`);
  }

  writeFileSync(pidFile, `${child.pid}\n`);
  console.log(`ngrok → ${tunnel.public_url} (localhost:${port})`);
  console.log(`Log:   ${logFile}`);
  console.log('Stop with `npm run tunnel:stop`.');

  const result = await check(tunnel.public_url);
  if (result.status === 200) console.log('Verified: tunnel returns 200.');
  else if (result.status === 0) console.log(`warning: could not verify yet (${result.body}).`);
  else console.warn(`warning: tunnel returned ${result.status}: ${result.body}`);
}

function pidsForPattern(pattern) {
  if (platform() === 'win32') return [];
  const result = spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' });
  return (result.stdout ?? '')
    .split('\n')
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function stopByPid(pid) {
  if (!isAlive(pid)) return false;
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

async function stop() {
  const pids = new Set();
  const tracked = readPid();
  if (isAlive(tracked)) pids.add(tracked);
  // A tunnel started by hand (or by a previous checkout) still holds the
  // endpoint, so stop anything matching this port too.
  pidsForPattern(`ngrok http ${port}`).forEach((pid) => pids.add(pid));

  if (pids.size === 0) {
    console.log('ngrok is not running.');
    rmSync(pidFile, { force: true });
    return;
  }

  pids.forEach(stopByPid);
  for (let i = 0; i < 20 && [...pids].some(isAlive); i += 1) await sleep(250);
  const stubborn = [...pids].filter(isAlive);
  stubborn.forEach((pid) => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  });
  rmSync(pidFile, { force: true });
  console.log(`Stopped ngrok (${[...pids].join(', ')}).`);
}

async function status() {
  const pid = readPid();
  const tunnel = await tunnelFor(port);
  if (!tunnel) {
    console.log(isAlive(pid) ? `ngrok (pid ${pid}) is starting but has no tunnel yet.` : 'ngrok is not running.');
    return;
  }
  console.log(`${tunnel.public_url} → ${tunnel.config?.addr}${isAlive(pid) ? ` (pid ${pid})` : ' (not started by this script)'}`);
}

const command = process.argv[2] ?? 'start';
if (command === 'start') await start();
else if (command === 'stop') await stop();
else if (command === 'status') await status();
else fail(`Unknown command "${command}". Use start, stop or status.`);
