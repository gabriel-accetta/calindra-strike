import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, TICK_MS, parseClientMessage, sanitizeChat, sanitizeName } from '@calindra-strike/shared';
import { type WebSocket, WebSocketServer } from 'ws';
import { loadConfig } from './config.ts';
import { Game, type ServerPlayer } from './game.ts';
import { KeyedLimiter, TokenBucket } from './ratelimit.ts';

const cfg = loadConfig();
const game = new Game({
  maxPlayers: cfg.maxPlayers,
  matchMs: cfg.matchMs,
  podiumMs: cfg.podiumMs,
  warmupMinPlayers: cfg.warmupMinPlayers,
  modes: cfg.modes,
  tdmLimit: cfg.tdmLimit,
  airdropFirstMs: cfg.airdropFirstMs,
  botFill: cfg.botFill,
  botSkill: cfg.botSkill,
});

const sockets = new Set<WebSocket>();

const MAX_CONNECTIONS = cfg.maxPlayers + 8;
const SEND_BUFFER_SOFT = 256 * 1024; // skip non-essential sends above this
const SEND_BUFFER_HARD = 2 * 1024 * 1024; // terminate hopelessly slow clients

let connections = 0;
const perIp = new Map<string, number>();
// Office players share one NAT IP, so per-IP limits must fit a whole team joining at once.
const connectLimiter = new KeyedLimiter(3, 40);
const statusLimiter = new KeyedLimiter(15, 90);

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

function originAllowed(origin: string | undefined): origin is string {
  return typeof origin === 'string' && cfg.allowedOrigins.has(origin);
}

function clientIp(req: http.IncomingMessage): string {
  if (cfg.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first && first.length <= 64) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function codeMatches(given: string): boolean {
  if (!cfg.joinCode) return true;
  const a = Buffer.from(given.trim().toLowerCase());
  const b = Buffer.from(cfg.joinCode.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

// ------------------------------------------------------------------ HTTP

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  const path = (req.url ?? '/').split('?')[0];
  const origin = req.headers.origin;
  if (originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '600' }).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (path === '/status') {
    if (!statusLimiter.take(clientIp(req))) {
      res.writeHead(429).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ ...game.publicStatus(), protocol: PROTOCOL_VERSION, codeRequired: cfg.joinCode !== '' }),
    );
    return;
  }
  res.writeHead(404).end();
});
server.headersTimeout = 10_000;
server.requestTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 64;
server.maxConnections = 512;

// ------------------------------------------------------------------ WebSocket

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_MESSAGE_BYTES,
  perMessageDeflate: false,
  clientTracking: false,
});

function refuse(socket: Duplex, code: number, text: string): void {
  socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => socket.destroy());
  const path = (req.url ?? '').split('?')[0];
  if (path !== '/ws') return refuse(socket, 404, 'Not Found');
  if (!originAllowed(req.headers.origin)) return refuse(socket, 403, 'Forbidden');
  const ip = clientIp(req);
  if (!connectLimiter.take(ip)) return refuse(socket, 429, 'Too Many Requests');
  if (connections >= MAX_CONNECTIONS) return refuse(socket, 503, 'Service Unavailable');
  if ((perIp.get(ip) ?? 0) >= cfg.maxPerIp) return refuse(socket, 429, 'Too Many Requests');
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ip));
});

