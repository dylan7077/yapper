import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Some models leak their reasoning as <think>...</think>; it must never reach Discord.
const stripThinking = text => String(text ?? '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const OPENAI_BASE = 'https://api.openai.com/v1';
const OPENCODE_GO_BASE = 'https://opencode.ai/zen/go/v1';

// `tools`: whether function calling (tools) can be offered to the model.
export const PROVIDERS = {
  'anthropic': { label: 'Claude', via: 'API key', tools: true },
  'claude-cli': { label: 'Claude', via: 'signed in', tools: false },
  'openai': { label: 'ChatGPT', via: 'API key', tools: true },
  'codex-cli': { label: 'ChatGPT', via: 'signed in', tools: false },
  'gemini': { label: 'Gemini', via: 'API key', tools: true },
  'gemini-cli': { label: 'Gemini', via: 'signed in', tools: false },
  'local': { label: 'Local model', via: 'on this machine', tools: true },
  'custom': { label: 'Custom API', via: 'OpenAI-compatible', tools: true }
};

export const DEFAULT_MODELS = {
  'anthropic': 'claude-opus-5-5',
  'openai': 'gpt-5-mini',
  'gemini': 'gemini-2.5-flash',
  'local': 'qwen2.5:3b',
  'custom': ''
};

// Every setting is read from process.env on each call, so changes saved in the dashboard apply immediately.
const env = (key, fallback = '') => process.env[key] || fallback;

// OpenAI-style chat/completions endpoints. Older installs used OPENAI_BASE_URL / OPENCODE_GO_* for a custom
// endpoint and OLLAMA_ENDPOINT / LOCAL_MODEL_NAME for Ollama; those still work.
function endpoint(provider) {
  switch (provider) {
    case 'openai':
      return { base: OPENAI_BASE, key: env('OPENAI_API_KEY'), model: env('OPENAI_MODEL', DEFAULT_MODELS.openai) };
    case 'gemini':
      return { base: GEMINI_BASE, key: env('GEMINI_API_KEY'), model: env('GEMINI_MODEL', DEFAULT_MODELS.gemini) };
    case 'local': {
      const legacy = env('OLLAMA_ENDPOINT') && `${env('OLLAMA_ENDPOINT').replace(/\/+$/, '')}/v1`;
      return { base: env('LOCAL_BASE_URL', legacy || 'http://127.0.0.1:11434/v1').replace(/\/+$/, ''), key: env('LOCAL_API_KEY', 'local'), model: env('LOCAL_MODEL', env('LOCAL_MODEL_NAME', DEFAULT_MODELS.local)) };
    }
    case 'custom':
      if (env('CUSTOM_BASE_URL')) return { base: env('CUSTOM_BASE_URL').replace(/\/+$/, ''), key: env('CUSTOM_API_KEY'), model: env('CUSTOM_MODEL') };
      if (env('OPENAI_BASE_URL')) return { base: env('OPENAI_BASE_URL').replace(/\/+$/, ''), key: env('OPENAI_API_KEY'), model: env('OPENAI_MODEL') };
      if (env('OPENCODE_GO_API_KEY')) return { base: OPENCODE_GO_BASE, key: env('OPENCODE_GO_API_KEY'), model: env('OPENCODE_GO_MODEL', 'deepseek-v4.1-flash') };
      return { base: '', key: '', model: '' };
    default:
      return null;
  }
}
export const endpointFor = endpoint;

export function activeProvider() {
  const chosen = env('AI_PROVIDER');
  if (PROVIDERS[chosen]) return chosen;
  if (chosen === 'ollama') return 'local';
  if (env('ANTHROPIC_API_KEY')) return 'anthropic';
  if (env('OPENAI_API_KEY') && !env('OPENAI_BASE_URL')) return 'openai';
  if (env('GEMINI_API_KEY')) return 'gemini';
  if (env('CUSTOM_BASE_URL') || env('OPENAI_BASE_URL') || env('OPENCODE_GO_API_KEY')) return 'custom';
  return 'local';
}

// `purpose` 'deep' is for harder one-off jobs (e.g. reading crash logs); it may use a separate model.
export function providerModel(provider, purpose = 'chat') {
  const deep = purpose === 'deep';
  switch (provider) {
    case 'anthropic': return (deep && env('CLAUDE_DEEP_MODEL', env('CLAUDE_CRASH_MODEL'))) || env('CLAUDE_MODEL', DEFAULT_MODELS.anthropic);
    case 'claude-cli': return env('CLAUDE_MODEL_CLI');
    case 'codex-cli': return env('CODEX_MODEL_CLI');
    case 'gemini-cli': return env('GEMINI_MODEL_CLI');
    case 'custom': return (deep && env('OPENCODE_GO_CRASH_MODEL')) || endpoint('custom').model;
    default: return endpoint(provider)?.model ?? '';
  }
}

// ---------- Claude (Anthropic API) ----------

// OpenAI-style function definitions (the format tools are written in) to Anthropic tool definitions.
const toAnthropicTools = tools => tools.map(t => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters
}));

