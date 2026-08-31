'use strict';

// Territory Trail — pure deterministic rules engine.
// No DOM, no rendering, no timers. Works in browser (ESM) and Node (tests).

export const RULES_VERSION = 1;

export const CELL_EMPTY = 0; // cells[i] holds owner player index+1, or 0
export const PHASE = { ACTIVE: 'active', ENDED: 'ended' };

export const DIR_NONE = 0;
export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
export const DIR_NAMES = Object.keys(DIRS);

// ---------------------------------------------------------------- RNG
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit hash of a string, hex.
export function fnv1a(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

export function dailySeed(date) {
  // One shared seed per UTC day.
  const d = date || new Date();
  const key = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  return { key: key, seed: parseInt(fnv1a('territory-trail-daily-' + key), 16) >>> 0, day: d.toISOString().slice(0, 10) };
}

// ---------------------------------------------------------------- setup
// Spawn layout: deterministic, seeded, evenly spread around the grid.
export function createGame(options) {
  const width = options.width || 30;
  const height = options.height || 30;
  const seed = (options.seed >>> 0) || 1;
  const rng = mulberry32(seed);
  const playerDefs = options.players || [{ id: 'p1', name: 'You', isBot: false }];
  const maxTicks = options.maxTicks || 1200;
  const areaGoal = options.areaGoal || 0; // 0 = no early area goal

  const cells = new Array(width * height).fill(CELL_EMPTY);
  const trailOf = new Array(width * height).fill(0); // player index+1 whose trail occupies cell

  const n = playerDefs.length;
  const players = [];
  const margin = 3;
  for (let i = 0; i < n; i++) {
    // Golden-angle spread with seeded jitter keeps spawns deterministic & separated.
    const angle = i * 2.39996 + rng() * 0.6;
    const radius = 0.30 + rng() * 0.08;
    let sx = Math.round(width / 2 + Math.cos(angle) * radius * width);
    let sy = Math.round(height / 2 + Math.sin(angle) * radius * height);
    sx = Math.max(margin, Math.min(width - margin - 1, sx));
    sy = Math.max(margin, Math.min(height - margin - 1, sy));
    // Starting patch: 3x3 owned territory.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = sx + dx, y = sy + dy;
        if (x >= 0 && y >= 0 && x < width && y < height) cells[y * width + x] = i + 1;
      }
    }
    players.push({
      id: playerDefs[i].id,
      name: playerDefs[i].name || ('Player ' + (i + 1)),
      isBot: !!playerDefs[i].isBot,
      x: sx, y: sy,
      dir: null, // stationary until the player's first steering input
      pendingDir: null,
      alive: true,
      trail: [],
      area: 9,
      eliminations: 0,
      invalidActions: 0,
      outside: false,
    });
  }

  return {
    version: RULES_VERSION,
    seed: seed,
    width: width,
    height: height,
    maxTicks: maxTicks,
    areaGoal: areaGoal,
    tick: 0,
    phase: PHASE.ACTIVE,
    reason: null,
    winner: null,
    cells: cells,
    trailOf: trailOf,
    players: players,
    commands: [], // authoritative command log (for replay)
    hashes: [],   // periodic state hashes (every 60 ticks)
    rngState: seed, // deterministic bot decisions re-derived per sim from (seed,tick)
    initialHash: null,
    eliminatedOrder: [],
  };
}

export function initHash(state) {
  state.initialHash = hashState(state);
  return state.initialHash;
}

export function cellAt(state, x, y) {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return -1;
  return state.cells[y * state.width + x];
}
export function trailAt(state, x, y) {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return -1;
  return state.trailOf[y * state.width + x];
}

// ---------------------------------------------------------------- legality
export function legalDirections(state, playerIndex) {
  const p = state.players[playerIndex];
  if (!p || !p.alive || state.phase !== PHASE.ACTIVE) return [];
  const out = [];
  for (const name of DIR_NAMES) {
    const d = DIRS[name];
    if (p.dir && DIRS[p.dir].x === -d.x && DIRS[p.dir].y === -d.y && p.trail.length > 0 && name !== p.dir) {
      continue;
    }
    const nx = p.x + d.x, ny = p.y + d.y;
    if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
    out.push(name);
  }
  return out;
}

