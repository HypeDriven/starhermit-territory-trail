// Territory Trail — authoritative server.
// Serves the static distribution, /api/v1 routes, and hosted realtime rooms
// over WebSocket. All competitive outcomes are computed here; clients send
// only direction commands, validated and applied idempotently by command ID.
'use strict';

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createGame, initHash, step, applyCommand, rankPlayers, serialize, PHASE } from './js/rules.js';

const PORT = process.env.PORT || 8080;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C7AB0D3FEA';
const TICK_MS = 125; // 8 ticks/s, matches client session

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.map': 'application/json',
  '.opus': 'audio/ogg',
};

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// ---------------------------------------------------------------- rooms
const rooms = new Map(); // name -> room

function getRoom(name) {
  if (!rooms.has(name)) {
    rooms.set(name, {
      name: name,
      clients: new Map(), // playerId -> { socket, name }
      state: null,
      timer: null,
      events: [],
      cmdCounter: 0,
    });
  }
  return rooms.get(name);
}

function broadcast(room, obj) {
  const frame = wsFrame(JSON.stringify(obj));
  for (const c of room.clients.values()) {
    try { c.socket.write(frame); } catch (e) { /* dropped client */ }
  }
}

function broadcastRoster(room) {
  broadcast(room, { type: 'roster', players: [...room.clients.entries()].map(([id, c]) => ({ id: id, name: c.name })) });
}

function maybeStart(room) {
  if (room.state || room.startTimer) return;
  if (room.clients.size === 0) return;
  // Short lobby window so a second player can join before seats fill with AI.
  room.startTimer = setTimeout(() => {
    room.startTimer = null;
    startRound(room);
  }, 2000);
}

function startRound(room) {
  if (room.state || room.clients.size === 0) return;
  // Fill to 4 seats with AI; authoritative scripted session.
  const players = [];
  for (const [id, c] of room.clients) players.push({ id: id, name: c.name, isBot: false });
  while (players.length < 4) players.push({ id: 'ai-' + players.length, name: 'Rival ' + players.length, isBot: true });
  const seed = (Date.now() % 2147483647) >>> 0;
  room.state = createGame({ seed: seed, width: 30, height: 30, maxTicks: 1000, areaGoal: 120, players: players });
  initHash(room.state);
  broadcast(room, { type: 'start', seed: seed });
  room.timer = setInterval(() => tickRoom(room), TICK_MS);
}

function tickRoom(room) {
  const s = room.state;
  if (!s) return;
  const beforeAreas = s.players.map((p) => p.area);
  const beforeAlive = s.players.map((p) => p.alive);
  step(s);
  const events = [];
  for (let i = 0; i < s.players.length; i++) {
    if (s.players[i].area > beforeAreas[i] && s.players[i].alive) events.push({ kind: 'claim', playerId: s.players[i].id });
    if (beforeAlive[i] && !s.players[i].alive) events.push({ kind: 'eliminated', playerId: s.players[i].id });
  }
  if (s.phase === PHASE.ENDED) {
    clearInterval(room.timer);
    room.timer = null;
    broadcast(room, { type: 'end', state: s, rank: rankPlayers(s), replay: serialize(s) });
    room.state = null;
    // Clean room up if everyone left during the round.
    if (room.clients.size === 0) rooms.delete(room.name);
    return;
  }
  broadcast(room, { type: 'snapshot', state: s, events: events });
}

// ---------------------------------------------------------------- WebSocket framing
function wsAccept(key) {
  return crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
}

function wsFrame(str) {
  const data = Buffer.from(str, 'utf8');
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x81, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

// Parse one complete client frame from buf; returns { opcode, payload, rest } or null.
function wsParse(buf) {
  if (buf.length < 2) return null;
  const fin = buf[0] & 0x80;
  const opcode = buf[0] & 0x0f;
  const masked = buf[1] & 0x80;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2); off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2)); off = 10;
  }
  const maskLen = masked ? 4 : 0;
  if (buf.length < off + maskLen + len) return null;
  if (len > 16384) return { opcode: -1, payload: null, rest: buf.slice(off + maskLen + len) }; // oversize: drop
  let payload = buf.slice(off + maskLen, off + maskLen + len);
  if (masked) {
    const mask = buf.slice(off, off + 4);
    payload = Buffer.from(payload); // copy before mutating
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  }
  return { opcode: opcode, fin: fin, payload: payload, rest: buf.slice(off + maskLen + len) };
}

