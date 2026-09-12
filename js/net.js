'use strict';

// Hosted rooms client: StarHermit realtime rooms (host-routed), carrying the
// game's EXISTING hosted JSON messages (welcome/roster/start/snapshot/ack/end)
// over the rooms transport. Lobby is REST; transport is
// ws(s)://<host>/ws/v1/realtime?roomId=<id>&access_token=<token> with binary
// frames. The platform prefixes every routed binary frame with a 16-byte
// sender participant id (stripped here); guest frames reach the host only,
// host frames reach everyone. 8 KB/frame cap, guests <=30 msg/s. The HOST
// seat runs the same authoritative rules engine as server.js (browser-side):
// guests send their existing {type:'dir'} messages, the host validates them
// through rules.applyCommand and broadcasts snapshots; player ids are account
// ids (token sub) and empty seats are AI, mirroring server.js's fill-to-4.

import { createGame, initHash, step, applyCommand, rankPlayers, PHASE } from './rules.js';

const SENDER_PREFIX = 16;      // bytes: platform participant id prefix
const MAX_BINARY = 8192;       // 8 KB/frame cap
const MAX_TEXT = 4096;         // JSON control frames <=4 KB
const GUEST_DIR_INTERVAL = 34; // ms between guest input frames (<=30 msg/s)
const ROOM_SEATS = 4;
const BOARD = { width: 30, height: 30, maxTicks: 1000, areaGoal: 120 };
const TICK_MS = 125;           // 8 ticks/s, matches Session/server.js

function roomIdOf(room) {
  if (!room || typeof room !== 'object') return null;
  return room.roomId || room.id || (room.room ? roomIdOf(room.room) : null);
}

/** Board state without the command/hash logs — fits the 8 KB frame cap. */
function wireState(s) {
  return {
    version: s.version, seed: s.seed, width: s.width, height: s.height,
    maxTicks: s.maxTicks, areaGoal: s.areaGoal, tick: s.tick,
    phase: s.phase, reason: s.reason, winner: s.winner,
    cells: s.cells, trailOf: s.trailOf,
    players: s.players.map((p) => ({
      id: p.id, name: p.name, isBot: p.isBot, x: p.x, y: p.y, dir: p.dir,
      alive: p.alive, trail: p.trail, area: p.area,
      eliminations: p.eliminations, invalidActions: p.invalidActions,
      outside: p.outside,
    })),
  };
}

export class RoomsClient {
  /**
   * @param platform  platform module (api/getToken/getUserId/getGameSlug/
   *                  getDisplayName/profileFor).
   */
  constructor(platform) {
    this.platform = platform;
    this.ws = null;
    this.roomId = null;
    this.isHost = false;
    this.handlers = {};        // type -> fn(msg)
    this.game = null;          // host-side authoritative sim {state, timer}
    this.participants = [];    // [{ participantId, userId, name|null }]
    this._senderPlayer = new Map(); // 16-byte sender hex -> player id
    this._lastDirAt = 0;
    this._roundSeed = null;    // guest: last start seed (resume echoes ignored)
    this._intentionalClose = false;
    this._reconnects = 0;
    this._reconnectTimer = null;
  }

  get myPlayerId() { return this.platform.getUserId(); }

  on(type, fn) { this.handlers[type] = fn; return this; }
  _emit(type, msg) { const fn = this.handlers[type]; if (fn) fn(msg || {}); }

  // ------------------------------------------------------------- lobby (REST)

  /** Host: create a 4-seat room and open it for quick-join. */
  async createAndOpen() {
    this._emit('status', { text: 'Creating room…' });
    const res = await this.platform.api('/api/v1/realtime/rooms', {
      method: 'POST',
      body: JSON.stringify({
        teamCount: 1,
        seatsPerTeam: ROOM_SEATS,
        metadata: { gameSlug: this.platform.getGameSlug() },
      }),
    });
    if (!res.ok) throw new Error('http-' + res.status);
    const room = await res.json();
    this.roomId = roomIdOf(room);
    if (!this.roomId) throw new Error('bad-room-payload');
    this.isHost = true;
    await this.platform.api('/api/v1/realtime/rooms/' + encodeURIComponent(this.roomId) + '/open', { method: 'POST' })
      .catch(() => { /* open is best-effort; the room still exists */ });
    await this._connectWs();
    this._emit('welcome', { playerId: this.myPlayerId });
    this._emitRoster();
  }