export function validateCommand(state, cmd) {
  if (!cmd || typeof cmd !== 'object') return { ok: false, reason: 'malformed-command' };
  if (typeof cmd.cmdId !== 'string' || cmd.cmdId.length === 0 || cmd.cmdId.length > 64) return { ok: false, reason: 'bad-command-id' };
  if (state.commands.some((c) => c.cmdId === cmd.cmdId)) return { ok: false, reason: 'duplicate-command' };
  if (cmd.type !== 'dir') return { ok: false, reason: 'unknown-command-type' };
  const idx = state.players.findIndex((p) => p.id === cmd.playerId);
  if (idx < 0) return { ok: false, reason: 'unknown-player' };
  const p = state.players[idx];
  if (!p.alive) return { ok: false, reason: 'player-eliminated' };
  if (state.phase !== PHASE.ACTIVE) return { ok: false, reason: 'game-ended' };
  if (typeof cmd.tick !== 'number' || cmd.tick < state.tick || cmd.tick > state.tick + 20) {
    return { ok: false, reason: 'tick-out-of-window' };
  }
  if (!DIRS[cmd.dir]) return { ok: false, reason: 'bad-direction' };
  if (legalDirections(state, idx).indexOf(cmd.dir) < 0) return { ok: false, reason: 'illegal-direction' };
  return { ok: true, playerIndex: idx };
}

// Apply a validated (or to-be-validated) command. Invalid commands count
// against the player (tiebreaker) but never corrupt state.
export function applyCommand(state, cmd) {
  const v = validateCommand(state, cmd);
  const idx = state.players.findIndex((p) => p.id === (cmd && cmd.playerId));
  if (!v.ok) {
    if (idx >= 0) state.players[idx].invalidActions++;
    return v;
  }
  const p = state.players[v.playerIndex];
  p.pendingDir = cmd.dir;
  state.commands.push({ cmdId: cmd.cmdId, playerId: cmd.playerId, type: 'dir', dir: cmd.dir, tick: cmd.tick });
  return { ok: true };
}

// ---------------------------------------------------------------- simulation
function eliminate(state, idx, killerIdx, reason) {
  const p = state.players[idx];
  if (!p.alive) return;
  p.alive = false;
  // Clear trail cells.
  for (const c of p.trail) state.trailOf[c] = 0;
  p.trail = [];
  state.eliminatedOrder.push({ playerId: p.id, by: killerIdx >= 0 ? state.players[killerIdx].id : null, reason: reason, tick: state.tick });
  if (killerIdx >= 0 && killerIdx !== idx) state.players[killerIdx].eliminations++;
}

// Claim enclosed land when a player reconnects to their own territory.
// Flood fill from the grid border over cells NOT occupied by the player's
// territory+trail; unvisited cells are enclosed and captured.
function resolveClaim(state, idx) {
  const p = state.players[idx];
  const w = state.width, h = state.height, me = idx + 1;
  if (p.trail.length === 0) return 0;
  const blocked = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (state.cells[i] === me || state.trailOf[i] === me) blocked[i] = 1;
  }
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    if (i < 0 || i >= w * h || seen[i] || blocked[i]) continue;
    seen[i] = 1;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  let gained = 0;
  for (let i = 0; i < w * h; i++) {
    // Trail itself becomes territory; enclosed unvisited cells are captured.
    if (state.trailOf[i] === me) {
      state.trailOf[i] = 0;
      if (state.cells[i] !== me) {
        if (state.cells[i] !== CELL_EMPTY) {
          state.players[state.cells[i] - 1].area--;
        }
        state.cells[i] = me; gained++;
      }
    } else if (!seen[i] && state.cells[i] !== me) {
      const prev = state.cells[i];
      if (prev !== CELL_EMPTY) state.players[prev - 1].area--;
      // Enclosed rival trails are cut: that rival is eliminated.
      const t = state.trailOf[i];
      if (t !== 0 && t !== me) eliminate(state, t - 1, idx, 'enclosed-trail');
      state.cells[i] = me; gained++;
    }
  }
  p.area += gained;
  p.trail = [];
  p.outside = false;
  return gained;
}

