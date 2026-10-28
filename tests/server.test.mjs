// server.js — the platform script: score posting (score-script.js's range
// checks) and the room-bound hosted referee. Evaluated as the platform does:
// one classic script in a fresh context without Date or Math.random.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const ROOT = new URL('..', import.meta.url);
const SRC = readFileSync(new URL('server.js', ROOT), 'utf8');
function load() {
  const ctx = { JSON, Object, Array, Number, String, Uint8Array, Math: Object.create(Math), isFinite, Date: undefined };
  ctx.Math.random = () => { throw new Error('Math.random in server.js'); };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx.game;
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const ROSTER = [
  { userId: 'alice', name: 'alice', team: 0, slot: 0, ai: false },
  { userId: 'bob', name: 'bob', team: 0, slot: 1, ai: false },
  { userId: null, name: 'Rafa', team: 0, slot: 2, ai: true },
  { userId: null, name: 'Mia', team: 0, slot: 3, ai: true },
];
function round(roster = ROSTER) {
  const g = load();
  const room = { roomId: 'r1', metadata: {}, roster };
  let now = 1_000_000;
  let ss = g.createSession({ now, random: 0.37, sessionId: 's', players: [], room }).sessionState;
  const online = Object.fromEntries(roster.filter((r) => r.userId).map((r) => [r.userId, { online: true, left: false }]));
  const api = {
    g, room, online,
    get ss() { return ss; },
    tick(inputs, dt = 125) {
      now += dt;
      const r = g.onTick({ now, random: 0.5, sessionState: plain(ss), room, presence: plain(online), inputs });
      if (r.sessionState) ss = r.sessionState;
      return r;
    },
    send(from, data) {
      const r = g.onPlayerMessage({ now, random: 0.5, sessionState: plain(ss), room, presence: plain(online), message: { from, data } });
      if (r.sessionState) ss = r.sessionState;
      return r;
    },
  };
  return api;
}
const snapOf = (r) => (r.broadcast || []).map((b) => b.data).find((d) => d.type === 'snap');

test('server.js is built from js/rules.js and tools/server-*.js', () => {
  execFileSync(process.execPath, [new URL('../tools/build-server.mjs', import.meta.url).pathname, '--check'], { stdio: 'pipe' });
});

test('score posting: range-checked totals, the session ends', () => {
  const g = load();
  const ss = g.createSession({ now: 5, sessionId: 'p', players: [] }).sessionState;
  assert.equal(ss.kind, 'score');
  assert.equal(g.tickRateHz, 8);
  const ok = g.onPlayerMessage({ now: 6, sessionState: ss, message: { from: 'alice', data: { type: 'result', scores: { 'high-score': 412 } } } });
  assert.deepEqual(plain(ok.scores), { 'high-score': { alice: 412 } });
  assert.equal(ok.result.kind, 'finished');
  assert.deepEqual(plain(ok.broadcast[0].data), { type: 'result-ack', accepted: ['high-score'] });
  for (const bad of [-1, 100001, 2.5, 'x', Infinity]) {
    const r = g.onPlayerMessage({ now: 6, sessionState: ss, message: { from: 'alice', data: { type: 'result', scores: { 'high-score': bad } } } });
    assert.deepEqual(plain(r.scores), {}, String(bad));
  }
  assert.equal(g.onPlayerMessage({ now: 6, sessionState: ss, message: { from: 'a', data: { type: 'nope' } } }).ok, false);
});

test('a hosted round: four seats, waits for sockets, counts down, then runs at 8 steps a second', () => {
  const R = round();
  assert.equal(R.ss.kind, 'round');
  assert.deepEqual(plain(R.ss.seats.map((s) => [s.userId, s.ai])), [['alice', false], ['bob', false], [null, true], [null, true]]);
  const sync = R.send('bob', { type: 'sync' });
  const table = sync.broadcast[0].data;
  assert.equal(table.type, 'table');
  assert.deepEqual([table.width, table.height, table.maxTicks, table.areaGoal], [30, 30, 1000, 120]);
  assert.deepEqual(plain(sync.broadcast.map((b) => b.to)), [['bob'], ['bob']]);
  R.online.bob.online = false;
  assert.equal(snapOf(R.tick()).ph, 'waiting');
  R.online.bob.online = true;
  assert.equal(snapOf(R.tick()).ph, 'countdown');
  let s;
  for (let i = 0; i < 25; i++) s = snapOf(R.tick());
  assert.equal(s.ph, 'active');
  const t0 = s.k;
  for (let i = 0; i < 8; i++) s = snapOf(R.tick());
  assert.equal(s.k, t0 + 8);
  assert.equal(s.c.length, 900);
  assert.ok(JSON.stringify(s).length < 16000);
  // a late platform tick catches up at most four steps
  s = snapOf(R.tick(undefined, 2000));
  assert.equal(s.k, t0 + 12);
});

test('inputs steer only the sender\'s own seat; bad directions are ignored', () => {
  const R = round();
  for (let i = 0; i < 30; i++) R.tick();
  const before = plain(R.ss.state.players);
  const r = R.tick([{ from: 'alice', data: { type: 'input', realtime: true, dir: 'up', seat: 1, playerId: 's1' } }, { from: 'mallory', data: { dir: 'left' } }, { from: 'bob', data: { dir: 'sideways' } }]);
  const after = R.ss.state.players;
  assert.equal(after[0].dir, 'up');
  assert.equal(after[0].y, before[0].y - 1);
  assert.equal(after[1].dir, before[1].dir);
  assert.ok(snapOf(r));
});

test('a player who leaves is out; when every human has left the round ends with the result', () => {
  const R = round();
  for (let i = 0; i < 30; i++) R.tick();
  R.online.bob.left = true;
  let r = R.tick();
  assert.equal(R.ss.state.players[1].alive, false);
  assert.ok(snapOf(r).ev.some((e) => e.k === 'out' && e.i === 1));
  assert.ok(!r.result);
  R.online.alice.left = true;
  r = R.tick();
  assert.ok(r.result);
  assert.equal(r.result.reason, 'abandoned');
  assert.equal(r.result.standings.length, 4);
  const over = r.broadcast.map((b) => b.data).find((d) => d.type === 'over');
  assert.equal(over.reason, 'abandoned');
  assert.equal(over.players.length, 4);
  assert.deepEqual(plain(R.tick().broadcast || []), []);
});

test('Leave round (forfeit) takes the sender out; an unseated sender is refused', () => {
  const R = round();
  for (let i = 0; i < 30; i++) R.tick();
  const r = R.send('alice', { type: 'forfeit' });
  assert.equal(R.ss.state.players[0].alive, false);
  assert.ok(snapOf(r));
  assert.equal(R.send('mallory', { type: 'forfeit' }).ok, false);
});

test('a round with AI seats plays to its end and records the result', () => {
  const R = round([{ userId: 'alice', name: 'alice', team: 0, slot: 0, ai: false }]);
  let result = null, n = 0;
  while (!result && n < 2000) {
    // alice walks a small square loop around home
    const dir = ['up', 'left', 'down', 'right'][Math.floor(n / 3) % 4];
    const r = R.tick(n % 3 === 0 ? [{ from: 'alice', data: { dir } }] : undefined);
    if (r.result) result = r.result;
    n++;
  }
  assert.ok(result, 'the round ended');
  assert.ok(['elimination', 'area-goal', 'time'].includes(result.reason), result.reason);
  assert.ok(R.ss.state.commands.length <= 40, 'the command log stays trimmed');
  assert.ok(JSON.stringify(R.ss).length < 30000);
});