function handleWsMessage(room, playerId, socket, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (e) { return; }
  if (typeof msg !== 'object' || !msg) return;

  if (msg.type === 'join') {
    const name = String(msg.name || 'Player').slice(0, 24);
    room.clients.set(playerId, { socket: socket, name: name });
    socket.write(wsFrame(JSON.stringify({ type: 'welcome', playerId: playerId })));
    broadcastRoster(room);
    if (room.state) {
      // Late join: spectate the live round with a fresh snapshot.
      socket.write(wsFrame(JSON.stringify({ type: 'start', seed: room.state.seed, spectator: true })));
      socket.write(wsFrame(JSON.stringify({ type: 'snapshot', state: room.state, events: [] })));
    } else {
      maybeStart(room);
    }
    return;
  }
  if (msg.type === 'dir') {
    if (!room.state || room.state.phase !== PHASE.ACTIVE) return;
    if (typeof msg.dir !== 'string' || typeof msg.cmdId !== 'string') return;
    const res = applyCommand(room.state, {
      cmdId: playerId + ':' + msg.cmdId.slice(0, 40),
      playerId: playerId, type: 'dir', dir: msg.dir, tick: room.state.tick,
    });
    socket.write(wsFrame(JSON.stringify({ type: 'ack', cmdId: msg.cmdId, ok: res.ok, reason: res.reason || null })));
    return;
  }
  if (msg.type === 'ping') {
    socket.write(wsFrame(JSON.stringify({ type: 'pong', now: Date.now() })));
  }
}

// ---------------------------------------------------------------- HTTP server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/api/v1/time') {
    sendJson(res, 200, { now: Date.now() });
    return;
  }
  if (pathname === '/api/v1/presence' && req.method === 'POST') {
    res.writeHead(204); res.end();
    return;
  }
  if (pathname === '/api/v1/event' && req.method === 'POST') {
    // Anonymous funnel intake: read, cap size, drop on the floor (aggregate only).
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 4096) req.destroy(); });
    req.on('end', () => { if (!res.writableEnded) { res.writeHead(202); res.end(); } });
    req.on('error', () => {});
    return;
  }
  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'unknown-endpoint' });
    return;
  }

  // Static files, confined to ROOT.
  let file = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.replace(/^\//, ''));
  const full = path.normalize(path.join(ROOT, file));
  if (!full.startsWith(ROOT)) { sendJson(res, 403, { error: 'forbidden' }); return; }
  fs.readFile(full, (err, data) => {
    if (err) { sendJson(res, 404, { error: 'not-found' }); return; }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  });
});

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n'
  );
  socket.setNoDelay(true);

  const roomName = (url.searchParams.get('room') || 'lobby').slice(0, 24);
  const room = getRoom(roomName);
  const playerId = 'u-' + crypto.randomBytes(4).toString('hex');
  let buf = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let frame;
    while ((frame = wsParse(buf))) {
      buf = frame.rest;
      if (frame.opcode === -1) continue; // oversize dropped
      if (frame.opcode === 0x8) { socket.end(); return; } // close
      if (frame.opcode === 0x9) { // ping → pong
        const pong = Buffer.concat([Buffer.from([0x8a, frame.payload.length]), frame.payload]);
        socket.write(pong);
        continue;
      }
      if (frame.opcode === 0x1) handleWsMessage(room, playerId, socket, frame.payload.toString('utf8'));
    }
  });
  const drop = () => {
    if (room.clients.has(playerId)) {
      room.clients.delete(playerId);
      broadcastRoster(room);
    }
    if (room.clients.size === 0 && !room.state) rooms.delete(roomName);
  };
  socket.on('close', drop);
  socket.on('error', drop);
});

server.listen(PORT, () => {
  console.log('Territory Trail server listening on http://localhost:' + PORT);
});