// Server-side refusal fallback and effort are only accepted by current Claude models.
const CURRENT_CLAUDE = /^claude-(opus-5|sonnet-5|fable-5)/;

async function claudeRun({ system, messages, tools = [], executeTool, maxSteps = 8, purpose }) {
  const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: 120_000 });
  const model = providerModel('anthropic', purpose);
  const current = CURRENT_CLAUDE.test(model);
  const request = {
    model,
    max_tokens: 16000,
    system,
    ...(current ? {
      output_config: { effort: purpose === 'deep' ? 'high' : env('CLAUDE_EFFORT', 'low') },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default'
    } : {}),
    ...(tools.length ? { tools: toAnthropicTools(tools) } : {})
  };
  const history = messages.map(m => ({ role: m.role, content: m.content }));
  for (let step = 0; step <= maxSteps; step++) {
    const lastStep = step === maxSteps;
    if (lastStep && tools.length) {
      history.push({ role: 'user', content: 'Stop calling tools. Give your final answer now using only the tool results above.' });
    }
    const params = { ...request, ...(lastStep && tools.length ? { tool_choice: { type: 'none' } } : {}), messages: history };
    const response = current ? await client.beta.messages.create(params) : await client.messages.create(params);
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to answer');
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const calls = response.content.filter(b => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !calls.length || !executeTool) {
      if (!text) throw new Error('Claude returned an empty answer');
      return text;
    }
    // Keep the whole assistant turn (thinking blocks included) and answer every tool call in one message.
    history.push({ role: 'assistant', content: response.content });
    const results = [];
    for (const call of calls) {
      let result;
      try {
        result = await executeTool(call.name, call.input ?? {});
      } catch (err) {
        result = { error: err.message };
      }
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result).slice(0, 8000) });
    }
    history.push({ role: 'user', content: results });
  }
  throw new Error('Claude did not finish answering');
}

// ---------- OpenAI-compatible chat/completions (ChatGPT, Gemini, local servers, custom APIs) ----------

async function postChat(provider, messages, { tools = [], sessionId, model }) {
  const { base, key } = endpoint(provider);
  const body = { model, messages };
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'yapper/2.0' };
  if (key) headers.Authorization = `Bearer ${key}`;
  // OpenCode Go wants a stable per-conversation session id.
  if (base.includes('opencode.ai')) headers['x-opencode-session'] = sessionId;
  const res = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${PROVIDERS[provider].label} status ${res.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`);
  }
  const message = (await res.json()).choices?.[0]?.message ?? null;
  if (message?.content) message.content = stripThinking(message.content);
  // A blank reply (no text, no tool calls) happens when a provider is struggling; treat it as a failure.
  if (!message?.content && !message?.tool_calls?.length) throw new Error('empty answer');
  return message;
}

async function chatRun(provider, { system, messages, tools = [], executeTool, maxSteps = 8, sessionId, purpose }) {
  const model = providerModel(provider, purpose);
  const history = [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role, content: m.content }))];
  const offered = executeTool ? tools : [];
  for (let step = 0; step < maxSteps; step++) {
    const message = await postChat(provider, history, { tools: offered, sessionId, model });
    history.push({ role: 'assistant', content: message.content ?? '', ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) });
    if (!message.tool_calls?.length) return message.content;
    for (const call of message.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch {}
      let result;
      try {
        result = await executeTool(call.function?.name, args);
      } catch (err) {
        result = { error: err.message };
      }
      history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 8000) });
    }
  }
  // Out of tool steps: make it answer from what it already gathered instead of giving up.
  history.push({ role: 'user', content: 'Stop calling tools. Give your final answer now using only the tool results above.' });
  return (await postChat(provider, history, { sessionId, model })).content;
}

// ---------- Official CLIs, signed in with the owner's own Claude, ChatGPT or Google account ----------

// API keys in the environment take precedence over a CLI's own sign-in, so they never reach the CLIs.
const CLI_HIDDEN_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CUSTOM_API_KEY', 'OPENCODE_GO_API_KEY', 'DISCORD_BOT_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];

// On Windows the CLIs are npm .cmd shims, which only start through cmd.exe, so arguments must be quoted
// for it. Long or multi-line text never goes in arguments: it goes through stdin or a file.
const winQuote = arg => (/^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`);