  /** Guest: quick-join any open room for this game (404 = none open). */
  async quickJoin() {
    this._emit('status', { text: 'Looking for an open room…' });
    const res = await this.platform.api('/api/v1/realtime/rooms/quick-join', {
      method: 'POST',
      body: JSON.stringify({ gameSlug: this.platform.getGameSlug(), seats: 1 }),
    });
    if (res.status === 404) {
      this._emit('error', { message: 'No open rooms right now. Create one and other players can quick-join it.' });
      return false;
    }
    if (!res.ok) throw new Error('http-' + res.status);
    const room = await res.json();
    this.roomId = roomIdOf(room);
    if (!this.roomId) throw new Error('bad-room-payload');
    this.isHost = false;
    await this._connectWs();
    return true;
  }

  // ------------------------------------------------------------- transport

  _wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws/v1/realtime?roomId=' + encodeURIComponent(this.roomId) +
      '&access_token=' + encodeURIComponent(this.platform.getToken());
  }

  _connectWs() {
    this._intentionalClose = false;
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this._wsUrl()); } catch (e) { reject(new Error('connect-failed')); return; }
      ws.binaryType = 'arraybuffer';
      ws.onerror = () => reject(new Error('connect-failed'));
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        if (this._intentionalClose || !this.roomId) return;
        this._stopTimer(); // host authority pauses while disconnected
        this._scheduleReconnect();
      };
      ws.onopen = () => {
        this.ws = ws;
        this._reconnects = 0;
        if (!this.isHost) this._sendControl({ op: 'ready' }); // guests: ready/chat only
        resolve();
      };
      ws.onmessage = (e) => this._onMessage(e);
    });
  }

  _scheduleReconnect() {
    if (this._reconnects >= 5) { this._emit('closed', {}); return; }
    const delay = Math.min(8000, 500 * Math.pow(2, this._reconnects++));
    this._emit('status', { text: 'Connection lost — reconnecting (attempt ' + this._reconnects + ')…' });
    this._reconnectTimer = setTimeout(() => {
      this.platform.api('/api/v1/realtime/rooms/mine')
        .then(async (res) => {
          if (!res.ok) throw new Error('http-' + res.status);
          const mine = await res.json();
          const rid = roomIdOf(mine);
          if (!rid) throw new Error('not-in-room');
          this.roomId = rid;
          await this._connectWs();
          this._emit('status', { text: 'Reconnected to the room.' });
          if (this.isHost && this.game) this._resumeGuests(); // re-broadcast state
        })
        .catch(() => this._scheduleReconnect());
    }, delay);
    if (this._reconnectTimer && this._reconnectTimer.unref) this._reconnectTimer.unref();
  }

  _sendControl(obj) {
    const text = JSON.stringify(obj);
    if (text.length > MAX_TEXT) return;
    if (this.ws && this.ws.readyState === 1) this.ws.send(text);
  }

  _sendBinary(text) {
    if (text.length > MAX_BINARY) return; // 8 KB cap
    if (this.ws && this.ws.readyState === 1) this.ws.send(new TextEncoder().encode(text));
  }

  leave() {
    this._stopTimer();
    this.game = null;
    this.participants = [];
    this._senderPlayer.clear();
    const room = this.roomId;
    this.roomId = null;
    this._intentionalClose = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; this._reconnects = 0; }
    try { if (this.ws) this.ws.close(); } catch (e) { /* already closed */ }
    this.ws = null;
    if (room) {
      this.platform.api('/api/v1/realtime/rooms/' + encodeURIComponent(room) + '/leave', { method: 'POST' })
        .catch(() => { /* seat is released by the room TTL anyway */ });
    }
  }

  // ------------------------------------------------------------- host gameplay

  /** Host: begin the authoritative round; AI fills empty seats (like server.js). */
  startRound() {
    if (!this.isHost || this.game) return;
    const players = [{ id: this.myPlayerId, name: this.platform.getDisplayName() || 'You', isBot: false }];
    for (const p of this.participants) {
      if (p.userId === this.myPlayerId) continue;
      if (players.length >= ROOM_SEATS) break;
      players.push({ id: p.userId, name: p.name || ('Player ' + String(p.userId).slice(0, 8)), isBot: false });
    }
    let ai = 1;
    while (players.length < ROOM_SEATS) {
      players.push({ id: 'ai-' + ai, name: 'Rival ' + ai, isBot: true });
      ai++;
    }
    const seed = (Date.now() % 2147483647) >>> 0;
    const state = createGame({
      seed: seed, width: BOARD.width, height: BOARD.height,
      maxTicks: BOARD.maxTicks, areaGoal: BOARD.areaGoal, players: players,
    });
    initHash(state);
    this._senderPlayer.clear();
    this.game = { state: state, timer: null };
    this._sendControl({ type: 'start', seed: seed });
    this._emit('start', { seed: seed });
    this.game.timer = setInterval(() => this._tickRoom(), TICK_MS);
    if (this.game.timer && this.game.timer.unref) this.game.timer.unref();
  }

  /** Host: steer the local seat through the same command path as guests. */
  hostSendDir(dir, cmdId) {
    if (!this.isHost || !this.game) return { ok: false, reason: 'no-active-round' };
    const s = this.game.state;
    return applyCommand(s, { cmdId: this.myPlayerId + ':' + cmdId, playerId: this.myPlayerId, type: 'dir', dir: dir, tick: s.tick });
  }

  _tickRoom() {
    const game = this.game;
    if (!game) return;
    const s = game.state;
    const beforeAreas = s.players.map((p) => p.area);
    const beforeAlive = s.players.map((p) => p.alive);
    step(s);
    const events = [];
    for (let i = 0; i < s.players.length; i++) {
      if (s.players[i].area > beforeAreas[i] && s.players[i].alive) events.push({ kind: 'claim', playerId: s.players[i].id });
      if (beforeAlive[i] && !s.players[i].alive) events.push({ kind: 'eliminated', playerId: s.players[i].id });
    }
    if (s.phase === PHASE.ENDED) {
      this._stopTimer();
      const rank = rankPlayers(s);
      this.game = null;
      this._sendBinary(JSON.stringify({ type: 'end', state: wireState(s), rank: rank }));
      this._postResult(s, rank);
      this._emit('end', { state: wireState(s), rank: rank });
      return;
    }
    this._sendBinary(JSON.stringify({ type: 'snapshot', state: wireState(s), events: events }));
  }

  _postResult(state, rank) {
    if (!this.roomId) return;
    const result = {
      seed: state.seed,
      reason: state.reason,
      winner: state.winner,
      standings: rank.map((i) => ({
        playerId: state.players[i].id,
        name: state.players[i].name,
        score: state.players[i].area + state.players[i].eliminations * 50,
      })),
    };
    this.platform.api('/api/v1/realtime/rooms/' + encodeURIComponent(this.roomId) + '/result', {
      method: 'POST',
      body: JSON.stringify({ result: result }),
    }).catch(() => { /* the end frame already delivered the outcome */ });
  }

  _resumeGuests() {
    const game = this.game;
    if (!game) return;
    this._sendControl({ type: 'start', seed: game.state.seed, resumed: true });
    this._sendBinary(JSON.stringify({ type: 'snapshot', state: wireState(game.state), events: [] }));
  }

  _stopTimer() {
    if (this.game && this.game.timer) { clearInterval(this.game.timer); this.game.timer = null; }
  }

  // ------------------------------------------------------------- guest input

  /** Guest: send a direction as a binary JSON frame (<=8 KB, <=30 msg/s). */
  guestSendDir(dir, cmdId) {
    if (this.isHost) return false;
    const now = Date.now();
    if (now - this._lastDirAt < GUEST_DIR_INTERVAL) return false;
    if (!this.ws || this.ws.readyState !== 1) return false;
    const text = JSON.stringify({ type: 'dir', dir: dir, cmdId: cmdId, playerId: this.myPlayerId });
    if (text.length > MAX_BINARY) return false;
    this._lastDirAt = now;
    this.ws.send(new TextEncoder().encode(text));
    return true;
  }

  // ------------------------------------------------------------- receive

  _onMessage(e) {
    if (typeof e.data === 'string') return this._onControl(e.data);
    const buf = new Uint8Array(e.data);
    if (buf.byteLength <= SENDER_PREFIX) return;
    const payload = buf.slice(SENDER_PREFIX); // strip 16-byte sender id
    if (payload.byteLength > MAX_BINARY) return;
    if (this.isHost) return this._onGuestBinary(this._hex(buf.slice(0, SENDER_PREFIX)), payload);
    this._onHostBinary(payload);
  }

  _hex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s;
  }

  _onHostBinary(payload) {
    let msg;
    try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    if (msg.type === 'start') {
      if (this._roundSeed === msg.seed) return; // resume echo aimed at another guest
      this._roundSeed = msg.seed;
      this._emit('start', msg);
      return;
    }
    if (msg.type === 'snapshot' || msg.type === 'end') this._emit(msg.type, msg);
  }

  _onGuestBinary(senderHex, payload) {
    let msg;
    try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type !== 'dir' || typeof msg.dir !== 'string' || typeof msg.cmdId !== 'string') return;
    const bound = this._senderPlayer.get(senderHex);
    const playerId = typeof msg.playerId === 'string' && msg.playerId ? msg.playerId : null;
    if (bound && playerId && bound !== playerId) return; // sender bound to another seat
    if (!bound) {
      if (!playerId) return;
      this._senderPlayer.set(senderHex, playerId);
    }
    this._handleDir(this._senderPlayer.get(senderHex), msg.cmdId.slice(0, 40), msg.dir);
  }

  _handleDir(playerId, cmdId, dir) {
    const game = this.game;
    if (!game || game.state.phase !== PHASE.ACTIVE || !playerId) {
      this._sendControl({ type: 'ack', cmdId: cmdId, ok: false, reason: 'no-active-round', playerId: playerId });
      return;
    }
    const idx = game.state.players.findIndex((p) => p.id === playerId);
    if (idx < 0 || game.state.players[idx].isBot) {
      this._sendControl({ type: 'ack', cmdId: cmdId, ok: false, reason: 'unknown-player', playerId: playerId });
      return;
    }
    const res = applyCommand(game.state, {
      cmdId: playerId + ':' + cmdId, playerId: playerId, type: 'dir', dir: dir, tick: game.state.tick,
    });
    this._sendControl({ type: 'ack', cmdId: cmdId, ok: !!res.ok, reason: res.reason || null, playerId: playerId });
  }

  _onControl(text) {
    if (text.length > MAX_TEXT) return;
    let msg;
    try { msg = JSON.parse(text); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.op === 'ready') {
      // A guest (re)announced itself mid-round: catch it up.
      if (this.isHost && this.game) this._resumeGuests();
      return;
    }
    if (typeof msg.type === 'string') {
      if (msg.type === 'ack' || msg.type === 'end') { this._emit(msg.type, msg); return; }
      if (msg.type === 'error') { this._emit('error', { message: typeof msg.message === 'string' ? msg.message : 'Room error.' }); return; }
      if (msg.type === 'start' && !this.isHost) { this._emit('start', msg); return; }
      return; // ignore our own host echoes
    }
    // Roster/presence pushes (platform shape) drive the lobby list.
    const list = msg.participants || msg.roster || msg.members || (Array.isArray(msg) ? msg : null);
    if (Array.isArray(list)) this._onRosterPush(list);
  }

  _onRosterPush(list) {
    this.participants = [];
    for (const p of list) {
      if (!p || typeof p !== 'object') continue;
      const participantId = p.participantId || p.id || null;
      const uid = p.userId || p.user_id || p.accountId || participantId;
      if (!uid) continue;
      const name = p.nickname || p.name || p.displayName || null;
      this.participants.push({
        participantId: participantId == null ? null : String(participantId),
        userId: String(uid),
        name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 24) : null,
      });
    }
    this._resolveNames();
    if (!this.isHost && this.ws && !this.participants.some((p) => p.userId !== this.myPlayerId)) {
      this._emit('status', { text: 'The host left the room.' });
    }
    this._emitRoster();
  }

  _resolveNames() {
    for (const p of this.participants) {
      if (p.name || p.userId === this.myPlayerId) continue;
      this.platform.profileFor(p.userId)
        .then((name) => { p.name = name; this._emitRoster(); })
        .catch(() => {});
    }
  }

  _emitRoster() {
    const me = { id: this.myPlayerId, name: this.platform.getDisplayName() || 'You' };
    const others = [];
    for (const p of this.participants) {
      if (p.userId === this.myPlayerId) continue;
      others.push({ id: p.userId, name: p.name || ('Player ' + String(p.userId).slice(0, 8)) });
    }
    const players = this.isHost ? [me].concat(others) : others.concat([me]);
    this._emit('roster', { players: players });
  }
}
