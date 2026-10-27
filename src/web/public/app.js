'use strict';

// ---------- Tiny DOM helpers (no innerHTML with data, ever) ----------
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'html') el.innerHTML = value; // only for our own static SVG icons
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  wand: '<path d="m4 20 11-11M14 4v3M12.5 5.5h3M19 9v3M17.5 10.5h3M18 3v2M17 4h2"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3v.2A3 3 0 0 0 4 10a3 3 0 0 0 1 2.2A3 3 0 0 0 6 17a3 3 0 0 0 3 3h1V4zM15 4a3 3 0 0 1 3 3v.2A3 3 0 0 1 20 10a3 3 0 0 1-1 2.2A3 3 0 0 1 18 17a3 3 0 0 1-3 3h-1V4z"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.8 2 5.2 2 7 0M9 9.5h.01M15 9.5h.01"/>',
  discord: '<path d="M8 7c1.3-.5 2.6-.8 4-.8s2.7.3 4 .8l1.5-1.5C19.5 6.3 21 9 21 13c-1.4 1.6-3.2 2.7-5 3l-1-1.5M8 7 6.5 5.5C4.5 6.3 3 9 3 13c1.4 1.6 3.2 2.7 5 3l1-1.5M9 14c2 1 4 1 6 0"/><circle cx="9.5" cy="11" r="1"/><circle cx="14.5" cy="11" r="1"/>',
  logs: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4"/>',
  out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  bolt: '<path d="M13 3 4 14h7l-1 7 9-11h-7z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'
};
const icon = (name, cls = 'ic') => h('span', { class: cls, html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>` });

function toast(text, bad = false) {
  const el = h('div', { class: `toast${bad ? ' bad' : ''}` }, text);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 4200);
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/setup')) {
    state.session = { ...state.session, loggedIn: false };
    render();
    throw new Error('Please sign in again.');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Runs an async action with a spinner on the button that triggered it.
async function busy(button, fn) {
  const label = [...button.childNodes];
  button.disabled = true;
  button.replaceChildren(h('span', { class: 'spinner' }), ' Working…');
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.replaceChildren(...label);
  }
}

function copyButton(text) {
  const button = h('button', { type: 'button', onclick: async () => {
    await navigator.clipboard?.writeText(text).catch(() => {});
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  } }, 'Copy');
  return button;
}
const cmd = text => h('div', { class: 'cmd' }, h('span', {}, text), copyButton(text));
const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

// ---------- State & routing ----------
const state = { session: null, overview: null, config: null, page: 'overview', timer: null };
const pages = () => [
  ['overview', 'Overview', 'home'],
  ['setup', 'Setup guide', 'wand'],
  ['ai', 'AI model', 'brain'],
  ['personality', 'Personality', 'smile'],
  ['discord', 'Discord', 'discord'],
  ['tools', 'Discord tools', 'wrench'],
  ['logs', 'Logs', 'logs'],
  ['account', 'Account', 'user']
];

window.addEventListener('hashchange', () => {
  state.page = location.hash.slice(2) || 'overview';
  render();
});

async function boot() {
  state.page = location.hash.slice(2) || 'overview';
  state.session = await api('/api/session');
  if (state.session.loggedIn) await loadConfig().catch(() => {});
  render();
}

function render() {
  const app = document.getElementById('app');
  clearInterval(state.timer);
  if (!state.session.setUp) return app.replaceChildren(setupScreen());
  if (!state.session.loggedIn) return app.replaceChildren(loginScreen());
  app.replaceChildren(shell());
}

async function loadConfig() {
  state.config = await api('/api/config');
  return state.config;
}

// ---------- Auth screens ----------
function authCard(title, subtitle, ...content) {
  return h('div', { class: 'auth' },
    h('div', { class: 'auth-card' },
      h('div', { class: 'auth-brand' }, h('img', { src: '/logo.svg', alt: '' }), h('h1', {}, title), h('p', {}, subtitle)),
      ...content));
}

function loginScreen() {
  const error = h('div', { class: 'error', hidden: true });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••••' });
  const button = h('button', { class: 'primary block', type: 'submit' }, 'Sign in');
  const form = h('form', { onsubmit: async e => {
    e.preventDefault();
    error.hidden = true;
    try {
      await busy(button, () => api('/api/login', { password: password.value }));
      state.session.loggedIn = true;
      await loadConfig();
      render();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      password.select();
    }
  } },
  h('label', { class: 'field' }, 'Password', password), error, button);
  setTimeout(() => password.focus());
  return authCard('Welcome back', 'Sign in to manage your bot.', form,
    h('p', { class: 'auth-foot' }, 'Forgot it? Delete ', h('code', {}, 'storage/admin.json'), ' and restart.'));
}

function setupScreen() {
  const error = h('div', { class: 'error', hidden: true });
  const code = h('input', { class: 'otp', inputmode: 'numeric', maxlength: 6, required: true, placeholder: '000000', autocomplete: 'one-time-code' });
  const pw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const button = h('button', { class: 'primary block', type: 'submit' }, 'Create account');
  const form = h('form', { onsubmit: async e => {
    e.preventDefault();
    error.hidden = true;
    if (pw.value !== pw2.value) {
      error.textContent = 'The passwords don\'t match.';
      error.hidden = false;
      return;
    }
    try {
      await busy(button, () => api('/api/setup', { code: code.value, password: pw.value }));
      state.session = { setUp: true, loggedIn: true };
      await loadConfig();
      location.hash = '#/setup';
      render();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  } },
  h('label', { class: 'field' }, 'Setup code', h('span', { class: 'hint' }, 'The 6-digit code the installer showed you (it\'s also in the logs).'), code),
  h('label', { class: 'field' }, 'Choose a password', h('span', { class: 'hint' }, 'At least 8 characters. You\'ll use it to open this dashboard.'), pw),
  h('label', { class: 'field' }, 'Confirm password', pw2),
  error, button);
  setTimeout(() => code.focus());
  return authCard('Welcome to Yapper', 'Your own AI bot for Discord. Let\'s get you set up.', form);
}

// ---------- App shell ----------
function statusInfo(o) {
  const s = o?.status;
  if (s === 'online') return ['online', 'Bot online'];
  if (s === 'starting' || s === 'restarting') return ['warn', 'Bot starting…'];
  if (s === 'needs-token') return ['warn', 'Waiting for Discord token'];
  if (s === 'crashed') return ['bad', 'Bot stopped with an error'];
  return ['bad', 'Bot stopped'];
}

function shell() {
  const all = pages();
  const page = all.find(p => p[0] === state.page) ?? all[0];
  const navLinks = withIcons => all.map(([id, label, ic]) =>
    h('a', { href: `#/${id}`, class: page[0] === id ? 'active' : '' }, withIcons ? icon(ic) : null, label));
  const pill = h('span', { class: 'pill' }, h('span', { class: 'dot' }), 'Loading…');
  const updatePill = () => {
    const [cls, text] = statusInfo(state.overview);
    pill.replaceChildren(h('span', { class: `dot ${cls}` }), text);
  };
  const restart = h('button', { onclick: async () => {
    await busy(restart, () => api('/api/bot/restart', {}));
    toast('Restarting the bot…');
  } }, icon('restart'), 'Restart bot');

  const body = h('div');
  const main = h('main', { class: 'main' },
    h('div', { class: 'topbar' }, h('h1', {}, page[1]), h('div', { class: 'actions' }, pill, restart)),
    body);

  async function refreshOverview() {
    try {
      state.overview = await api('/api/overview');
      updatePill();
    } catch {}
  }
  refreshOverview();
  state.timer = setInterval(refreshOverview, 5000);
  (VIEWS[page[0]] ?? VIEWS.overview)(body);

  const logout = h('a', { href: '#', onclick: async e => {
    e.preventDefault();
    await api('/api/logout', {}).catch(() => {});
    state.session.loggedIn = false;
    render();
  } }, icon('out'), 'Sign out');

  return h('div', {},
    h('nav', { class: 'mobile-nav' }, navLinks(false)),
    h('div', { class: 'shell' },
      h('aside', { class: 'sidebar' },
        h('div', { class: 'brand' }, h('img', { src: '/logo.svg', alt: '' }), 'Yapper'),
        h('nav', { class: 'nav' }, navLinks(true)),
        h('div', { class: 'spacer' }),
        h('nav', { class: 'nav' }, logout)),
      main));
}

// ---------- Settings helpers ----------

// A text field bound to one setting. Secrets are write-only: the field shows whether one is saved.
function settingField(key, label, { hint, secret, placeholder, type = 'text' } = {}) {
  const value = state.config.values[key];
  const input = h('input', { type: secret ? 'password' : type, name: key, autocomplete: 'off', spellcheck: 'false',
    placeholder: secret ? (value.set ? `Saved (${value.hint}) — paste a new one to replace` : placeholder ?? 'Not set') : placeholder ?? '' });
  if (!secret) input.value = value ?? '';
  input.dataset.secret = secret ? '1' : '';
  return h('label', { class: 'field' },
    label ? h('span', {}, label, secret && value.set ? h('span', { class: 'secret-state' }, '✓ saved') : null) : null,
    hint ? h('span', { class: 'hint' }, hint) : null,
    input);
}

function toggle(key, label, { on = 'on', off = 'off', defaultOn = false, hint } = {}) {
  const input = h('input', { type: 'checkbox', name: key, 'data-on': on, 'data-off': off });
  const value = state.config.values[key];
  input.checked = value ? value === on : defaultOn;
  return h('div', { class: 'field' },
    h('label', { class: 'check' }, input, label),
    hint ? h('span', { class: 'hint indent' }, hint) : null);
}

// Collects the fields in a container: plain fields always, secrets only when something new was typed.
function collect(container) {
  const out = {};
  for (const input of container.querySelectorAll('input[name], select[name], textarea[name]')) {
    if (input.type === 'checkbox') out[input.name] = input.checked ? input.dataset.on : input.dataset.off;
    else if (input.dataset.secret) { if (input.value.trim()) out[input.name] = input.value.trim(); }
    else out[input.name] = input.value.trim();
  }
  return out;
}

async function save(button, values, { quiet } = {}) {
  const result = await busy(button, () => api('/api/config', { values }));
  await loadConfig();
  if (!quiet) {
    if (result.restart) toast('Saved. Restart the bot to apply.');
    else toast(result.changed.length ? 'Saved — applied right away.' : 'Nothing changed.');
  }
  return result;
}

function restartNotice() {
  const bar = h('div', { class: 'notice warn', hidden: true },
    h('div', { class: 'row-between' },
      h('span', {}, 'Restart the bot to apply these settings.'),
      h('button', { class: 'primary', onclick: async e => {
        await busy(e.currentTarget, () => api('/api/bot/restart', {}));
        bar.hidden = true;
        toast('Restarting the bot…');
      } }, 'Restart now')));
  return bar;
}

function botCard(r, subtitle) {
  return h('div', { class: 'bot-card' },
    r.avatar ? h('img', { class: 'avatar', src: r.avatar, alt: '' }) : h('div', { class: 'avatar' }),
    h('div', { class: 'grow' }, h('div', { class: 'strong' }, r.name), h('div', { class: 'muted small' }, subtitle)),
    h('a', { class: 'btn primary', href: r.invite, target: '_blank', rel: 'noopener' }, icon('link'), 'Add to a server'));
}

// ---------- Discord ----------

function discordPanel({ onDone } = {}) {
  const v = state.config.values;
  const result = h('div');
  const token = settingField('DISCORD_BOT_TOKEN', '', { secret: true, placeholder: 'Paste your bot token' });
  const tokenInput = token.querySelector('input');

  const showCheck = r => {
    if (!r.ok) return result.replaceChildren(h('div', { class: 'result bad' }, r.error));
    result.replaceChildren(botCard(r, 'Token works'),
      r.messageContent ? null : h('div', { class: 'notice warn', style: 'margin-top:10px' },
        h('b', {}, 'Turn on "Message Content Intent". '), 'Without it the bot can\'t read messages. ',
        link(r.portal, 'Open the Bot settings'), ' → Privileged Gateway Intents → Message Content Intent → Save Changes.'));
  };

  const check = h('button', { type: 'button', onclick: async () => {
    showCheck(await busy(check, () => api('/api/discord/check', { token: tokenInput.value.trim() })));
  } }, 'Check token');
  const saveBtn = h('button', { class: 'primary', type: 'button', onclick: async () => {
    const typed = tokenInput.value.trim();
    if (typed) {
      const r = await busy(saveBtn, () => api('/api/discord/check', { token: typed }));
      showCheck(r);
      if (!r.ok) return;
    } else if (!v.DISCORD_BOT_TOKEN.set) {
      return toast('Paste your bot token first.', true);
    }
    const res = await save(saveBtn, collect(panel), { quiet: true });
    const changed = res.changed.includes('DISCORD_BOT_TOKEN');
    toast(changed ? 'Saved. The bot is connecting to Discord…' : 'Saved.');
    if (changed && state.overview?.status !== 'needs-token') api('/api/bot/restart', {}).catch(() => {});
    onDone?.();
  } }, onDone ? 'Save & continue' : 'Save');

  const panel = h('div', { class: 'stack' },
    h('ol', { class: 'steps' },
      h('li', {}, h('div', {}, 'Open the ', link('https://discord.com/developers/applications', 'Discord Developer Portal'), ' and click ', h('b', {}, 'New Application'), '. Name it after your bot.')),
      h('li', {}, h('div', {}, 'Open ', h('b', {}, 'Bot'), ' in the menu, click ', h('b', {}, 'Reset Token'), ' and copy the token.')),
      h('li', {}, h('div', {}, 'On the same page, switch on ', h('b', {}, 'Message Content Intent'), ' and click ', h('b', {}, 'Save Changes'), '.')),
      h('li', {}, h('div', { class: 'grow' }, 'Paste the token here:', h('div', { class: 'gap-top' }, token)))),
    result,
    h('div', { class: 'form-actions' }, check, saveBtn));
  if (v.DISCORD_BOT_TOKEN.set) api('/api/discord/check', {}).then(showCheck).catch(() => {});
  return panel;
}

// ---------- AI ----------

const AI_CHOICES = [
  { id: 'claude', name: 'Claude', by: 'Anthropic', mark: 'C', signIn: 'claude-cli', key: 'anthropic', signInLabel: 'Sign in with Claude' },
  { id: 'chatgpt', name: 'ChatGPT', by: 'OpenAI', mark: 'G', signIn: 'codex-cli', key: 'openai', signInLabel: 'Sign in with ChatGPT' },
  { id: 'gemini', name: 'Gemini', by: 'Google', mark: '✦', signIn: 'gemini-cli', key: 'gemini', signInLabel: 'Sign in with Google' },
  { id: 'local', name: 'Local model', by: 'Ollama, LM Studio…', mark: '⌂', key: 'local' },
  { id: 'custom', name: 'Other API', by: 'OpenRouter, Groq…', mark: '…', key: 'custom' }
];
const familyOf = provider => AI_CHOICES.find(c => c.signIn === provider || c.key === provider)?.id;

// Model picker: a free-text field with a "Load" button that fills suggestions from the provider.
function modelField(key, provider, { label = 'Model', hint, placeholder } = {}) {
  const list = h('datalist', { id: `dl-${key}` });
  const input = h('input', { name: key, list: `dl-${key}`, autocomplete: 'off', spellcheck: 'false', placeholder: placeholder ?? state.config.defaults[provider] ?? 'Default' });
  input.value = state.config.values[key] ?? '';
  const load = provider ? h('button', { type: 'button', title: 'Show the models you can use', onclick: async () => {
    const r = await busy(load, () => api('/api/ai/models', { provider }));
    if (!r.ok) return toast(`Couldn't list models: ${r.error}`, true);
    list.replaceChildren(...r.models.map(m => h('option', { value: m })));
    toast(`${r.models.length} models found — pick one from the list.`);
    input.focus();
  } }, 'Load') : null;
  return h('label', { class: 'field' }, label, hint ? h('span', { class: 'hint' }, hint) : null,
    h('div', { class: 'input-row' }, input, load), list);
}

function cliStatusLine(info, what) {
  if (!info) return h('div', { class: 'status-line' }, h('span', { class: 'spinner' }), 'Checking this computer…');
  if (!info.installed) return h('div', { class: 'status-line' }, h('span', { class: 'dot bad' }), `${what} isn't installed on this computer yet`);
  return h('div', { class: 'status-line' }, h('span', { class: `dot ${info.signedIn ? 'online' : 'warn'}` }),
    info.signedIn ? `Signed in · ${info.version}` : `Installed, not signed in yet · ${info.version}`);
}

function signInPane(choice, cli) {
  if (choice.id === 'claude') return h('div', { class: 'stack' },
    cliStatusLine(cli?.claude, 'Claude Code'),
    h('ol', { class: 'steps' },
      h('li', {}, h('div', { class: 'grow' }, 'Install Claude Code on the computer running the bot:', cmd('npm install -g @anthropic-ai/claude-code'))),
      h('li', {}, h('div', { class: 'grow' }, 'Sign in with your Claude Pro or Max account. It prints a link: open it, approve, and copy the code it shows:', cmd('claude setup-token'))),
      h('li', {}, h('div', { class: 'grow' }, 'Paste the code here (skip this if you\'re already signed in to Claude Code as the bot\'s user):',
        h('div', { class: 'gap-top' }, settingField('CLAUDE_CODE_OAUTH_TOKEN', '', { secret: true, placeholder: 'sk-ant-oat01-…' }))))),
    modelField('CLAUDE_MODEL_CLI', null, { label: 'Model (optional)', placeholder: 'Default', hint: 'e.g. opus or sonnet.' }));
  if (choice.id === 'chatgpt') return h('div', { class: 'stack' },
    cliStatusLine(cli?.codex, 'Codex'),
    h('ol', { class: 'steps' },
      h('li', {}, h('div', { class: 'grow' }, 'Install OpenAI\'s Codex app on the computer running the bot:', cmd('npm install -g @openai/codex'))),
      h('li', {}, h('div', { class: 'grow' }, 'Sign in with your ChatGPT account (Plus, Pro, Business…). It shows a link and a code to enter:', cmd('codex login --device-auth'))),
      h('li', {}, h('div', {}, 'Come back here and press ', h('b', {}, 'Use ChatGPT'), '.'))),
    modelField('CODEX_MODEL_CLI', null, { label: 'Model (optional)', placeholder: 'Default' }));
  return h('div', { class: 'stack' },
    cliStatusLine(cli?.gemini, 'Gemini CLI'),
    h('ol', { class: 'steps' },
      h('li', {}, h('div', { class: 'grow' }, 'Install the Gemini CLI on the computer running the bot:', cmd('npm install -g @google/gemini-cli'))),
      h('li', {}, h('div', { class: 'grow' }, 'Run it once and choose "Sign in with Google" (it prints a link to open):', cmd('NO_BROWSER=true gemini'))),
      h('li', {}, h('div', {}, 'Come back here and press ', h('b', {}, 'Use Gemini'), '.'))),
    modelField('GEMINI_MODEL_CLI', null, { label: 'Model (optional)', placeholder: 'Default' }));
}

function keyPane(choice) {
  if (choice.id === 'claude') return h('div', { class: 'stack' },
    settingField('ANTHROPIC_API_KEY', 'API key', { secret: true, placeholder: 'sk-ant-api03-…', hint: 'From console.anthropic.com → API keys. Pay as you go.' }),
    modelField('CLAUDE_MODEL', 'anthropic'));
  if (choice.id === 'chatgpt') return h('div', { class: 'stack' },
    settingField('OPENAI_API_KEY', 'API key', { secret: true, placeholder: 'sk-proj-…', hint: 'From platform.openai.com → API keys. Pay as you go.' }),
    modelField('OPENAI_MODEL', 'openai'));
  if (choice.id === 'gemini') return h('div', { class: 'stack' },
    settingField('GEMINI_API_KEY', 'API key', { secret: true, placeholder: 'AIza…', hint: 'Free from aistudio.google.com → Get API key.' }),
    modelField('GEMINI_MODEL', 'gemini'));
  if (choice.id === 'local') return h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Runs on your own hardware: free and private. Install ', link('https://ollama.com', 'Ollama'), ' and download a model, or start the local server in ', link('https://lmstudio.ai', 'LM Studio'), '.'),
    cmd('ollama pull qwen2.5:7b'),
    settingField('LOCAL_BASE_URL', 'Server address', { placeholder: 'http://127.0.0.1:11434/v1', hint: 'Ollama: http://127.0.0.1:11434/v1 · LM Studio: http://127.0.0.1:1234/v1' }),
    modelField('LOCAL_MODEL', 'local'));
  return h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Any service with an OpenAI-style API: OpenRouter, Groq, Together, Mistral, DeepSeek, OpenCode…'),
    settingField('CUSTOM_BASE_URL', 'API address', { placeholder: 'https://openrouter.ai/api/v1' }),
    settingField('CUSTOM_API_KEY', 'API key', { secret: true }),
    modelField('CUSTOM_MODEL', 'custom', { placeholder: 'Model name' }));
}