export function runCli(command, args, { input = '', env: extraEnv = {}, timeoutMs = 180_000 } = {}) {
  const childEnv = { ...process.env };
  for (const key of CLI_HIDDEN_ENV) delete childEnv[key];
  const windows = process.platform === 'win32';
  return new Promise((resolve, reject) => {
    const child = spawn(windows ? [command, ...args].map(winQuote).join(' ') : command, windows ? [] : args, {
      cwd: os.tmpdir(),
      env: { ...childEnv, ...extraEnv, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: windows,
      windowsHide: true
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${command} timed out`)); }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(e.code === 'ENOENT' ? new Error(`${command} is not installed on this machine`) : e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${command} exited with ${code}: ${(err || out).trim().slice(-300)}`));
    });
    child.stdin.end(input);
  });
}

export const claudeCliEnv = () => (env('CLAUDE_CODE_OAUTH_TOKEN') ? { CLAUDE_CODE_OAUTH_TOKEN: env('CLAUDE_CODE_OAUTH_TOKEN') } : {});

// CLIs take one prompt, so the conversation is written out as a transcript.
function transcript(messages) {
  if (messages.length === 1) return messages[0].content;
  const lines = messages.slice(0, -1).map(m => `${m.role === 'assistant' ? 'You' : 'User'}: ${m.content}`);
  return `Conversation so far:\n${lines.join('\n\n')}\n\nLatest message (reply to this):\n${messages.at(-1).content}`;
}

// Writes the system prompt to a private temp file for a CLI to read.
async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yapper-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function claudeCliRun({ system, messages }) {
  return await withTempDir(async dir => {
    const systemFile = path.join(dir, 'system.md');
    await fs.writeFile(systemFile, system, { mode: 0o600 });
    // --tools "" turns off Claude Code's built-in tools: the bot only wants text back.
    const args = ['-p', '--output-format', 'json', '--tools', '', '--system-prompt-file', systemFile];
    const model = providerModel('claude-cli');
    if (model) args.push('--model', model);
    const out = await runCli(env('CLAUDE_CLI_PATH', 'claude'), args, { input: transcript(messages), env: claudeCliEnv() });
    const data = JSON.parse(out);
    if (data.is_error || !data.result) throw new Error(`Claude: ${String(data.result || data.subtype || 'no answer').slice(0, 200)}`);
    return stripThinking(data.result);
  });
}

async function codexCliRun({ system, messages }) {
  return await withTempDir(async dir => {
    const systemFile = path.join(dir, 'system.md');
    const outFile = path.join(dir, 'answer.txt');
    await fs.writeFile(systemFile, system, { mode: 0o600 });
    // Read-only sandbox, no saved session, and the bot's own instructions instead of Codex's coding prompt.
    const tomlPath = JSON.stringify(systemFile.replace(/\\/g, '/'));
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only', '--color', 'never',
      '-c', `model_instructions_file=${tomlPath}`, '-o', outFile];
    const model = providerModel('codex-cli');
    if (model) args.push('-m', model);
    args.push('-');
    await runCli(env('CODEX_CLI_PATH', 'codex'), args, { input: transcript(messages) });
    const answer = (await fs.readFile(outFile, 'utf8').catch(() => '')).trim();
    if (!answer) throw new Error('ChatGPT returned an empty answer');
    return stripThinking(answer);
  });
}

