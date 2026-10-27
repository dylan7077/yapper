// The Discord bot: an AI chat bot with a configurable personality.
// Started by src/main.js, which also runs the dashboard; settings arrive as environment variables.
import { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, ActivityType, ChannelType } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { AI, describeAI, aiSupportsTools } from './ai.js';
import { mayUseTools, toolsForAI, toolInstructions } from './discord-tools.js';
import { botName } from './branding.js';
import { DEFAULT_PERSONA } from './personas.js';
import { splitMessage } from './discord-text.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || './storage');
const env = (key, fallback = '') => process.env[key] || fallback;
const list = key => env(key).split(/[\s,]+/).filter(Boolean);

if (!TOKEN) {
  console.error('ERROR: DISCORD_BOT_TOKEN is required. Run `npm start` and add it in the dashboard.');
  process.exit(1);
}

// One bot process per storage folder.
fs.mkdirSync(STORAGE_DIR, { recursive: true });
const LOCK_FILE = path.join(STORAGE_DIR, 'bot.pid');
try {
  process.kill(Number(fs.readFileSync(LOCK_FILE, 'utf8')), 0);
  console.warn('[bot] Another bot instance is already running for this storage folder. Exiting.');
  process.exit(0);
} catch {}
fs.writeFileSync(LOCK_FILE, String(process.pid));
process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch {} });
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());

const ai = new AI();
const persona = () => {
  const text = env('BOT_PERSONA', DEFAULT_PERSONA).replaceAll('{name}', botName());
  return `${text}\n\nYou are chatting in Discord as "${botName()}". Keep replies under 1800 characters unless asked for more. Discord markdown works. Messages from people start with their display name.`;
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

// ---------- Conversation memory ----------
// History comes from the channel itself (so it survives restarts), back to the last /reset.

const resetsFile = path.join(STORAGE_DIR, 'resets.json');
const resets = (() => { try { return JSON.parse(fs.readFileSync(resetsFile, 'utf8')); } catch { return {}; } })();
const saveResets = () => fs.writeFileSync(resetsFile, JSON.stringify(resets));
const MEMORY = () => Math.max(0, Math.min(50, Number(env('BOT_MEMORY', '20')) || 0));
const MAX_HISTORY_CHARS = 12_000;

const cleanContent = (message) => message.content
  .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), `@${botName()}`)
  .trim();

const speaker = message => message.member?.displayName ?? message.author.globalName ?? message.author.username;

async function history(message) {
  const limit = MEMORY();
  const since = resets[message.channelId] ?? 0;
  const before = limit ? await message.channel.messages.fetch({ limit, before: message.id }).catch(() => null) : null;
  const past = [...(before?.values() ?? [])]
    .filter(m => m.createdTimestamp > since && (m.content || '').trim() && (!m.author.bot || m.author.id === client.user.id));
  // Newest first, so the most recent messages are kept when the history is too long.
  const messages = [];
  let chars = 0;
  for (const m of past) {
    const content = m.author.id === client.user.id ? m.content : `${speaker(m)}: ${cleanContent(m)}`;
    chars += content.length;
    if (chars > MAX_HISTORY_CHARS) break;
    messages.unshift({ role: m.author.id === client.user.id ? 'assistant' : 'user', content });
  }
  messages.push({ role: 'user', content: `${speaker(message)}: ${cleanContent(message)}` });
  // Some APIs require the conversation to start with the user.
  while (messages[0]?.role === 'assistant') messages.shift();
  return messages;
}

// ---------- Replying ----------

const NO_PINGS = { parse: [], repliedUser: true };