function aiPanel({ onDone } = {}) {
  const active = state.config.values.AI_PROVIDER;
  let selected = AI_CHOICES.find(c => c.id === familyOf(active)) ?? AI_CHOICES[0];
  let mode = !selected.signIn || (active && active === selected.key) ? 'key' : 'signin';
  let cli = null;
  api('/api/ai/cli').then(r => { cli = r; draw(); }).catch(() => {});

  const tiles = h('div', { class: 'tiles' });
  const detail = h('div', { class: 'card stack' });

  function draw() {
    const current = state.config.values.AI_PROVIDER;
    tiles.replaceChildren(...AI_CHOICES.map(c => h('button', {
      type: 'button',
      class: `tile${c === selected ? ' on' : ''}`,
      onclick: () => { selected = c; mode = c.signIn ? 'signin' : 'key'; draw(); }
    },
    h('span', { class: 'brand-mark' }, c.mark),
    h('span', { class: 'tile-text' }, h('span', { class: 'strong' }, c.name), h('span', { class: 'muted small' }, c.by)),
    current && familyOf(current) === c.id ? h('span', { class: 'in-use' }, h('span', { class: 'dot online' }), 'In use') : null)));

    const provider = mode === 'signin' ? selected.signIn : selected.key;
    const tabs = selected.signIn ? h('div', { class: 'tabs' },
      h('button', { type: 'button', class: mode === 'signin' ? 'on' : '', onclick: () => { mode = 'signin'; draw(); } }, selected.signInLabel),
      h('button', { type: 'button', class: mode === 'key' ? 'on' : '', onclick: () => { mode = 'key'; draw(); } }, 'API key')) : null;
    const pane = mode === 'signin' ? signInPane(selected, cli) : keyPane(selected);
    const note = mode === 'signin' ? h('p', { class: 'muted small' }, `Uses your own ${selected.name} subscription through ${selected.by}'s official app, for your own bot. Usage counts towards your plan's limits and ${selected.by}'s terms apply. For a bot in a big public server, use an API key.`) : null;
    const result = h('div');

    const test = h('button', { type: 'button', onclick: async () => {
      result.replaceChildren();
      const r = await busy(test, async () => {
        await api('/api/config', { values: collect(pane) });
        await loadConfig();
        return await api('/api/ai/test', { provider });
      });
      result.replaceChildren(r.ok
        ? h('div', { class: 'result ok' }, `✓ It works — answered in ${(r.ms / 1000).toFixed(1)}s.`)
        : h('div', { class: 'result bad' }, `✗ ${r.error}`));
    } }, icon('bolt'), 'Test');
    const use = h('button', { type: 'button', class: 'primary', onclick: async () => {
      await save(use, { ...collect(pane), AI_PROVIDER: provider }, { quiet: true });
      toast(`Your bot now uses ${selected.name}.`);
      if (onDone) onDone();
      else draw();
    } }, onDone ? `Use ${selected.name} & continue` : `Use ${selected.name}`);

    detail.replaceChildren(
      h('div', { class: 'row-between' }, h('h2', {}, selected.name), h('span', { class: 'muted small' }, selected.by)),
      tabs, pane, note, result,
      h('div', { class: 'form-actions' }, test, use));
  }
  draw();

  const fallback = toggle('AI_LOCAL_FALLBACK', 'If the AI fails, answer with the local model instead', { hint: 'Needs a local model set up. Keeps the bot answering during outages or rate limits.' });
  fallback.querySelector('input').addEventListener('change', e => api('/api/config', { values: { AI_LOCAL_FALLBACK: e.target.checked ? 'on' : 'off' } })
    .then(() => toast('Saved.')).catch(err => toast(err.message, true)));
  return h('div', { class: 'stack' }, tiles, detail, onDone ? null : h('div', { class: 'card' }, fallback));
}

