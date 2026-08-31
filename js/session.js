'use strict';

// Session: owns the fixed-step simulation loop, command queue, snapshots,
// undo (practice), replay envelope, and hosted reconnect glue.
import { createGame, initHash, step, applyCommand, serialize, deserialize, makeEnvelope, replay, hashState, PHASE } from './rules.js';

export const TICK_RATE = 8; // simulation ticks per second (fixed step)
export const TICK_MS = 1000 / TICK_RATE;

export class Session {
  constructor(config, playerDefs, localPlayerId) {
    this.config = config;
    this.state = createGame(config);
    // createGame takes players via config; rebuild with explicit defs:
    this.state = createGame({ ...config, players: playerDefs });
    initHash(this.state);
    this.localPlayerId = localPlayerId;
    this.accumulator = 0;
    this.lastTime = null;
    this.running = false;
    this.paused = false;
    this.onSnapshot = null;   // (state) => render/ui update
    this.onEnd = null;
    this.undoStack = [];      // serialized snapshots for Practice undo
    this.commandCounter = 0;
    this.events = [];         // logical events for audio/vfx since last snapshot
  }

  localPlayerIndex() {
    return this.state.players.findIndex((p) => p.id === this.localPlayerId);
  }

  sendDirection(dir) {
    if (this.state.phase !== PHASE.ACTIVE) return { ok: false, reason: 'game-ended' };
    const cmd = {
      cmdId: this.localPlayerId + '-' + (++this.commandCounter),
      playerId: this.localPlayerId,
      type: 'dir', dir: dir, tick: this.state.tick,
    };
    const res = applyCommand(this.state, cmd);
    if (res.ok) this.events.push({ kind: 'input', dir: dir });
    else this.events.push({ kind: 'invalid', reason: res.reason });
    return res;
  }

  snapshot() {
    const ev = this.events;
    this.events = [];
    return { state: this.state, events: ev, hash: hashState(this.state) };
  }

  pushUndo() {
    this.undoStack.push(serialize(this.state));
    if (this.undoStack.length > 200) this.undoStack.shift();
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    const s = this.undoStack.pop();
    this.state = deserialize(s);
    return true;
  }

  // Fixed-step update; frame-rate independent. `nowMs` from rAF.
  tickFrame(nowMs) {
    if (!this.running || this.paused) return;
    if (this.lastTime === null) this.lastTime = nowMs;
    this.accumulator += Math.min(nowMs - this.lastTime, 250); // clamp spiral of death
    this.lastTime = nowMs;
    const prevPhase = this.state.phase;
    while (this.accumulator >= TICK_MS && this.state.phase === PHASE.ACTIVE) {
      const beforeTrail = this.localPlayerIndex() >= 0 ? this.state.players[this.localPlayerIndex()].trail.length : 0;
      const beforeAlive = this.state.players.map((p) => p.alive);
      const beforeArea = this.localPlayerIndex() >= 0 ? this.state.players[this.localPlayerIndex()].area : 0;
      step(this.state);
      const li = this.localPlayerIndex();
      if (li >= 0) {
        const lp = this.state.players[li];
        if (beforeTrail > 0 && lp.trail.length === 0 && lp.area > beforeArea) {
          this.events.push({ kind: 'claim', area: lp.area - beforeArea });
          if (this.allowUndo !== false) this.pushUndo();
        }
        if (!lp.alive && beforeAlive[li]) this.events.push({ kind: 'eliminated' });
      }
      for (let i = 0; i < this.state.players.length; i++) {
        if (beforeAlive[i] && this.state.players[i].alive && i !== li) {
          // bot claims also produce sound/vfx, lower tier
        }
      }
      this.accumulator -= TICK_MS;
    }
    if (prevPhase === PHASE.ACTIVE && this.state.phase === PHASE.ENDED) {
      this.events.push({ kind: 'ended', reason: this.state.reason });
      if (this.onEnd) this.onEnd(this.state);
    }
    if (this.onSnapshot) this.onSnapshot(this.snapshot());
  }

  start() { this.running = true; this.paused = false; this.lastTime = null; }
  pause() { this.paused = true; }
  resume() { this.paused = false; this.lastTime = null; }
  stop() { this.running = false; }

  envelope() {
    return makeEnvelope(this.state, this.config);
  }

  static replayEnvelope(env) { return replay(env); }
}
