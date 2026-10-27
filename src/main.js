// Entry point. Runs the web dashboard and keeps the Discord bot (src/bot.js) running as a child process,
// so the dashboard stays up while the bot restarts, crashes or waits for its first Discord token.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { applyToProcess, effectiveEnv, SETTINGS, STORAGE_DIR } from './config.js';
import { startWeb } from './web/server.js';
import { setupCodeForLog } from './web/auth.js';

const BOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bot.js');
const LOG_LINES = 800;

applyToProcess();

const logs = [];
function log(line) {
  const text = `${new Date().toISOString().slice(11, 19)} ${line}`;
  logs.push(text);
  if (logs.length > LOG_LINES) logs.splice(0, logs.length - LOG_LINES);
  console.log(line);
}

const bot = {
  child: null,
  status: 'stopped',
  state: {},
  startedAt: null,
  restarting: false,
  crashes: 0
};

function pipeLines(stream) {
  let rest = '';
  stream.on('data', chunk => {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop();
    for (const line of lines) if (line.trim()) log(line.trimEnd());
  });
}

function startBot() {
  if (bot.child) return;
  bot.state = {};
  if (!effectiveEnv().DISCORD_BOT_TOKEN) {
    bot.status = 'needs-token';
    log('[dashboard] No Discord bot token yet. Add one in the dashboard and the bot will start.');
    return;
  }
  bot.status = 'starting';
  bot.startedAt = Date.now();
  const child = fork(BOT, [], { env: process.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  bot.child = child;
  pipeLines(child.stdout);
  pipeLines(child.stderr);
  child.on('message', msg => {
    if (msg?.type === 'state') {
      Object.assign(bot.state, msg.state);
      if (msg.state.ready) {
        bot.status = 'online';
        bot.crashes = 0;
      }
    }
  });
  child.on('exit', (code, signal) => {
    bot.child = null;
    if (bot.status === 'stopped') return;
    if (bot.restarting) {
      bot.restarting = false;
      startBot();
      return;
    }
    bot.status = 'crashed';
    bot.crashes++;
    const wait = Math.min(60_000, 5_000 * bot.crashes);
    log(`[dashboard] Bot exited (${signal ?? code}). Restarting in ${wait / 1000}s.`);
    setTimeout(() => { if (!bot.child && bot.status === 'crashed') startBot(); }, wait);
  });
}

export const supervisor = {
  logs: () => logs,
  overview: () => ({ status: bot.status, startedAt: bot.startedAt, state: bot.state }),
  restart() {
    if (!bot.child) {
      bot.crashes = 0;
      startBot();
      return;
    }
    bot.restarting = true;
    bot.status = 'restarting';
    bot.child.kill('SIGTERM');
  },
  // Live settings (AI provider, keys, models) go to the running bot without a restart.
  pushSettings() {
    const values = effectiveEnv();
    bot.child?.send({ type: 'env', values, cleared: Object.keys(SETTINGS).filter(key => values[key] === undefined) });
    if (!bot.child && bot.status === 'needs-token') startBot();
  }

};

const { url } = await startWeb(supervisor);
log(`[dashboard] Open ${url}`);
const code = setupCodeForLog();
if (code) {
  log(`[dashboard] First-time setup code: ${code}  (enter it on the dashboard to create the admin password)`);
  // Installers read it from here to show it to the user.
  mkdirSync(STORAGE_DIR, { recursive: true });
  writeFileSync(path.join(STORAGE_DIR, 'setup-code.txt'), `${code}\n`, { mode: 0o600 });
}

startBot();

const stop = () => {
  bot.restarting = false;
  bot.status = 'stopped';
  bot.child?.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1500).unref();
  if (!bot.child) process.exit(0);
  bot.child.once('exit', () => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