// ---------- Personality ----------

function personalityPanel({ onDone } = {}) {
  const v = state.config.values;
  const persona = h('textarea', { name: 'BOT_PERSONA', rows: 6, placeholder: 'Describe how the bot should behave…' });
  persona.value = v.BOT_PERSONA || '';
  const presets = h('div', { class: 'chips' });
  api('/api/personas').then(({ personas }) => {
    if (!persona.value) persona.value = personas[0].text;
    presets.replaceChildren(...personas.map(p => h('button', { type: 'button', class: 'chip', onclick: () => { persona.value = p.text; } }, p.label)));
  }).catch(() => {});

  const form = h('div', { class: 'stack' },
    h('div', { class: 'form-grid' },
      settingField('BOT_NAME', 'Name', { placeholder: 'Yapper', hint: 'What the bot calls itself.' }),
      settingField('BOT_STATUS', 'Status text', { placeholder: 'Mention me to chat', hint: 'Shown under its name in Discord.' })),
    h('label', { class: 'field' }, 'Personality', h('span', { class: 'hint' }, 'Start from a preset, then make it yours. {name} becomes the bot\'s name.'), presets, persona),
    h('h3', {}, 'When does it reply?'),
    h('p', { class: 'muted small tight' }, 'Always when someone @mentions it or replies to one of its messages.'),
    h('div', { class: 'form-grid' },
      settingField('BOT_CHANNELS', 'Also reply to every message in these channels', { placeholder: 'Channel IDs, comma separated', hint: 'Right-click a channel → Copy Channel ID (needs Developer Mode: Discord settings → Advanced).' }),
      settingField('BOT_MEMORY', 'Messages it remembers', { type: 'number', placeholder: '20', hint: 'Recent messages it reads for context. /reset clears them.' })),
    toggle('BOT_DMS', 'Reply to direct messages', { defaultOn: true }),
    toggle('BOT_SLASH_COMMANDS', 'Slash commands (/ask, /reset, /about)', { defaultOn: true, hint: 'Off = people chat by @mentioning the bot only, and the commands disappear from Discord\'s / menu.' }));
  const notice = restartNotice();
  const saveBtn = h('button', { class: 'primary', type: 'button', onclick: async () => {
    const res = await save(saveBtn, collect(form), { quiet: !!onDone });
    if (res.restart && !onDone) notice.hidden = false;
    onDone?.();
  } }, onDone ? 'Save & continue' : 'Save');
  return h('div', { class: 'stack' }, form, notice, h('div', { class: 'form-actions' }, saveBtn));
}

