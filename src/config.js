// Settings saved from the web dashboard. They live in storage/config.json (owner-only) and override .env.
import fs from 'node:fs';
import path from 'node:path';

export const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || './storage');
const FILE = path.join(STORAGE_DIR, 'config.json');
// The environment as started (.env), before any saved settings are applied on top.
const BASE_ENV = { ...process.env };

// `live` settings apply to the running bot immediately; the rest need a bot restart (one click in the dashboard).
export const SETTINGS = {
  // AI
  AI_PROVIDER: { live: true },
  AI_LOCAL_FALLBACK: { live: true },
  ANTHROPIC_API_KEY: { live: true, secret: true },
  CLAUDE_MODEL: { live: true },
  CLAUDE_EFFORT: { live: true },
  CLAUDE_CODE_OAUTH_TOKEN: { live: true, secret: true },
  CLAUDE_MODEL_CLI: { live: true },
  OPENAI_API_KEY: { live: true, secret: true },
  OPENAI_MODEL: { live: true },
  CODEX_MODEL_CLI: { live: true },
  GEMINI_API_KEY: { live: true, secret: true },
  GEMINI_MODEL: { live: true },
  GEMINI_MODEL_CLI: { live: true },
  OPENCODE_GO_API_KEY: { live: true, secret: true },
  OPENCODE_GO_MODEL: { live: true },
  OPENCODE_GO_FALLBACK_MODEL: { live: true },
  LOCAL_BASE_URL: { live: true },
  LOCAL_MODEL: { live: true },
  LOCAL_API_KEY: { live: true, secret: true },
  CUSTOM_BASE_URL: { live: true },
  CUSTOM_API_KEY: { live: true, secret: true },
  CUSTOM_MODEL: { live: true },
  // Personality and behaviour
  BOT_NAME: { live: true },
  BOT_PERSONA: { live: true },
  BOT_CHANNELS: { live: true },
  BOT_DMS: { live: true },
  BOT_MEMORY: { live: true },
  BOT_COOLDOWN_SECONDS: { live: true },
  BOT_STATUS: {},
  BOT_SLASH_COMMANDS: {},
  // Discord tools (MCP)
  DISCORD_TOOLS: { live: true },
  DISCORD_TOOLS_URL: { live: true },
  DISCORD_TOOLS_ACCESS: { live: true },
  DISCORD_TOOLS_WHO: { live: true },
  // Discord
  DISCORD_BOT_TOKEN: { secret: true }
};

export function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Saved values on top of the process environment (.env).
export function effectiveEnv() {
  const saved = readConfig();
  const out = {};
  for (const key of Object.keys(SETTINGS)) {
    const value = saved[key] ?? BASE_ENV[key];
    if (value !== undefined && value !== '') out[key] = String(value);
  }
  return out;
}

// What the dashboard may see: secrets only say whether they are set.
export function publicConfig() {
  const values = effectiveEnv();
  const out = {};
  for (const [key, meta] of Object.entries(SETTINGS)) {
    out[key] = meta.secret ? { set: !!values[key], hint: values[key] ? `…${values[key].slice(-4)}` : '' } : (values[key] ?? '');
  }
  return out;
}

// Applies a patch from the dashboard. Unknown keys are ignored; null or '' clears a value.
// Returns the keys that changed and whether any of them need a restart.
export function saveConfig(patch) {
  const saved = readConfig();
  const changed = [];
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!SETTINGS[key]) continue;
    const next = value === null || value === undefined ? '' : String(value).trim();
    // Only the persona is free text that may span lines.
    if (next.length > 6000 || (key !== 'BOT_PERSONA' && /[\r\n]/.test(next))) throw new Error(`${key} is not a valid value.`);
    if ((saved[key] ?? '') === next) continue;
    if (next === '') delete saved[key];
    else saved[key] = next;
    changed.push(key);
  }
  if (changed.length) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(saved, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  }
  applyToProcess();
  return { changed, restart: changed.some(key => !SETTINGS[key].live) };
}

// Makes this process see the current settings (cleared ones fall back to .env or disappear).
export function applyToProcess(target = process.env, values = effectiveEnv()) {
  for (const key of Object.keys(SETTINGS)) {
    if (values[key] === undefined) delete target[key];
    else target[key] = values[key];
  }
}
