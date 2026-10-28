// Hosted play: StarHermit realtime rooms for the lobby, and the session the
// platform binds to a started room for the round, refereed by server.js
// (after ~/games/spot-kick js/online.js and ~/games/poker src/online.js).
//
// Create room makes a room of one team with four seats and opens it for quick
// join; Quick join joins an open room of this game (none open: say so, as the
// browser build did). The room's host presses Start round (the platform also
// starts a full room by itself); the platform fills the empty seats with AI
// participants and binds a session running server.js. Every client then opens
// the session's game socket, sends { type: 'sync' } on every (re)connection and
// steers with realtime inputs { dir }. The script answers with the table,
// snapshots every tick and the end of the round; the result is the script's
// (no client ever posts one). A room that starts without a bound session is
// not played.
//
// `platform` is the adapter native/platform.ts provides (and the node tests
// fake): { userId, createRoom, openRoom, startRoom, leaveRoom, getRoom,
// quickJoin, myRoom, connectRoom(roomId, handlers), connectGame(sessionId,
// handlers) → { send, input, close } }.

export const SEATS = 4;
export const SHAPE = { teamCount: 1, seatsPerTeam: SEATS };

export function newRoom() {
  return { ...SHAPE, backfillAiPlayers: true, metadata: { mode: 'ffa' } };
}

const errKind = (e) => (e && (e.kind || e.code)) || '';
const conflict = (e) => {
  const k = errKind(e);
  return k === 'conflict' || k === 'active-room-elsewhere' || (e && e.status === 409);
};
// One active room per player: when creating or joining conflicts, rejoin the room the player already holds.
async function recoverConflict(platform, e) {
  if (conflict(e)) {
    const room = await platform.myRoom().catch(() => null);
    if (room && room.status !== 'closed') return room;
  }
  throw e;
}

/** Create room: a new room, opened for quick join. */
export async function createRoom(platform) {
  try {
    const room = await platform.createRoom(newRoom());
    return await platform.openRoom(room.id).catch(() => room);
  } catch (e) { return recoverConflict(platform, e); }
}

/** Quick join: an open room of this game, or null when none is open. */
export async function quickJoin(platform) {
  try { return await platform.quickJoin(SHAPE); } catch (e) { return recoverConflict(platform, e); }
}

export function isHost(room, userId) { return !!room && !!userId && room.hostUserId === userId; }

/** The lobby: the room's roster until it plays. */
export class LobbyClient {
  /** hooks: onChange(), onPlaying(room) when the bound session is there, onClosed(reason). */
  constructor(platform, room, hooks = {}) {
    this.platform = platform;
    this.hooks = hooks;
    this.room = room;
    this.connected = false;
    this.unavailable = false;
    this.starting = false;
    this._socket = null;
    this._handedOff = false;
  }
  get host() { return isHost(this.room, this.platform.userId); }
  get participants() { return (this.room && this.room.participants) || []; }
  _emit(name, ...args) { const fn = this.hooks[name]; if (fn) fn(...args); }

  connect() {
    if (this._socket) return;
    this._socket = this.platform.connectRoom(this.room.id, {
      onOpen: () => { this.connected = true; this._emit('onChange'); },
      onDown: () => { this.connected = false; this._emit('onChange'); },
      onRoster: (room) => this._onRoster(room),
      onStopped: (reason) => {
        this.connected = false;
        if (reason !== 'closed') { this.unavailable = true; this._emit('onClosed', reason); }
        this._emit('onChange');
      },
    });
    void this.refresh();
  }

  async refresh() {
    try {
      const room = await this.platform.getRoom(this.room.id);
      if (room) this._onRoster(room);
      else { this.unavailable = true; this._emit('onClosed', 'gone'); }
    } catch { /* the socket's roster keeps it current */ }
  }

  _onRoster(room) {
    this.room = { ...this.room, ...room };
    const st = this.room.status;
    if (st === 'playing' && this.room.gameSessionId && !this._handedOff) {
      this._handedOff = true;
      this._emit('onPlaying', this.room);
    } else if (st === 'closed') {
      this.unavailable = true;
      this._emit('onClosed', 'closed');
    }
    this._emit('onChange');
  }

  /** Host: Start round (empty seats become AI; idempotent). */
  async start() {
    if (!this.host || this.starting) return false;
    this.starting = true;
    try {
      const r = await this.platform.startRoom(this.room.id);
      if (r) this._onRoster(r);
      return true;
    } catch { return false; } finally { this.starting = false; }
  }

  async leave() {
    this.close();
    try { await this.platform.leaveRoom(this.room.id); } catch { /* already gone */ }
  }
  close() {
    if (this._socket) { try { this._socket.close(); } catch { /* gone */ } }
    this._socket = null;
  }
}