// ---------- Views ----------
const VIEWS = {};

VIEWS.overview = async body => {
  const [o] = await Promise.all([api('/api/overview'), loadConfig()]);
  state.overview = o;
  const s = o.state ?? {};
  const v = state.config.values;
  const [dotCls, statusText] = statusInfo(o);
  const steps = [v.DISCORD_BOT_TOKEN.set, !!v.AI_PROVIDER, !!v.BOT_PERSONA];
  const done = steps.filter(Boolean).length;

  const stat = (ic, label, value, sub, extra) => h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'title' }, extra ?? h('div', { class: 'icon-tile' }, icon(ic)), h('div', { class: 'stat-label' }, label))),
    h('div', { class: 'stat-value' }, value), sub ? h('div', { class: 'stat-sub' }, sub) : null);

  const invite = h('div');
  if (v.DISCORD_BOT_TOKEN.set) api('/api/discord/check', {}).then(r => {
    if (r.ok) invite.replaceChildren(h('a', { class: 'btn', href: r.invite, target: '_blank', rel: 'noopener' }, icon('link'), 'Add to a server'));
  }).catch(() => {});

  body.replaceChildren(
    done < steps.length ? h('a', { class: 'card banner', href: '#/setup' },
      h('div', { class: 'grow' }, h('h2', {}, 'Finish setting up your bot'), h('p', { class: 'muted' }, `${done} of ${steps.length} steps done. It takes about five minutes.`)),
      h('span', { class: 'btn primary' }, 'Continue setup')) : null,
    h('div', { class: 'grid cols-3' },
      stat('discord', 'Discord', s.tag ?? statusText, s.tag ? `In ${s.guilds ?? 0} server${s.guilds === 1 ? '' : 's'}` : 'Not connected yet',
        s.avatar ? h('img', { class: 'avatar small', src: s.avatar, alt: '' }) : null),
      stat('brain', 'AI model', o.ai.label, `${o.ai.via}${o.ai.model ? ` · ${o.ai.model}` : ''}`),
      stat('smile', 'Personality', v.BOT_NAME || 'Yapper', v.BOT_CHANNELS ? 'Mentions, replies and chosen channels' : 'Replies when mentioned')),
    h('div', { class: 'grid cols-2 section' },
      h('div', { class: 'card stack' },
        h('h2', {}, 'Bot'),
        h('div', { class: 'status-line' }, h('span', { class: `dot ${dotCls}` }), statusText),
        o.startedAt && o.status === 'online' ? h('p', { class: 'muted small' }, `Running since ${new Date(o.startedAt).toLocaleString()}`) : null,
        invite),
      h('div', { class: 'card stack' },
        h('div', { class: 'row-between' }, h('h2', {}, 'Test the AI'), h('span', { class: 'muted small' }, o.ai.label)),
        tryBox())));
};

