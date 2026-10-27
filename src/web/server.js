import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { publicConfig, saveConfig, effectiveEnv } from '../config.js';
import { PROVIDERS, DEFAULT_MODELS, describeAI, endpointFor, testProvider, runCli, claudeCliEnv } from '../ai.js';
import { PERSONAS } from '../personas.js';
import { testTools } from '../discord-tools.js';
import * as auth from './auth.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/logo.svg': ['logo.svg', 'image/svg+xml']
};
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...HEADERS, 'Cache-Control': 'no-store', ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers });
  res.end(json ? JSON.stringify(body) : body);
}

async function readJson(req) {
  // A JSON content type can't be sent cross-site without CORS, which (with SameSite cookies) blocks CSRF.
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Expected JSON.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, 'Too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Bad JSON.');
  }
}

const secureRequest = req => req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';

async function cliStatus() {
  const env = effectiveEnv();
  const version = async (cmd, extraEnv = {}) => (await runCli(cmd, ['--version'], { env: extraEnv, timeoutMs: 15_000 }).catch(() => '')).trim().split('\n')[0];
  const [claude, codex, gemini] = await Promise.all([
    version(env.CLAUDE_CLI_PATH || 'claude', claudeCliEnv()),
    version(env.CODEX_CLI_PATH || 'codex'),
    version(env.GEMINI_CLI_PATH || 'gemini')
  ]);
  const home = os.homedir();
  const has = (...parts) => existsSync(path.join(home, ...parts));
  return {
    claude: { installed: !!claude, version: claude, signedIn: !!env.CLAUDE_CODE_OAUTH_TOKEN || has('.claude', '.credentials.json') },
    codex: { installed: !!codex, version: codex, signedIn: has('.codex', 'auth.json') },
    gemini: { installed: !!gemini, version: gemini, signedIn: has('.gemini', 'oauth_creds.json') }
  };
}

// Checks a Discord bot token and builds the invite link. Uses the saved token when none is given.
// View channels, send messages (and in threads), manage messages (tidying reactions), embed links, attach files,
// read message history, add reactions.
const INVITE_PERMISSIONS = [10, 11, 38, 13, 14, 15, 16, 6].reduce((sum, bit) => sum + (1n << BigInt(bit)), 0n);
async function discordCheck(token) {
  token ||= effectiveEnv().DISCORD_BOT_TOKEN;
  if (!token) throw new Error('Paste a bot token first.');
  const get = async route => {
    const res = await fetch(`https://discord.com/api/v10${route}`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 401) throw new Error('Discord says this token is invalid. Copy it again from the Bot page (Reset Token).');
    if (!res.ok) throw new Error(`Discord answered ${res.status}.`);
    return await res.json();
  };
  const app = await get('/applications/@me');
  const bot = app.bot ?? await get('/users/@me');
  // Application flags: 1<<18 = message content intent (verified bots), 1<<19 = message content intent (unverified).
  const flags = BigInt(app.flags ?? 0);
  const messageContent = (flags & (1n << 18n)) !== 0n || (flags & (1n << 19n)) !== 0n;
  return {
    id: app.id,
    name: bot.username,
    avatar: bot.avatar ? `https://cdn.discordapp.com/avatars/${bot.id}/${bot.avatar}.png?size=128` : null,
    messageContent,
    portal: `https://discord.com/developers/applications/${app.id}/bot`,
    invite: `https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot+applications.commands&permissions=${INVITE_PERMISSIONS}`
  };
}

