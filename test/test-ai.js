// Provider choice, chat history, the OpenAI-compatible tool loop (used for ChatGPT/Gemini keys, local and
// custom APIs) and the local fallback.
import assert from 'node:assert/strict';
import { AI, activeProvider, providerModel, endpointFor } from '../src/ai.js';

for (const key of Object.keys(process.env).filter(k => /^(AI_|ANTHROPIC|OPENAI|GEMINI|OPENCODE|CUSTOM_|LOCAL_|OLLAMA)/.test(k))) delete process.env[key];
assert.equal(activeProvider(), 'local');
assert.equal(endpointFor('local').base, 'http://127.0.0.1:11434/v1');
process.env.OLLAMA_ENDPOINT = 'http://box:11434';
process.env.LOCAL_MODEL_NAME = 'llama3';
assert.equal(endpointFor('local').base, 'http://box:11434/v1');
assert.equal(providerModel('local'), 'llama3');
process.env.OPENCODE_GO_API_KEY = 'go';
assert.equal(activeProvider(), 'opencode');
assert.equal(providerModel('opencode'), 'deepseek-v4.1-flash');
assert.equal(endpointFor('opencode').base, 'https://opencode.ai/zen/go/v1');
delete process.env.OPENCODE_GO_API_KEY;
process.env.OPENAI_API_KEY = 'sk-openai';
assert.equal(activeProvider(), 'openai');
process.env.AI_PROVIDER = 'ollama';
assert.equal(activeProvider(), 'local');
process.env.AI_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'gem-key';

const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.Authorization });
  const step = calls.filter(c => c.url.includes('generativelanguage')).length;
  const message = step === 1
    ? { content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'lookup', arguments: '{"q":"weather"}' } }] }
    : { content: 'It is sunny.' };
  return new Response(JSON.stringify({ choices: [{ message }] }));
};

const ai = new AI();
const used = [];
const tools = [{ type: 'function', function: { name: 'lookup', description: 'x', parameters: { type: 'object', properties: {} } } }];
const history = [
  { role: 'user', content: 'Alex: hi' },
  { role: 'assistant', content: 'Hello Alex!' },
  { role: 'user', content: 'Alex: weather?' }
];
const answer = await ai.chat({ system: 'be nice', messages: history, tools, executeTool: async (name, args) => { used.push([name, args]); return { sky: 'clear' }; } });
assert.equal(answer, 'It is sunny.');
assert.deepEqual(used, [['lookup', { q: 'weather' }]]);
assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions$/);
assert.equal(calls[0].auth, 'Bearer gem-key');
assert.equal(calls[0].body.model, 'gemini-2.5-flash');
assert.deepEqual(calls[0].body.messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
assert.equal(calls[1].body.messages.at(-1).role, 'tool');

// Without tools, no tool definitions are sent.
calls.length = 0;
await ai.chat({ system: 's', messages: [{ role: 'user', content: 'hi' }] }).catch(() => {});
assert.equal(calls[0].body.tools, undefined);

// The local model answers when the chosen provider fails, only if AI_LOCAL_FALLBACK=on.
globalThis.fetch = async url => (String(url).startsWith('http://box:11434')
  ? new Response(JSON.stringify({ choices: [{ message: { content: 'local answer' } }] }))
  : new Response('down', { status: 503 }));
const warn = console.warn;
console.warn = () => {};
await assert.rejects(ai.chat({ system: 's', messages: [{ role: 'user', content: 'hi' }] }), /status 503/);
process.env.AI_LOCAL_FALLBACK = 'on';
assert.equal(await ai.chat({ system: 's', messages: [{ role: 'user', content: 'hi' }] }), 'local answer');
console.warn = warn;
console.log('ai ok');
