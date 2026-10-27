// Dashboard login: one admin password (scrypt), in-memory sessions, and a one-time setup code
// printed to the bot's log so nobody else on the network can claim a fresh install first.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { STORAGE_DIR } from '../config.js';

const FILE = path.join(STORAGE_DIR, 'admin.json');
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();
const failures = new Map();
export const COOKIE = 'yapper_session';

const readAdmin = () => {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return null;
  }
};

export const isSetUp = () => !!readAdmin()?.hash;

let setupCode = null;
export function setupCodeForLog() {
  if (isSetUp()) return null;
  setupCode ??= crypto.randomInt(0, 1e6).toString().padStart(6, '0');
  return setupCode;
}

const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function newSession() {
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, Date.now() + SESSION_MS);
  return id;
}

export function createAdmin(password, code) {
  if (isSetUp()) throw new Error('An admin password already exists.');
  if (!setupCode || !same(code, setupCode)) throw new Error('That setup code is wrong. It is printed in the bot\'s log.');
  if (typeof password !== 'string' || password.length < 8) throw new Error('Use at least 8 characters.');
  const salt = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ salt, hash: hashPassword(password, salt) }), { mode: 0o600 });
  setupCode = null;
  fs.rmSync(path.join(STORAGE_DIR, 'setup-code.txt'), { force: true });
  return newSession();
}

// Five wrong passwords from one address locks that address out for 10 minutes.
export function login(password, ip) {
  const f = failures.get(ip);
  if (f && f.count >= 5 && Date.now() < f.until) throw new Error('Too many attempts. Try again in a few minutes.');
  const admin = readAdmin();
  if (admin && typeof password === 'string' && same(hashPassword(password, admin.salt), admin.hash)) {
    failures.delete(ip);
    return newSession();
  }
  const count = (f && Date.now() < f.until ? f.count : 0) + 1;
  failures.set(ip, { count, until: Date.now() + 10 * 60 * 1000 });
  throw new Error('Wrong password.');
}

export function changePassword(current, next) {
  const admin = readAdmin();
  if (!admin || !same(hashPassword(String(current), admin.salt), admin.hash)) throw new Error('Current password is wrong.');
  if (typeof next !== 'string' || next.length < 8) throw new Error('Use at least 8 characters.');
  const salt = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(FILE, JSON.stringify({ salt, hash: hashPassword(next, salt) }), { mode: 0o600 });
  sessions.clear();
  return newSession();
}

export function sessionFrom(req) {
  const id = String(req.headers.cookie ?? '').split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const expires = id && sessions.get(id);
  if (!expires) return null;
  if (Date.now() > expires) {
    sessions.delete(id);
    return null;
  }
  return id;
}

export const logout = id => sessions.delete(id);

export const sessionCookie = (id, secure) =>
  `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