async function listModels(provider) {
  const env = effectiveEnv();
  if (provider === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('Save an API key first.');
    const ids = [];
    for await (const m of new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }).models.list()) ids.push(m.id);
    return ids;
  }
  const point = endpointFor(provider);
  if (!point?.base) throw new Error('Save the address first.');
  const res = await fetch(`${point.base}/models`, { headers: point.key ? { Authorization: `Bearer ${point.key}` } : {}, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const ids = (await res.json()).data.map(m => m.id.replace(/^models\//, ''));
  if (provider === 'gemini') return ids.filter(id => id.startsWith('gemini'));
  if (provider === 'openai') return ids.filter(id => /^(gpt|o\d|chatgpt)/.test(id)).sort();
  return ids.sort();
}

export function startWeb(supervisor) {
  const routes = {
    'GET /api/session': async (req) => ({ setUp: auth.isSetUp(), loggedIn: !!auth.sessionFrom(req) }),

    'POST /api/setup': async (req, res) => {
      const { code, password } = await readJson(req);
      const id = auth.createAdmin(password, String(code ?? '').trim());
      res.setHeader('Set-Cookie', auth.sessionCookie(id, secureRequest(req)));
      return { ok: true };
    },

    'POST /api/login': async (req, res) => {
      const { password } = await readJson(req);
      try {
        const id = auth.login(password, req.socket.remoteAddress);
        res.setHeader('Set-Cookie', auth.sessionCookie(id, secureRequest(req)));
        return { ok: true };
      } catch (err) {
        throw new HttpError(401, err.message);
      }
    },

    'POST /api/logout': async (req, res, session) => {
      auth.logout(session);
      res.setHeader('Set-Cookie', `${auth.COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return { ok: true };
    },

    'GET /api/overview': async () => ({ ...supervisor.overview(), ai: describeAI() }),

    'GET /api/personas': async () => ({ personas: PERSONAS }),

    'POST /api/discord/check': async (req) => {
      const { token } = await readJson(req);
      try {
        return { ok: true, ...await discordCheck(typeof token === 'string' ? token.trim() : '') };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    'GET /api/config': async () => ({ values: publicConfig(), providers: PROVIDERS, defaults: DEFAULT_MODELS }),

    'POST /api/config': async (req) => {
      const { values } = await readJson(req);
      const result = saveConfig(values);
      supervisor.pushSettings();
      return result;
    },

    'POST /api/bot/restart': async () => {
      supervisor.restart();
      return { ok: true };
    },

    'GET /api/logs': async () => ({ lines: supervisor.logs().slice(-400) }),

    'GET /api/ai/cli': async () => await cliStatus(),

    'POST /api/ai/test': async (req) => {
      const { provider } = await readJson(req);
      if (!PROVIDERS[provider]) throw new HttpError(400, 'Unknown provider.');
      try {
        return { ok: true, ...await testProvider(provider) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    'POST /api/ai/models': async (req) => {
      const { provider } = await readJson(req);
      try {
        return { ok: true, models: await listModels(provider) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    'POST /api/tools/test': async () => {
      try {
        return { ok: true, ...await testTools() };
      } catch (err) {
        return { ok: false, error: `Couldn't reach the tools server: ${err.message}` };
      }
    },

    'POST /api/password': async (req, res) => {
      const { current, next } = await readJson(req);
      const id = auth.changePassword(current, next);
      res.setHeader('Set-Cookie', auth.sessionCookie(id, secureRequest(req)));
      return { ok: true };
    }
  };
  const PUBLIC_ROUTES = new Set(['GET /api/session', 'POST /api/setup', 'POST /api/login']);

  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    try {
      if (req.method === 'GET' && STATIC[pathname]) {
        const [file, type] = STATIC[pathname];
        return send(res, 200, await fs.readFile(path.join(PUBLIC, file)), { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      }
      const key = `${req.method} ${pathname}`;
      const route = routes[key];
      if (!route) return send(res, 404, { error: 'Not found.' });
      const session = auth.sessionFrom(req);
      if (!PUBLIC_ROUTES.has(key) && !session) return send(res, 401, { error: 'Please sign in.' });
      send(res, 200, await route(req, res, session));
    } catch (err) {
      const status = err.status ?? (/(password|setup code|characters|already exists|not a valid)/i.test(err.message) ? 400 : 500);
      if (status === 500) console.error('[dashboard]', err);
      if (!res.headersSent) send(res, status, { error: err.message });
    }
  });

  const port = Number(process.env.WEB_PORT) || 3080;
  const host = process.env.WEB_HOST || '0.0.0.0';
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ server, url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}` }));
  });
}