// Sends a test question through the AI the bot is using right now.
function tryBox() {
  const out = h('div');
  const button = h('button', { onclick: async () => {
    out.replaceChildren();
    const r = await busy(button, () => api('/api/ai/test', { provider: state.overview.ai.provider }));
    out.replaceChildren(r.ok
      ? h('div', { class: 'result ok' }, `✓ Connected — answered in ${(r.ms / 1000).toFixed(1)}s.`)
      : h('div', { class: 'result bad' }, `✗ ${r.error}`));
  } }, icon('bolt'), 'Test connection');
  return h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Sends a tiny test message to check the AI answers.'), h('div', {}, button), out);
}

VIEWS.setup = async body => {
  await loadConfig();
  const v = state.config.values;
  const STEPS = [
    ['Discord', 'Create your bot on Discord and connect it.', next => discordPanel({ onDone: next })],
    ['AI model', 'Pick the AI that powers your bot: sign in with an account you already have, use an API key, or run a model on your own computer.', next => aiPanel({ onDone: next })],
    ['Personality', 'How should your bot talk, and when should it reply?', next => personalityPanel({ onDone: next })],
    ['Done', '', () => finishPanel()]
  ];
  let step = !v.DISCORD_BOT_TOKEN.set ? 0 : !v.AI_PROVIDER ? 1 : !v.BOT_PERSONA ? 2 : 3;
  const stepper = h('ol', { class: 'stepper' });
  const holder = h('div');
  const draw = async () => {
    await loadConfig();
    stepper.replaceChildren(...STEPS.map(([label], i) => h('li', { class: i === step ? 'on' : i < step ? 'done' : '' },
      h('button', { type: 'button', onclick: () => { step = i; draw(); } }, h('span', { class: 'num' }, i < step ? '✓' : String(i + 1)), label))));
    const [label, intro, make] = STEPS[step];
    holder.replaceChildren(h('div', { class: 'card stack' },
      h('div', {}, h('h2', {}, label), intro ? h('p', { class: 'muted' }, intro) : null),
      make(() => { step = Math.min(step + 1, STEPS.length - 1); draw(); })));
  };
  body.replaceChildren(stepper, holder);
  draw();
};

