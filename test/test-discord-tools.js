// Discord tools: talks MCP to a stand-in for discord-mcp, offers only read-only tools unless full access is on,
// refuses tools it didn't offer, and limits who may use them.
import assert from 'node:assert/strict';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { PermissionFlagsBits } from 'discord.js';
import { listTools, toolsForAI, mayUseTools, testTools } from '../src/discord-tools.js';

const deleted = [];
function makeServer() {
  const server = new McpServer({ name: 'fake-discord', version: '1.0.0' });
  server.registerTool('get_server_info', { description: 'Server info', inputSchema: { guildId: z.string() } },
    async ({ guildId }) => ({ content: [{ type: 'text', text: `Guild ${guildId}: 42 members` }] }));
  server.registerTool('delete_channel', { description: 'Delete a channel', inputSchema: { channelId: z.string() } },
    async ({ channelId }) => { deleted.push(channelId); return { content: [{ type: 'text', text: 'deleted' }] }; });
  return server;
}

// Stateless Streamable HTTP, like discord-mcp's /mcp endpoint.
const httpServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = makeServer();
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
});
await new Promise(r => httpServer.listen(0, '127.0.0.1', r));
process.env.DISCORD_TOOLS_URL = `http://127.0.0.1:${httpServer.address().port}/mcp`;

assert.deepEqual((await listTools()).map(t => t.name).sort(), ['delete_channel', 'get_server_info']);
assert.deepEqual(await testTools().then(r => [r.count, r.readOnly]), [2, 1]);

// Read-only by default: only the lookup tool is offered, and the other is refused even if the AI asks.
let tools = await toolsForAI();
assert.deepEqual(tools.definitions.map(d => d.function.name), ['get_server_info']);
assert.equal(tools.definitions[0].function.parameters.properties.guildId.type, 'string');
assert.deepEqual(await tools.execute('get_server_info', { guildId: '123' }), { result: 'Guild 123: 42 members' });
await assert.rejects(tools.execute('delete_channel', { channelId: '9' }), /not allowed/);
assert.deepEqual(deleted, []);

process.env.DISCORD_TOOLS_ACCESS = 'full';
tools = await toolsForAI();
assert.equal(tools.definitions.length, 2);
await tools.execute('delete_channel', { channelId: '9' });
assert.deepEqual(deleted, ['9']);

// Who may use them.
const member = perms => ({ permissions: { has: flag => perms.includes(flag) } });
assert.equal(mayUseTools(member([PermissionFlagsBits.ManageGuild])), false, 'off unless DISCORD_TOOLS=on');
process.env.DISCORD_TOOLS = 'on';
assert.equal(mayUseTools(member([PermissionFlagsBits.ManageGuild])), true);
assert.equal(mayUseTools(member([])), false);
assert.equal(mayUseTools(null), false, 'no tools in DMs');
process.env.DISCORD_TOOLS_WHO = 'everyone';
assert.equal(mayUseTools(member([])), true);

httpServer.close();
console.log('discord-tools ok');
process.exit(0);
