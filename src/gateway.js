'use strict';

const GATEWAY_VERSION = 10;
const RECONNECTABLE_CODES = new Set([4000, 4001, 4002, 4003, 4005, 4007, 4008, 4009]);
const FRESH_SESSION_CODES = new Set([4007, 4009]);
const FATAL_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

function gatewayUrl(url) {
  const parsed = new URL(url);
  parsed.searchParams.set('v', String(GATEWAY_VERSION));
  parsed.searchParams.set('encoding', 'json');
  return parsed.toString();
}

class GatewayClient {
  constructor({ token, intents, getGateway, onDispatch = async () => {}, logger = () => {}, webSocketFactory, timers = globalThis, random = Math.random, reconnectBaseMs = 1000, reconnectMaxMs = 30_000 }) {
    this.token = token;
    this.intents = intents;
    this.getGateway = getGateway;
    this.onDispatch = onDispatch;
    this.logger = logger;
    this.webSocketFactory = webSocketFactory || ((url) => new WebSocket(url));
    this.timers = timers;
    this.random = random;
    this.reconnectBaseMs = reconnectBaseMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.running = false;
    this.socket = null;
    this.gatewayBaseUrl = null;
    this.resumeUrl = null;
    this.sessionId = null;
    this.sequence = null;
    this.heartbeatInterval = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.lastHeartbeatAck = true;
    this.reconnectAttempt = 0;
    this.messageQueue = Promise.resolve();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.reconnectAttempt = 0;
    this.#connect();
  }

  stop() {
    this.running = false;
    this.#clearHeartbeat();
    if (this.reconnectTimer !== null) this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < 2) socket.close(1000, 'OpenDesk shutdown');
  }

  #connect() {
    if (!this.running || this.socket) return;
    void this.#open().catch((error) => {
      this.#log('gateway_connect_failed', { message: error.message });
      this.#scheduleReconnect();
    });
  }

  async #open() {
    if (!this.gatewayBaseUrl) {
      const gateway = await this.getGateway();
      if (!gateway?.url) throw new Error('Discord did not provide a Gateway URL.');
      this.gatewayBaseUrl = gateway.url;
    }
    const url = gatewayUrl(this.sessionId && this.resumeUrl ? this.resumeUrl : this.gatewayBaseUrl);
    const socket = this.webSocketFactory(url);
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      this.messageQueue = this.messageQueue.then(() => this.#receive(event.data)).catch((error) => {
        this.#log('gateway_payload_failed', { message: error.message });
      });
    });
    socket.addEventListener('close', (event) => this.#closed(socket, event));
    socket.addEventListener('error', () => this.#log('gateway_socket_error', {}));
  }

  async #receive(raw) {
    const text = typeof raw === 'string' ? raw : await raw.text();
    const packet = JSON.parse(text);
    if (packet.op === 10) {
      this.#hello(packet.d?.heartbeat_interval);
      return;
    }
    if (packet.op === 11) {
      this.lastHeartbeatAck = true;
      return;
    }
    if (packet.op === 1) {
      if (this.heartbeatTimer !== null) this.timers.clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.#sendHeartbeat(true);
      return;
    }
    if (packet.op === 7) {
      this.#log('gateway_reconnect_requested', {});
      const socket = this.socket;
      this.socket = null;
      this.#clearHeartbeat();
      socket?.close(4000, 'Discord requested reconnect');
      this.#scheduleReconnect(0);
      return;
    }
    if (packet.op === 9) {
      if (!packet.d) this.#clearSession();
      this.#log('gateway_session_invalid', { resumable: Boolean(packet.d) });
      const socket = this.socket;
      this.socket = null;
      this.#clearHeartbeat();
      socket?.close(4000, 'Discord invalidated session');
      this.#scheduleReconnect(1000 + Math.floor(this.random() * 4000));
      return;
    }
    if (packet.op !== 0) return;
    if (packet.s !== null && packet.s !== undefined) this.sequence = packet.s;
    if (packet.t === 'READY') {
      this.sessionId = packet.d?.session_id || null;
      this.resumeUrl = packet.d?.resume_gateway_url || null;
      this.reconnectAttempt = 0;
      this.#log('gateway_ready', {});
    } else if (packet.t === 'RESUMED') {
      this.reconnectAttempt = 0;
      this.#log('gateway_resumed', {});
    }
    await this.onDispatch(packet.t, packet.d);
  }

  #hello(interval) {
    if (!Number.isFinite(interval) || interval < 1) {
      this.#log('gateway_invalid_heartbeat_interval', {});
      this.socket?.close(4002, 'Invalid heartbeat interval');
      return;
    }
    this.#clearHeartbeat();
    this.heartbeatInterval = interval;
    this.lastHeartbeatAck = true;
    if (this.sessionId && this.sequence !== null) {
      this.#send({ op: 6, d: { token: this.token, session_id: this.sessionId, seq: this.sequence } });
    } else {
      this.#send({ op: 2, d: {
        token: this.token,
        intents: this.intents,
        properties: { os: process.platform, browser: 'OpenDesk', device: 'OpenDesk' }
      } });
    }
    this.heartbeatTimer = this.timers.setTimeout(() => this.#sendHeartbeat(), Math.floor(interval * this.random()));
  }

  #sendHeartbeat(force = false) {
    if (!this.running || !this.socket) return;
    if (!this.lastHeartbeatAck && !force) {
      this.#log('gateway_heartbeat_unacknowledged', {});
      this.socket.close(4000, 'Heartbeat acknowledgement missing');
      return;
    }
    if (this.heartbeatTimer !== null) this.timers.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.lastHeartbeatAck = false;
    this.#send({ op: 1, d: this.sequence });
    this.heartbeatTimer = this.timers.setTimeout(() => this.#sendHeartbeat(), this.heartbeatInterval);
  }

  #send(packet) {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify(packet));
  }

  #closed(socket, event = {}) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.#clearHeartbeat();
    const code = Number(event.code || 0);
    if (FATAL_CODES.has(code)) {
      this.running = false;
      this.#log('gateway_stopped_fatal_close', { code });
      return;
    }
    if (FRESH_SESSION_CODES.has(code)) this.#clearSession();
    if (code === 1000 || code === 1001) this.#clearSession();
    if (!this.running) return;
    if (code && code !== 1000 && code !== 1001 && !RECONNECTABLE_CODES.has(code)) {
      this.running = false;
      this.#log('gateway_stopped_unexpected_close', { code });
      return;
    }
    this.#scheduleReconnect();
  }

  #scheduleReconnect(delay) {
    if (!this.running || this.reconnectTimer !== null) return;
    const backoff = delay ?? Math.min(this.reconnectBaseMs * (2 ** this.reconnectAttempt), this.reconnectMaxMs);
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 16);
    const jittered = delay === undefined ? Math.floor(backoff * (0.8 + this.random() * 0.4)) : delay;
    this.#log('gateway_reconnect_scheduled', { delayMs: jittered });
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      this.#connect();
    }, jittered);
  }

  #clearHeartbeat() {
    if (this.heartbeatTimer !== null) this.timers.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.heartbeatInterval = null;
  }

  #clearSession() {
    this.sessionId = null;
    this.sequence = null;
    this.resumeUrl = null;
  }

  #log(event, details) {
    try { this.logger(event, details); } catch {}
  }
}

module.exports = { GatewayClient, GATEWAY_VERSION, RECONNECTABLE_CODES, FRESH_SESSION_CODES, FATAL_CODES, gatewayUrl };
