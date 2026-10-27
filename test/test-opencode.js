// OpenCode Go: its own endpoint and session header, and the backup model when the main one fails.
import assert from 'node:assert/strict';
import { AI, activeProvider, describeAI } from '../src/ai.js';

for (const key of Object.keys(process.env).filter(k => /^(AI_|ANTHROPIC|OPENAI|GEMINI|OPENCODE|CUSTOM_|LOCAL_|OLLAMA)/.test(k))) delete process.env[key];
process.env.AI_PROVIDER = 'opencode';
process.env.OPENCODE_GO_API_KEY = 'go-key';
process.env.OPENCODE_GO_FALLBACK_MODEL = 'mimo-v2.6-pro';
assert.equal(activeProvider(), 'opencode');
assert.equal(describeAI().text, 'OpenCode Go (API key): deepseek-v4.1-flash');

const calls = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url: String(url), model: body.model, auth: init.headers.Authorization, session: init.headers['x-opencode-session'] });
  return body.model === 'deepseek-v4.1-flash'
    ? new Response('overloaded', { status: 529 })
    : new Response(JSON.stringify({ choices: [{ message: { content: 'from the backup' } }] }));
};
const warn = console.warn;
console.warn = () => {};
const answer = await new AI().chat({ system: 's', messages: [{ role: 'user', content: 'hi' }], sessionId: 'discord-42' });
console.warn = warn;
assert.equal(answer, 'from the backup');
assert.deepEqual(calls.map(c => c.model), ['deepseek-v4.1-flash', 'mimo-v2.6-pro']);
assert.equal(calls[0].url, 'https://opencode.ai/zen/go/v1/chat/completions');
assert.equal(calls[0].auth, 'Bearer go-key');
assert.equal(calls[0].session, 'discord-42');
console.log('opencode ok');