function finishPanel() {
  const invite = h('div', {}, h('div', { class: 'status-line' }, h('span', { class: 'spinner' }), 'Getting your invite link…'));
  api('/api/discord/check', {}).then(r => {
    invite.replaceChildren(r.ok ? botCard(r, 'Ready to join your server') : h('div', { class: 'result bad' }, r.error));
  }).catch(() => {});
  return h('div', { class: 'stack' },
    h('p', {}, 'All set. Add the bot to your Discord server, then say hi by @mentioning it.'),
    invite,
    h('ul', { class: 'muted small tips' },
      h('li', {}, h('b', {}, '@mention'), ' the bot or reply to it to chat. ', h('b', {}, '/ask'), ' works too.'),
      h('li', {}, h('b', {}, '/reset'), ' makes it forget the conversation in a channel.'),
      h('li', {}, 'Change anything later from the menu on the left.')),
    h('div', { class: 'form-actions' }, h('a', { class: 'btn', href: '#/overview' }, 'Go to overview')));
}

VIEWS.ai = async body => {
  await loadConfig();
  body.replaceChildren(h('p', { class: 'muted intro' }, 'Pick the AI that powers your bot. Changes apply right away.'), aiPanel());
};

VIEWS.personality = async body => {
  await loadConfig();
  body.replaceChildren(h('div', { class: 'card' }, personalityPanel()));
};