async function withTyping(channel, fn) {
  channel.sendTyping().catch(() => {});
  const timer = setInterval(() => channel.sendTyping().catch(() => {}), 8000);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

const lastAsk = new Map();
function coolingDown(userId) {
  const now = Date.now();
  const wait = Number(env('BOT_COOLDOWN_SECONDS', '3')) * 1000;
  if (now - (lastAsk.get(userId) ?? 0) < wait) return true;
  lastAsk.set(userId, now);
  return false;
}

async function shouldReply(message) {
  if (message.channel.type === ChannelType.DM) return env('BOT_DMS', 'on') === 'on';
  if (list('BOT_CHANNELS').includes(message.channelId)) return true;
  if (message.mentions.users.has(client.user.id)) return true;
  if (message.reference?.messageId) {
    const replied = await message.fetchReference().catch(() => null);
    if (replied?.author.id === client.user.id) return true;
  }
  return false;
}

// Discord tools (see src/discord-tools.js) for people allowed to use them, when the AI can call tools.
async function toolsFor(member, guildId, channelId) {
  if (!guildId || !aiSupportsTools() || !mayUseTools(member)) return { system: persona() };
  try {
    const tools = await toolsForAI();
    return { system: `${persona()}

${toolInstructions({ guildId, channelId })}`, tools: tools.definitions, executeTool: tools.execute };
  } catch (err) {
    console.warn(`[tools] Discord tools unavailable: ${err.message}`);
    return { system: persona() };
  }
}

async function answer(message) {
  try {
    const text = await withTyping(message.channel, async () => ai.chat({
      ...await toolsFor(message.member, message.guildId, message.channelId),
      messages: await history(message),
      sessionId: `discord-${message.channelId}`
    }));
    const [first, ...more] = splitMessage(text);
    await message.reply({ content: first, allowedMentions: NO_PINGS });
    for (const part of more) await message.channel.send({ content: part, allowedMentions: { parse: [] } });
  } catch (err) {
    console.error(`[bot] Reply failed: ${err.message}`);
    await message.reply({ content: `⚠️ I couldn't answer that: ${err.message.slice(0, 300)}`, allowedMentions: NO_PINGS }).catch(() => {});
  }
}

client.on('messageCreate', async message => {
  if (message.author.bot || !client.user) return;
  if (!message.content.trim() || !await shouldReply(message)) return;
  if (coolingDown(message.author.id)) return;
  await answer(message);
});

// ---------- Slash commands ----------

const commands = [
  new SlashCommandBuilder().setName('ask').setDescription(`Ask ${botName()} something`)
    .addStringOption(o => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(4000)),
  new SlashCommandBuilder().setName('reset').setDescription('Make the bot forget the conversation in this channel'),
  new SlashCommandBuilder().setName('about').setDescription('Which AI the bot is using')
];

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  try {
    if (commandName === 'ask') {
      await interaction.deferReply();
      const question = interaction.options.getString('question');
      const name = interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username;
      const text = await ai.chat({
        ...await toolsFor(interaction.member, interaction.guildId, interaction.channelId),
        messages: [{ role: 'user', content: `${name}: ${question}` }],
        sessionId: `discord-${interaction.channelId}`
      });
      const [first, ...more] = splitMessage(text);
      await interaction.editReply({ content: first, allowedMentions: { parse: [] } });
      for (const part of more) await interaction.followUp({ content: part, allowedMentions: { parse: [] } });
    } else if (commandName === 'reset') {
      resets[interaction.channelId] = Date.now();
      saveResets();
      await interaction.reply('🧹 Fresh start: I\'ve forgotten the conversation in this channel.');
    } else if (commandName === 'about') {
      await interaction.reply({ content: `I'm **${botName()}**, thinking with **${ai.model}**.`, ephemeral: true });
    }
  } catch (err) {
    console.error(`[bot] /${commandName} failed: ${err.message}`);
    const reply = { content: `⚠️ ${err.message.slice(0, 300)}`, ephemeral: true };
    await (interaction.deferred || interaction.replied ? interaction.editReply(reply) : interaction.reply(reply)).catch(() => {});
  }
});

client.once('clientReady', async () => {
  console.log(`[bot] Logged in as ${client.user.tag} · AI: ${ai.model}`);
  try {
    // BOT_SLASH_COMMANDS=off registers none, which also removes any registered earlier.
    const body = env('BOT_SLASH_COMMANDS', 'on') === 'off' ? [] : commands.map(c => c.toJSON());
    await new REST({ version: '10' }).setToken(TOKEN).put(Routes.applicationCommands(client.user.id), { body });
    console.log(`[bot] Registered ${body.length} slash commands.`);
  } catch (err) {
    console.error('[bot] Failed to register slash commands:', err.message);
  }
  const status = env('BOT_STATUS', 'Mention me to chat');
  client.user.setPresence({ activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: status }], status: 'online' });
  reportState();
});

// ---------- Dashboard link (IPC with src/main.js) ----------

function reportState() {
  if (!process.send) return;
  process.send({
    type: 'state',
    state: {
      ready: client.isReady(),
      id: client.user?.id ?? null,
      tag: client.user?.tag ?? null,
      avatar: client.user?.displayAvatarURL?.() ?? null,
      guilds: client.guilds.cache.size,
      ai: describeAI()
    }
  });
}

process.on('message', async msg => {
  if (msg?.type === 'env') {
    // Live settings from the dashboard (AI provider, keys, models, persona).
    for (const [key, value] of Object.entries(msg.values ?? {})) process.env[key] = value;
    for (const key of msg.cleared ?? []) delete process.env[key];
  }
});
if (process.send) setInterval(reportState, 15_000);

client.login(TOKEN).catch(err => {
  console.error(`[bot] Discord login failed: ${err.message}`);
  process.exit(1);
});