async function geminiCliRun({ system, messages }) {
  return await withTempDir(async dir => {
    // GEMINI_SYSTEM_MD replaces the CLI's coding-assistant system prompt with the bot's own.
    const systemFile = path.join(dir, 'system.md');
    await fs.writeFile(systemFile, system, { mode: 0o600 });
    const args = ['-p', 'Reply to the message above.', '--output-format', 'json'];
    const model = providerModel('gemini-cli');
    if (model) args.push('-m', model);
    const out = await runCli(env('GEMINI_CLI_PATH', 'gemini'), args, { input: transcript(messages), env: { GEMINI_SYSTEM_MD: systemFile } });
    const data = JSON.parse(out.slice(out.indexOf('{')));
    if (!data.response) throw new Error(`Gemini: ${data.error?.message ?? 'no answer'}`);
    return stripThinking(data.response);
  });
}

// ---------- Dispatch ----------

function configured(provider) {
  switch (provider) {
    case 'anthropic': return !!env('ANTHROPIC_API_KEY');
    case 'openai':
    case 'gemini': return !!endpoint(provider).key;
    case 'custom': return !!endpoint('custom').base;
    default: return true;
  }
}

async function runProvider(provider, options) {
  switch (provider) {
    case 'anthropic': return await claudeRun(options);
    case 'claude-cli': return await claudeCliRun(options);
    case 'codex-cli': return await codexCliRun(options);
    case 'gemini-cli': return await geminiCliRun(options);
    default: return await chatRun(provider, options);
  }
}

// Sends one short prompt through a provider; used by the dashboard's "Test" buttons.
export async function testProvider(provider) {
  if (!configured(provider)) throw new Error('Nothing saved for this option yet.');
  const started = Date.now();
  const answer = await runProvider(provider, {
    system: 'You are a connection test.\nReply with exactly: YAPPER OK',
    messages: [{ role: 'user', content: 'Reply now.' }],
    sessionId: 'test'
  });
  return { answer: answer.slice(0, 200), ms: Date.now() - started, model: providerModel(provider) || 'default model' };
}

// Whether the AI in use can call tools (the sign-in modes answer in plain text only).
export const aiSupportsTools = () => PROVIDERS[activeProvider()].tools;

export function describeAI() {
  const provider = activeProvider();
  const p = PROVIDERS[provider];
  const model = providerModel(provider);
  return { provider, label: p.label, via: p.via, model, text: `${p.label} (${p.via})${model ? `: ${model}` : ''}` };
}

// The chosen provider answers; the local model is the backup when AI_LOCAL_FALLBACK=on.
export class AI {
  get model() {
    const { provider, text } = describeAI();
    return provider !== 'local' && env('AI_LOCAL_FALLBACK') === 'on' ? `${text} (backup: local ${providerModel('local')})` : text;
  }

  async isAvailable() {
    const provider = activeProvider();
    if (provider !== 'local') return configured(provider);
    try {
      return (await fetch(`${endpoint('local').base}/models`, { signal: AbortSignal.timeout(2000) })).ok;
    } catch {
      return false;
    }
  }

  // messages: [{ role: 'user' | 'assistant', content }], oldest first, ending with the user's message.
  async chat({ system, messages, tools = [], executeTool, sessionId = 'yapper', purpose = 'chat' }) {
    const provider = activeProvider();
    const chain = [provider];
    if (provider !== 'local' && env('AI_LOCAL_FALLBACK') === 'on') chain.push('local');
    let lastError;
    for (const p of chain) {
      if (!configured(p)) continue;
      const withTools = PROVIDERS[p].tools && tools.length && executeTool;
      try {
        return await runProvider(p, { system, messages, sessionId, purpose, ...(withTools ? { tools, executeTool } : {}) });
      } catch (err) {
        lastError = err;
        console.warn(`[AI] ${PROVIDERS[p].label} (${PROVIDERS[p].via}): ${err.message}`);
      }
    }
    if (lastError?.name === 'TimeoutError') throw new Error('The AI took too long to answer.');
    throw lastError ?? new Error('No AI is set up yet. Open the dashboard to connect one.');
  }
}