VIEWS.discord = async body => {
  await loadConfig();
  body.replaceChildren(h('div', { class: 'card stack' }, h('h2', {}, 'Bot token'), discordPanel()));
};

function choice(key, label, options, fallback, hint) {
  const select = h('select', { name: key }, options.map(([value, text]) => h('option', { value }, text)));
  select.value = state.config.values[key] || fallback;
  return h('label', { class: 'field' }, label, hint ? h('span', { class: 'hint' }, hint) : null, select);
}

VIEWS.tools = async body => {
  await loadConfig();
  const v = state.config.values;
  const result = h('div');
  const form = h('div', { class: 'stack' },
    toggle('DISCORD_TOOLS', 'Let the AI use Discord tools', { hint: 'Off by default. Works with the API-key, local and custom AI options (sign-in mode answers in plain text only).' }),
    h('div', { class: 'form-grid' },
      choice('DISCORD_TOOLS_ACCESS', 'What it may do', [['read', 'Look things up only (read-only)'], ['full', 'Everything: send, edit, manage, moderate']], 'read'),
      choice('DISCORD_TOOLS_WHO', 'Who can ask it to', [['admins', 'People with Manage Server permission'], ['everyone', 'Everyone']], 'admins',
        'Tools act with the bot’s own permissions, so keep this to admins unless you trust everyone.')),
    settingField('DISCORD_TOOLS_URL', 'Tools server address', { placeholder: 'http://127.0.0.1:8085/mcp' }));
  const test = h('button', { type: 'button', onclick: async () => {
    result.replaceChildren();
    const r = await busy(test, async () => {
      await api('/api/config', { values: collect(form) });
      await loadConfig();
      return await api('/api/tools/test', {});
    });
    result.replaceChildren(r.ok
      ? h('div', { class: 'result ok' }, `✓ Connected: ${r.count} tools (${r.readOnly} read-only).`)
      : h('div', { class: 'result bad' }, `✗ ${r.error}`));
  } }, icon('bolt'), 'Test');
  const saveBtn = h('button', { class: 'primary', type: 'button', onclick: () => save(saveBtn, collect(form)) }, 'Save');
  body.replaceChildren(
    h('p', { class: 'muted intro' }, 'Give the AI hands in your server: it can look up members and messages, create channels and events, manage roles and more, when someone asks. Powered by ', link('https://github.com/SaseQ/discord-mcp', 'discord-mcp'), '.'),
    h('div', { class: 'stack' },
      h('div', { class: 'card stack' },
        h('h2', {}, '1. Start the tools server'),
        h('p', { class: 'muted small' }, 'It runs next to the bot in Docker and uses the same bot token. Replace YOUR_BOT_TOKEN with the token from the Discord page:'),
        cmd('docker run -d --name discord-mcp --restart unless-stopped -p 127.0.0.1:8085:8085 -e SPRING_PROFILES_ACTIVE=http -e DISCORD_TOKEN=YOUR_BOT_TOKEN saseq/discord-mcp:latest'),
        h('p', { class: 'muted small' }, 'Using Docker Compose? It’s already in docker-compose.yml: uncomment the discord-mcp service.')),
      h('div', { class: 'card stack' },
        h('h2', {}, '2. Turn it on'),
        form, result,
        h('div', { class: 'form-actions' }, test, saveBtn)),
      h('div', { class: 'notice small' }, h('b', {}, 'Safety: '), 'the AI only uses tools when someone asks, asks for confirmation before deleting, kicking or banning, and ignores instructions hidden in messages. Give the bot’s Discord role only the permissions you’re happy for it to use.')));
};