/** Wire snapshot → the rules' state shape the renderer and HUD read. */
export function stateFromSnap(table, snap, prev) {
  const w = table.width, h = table.height;
  const cells = prev && prev.cells.length === w * h ? prev.cells : new Array(w * h).fill(0);
  const trailOf = prev && prev.trailOf.length === w * h ? prev.trailOf : new Array(w * h).fill(0);
  for (let i = 0; i < w * h; i++) {
    cells[i] = snap.c.charCodeAt(i) - 48 || 0;
    trailOf[i] = snap.t.charCodeAt(i) - 48 || 0;
  }
  const DIRS = ['up', 'down', 'left', 'right'];
  const players = table.seats.map((s, i) => {
    const p = snap.p[i] || [0, 0, -1, 0, 0, 0, 0, 0];
    return {
      id: s.id, name: s.name, isBot: !!s.ai, userId: s.userId, x: p[0], y: p[1], dir: p[2] >= 0 ? DIRS[p[2]] : null, pendingDir: null,
      alive: !!p[3], area: p[4], eliminations: p[5], trail: { length: p[6] }, invalidActions: p[7], outside: p[6] > 0,
    };
  });
  return {
    version: 1, seed: 0, width: w, height: h, maxTicks: table.maxTicks, areaGoal: table.areaGoal, tick: snap.k,
    phase: snap.ph === 'ended' ? 'ended' : 'active', reason: null, winner: null, cells, trailOf, players, commands: [], hashes: [], eliminatedOrder: [],
  };
}

/** The round: the bound session's game socket and the latest view the script sent. */
export class MatchClient {
  /** hooks: onTable(table), onSnap(snap), onRejected(reason), onOver(over), onChange(). */
  constructor(platform, room, hooks = {}) {
    this.platform = platform;
    this.room = room;
    this.sessionId = room.gameSessionId;
    this.hooks = hooks;
    this.table = null;
    this.snap = null;
    this.over = null;
    this.connected = false;
    this.unavailable = false;
    this._pendingDir = null;
    this._game = null;
    this._room = null;
  }
  _emit(name, ...args) { const fn = this.hooks[name]; if (fn) fn(...args); }

  /** This player's seat index, once the table arrived (-1 when spectating). */
  get seat() {
    const me = this.platform.userId;
    return this.table ? this.table.seats.findIndex((s) => s.userId && s.userId === me) : -1;
  }

  connect() {
    if (this._game) return;
    this._game = this.platform.connectGame(this.sessionId, {
      onOpen: () => {
        this.connected = true;
        this._game.send({ type: 'sync' }); // every (re)connection resyncs first
        this._emit('onChange');
      },
      onDown: () => { this.connected = false; this._emit('onChange'); },
      onMessage: (data) => this._onGame(data),
      onError: (message) => this._emit('onRejected', String(message || 'rejected')),
      onStopped: (reason) => {
        this.connected = false;
        if (reason !== 'closed') this.unavailable = true;
        this._emit('onChange');
      },
    });
    // The room's socket stays open for the roster.
    if (this.room.id) {
      this._room = this.platform.connectRoom(this.room.id, { onRoster: (room) => { this.room = { ...this.room, ...room }; } });
    }
  }

  /** Steers: a realtime input (latest wins at the script's next tick). False when it could not be sent. */
  steer(dir) {
    if (!this._game || !this.connected) { this._pendingDir = dir; return false; }
    if (this._game.input({ dir })) { this._pendingDir = null; return true; }
    this._pendingDir = dir;
    return false;
  }
  /** Each frame: an input paced away is sent again. */
  update() { if (this._pendingDir) this.steer(this._pendingDir); }

  _onGame(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'table') { this.table = data; this._emit('onTable', data); }
    else if (data.type === 'snap') {
      if (this.snap && data.k < this.snap.k) return; // stale
      this.snap = data;
      this._emit('onSnap', data);
    } else if (data.type === 'over') { if (!this.over) { this.over = data; this._emit('onOver', data); } }
    this._emit('onChange');
  }

  /** Leave round: out of the round (the script decides), then leave the room. */
  async leave() {
    if (this._game && this.connected && !this.over) { try { this._game.send({ type: 'forfeit' }); } catch { /* gone */ } }
    this.close();
    if (this.room.id) { try { await this.platform.leaveRoom(this.room.id); } catch { /* gone */ } }
  }
  close() {
    for (const s of [this._game, this._room]) if (s) { try { s.close(); } catch { /* gone */ } }
    this._game = null;
    this._room = null;
  }
}
