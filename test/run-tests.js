'use strict';

// Offline test suite: rules unit tests, replay determinism (property),
// fuzzing, terminal states, serialization migration, content validation.
import {
  createGame, initHash, step, applyCommand, validateCommand, legalDirections,
  serialize, deserialize, hashState, makeEnvelope, replay, rankPlayers, scoreOf,
  dailySeed, mulberry32, PHASE, RULES_VERSION,
} from '../js/rules.js';
import { STAGES, LESSONS, CHALLENGES, THEMES, validateAllContent, validateStage, dailyChallenge } from '../js/content.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL: ' + name); }
}
function section(name) { console.log('— ' + name); }

function game(opts) {
  const g = createGame(Object.assign({ seed: 42, width: 20, height: 20, maxTicks: 200 }, opts || {}));
  initHash(g);
  return g;
}

// ---------------------------------------------------------------- legality
section('legal actions and invalid-action reasons');
{
  const g = game({ players: [{ id: 'p1', name: 'A', isBot: false }] });
  const legal = legalDirections(g, 0);
  ok(legal.length === 4, 'four legal directions at spawn (' + legal.length + ')');

  let r = applyCommand(g, { cmdId: 'c1', playerId: 'p1', type: 'dir', dir: 'up', tick: 0 });
  ok(r.ok, 'valid direction accepted');
  r = applyCommand(g, { cmdId: 'c1', playerId: 'p1', type: 'dir', dir: 'up', tick: 0 });
  ok(!r.ok && r.reason === 'duplicate-command', 'duplicate command id rejected idempotently');
  r = applyCommand(g, { cmdId: 'c2', playerId: 'nobody', type: 'dir', dir: 'up', tick: 0 });
  ok(!r.ok && r.reason === 'unknown-player', 'unknown player rejected');
  r = applyCommand(g, { cmdId: 'c3', playerId: 'p1', type: 'dir', dir: 'sideways', tick: 0 });
  ok(!r.ok && r.reason === 'bad-direction', 'bad direction rejected');
  r = applyCommand(g, { cmdId: 'c4', playerId: 'p1', type: 'dir', dir: 'up', tick: 999 });
  ok(!r.ok && r.reason === 'tick-out-of-window', 'far-future tick rejected');
  r = applyCommand(g, { playerId: 'p1', type: 'dir', dir: 'up', tick: 0 });
  ok(!r.ok && r.reason === 'bad-command-id', 'missing command id rejected');
  ok(validateCommand(g, null).reason === 'malformed-command', 'null command rejected');
  ok(g.players[0].invalidActions > 0, 'invalid actions counted for tiebreak');
}

// ---------------------------------------------------------------- movement & claiming
section('movement, claiming, scoring');
{
  const g = game({ players: [{ id: 'p1', name: 'A', isBot: false }] });
  const p = g.players[0];
  const startArea = p.area;
  ok(startArea === 9, 'start patch is 3x3 (' + startArea + ')');
  // Walk a loop: up 2, right 3, down 2, left 3 → reconnect and claim.
  applyCommand(g, { cmdId: 'm1', playerId: 'p1', type: 'dir', dir: 'up', tick: 0 });
  for (let i = 0; i < 2; i++) step(g);
  ok(p.trail.length === 1, 'trail recorded outside (' + p.trail.length + ')');
  applyCommand(g, { cmdId: 'm2', playerId: 'p1', type: 'dir', dir: 'right', tick: g.tick });
  for (let i = 0; i < 3; i++) step(g);
  applyCommand(g, { cmdId: 'm3', playerId: 'p1', type: 'dir', dir: 'down', tick: g.tick });
  for (let i = 0; i < 2; i++) step(g);
  applyCommand(g, { cmdId: 'm4', playerId: 'p1', type: 'dir', dir: 'left', tick: g.tick });
  for (let i = 0; i < 3; i++) step(g);
  ok(p.trail.length === 0, 'trail cleared after reconnect');
  ok(p.area > startArea, 'area grew after claim: ' + startArea + ' → ' + p.area);
  const s = scoreOf(g, 0);
  ok(s.total === s.area + s.eliminations * 50, 'score = area + 50*eliminations');
}