export function step(state) {
  if (state.phase !== PHASE.ACTIVE) return state;
  state.tick++;

  // Bots decide deterministically from (seed, tick).
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p.isBot && p.alive) botDecide(state, i);
  }

  // Apply pending directions.
  for (const p of state.players) {
    if (p.pendingDir && p.alive) {
      // last-chance legality: no reversing mid-trail
      if (!p.dir || !(p.trail.length > 0 && DIRS[p.pendingDir].x === -DIRS[p.dir].x && DIRS[p.pendingDir].y === -DIRS[p.dir].y)) {
        p.dir = p.pendingDir;
      }
      p.pendingDir = null;
    }
  }

  // Move everyone, then resolve interactions in stable index order.
  const destinations = [];
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (!p.alive || !p.dir) { destinations.push(null); continue; } // stationary until first input
    const d = DIRS[p.dir];
    const nx = p.x + d.x, ny = p.y + d.y;
    if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) {
      eliminate(state, i, -1, 'out-of-bounds');
      destinations.push(null);
      continue;
    }
    destinations.push({ x: nx, y: ny });
  }

  // Head-on collisions: two players entering the same cell both die.
  const claimMap = {};
  for (let i = 0; i < destinations.length; i++) {
    const dst = destinations[i];
    if (!dst) continue;
    const key = dst.y * state.width + dst.x;
    if (claimMap[key] !== undefined) {
      eliminate(state, i, claimMap[key], 'head-on');
      eliminate(state, claimMap[key], i, 'head-on');
      destinations[i] = null;
      destinations[claimMap[key]] = null;
    } else {
      claimMap[key] = i;
    }
  }

  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    const dst = destinations[i];
    if (!p.alive || !dst) continue;
    const c = dst.y * state.width + dst.x;
    const trailOwner = state.trailOf[c];
    if (trailOwner !== 0 && trailOwner !== i + 1) {
      // Cut an exposed rival trail.
      eliminate(state, trailOwner - 1, i, 'trail-cut');
    }
    p.x = dst.x; p.y = dst.y;
    if (state.cells[c] === i + 1) {
      if (p.trail.length > 0) resolveClaim(state, i);
      p.outside = false;
    } else {
      p.outside = true;
      state.trailOf[c] = i + 1;
      p.trail.push(c);
    }
  }

  // Terminal checks.
  const aliveCount = state.players.filter((p) => p.alive).length;
  if (state.players.length > 1 && aliveCount <= 1) {
    endGame(state, 'elimination');
  } else if (state.players.length === 1 && aliveCount === 0) {
    endGame(state, 'elimination');
  } else if (state.areaGoal > 0) {
    const champ = state.players.find((p) => p.alive && p.area >= state.areaGoal);
    if (champ) endGame(state, 'area-goal');
    else if (state.tick >= state.maxTicks) endGame(state, 'time');
  } else if (state.tick >= state.maxTicks) {
    endGame(state, 'time');
  }

  if (state.tick % 60 === 0 || state.phase === PHASE.ENDED) {
    state.hashes.push({ tick: state.tick, hash: hashState(state) });
  }
  return state;
}

export function scoreOf(state, idx) {
  const p = state.players[idx];
  return { area: p.area, eliminations: p.eliminations, total: p.area + p.eliminations * 50 };
}

// Tie-break order: primary objective, fewer invalid actions, lower elapsed
// ticks, then stable player id.
export function rankPlayers(state) {
  const order = state.players.map((p, i) => i);
  order.sort((a, b) => {
    const sa = scoreOf(state, a), sb = scoreOf(state, b);
    if (sb.total !== sa.total) return sb.total - sa.total;
    const pa = state.players[a], pb = state.players[b];
    if (pa.invalidActions !== pb.invalidActions) return pa.invalidActions - pb.invalidActions;
    const ea = state.eliminatedOrder.findIndex((e) => e.playerId === pa.id);
    const eb = state.eliminatedOrder.findIndex((e) => e.playerId === pb.id);
    if (ea !== eb) return (ea === -1 ? -1 : ea) - (eb === -1 ? -1 : eb);
    return pa.id < pb.id ? -1 : 1;
  });
  return order;
}

function endGame(state, reason) {
  if (state.phase === PHASE.ENDED) return;
  state.phase = PHASE.ENDED;
  state.reason = reason;
  if (reason === 'elimination') {
    const alive = state.players.filter((p) => p.alive);
    state.winner = alive.length === 1 ? alive[0].id : null;
  } else {
    const rank = rankPlayers(state);
    state.winner = rank.length ? state.players[rank[0]].id : null;
  }
}

