// Long AI replies are split into Discord-sized messages without breaking code blocks.
import assert from 'node:assert/strict';
import { splitMessage } from '../src/discord-text.js';

assert.deepEqual(splitMessage('hello'), ['hello']);
const paras = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} `.repeat(10).trim()).join('\n\n');
const parts = splitMessage(paras, 500);
assert(parts.length > 1 && parts.every(p => p.length <= 500));
assert.equal(parts.join('\n\n').replace(/\s+/g, ' '), paras.replace(/\s+/g, ' '));
const code = 'Intro\n```js\n' + 'const x = 1;\n'.repeat(80) + '```\nOutro';
for (const p of splitMessage(code, 400)) assert.equal((p.match(/```/g) ?? []).length % 2, 0, 'every part closes its code block');
console.log('discord-text ok');
