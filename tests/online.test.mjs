// js/online.js over a fake platform: create / quick join (none open: null),
// the lobby handing a playing room over, the round's sync on every
// connection, steering as realtime inputs (resent when paced), stale
// snapshots dropped, the end, Leave round; and the wire snapshot of the real
// server.js turned back into the rules' state shape the client draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LobbyClient, MatchClient, createRoom, quickJoin, stateFromSnap, newRoom } from '../js/online.js';

function fakePlatform() {
  const log = [];
  let gameH = null, roomH = null, paced = false;
  const room = { id: 'r1', hostUserId: 'alice', status: 'lobby', participants: [{ userId: 'alice' }], gameSessionId: null };
  return {
    log, room,
    get gameH() { return gameH; }, get roomH() { return roomH; },
    setPaced(v) { paced = v; },
    userId: 'alice',
    createRoom: async (cfg) => { log.push(['create', cfg]); return { ...room }; },
    openRoom: async (id) => { log.push(['open', id]); return { ...room, status: 'open' }; },
    startRoom: async (id) => { log.push(['start', id]); return { ...room, status: 'playing', gameSessionId: 'g1' }; },
    leaveRoom: async (id) => { log.push(['leave', id]); },
    getRoom: async () => ({ ...room }),
    quickJoin: async (shape) => { log.push(['quick', shape]); return null; },
    myRoom: async () => null,
    connectRoom: (id, h) => { roomH = h; return { close() { log.push(['room-close', id]); } }; },
    connectGame: (id, h) => {
      gameH = h;
      return {
        send: (d) => { log.push(['cmd', d]); return true; },
        input: (d) => { if (paced) return false; log.push(['input', d]); return true; },
        close: () => log.push(['game-close', id]),
      };
    },
  };
}

test('create opens a four-seat room with AI backfill; quick join with none open is null', async () => {
  const p = fakePlatform();
  const room = await createRoom(p);
  assert.equal(room.status, 'open');
  assert.deepEqual(p.log[0], ['create', newRoom()]);
  assert.deepEqual([newRoom().teamCount, newRoom().seatsPerTeam, newRoom().backfillAiPlayers], [1, 4, true]);
  assert.equal(await quickJoin(p), null);
});

test('the lobby: Start round (host only) hands the playing room over once', async () => {
  const p = fakePlatform();
  const played = [];
  const lobby = new LobbyClient(p, p.room, { onPlaying: (r) => played.push(r.gameSessionId) });
  lobby.connect();
  assert.ok(lobby.host);
  assert.equal(await lobby.start(), true);
  p.roomH.onRoster({ status: 'playing', gameSessionId: 'g1' });
  assert.deepEqual(played, ['g1']);
});

test('the round: sync on open, inputs, paced inputs resent, stale snaps dropped, over, leave', async () => {
  const p = fakePlatform();
  const seen = [];
  const m = new MatchClient(p, { ...p.room, gameSessionId: 'g1' }, { onSnap: (s) => seen.push(s.k), onOver: (o) => seen.push(o.reason) });
  m.connect();
  assert.equal(m.steer('up'), false); // not open yet: kept
  p.gameH.onOpen();
  assert.deepEqual(p.log.find((l) => l[0] === 'cmd'), ['cmd', { type: 'sync' }]);
  m.update();
  assert.deepEqual(p.log.filter((l) => l[0] === 'input').map((l) => l[1].dir), ['up']);
  p.setPaced(true);
  m.steer('left');
  p.setPaced(false);
  m.update();
  assert.deepEqual(p.log.filter((l) => l[0] === 'input').map((l) => l[1].dir), ['up', 'left']);
  p.gameH.onMessage({ type: 'table', seats: [{ id: 's0', userId: 'alice' }, { id: 's1', userId: null }], width: 30, height: 30 });
  assert.equal(m.seat, 0);
  p.gameH.onMessage({ type: 'snap', k: 5 });
  p.gameH.onMessage({ type: 'snap', k: 4 });
  p.gameH.onMessage({ type: 'over', reason: 'time' });
  p.gameH.onMessage({ type: 'over', reason: 'time' });
  assert.deepEqual(seen, [5, 'time']);
  await m.leave();
  assert.ok(!p.log.some((l) => l[0] === 'cmd' && l[1].type === 'forfeit'), 'no forfeit after the end');
  assert.ok(p.log.some((l) => l[0] === 'leave'));
});

test('a server.js snapshot becomes the rules state shape', () => {
  const ctx = { JSON, Object, Array, Number, String, Math: Object.create(Math), isFinite };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../server.js', import.meta.url), 'utf8'), ctx);
  const room = { roomId: 'r', metadata: {}, roster: [{ userId: 'alice', name: 'alice', team: 0, slot: 0, ai: false }] };
  let ss = ctx.game.createSession({ now: 0, random: 0.2, room }).sessionState;
  const pres = { alice: { online: true, left: false } };
  let snap = null, table = null;
  table = JSON.parse(JSON.stringify(ctx.game.onPlayerMessage({ now: 0, sessionState: ss, room, presence: pres, message: { from: 'alice', data: { type: 'sync' } } }).broadcast[0].data));
  for (let i = 1; i < 40; i++) {
    const r = ctx.game.onTick({ now: i * 125, sessionState: JSON.parse(JSON.stringify(ss)), room, presence: pres, inputs: i === 25 ? [{ from: 'alice', data: { dir: 'up' } }] : undefined });
    ss = r.sessionState;
    snap = JSON.parse(JSON.stringify(r.broadcast[0].data));
  }
  const st = stateFromSnap(table, snap, null);
  const real = ss.state;
  assert.deepEqual(st.cells, real.cells);
  assert.deepEqual(st.trailOf, real.trailOf);
  st.players.forEach((p, i) => {
    assert.deepEqual([p.x, p.y, p.dir, p.alive, p.area, p.trail.length], [real.players[i].x, real.players[i].y, real.players[i].dir, real.players[i].alive, real.players[i].area, real.players[i].trail.length]);
  });
  assert.equal(st.players[0].userId, 'alice');
  assert.equal(st.tick, real.tick);
});