VIEWS.logs = async body => {
  const box = h('div', { class: 'logs', tabindex: 0 });
  const follow = h('input', { type: 'checkbox', checked: true });
  const draw = async () => {
    const { lines } = await api('/api/logs').catch(() => ({ lines: [] }));
    box.replaceChildren(...lines.map(line => h('div', { class: /error|fail|crash/i.test(line) ? 'err' : /warn/i.test(line) ? 'warn' : '' }, line)));
    if (follow.checked) box.scrollTop = box.scrollHeight;
  };
  body.replaceChildren(h('div', { class: 'toolbar' }, h('label', { class: 'check' }, follow, 'Follow new lines')), box);
  await draw();
  const t = setInterval(() => {
    if (!document.body.contains(box)) return clearInterval(t);
    draw();
  }, 3000);
};

VIEWS.account = async body => {
  const error = h('div', { class: 'error', hidden: true });
  const current = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const next = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const button = h('button', { class: 'primary', type: 'submit' }, 'Change password');
  body.replaceChildren(h('form', { class: 'card stack narrow', onsubmit: async e => {
    e.preventDefault();
    error.hidden = true;
    try {
      await busy(button, () => api('/api/password', { current: current.value, next: next.value }));
      current.value = next.value = '';
      toast('Password changed. Other sessions were signed out.');
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  } },
  h('h2', {}, 'Dashboard password'),
  h('label', { class: 'field' }, 'Current password', current),
  h('label', { class: 'field' }, 'New password', h('span', { class: 'hint' }, 'At least 8 characters.'), next),
  error, h('div', {}, button)));
};

window.addEventListener('unhandledrejection', e => toast(e.reason?.message ?? 'Something went wrong.', true));
boot().catch(err => {
  document.getElementById('app').replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, h('h1', {}, 'Can\'t reach the bot'), h('p', { class: 'muted' }, err.message))));
});