// ---------------------------------------------------------------- trail cutting
section('trail cutting and elimination');
{
  const g = game({ seed: 7, players: [{ id: 'p1', name: 'A', isBot: false }, { id: 'p2', name: 'B', isBot: false }] });
  // Drive p1 far out, then have p2 cut the trail by teleport-simulating:
  // simpler: put p2 adjacent to p1's trail manually and step.
  const p1 = g.players[0], p2 = g.players[1];
  applyCommand(g, { cmdId: 'a1', playerId: 'p1', type: 'dir', dir: 'up', tick: 0 });
  for (let i = 0; i < 4; i++) step(g);
  ok(p1.trail.length === 3, 'p1 has exposed trail (' + p1.trail.length + ')');
  const trailCell = p1.trail[1];
  const tx = trailCell % g.width, ty = Math.floor(trailCell / g.width);
  // Place p2 next to the trail cell, facing it.
  p2.x = tx - 1; p2.y = ty; p2.dir = 'right';
  step(g);
  ok(!p1.alive, 'p1 eliminated when trail is cut');
  ok(p2.eliminations === 1, 'cutter credited with elimination');
  ok(g.eliminatedOrder.length === 1 && g.eliminatedOrder[0].reason === 'trail-cut', 'elimination recorded with reason');
  ok(g.phase === PHASE.ENDED && g.reason === 'elimination', 'terminal state: elimination');
  ok(g.winner === 'p2', 'winner is the survivor');
  ok(validateCommand(g, { cmdId: 'z', playerId: 'p1', type: 'dir', dir: 'up', tick: g.tick }).reason === 'player-eliminated',
    'eliminated player cannot act');
}

// ---------------------------------------------------------------- terminal: time
section('terminal state: time and ranking ties');
{
  const g = game({ maxTicks: 30, players: [{ id: 'p1', name: 'A', isBot: true }, { id: 'p2', name: 'B', isBot: true }] });
  let guard = 0;
  while (g.phase === PHASE.ACTIVE && guard++ < 100) step(g);
  ok(g.phase === PHASE.ENDED, 'game ends within bounded ticks');
  ok(g.reason === 'time' || g.reason === 'elimination', 'terminal reason present: ' + g.reason);
  const rank = rankPlayers(g);
  ok(rank.length === 2, 'ranking covers all players');
  ok(g.winner === g.players[rank[0]].id, 'winner is rank #1');
}

// ---------------------------------------------------------------- serialization
section('serialization and migration');
{
  const g = game({ players: [{ id: 'p1', name: 'A', isBot: false }] });
  for (let i = 0; i < 10; i++) step(g);
  const h1 = hashState(g);
  const json = serialize(g);
  const g2 = deserialize(json);
  ok(hashState(g2) === h1, 'round-trip serialization preserves state hash');
  // Continue both copies in lockstep.
  for (let i = 0; i < 10; i++) { step(g); step(g2); }
  ok(hashState(g2) === hashState(g), 'deserialized state continues deterministically');
  let threw = false;
  try { deserialize(JSON.stringify({ version: 999 })); } catch (e) { threw = /unsupported-save-version/.test(e.message); }
  ok(threw, 'unknown save version rejected (migration hook)');
}

// ---------------------------------------------------------------- replay determinism (property)
section('deterministic replay property');
{
  for (const seed of [1, 2, 3, 12345, 987654321]) {
    const config = { seed: seed, width: 24, height: 24, maxTicks: 300, areaGoal: 0,
      players: [{ id: 'p1', name: 'A', isBot: true }, { id: 'p2', name: 'B', isBot: true }, { id: 'p3', name: 'C', isBot: true }] };
    const g1 = createGame(config); initHash(g1);
    let guard = 0;
    while (g1.phase === PHASE.ACTIVE && guard++ < 500) step(g1);
    const env = makeEnvelope(g1, config);
    const r = replay(env);
    ok(r.ok, 'replay reproduces terminal state for seed ' + seed + (r.ok ? '' : ' (' + r.reason + ')'));
    ok(hashState(r.state) === hashState(g1), 'final hash identical for seed ' + seed);
  }
}

// Same seed & commands → identical hashes across two fresh runs.
{
  const config = { seed: 555, width: 20, height: 20, maxTicks: 120, players: [{ id: 'p1', name: 'A', isBot: true }, { id: 'p2', name: 'B', isBot: true }] };
  const a = createGame(config); initHash(a);
  const b = createGame(config); initHash(b);
  for (let i = 0; i < 120; i++) { step(a); step(b); }
  ok(hashState(a) === hashState(b), 'two fresh runs of same seed produce identical hashes');
  ok(a.initialHash === b.initialHash, 'initial hash stable');
}