// ---------------------------------------------------------------- bots
function botDecide(state, idx) {
  const p = state.players[idx];
  const rng = mulberry32((state.seed ^ (state.tick * 0x9e3779b9) ^ (idx * 0x85ebca6b)) >>> 0);
  const me = idx + 1;
  const legal = legalDirections(state, idx);
  if (!legal.length) return;

  let best = null;
  if (p.outside && p.trail.length > 4 + Math.floor(rng() * 8)) {
    // Head home: pick the direction reducing distance to own territory.
    let bestDist = Infinity;
    for (const name of legal) {
      const d = DIRS[name];
      const nx = p.x + d.x, ny = p.y + d.y;
      let dist = Infinity;
      for (let r = 0; r < 9; r++) {
        const tx = nx + d.x * r, ty = ny + d.y * r;
        if (cellAt(state, tx, ty) === me) { dist = r; break; }
        if (cellAt(state, tx, ty) === -1) break;
      }
      if (dist < bestDist) { bestDist = dist; best = name; }
    }
  }
  if (!best) {
    // Wander: avoid walls and own trail; sometimes strike at a rival trail.
    const safe = legal.filter((name) => {
      const d = DIRS[name];
      const t = trailAt(state, p.x + d.x, p.y + d.y);
      return t !== me;
    });
    const pool = safe.length ? safe : legal;
    best = pool[Math.floor(rng() * pool.length)];
    if (rng() < 0.1) {
      for (const name of pool) {
        const d = DIRS[name];
        const t = trailAt(state, p.x + d.x, p.y + d.y);
        if (t > 0 && t !== me) { best = name; break; }
      }
    }
  }
  if (best && best !== p.dir) {
    applyCommand(state, { cmdId: 'bot-' + idx + '-' + state.tick, playerId: p.id, type: 'dir', dir: best, tick: state.tick });
  }
}

// ---------------------------------------------------------------- serialization
export function serialize(state) {
  return JSON.stringify({
    version: state.version, seed: state.seed, width: state.width, height: state.height,
    maxTicks: state.maxTicks, areaGoal: state.areaGoal, tick: state.tick,
    phase: state.phase, reason: state.reason, winner: state.winner,
    cells: state.cells, trailOf: state.trailOf,
    players: state.players.map((p) => ({ ...p, trail: p.trail.slice() })),
    commands: state.commands, hashes: state.hashes,
    initialHash: state.initialHash, eliminatedOrder: state.eliminatedOrder,
  });
}

export function deserialize(json) {
  const s = JSON.parse(json);
  if (s.version !== RULES_VERSION) {
    // migration hook: only version 1 exists; unknown versions are rejected
    throw new Error('unsupported-save-version:' + s.version);
  }
  return s;
}

export function hashState(state) {
  let s = state.tick + '|' + state.width + 'x' + state.height + '|';
  for (const p of state.players) {
    s += p.id + ':' + p.x + ',' + p.y + ':' + p.dir + ':' + (p.alive ? 1 : 0) + ':' + p.area + ':' + p.eliminations + ':' + p.invalidActions + ';';
  }
  // Pack owner+trail grids compactly.
  let run = 0, prev = -1;
  const enc = [];
  for (let i = 0; i < state.cells.length; i++) {
    const v = state.cells[i] * 16 + state.trailOf[i];
    if (v === prev) { run++; } else { if (prev >= 0) enc.push(prev + 'x' + run); prev = v; run = 1; }
  }
  if (prev >= 0) enc.push(prev + 'x' + run);
  return fnv1a(s + enc.join(','));
}

// Replay envelope: re-run seed + ordered commands, verify hashes.
export function replay(envelope) {
  if (envelope.schemaVersion !== 1) return { ok: false, reason: 'bad-schema' };
  const state = createGame(envelope.config);
  initHash(state);
  if (state.initialHash !== envelope.initialHash) return { ok: false, reason: 'initial-hash-mismatch' };
  const byTick = {};
  for (const c of envelope.commands) {
    // Bot commands are regenerated deterministically inside step(); only
    // replay commands issued by non-bot players.
    const p = state.players.find((pl) => pl.id === c.playerId);
    if (p && p.isBot) continue;
    (byTick[c.tick] = byTick[c.tick] || []).push(c);
  }
  while (state.phase === PHASE.ACTIVE && state.tick < state.maxTicks + 5) {
    const cmds = byTick[state.tick] || [];
    for (const c of cmds) applyCommand(state, c);
    step(state);
  }
  const okHashes = envelope.hashes.every((h, i) => state.hashes[i] && state.hashes[i].hash === h.hash && state.hashes[i].tick === h.tick);
  const terminal = state.phase === PHASE.ENDED && state.reason === envelope.terminal.reason && state.winner === envelope.terminal.winner;
  return { ok: okHashes && terminal, state: state, reason: okHashes ? (terminal ? null : 'terminal-mismatch') : 'hash-mismatch' };
}

export function makeEnvelope(state, config) {
  return {
    schemaVersion: 1,
    rulesVersion: RULES_VERSION,
    seed: state.seed,
    initialHash: state.initialHash,
    createdTick: state.tick,
    config: config,
    commands: state.commands.slice(),
    hashes: state.hashes.slice(),
    terminal: { reason: state.reason, winner: state.winner },
  };
}