function onConnection(ws: WebSocket, ip: string): void {
  connections++;
  sockets.add(ws);
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
  let player: ServerPlayer | null = null;
  let strikes = 0;
  let kicked = false;
  let alive = true;
  let pingSentAt = 0;
  const bucket = new TokenBucket(120, 240);

  const send = (data: string, essential = false): void => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > SEND_BUFFER_HARD) {
      ws.terminate();
      return;
    }
    if (!essential && ws.bufferedAmount > SEND_BUFFER_SOFT) return;
    ws.send(data);
  };

  const strike = (n: number, why: string): void => {
    strikes += n;
    if (strikes >= 60 && !kicked) {
      kicked = true;
      log('kick', why, player?.name ?? '(handshake)');
      ws.close(1008, 'policy');
    }
  };

  const helloTimer = setTimeout(() => {
    if (!player) ws.close(4000, 'hello timeout');
  }, 6000);

  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    pingSentAt = performance.now();
    ws.ping();
    strikes = Math.max(0, strikes - 10);
  }, 4000);

  ws.on('pong', () => {
    alive = true;
    if (player) player.ping = Math.min(999, Math.round(performance.now() - pingSentAt));
  });

  ws.on('message', (data, isBinary) => {
    if (kicked) return;
    if (isBinary) return strike(20, 'binary');
    if (!bucket.take()) return strike(1, 'rate');
    const msg = parseClientMessage(data.toString());
    if (!msg) return strike(15, 'malformed');
    try {
      if (!player) {
        if (msg.t !== 'hello') return strike(30, 'no hello');
        if (msg.v !== PROTOCOL_VERSION) {
          send(JSON.stringify({ t: 'reject', reason: 'Versão desatualizada: recarregue a página', code: 'version' }), true);
          ws.close(4001, 'version');
          return;
        }
        if (!codeMatches(msg.code)) {
          send(JSON.stringify({ t: 'reject', reason: 'Código de acesso inválido', code: 'code' }), true);
          ws.close(4003, 'code');
          return;
        }
        const res = game.join(sanitizeName(msg.name), msg.color, msg.primary, (d) => send(d), msg.token);
        if (typeof res === 'string') {
          send(JSON.stringify({ t: 'reject', reason: res, code: 'full' }), true);
          ws.close(4002, 'full');
          return;
        }
        player = res;
        clearTimeout(helloTimer);
        log('join', JSON.stringify(player.name), `players=${game.players.size}`);
        return;
      }
      switch (msg.t) {
        case 'in':
          game.input(player, msg.c);
          break;
        case 'ping':
          send(JSON.stringify({ t: 'pong', c: msg.c, s: game.now() }), true);
          break;
        case 'loadout':
          game.setLoadout(player, msg.primary);
          break;
        case 'vote':
          game.vote(player, msg.option);
          break;
        case 'team':
          game.switchTeam(player, msg.team);
          break;
        case 'chat': {
          const text = sanitizeChat(msg.text);
          if (text) game.chat(player, text);
          break;
        }
        case 'hello':
          strike(5, 'dup hello');
          break;
      }
    } catch (err) {
      log('handler error', err);
      ws.close(1011, 'error');
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    clearInterval(heartbeat);
    connections--;
    sockets.delete(ws);
    const n = (perIp.get(ip) ?? 1) - 1;
    if (n <= 0) perIp.delete(ip);
    else perIp.set(ip, n);
    if (player) {
      log('leave', JSON.stringify(player.name), `players=${game.players.size - 1}`);
      game.leave(player.id);
      player = null;
    }
  });
  ws.on('error', () => ws.terminate());
}

// ------------------------------------------------------------------ loop

let next = performance.now();
function loop(): void {
  const now = performance.now();
  let n = 0;
  while (now >= next && n < 6) {
    game.update();
    next += TICK_MS;
    n++;
  }
  if (now - next > 250) next = now; // we fell far behind (GC pause / suspend): skip ahead
  setTimeout(loop, Math.max(0, next - performance.now()));
}
loop();

setInterval(() => {
  connectLimiter.sweep();
  statusLimiter.sweep();
}, 60_000).unref();

server.listen(cfg.port, cfg.host, () => {
  log(`calindra-strike server on ${cfg.host}:${cfg.port}`, `origins=${[...cfg.allowedOrigins].join(',')}`, `code=${cfg.joinCode ? 'on' : 'off'}`, `modes=${cfg.modes}`, `tdmLimit=${cfg.tdmLimit}`, `botFill=${cfg.botFill}`, `botSkill=${cfg.botSkill}`);
});

process.on('uncaughtException', (err) => {
  log('fatal', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  log('fatal rejection', err);
  process.exit(1);
});
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    log('shutting down: asking clients to reconnect');
    // 1012 = service restart: clients show "reconectando" and come back on their own
    for (const ws of sockets) ws.close(1012, 'restart');
    server.close();
    setTimeout(() => process.exit(0), 400).unref();
  });
}
