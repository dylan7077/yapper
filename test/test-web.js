// Dashboard: first-run setup code, login, auth guard, JSON-only writes and write-only secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.STORAGE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'yapper-web-'));
process.env.WEB_PORT = '0';
process.env.WEB_HOST = '127.0.0.1';
const { startWeb } = await import('../src/web/server.js');
const { setupCodeForLog } = await import('../src/web/auth.js');

const supervisor = { overview: () => ({ status: 'needs-token', state: {} }), logs: () => [], pushSettings() {}, restart() {}, request: async () => ({}) };
const { server } = await startWeb(supervisor);
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = '';
const call = async (route, body, headers = {}) => {
  const res = await fetch(base + route, body === undefined
    ? { headers: { cookie } }
    : { method: 'POST', headers: { 'Content-Type': 'application/json', cookie, ...headers }, body: JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, body: await res.json() };
};

assert.deepEqual((await call('/api/session')).body, { setUp: false, loggedIn: false });
assert.equal((await call('/api/overview')).status, 401);
assert.equal((await call('/api/setup', { code: '000000x', password: 'longenough' })).status, 400);
const code = setupCodeForLog();
assert.match(code, /^\d{6}$/);
assert.equal((await call('/api/setup', { code, password: 'short' })).status, 400);
assert.equal((await call('/api/setup', { code, password: 'longenough' })).status, 200);
assert.equal((await call('/api/setup', { code, password: 'another-one' })).status, 400);
assert.equal((await call('/api/overview')).status, 200);

// Secrets are stored but only reported as set, with the last 4 characters.
assert.equal((await call('/api/config', { values: { GEMINI_API_KEY: 'AIza-secret-1234', BOT_NAME: 'Herald', NOT_A_SETTING: 'x' } })).status, 200);
const config = (await call('/api/config')).body.values;
assert.deepEqual(config.GEMINI_API_KEY, { set: true, hint: '…1234' });
assert.equal(config.BOT_NAME, 'Herald');
assert.equal(config.NOT_A_SETTING, undefined);
assert(!JSON.stringify(config).includes('secret-1234'));
const saved = JSON.parse(await fs.readFile(path.join(process.env.STORAGE_DIR, 'config.json'), 'utf8'));
assert.equal(saved.GEMINI_API_KEY, 'AIza-secret-1234');

// Form posts (CSRF) are refused; only JSON is accepted.
const form = await fetch(`${base}/api/config`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'values=1' });
assert.equal(form.status, 415);

// Logout, wrong passwords, lockout.
await call('/api/logout', {});
assert.equal((await call('/api/overview')).status, 401);
for (let i = 0; i < 5; i++) assert.equal((await call('/api/login', { password: 'wrong-password' })).status, 401);
assert.match((await call('/api/login', { password: 'longenough' })).body.error, /Too many attempts/);

server.close();
await fs.rm(process.env.STORAGE_DIR, { recursive: true, force: true });
console.log('web ok');
