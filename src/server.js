'use strict';

const http = require('node:http');
const path = require('node:path');
const { loadConfig } = require('./config');
const { DiscordApi } = require('./discord-api');
const { TicketStore } = require('./ticket-store');
const { ModerationStore } = require('./moderation-store');
const { EconomyStore } = require('./economy-store');
const { GatewayClient } = require('./gateway');
const { GuildEventService } = require('./guild-events');
const { LevelStore } = require('./level-store');
const { AutoModService } = require('./automod-service');
const { CommunityStore } = require('./community-store');
const { CommunityService } = require('./community-service');
const { TicketService } = require('./ticket-service');
const { publicKeyFromHex, verifySignature, createInteractionHandler } = require('./interactions');

const BODY_LIMIT = 64 * 1024;
const SHUTDOWN_DRAIN_TIMEOUT_MS = 30_000;

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      length += chunk.length;
      if (length > BODY_LIMIT) { tooLarge = true; chunks.length = 0; return; }
      chunks.push(chunk);
    });
    request.on('end', () => tooLarge ? reject(Object.assign(new Error('Body too large'), { statusCode: 413 })) : resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function startServer({ config, publicKey, handle, logger = () => {} }) {
  const pendingWork = new Set();
  const server = http.createServer(async (request, reply) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      reply.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('ok');
      return;
    }
    if (request.method !== 'POST' || request.url !== '/interactions') {
      reply.writeHead(404).end();
      return;
    }
    try {
      const rawBody = await readBody(request);
      if (!verifySignature({ publicKey, timestamp: request.headers['x-signature-timestamp'], signature: request.headers['x-signature-ed25519'], rawBody })) {
        reply.writeHead(401).end();
        return;
      }
      let payload;
      try { payload = JSON.parse(rawBody.toString('utf8')); }
      catch { reply.writeHead(400).end(); return; }
      const result = await handle(payload);
      reply.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      reply.end(JSON.stringify(result.immediate));
      if (result.work) {
        let task;
        task = Promise.resolve().then(result.work).catch((error) => {
          try { logger('interaction_work_failed', { message: error.message }); } catch {}
        }).finally(() => pendingWork.delete(task));
        pendingWork.add(task);
      }
    } catch (error) {
      logger('http_request_failed', { message: error.message });
      if (!reply.headersSent) reply.writeHead(error.statusCode || 500).end();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.drain = async () => {
    while (pendingWork.size > 0) await Promise.all([...pendingWork]);
  };
  server.pendingWorkCount = () => pendingWork.size;
  server.listen(config.port, config.host);
  return server;
}

function installShutdownHandlers(server, { log, gateway, processRef = process, timeoutMs = SHUTDOWN_DRAIN_TIMEOUT_MS }) {
  let shuttingDown = false;
  const beginShutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    gateway?.stop();
    void server.community?.stop();
    const timeout = setTimeout(() => {
      log('shutdown_drain_timed_out', { pending: server.pendingWorkCount() });
      processRef.exitCode = 1;
    }, timeoutMs);
    if (server.listening) server.close();
    else server.once('listening', () => server.close());
    void server.drain().then(() => server.community?.stop()).then(
      () => clearTimeout(timeout),
      (error) => {
        clearTimeout(timeout);
        log('shutdown_drain_failed', { message: error.message });
        processRef.exitCode = 1;
      }
    );
  };
  for (const signal of ['SIGINT', 'SIGTERM']) processRef.once(signal, beginShutdown);
}

async function createServerRuntime({ config, publicKey, discord, store, moderation = new ModerationStore(config.moderationStorePath || './data/moderation.json'), economy = new EconomyStore(config.economyStorePath || './data/economy.json'), levels = new LevelStore(config.levelStorePath || './data/levels.json'), communityStore = new CommunityStore(config.communityStorePath || path.join(path.dirname(config.storePath || './data/tickets.json'), 'community.json')), gateway, logger = () => {} }) {
  await store.load();
  await moderation.load();
  await economy.load();
  await levels.load();
  await communityStore.load();
  const botUser = await discord.getCurrentUser();
  const tickets = new TicketService({ config, store, discord, botUserId: botUser.id });
  const automod = new AutoModService({ discord, guildId: config.guildId, botUserId: botUser.id });
  const community = new CommunityService({ config, store: communityStore, discord, logger });
  const handle = createInteractionHandler({ config, tickets, moderation, economy, levels, automod, community, discord, logger });
  const server = startServer({ config, publicKey, handle, logger });
  server.community = community;
  server.once('close', () => { void community.stop(); });
  community.start();
  const guildEvents = new GuildEventService({ config, discord, levels, logger });
  if (config.gatewayEnabled !== false && gateway) {
    gateway.intents = config.gatewayIntents;
    gateway.onDispatch = (type, data) => guildEvents.dispatch(type, data);
    gateway.start();
  }
  server.gateway = gateway || null;
  return server;
}

async function main() {
  const config = loadConfig();
  const publicKey = publicKeyFromHex(config.publicKey);
  const discord = new DiscordApi(config.botToken);
  const store = new TicketStore(config.storePath);
  const log = (event, details) => console.error(JSON.stringify({ time: new Date().toISOString(), event, ...details }));
  const gateway = config.gatewayEnabled ? new GatewayClient({ token: config.botToken, intents: config.gatewayIntents, getGateway: () => discord.getGatewayBot(), logger: log }) : null;
  const server = await createServerRuntime({ config, publicKey, discord, store, gateway, logger: log });
  server.on('listening', () => console.log(`OpenDesk listening on ${config.host}:${config.port}/interactions`));
  installShutdownHandlers(server, { gateway, log });
}

if (require.main === module) main().catch((error) => { console.error(`OpenDesk failed to start: ${error.message}`); process.exitCode = 1; });

module.exports = { startServer, createServerRuntime, installShutdownHandlers, readBody, BODY_LIMIT, SHUTDOWN_DRAIN_TIMEOUT_MS };