// ---------------------------------------------------------------- fuzz
section('fuzz: malformed commands, no hangs/NaN');
{
  const rng = mulberry32(99);
  const g = game({ maxTicks: 150, players: [{ id: 'p1', name: 'A', isBot: true }, { id: 'p2', name: 'B', isBot: true }] });
  const dirs = ['up', 'down', 'left', 'right', 'nope', '', null, 42];
  for (let i = 0; i < 2000; i++) {
    const cmd = {
      cmdId: 'f' + i,
      playerId: rng() < 0.5 ? 'p1' : 'p2',
      type: rng() < 0.9 ? 'dir' : 'bogus',
      dir: dirs[Math.floor(rng() * dirs.length)],
      tick: Math.floor(rng() * 200),
    };
    applyCommand(g, cmd); // must never throw
  }
  let guard = 0;
  while (g.phase === PHASE.ACTIVE && guard++ < 500) step(g);
  ok(g.phase === PHASE.ENDED, 'fuzz game terminates');
  let allFinite = true;
  for (const p of g.players) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.area)) allFinite = false;
  }
  ok(allFinite, 'no NaN coordinates or areas after fuzz');
  let cellsValid = true;
  for (const c of g.cells) if (!(c >= 0 && c <= g.players.length)) cellsValid = false;
  ok(cellsValid, 'cell owners stay in range after fuzz');
}

// ---------------------------------------------------------------- daily seed
section('daily seed');
{
  const d1 = dailySeed(new Date(Date.UTC(2026, 7, 29, 0, 0, 1)));
  const d2 = dailySeed(new Date(Date.UTC(2026, 7, 29, 23, 59)));
  const d3 = dailySeed(new Date(Date.UTC(2026, 7, 30)));
  ok(d1.seed === d2.seed, 'same UTC day → same seed');
  ok(d1.seed !== d3.seed, 'different UTC day → different seed');
  ok(d1.day === '2026-08-29', 'day label correct');
}

// ---------------------------------------------------------------- content validation
section('content validators');
{
  ok(STAGES.length === 40, 'exactly 40 authored stages (' + STAGES.length + ')');
  ok(THEMES.length === 5, 'five visual themes');
  ok(LESSONS.length >= 4, 'tutorial lessons present');
  ok(CHALLENGES.length >= 3, 'challenge presets present');
  const results = validateAllContent();
  const bad = results.filter((r) => !r.ok);
  if (bad.length) for (const b of bad) console.error('  invalid content: ' + b.id + ' → ' + b.errors.join(', '));
  ok(bad.length === 0, 'all stages/lessons/challenges/daily pass offline validation (' + results.length + ' checked)');
  ok(validateStage({ id: 'x', seed: 1, width: 4, height: 4, maxTicks: 0, areaGoal: 0, theme: 'nope', bots: 0 }).errors.length >= 3,
    'validator rejects defective content');
  const dc = dailyChallenge(new Date(Date.UTC(2026, 0, 1)));
  ok(dc.immutable === true, 'daily content marked immutable');
}

// ---------------------------------------------------------------- golden sessions
section('golden sessions (easy/medium/hard/interrupted/resumed/terminal)');
{
  const golden = (seed, bots, maxTicks) => {
    const players = [{ id: 'p1', name: 'A', isBot: true }];
    for (let i = 0; i < bots; i++) players.push({ id: 'b' + i, name: 'B' + i, isBot: true });
    const g = createGame({ seed: seed, width: 24, height: 24, maxTicks: maxTicks, players: players });
    initHash(g);
    let guard = 0;
    while (g.phase === PHASE.ACTIVE && guard++ < maxTicks + 20) step(g);
    return g;
  };
  const easy = golden(11, 0, 300), medium = golden(22, 2, 300), hard = golden(33, 4, 300);
  for (const [name, g] of [['easy', easy], ['medium', medium], ['hard', hard]]) {
    ok(g.phase === PHASE.ENDED, 'golden ' + name + ' terminates (' + g.reason + ')');
  }
  // Interrupted + resumed via serialization mid-game.
  const g = createGame({ seed: 44, width: 24, height: 24, maxTicks: 300, players: [{ id: 'p1', name: 'A', isBot: true }, { id: 'p2', name: 'B', isBot: true }] });
  initHash(g);
  for (let i = 0; i < 100; i++) step(g);
  const resumed = deserialize(serialize(g));
  while (g.phase === PHASE.ACTIVE) step(g);
  while (resumed.phase === PHASE.ACTIVE) step(resumed);
  ok(hashState(g) === hashState(resumed), 'interrupted/resumed session converges to identical terminal hash');
  ok(g.phase === PHASE.ENDED, 'golden terminal session ends');
}

// ---------------------------------------------------------------- rules version
section('rules versioning');
ok(RULES_VERSION === 1, 'rules version declared');
{
  const g = game({ maxTicks: 400, players: [{ id: 'p1', name: 'A', isBot: true }, { id: 'p2', name: 'B', isBot: true }] });
  ok(typeof g.initialHash === 'string' && g.initialHash.length === 8, 'initial hash recorded');
  for (let i = 0; i < 130; i++) step(g);
  ok(g.hashes.length >= 1, 'periodic state hashes recorded for replay (' + g.hashes.length + ')');
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
