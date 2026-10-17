// platform.test.mjs — js/platform.js over starhermit-sdk.js with a stubbed
// fetch and launch hash: token read, nickname, cloud-save path game:<slug>
// round-trip, settings patch, controls, rooms REST, and no network standalone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The SDK is a classic browser script; package.json "type": "module" makes
// Node treat .js as ESM, so evaluate it with a CommonJS shim.
const mod = { exports: {} };
new Function('module', 'exports', readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(mod, mod.exports);
const SDK = mod.exports;
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `x.${b64url({ sub: 'u-12345678', game_scope: 'trail-test', exp: Math.floor(Date.now() / 1000) + 3600 })}.y`;

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

let n = 0;
async function setup(hash, hostname = 'trail-test.starhermit.com', extra = null) {
  const calls = [], store = new Map(), etags = new Map();
  let version = 0;
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body, auth: init.headers?.Authorization });
    const path = url.split('?')[0];
    const json = (o) => new Response(JSON.stringify(o));
    const hit = extra && extra(path, init);
    if (hit) return hit;
    if (path.endsWith('/profile')) return json({ nickname: 'Trailblazer' });
    if (path.includes('/cloud-saves/')) {
      if (path.endsWith('/info')) {
        const slot = path.slice(0, -5);
        return json(store.has(slot) ? { exists: true, etag: etags.get(slot) } : { exists: false });
      }
      if (init.method === 'PUT') {
        const match = init.headers && init.headers['If-Match'];
        if (match && match !== etags.get(path)) return new Response(JSON.stringify({ etag: etags.get(path) }), { status: 412 });
        store.set(path, JSON.parse(init.body).dataBase64);
        etags.set(path, '"v' + (++version) + '"');
        return json({ etag: etags.get(path) });
      }
      return store.has(path) ? new Response(Buffer.from(store.get(path), 'base64')) : new Response(null, { status: 404 });
    }
    if (path.endsWith('/settings')) return init.method === 'PATCH' ? new Response(null, { status: 204 }) : json({ settings: { palette: 'tritanopia' } });
    if (path.endsWith('/controls')) return json({ actions: [{ action: 'pause', codes: ['KeyQ'] }] });
    if (path.endsWith('/realtime/rooms/quick-join')) return new Response(null, { status: 404 });
    return new Response(null, { status: 404 });
  };
  const location = { hash, search: '', pathname: '/', hostname, origin: 'https://' + hostname };
  const win = { location, history: { state: null, replaceState: (_s, _t, u) => { location.hash = u.includes('#') ? u.slice(u.indexOf('#')) : ''; } } };
  globalThis.location = location;
  globalThis.localStorage = memStorage();
  globalThis.fetch = (...a) => fetch(...a);
  globalThis.StarHermit = SDK.create({ window: win, fetch });
  const p = await import('../js/platform.js?case=' + (n++));
  // Another device writing the slot: the next conditional write from this client is refused (412).
  const otherDevice = async (doc) => {
    const zipped = await globalThis.StarHermit._zip('save.json', new TextEncoder().encode(JSON.stringify(doc)));
    const slot = [...store.keys()][0];
    store.set(slot, Buffer.from(zipped).toString('base64'));
    etags.set(slot, '"v' + (++version) + '"');
  };
  return { calls, sh: globalThis.StarHermit, location, p, otherDevice };
}

test('launch token read + stripped, nickname resolved', async () => {
  const { p, sh, location } = await setup('#game_token=' + JWT);
  assert.equal(p.isHosted(), true);
  assert.equal(p.getGameSlug(), 'trail-test');
  assert.equal(location.hash, '');
  await p.fetchProfile();
  assert.equal(p.getDisplayName(), 'Trailblazer');
  sh.signOut();
});

test('cloud save round-trips game:<slug>; platform settings adopted', async () => {
  const { p, sh, calls } = await setup('#game_token=' + JWT);
  assert.equal(await p.initHosted(), false); // empty slot
  assert.equal(p.loadSettings().palette, 'tritanopia');
  const doc = p.loadProgress();
  doc.stagesCompleted = { s1: true };
  p.saveProgress(doc);
  await sh.flushSave();
  const put = calls.filter((c) => c.method === 'PUT').pop();
  assert.ok(put.url.endsWith('/api/v1/me/cloud-saves/' + encodeURIComponent('game:trail-test')));
  assert.equal(put.auth, 'Bearer ' + JWT);
  assert.deepEqual((await p.cloudLoad()).stagesCompleted, { s1: true });
  sh.signOut();
});

test('settings PATCH, control overrides, invite link, rooms REST', async () => {
  const { p, sh, calls } = await setup('#game_token=' + JWT);
  await p.initHosted();
  p.saveSettings(Object.assign(p.loadSettings(), { largeText: true }));
  await new Promise((r) => setTimeout(r, 900));
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch.url.endsWith('/api/v1/games/trail-test/settings'));
  assert.deepEqual(JSON.parse(patch.body), { settings: { largeText: true } });
  const b = await p.loadBindings();
  assert.deepEqual(b.pause, ['KeyQ']);
  assert.deepEqual(b.up, ['ArrowUp', 'KeyW']);
  assert.match(p.inviteLink(), /game-invite\/u-12345678\/trail-test$/);
  assert.equal(await p.rooms.quickJoin({ seats: 1 }), null);
  assert.match(p.rooms.socketUrl('r1'), /^wss:\/\/trail-test\.starhermit\.com\/ws\/v1\/realtime\?roomId=r1&access_token=/);
  sh.signOut();
});

test('standalone: no network calls', async () => {
  const { p, calls } = await setup('', 'example.com');
  assert.equal(p.isHosted(), false);
  assert.equal(p.canSignIn(), false);
  assert.equal(p.inviteLink(), null);
  assert.equal(await p.initHosted(), false);
  p.saveProgress(p.loadProgress());
  p.saveSettings(p.loadSettings());
  assert.deepEqual((await p.loadBindings()).undo, ['KeyU']);
  assert.deepEqual(await p.submitScore(120), { posted: false, rank: null });
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(calls.length, 0);
});

test('sign-in offered on the platform host without a token', async () => {
  const { p, calls } = await setup('', '0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com');
  assert.equal(p.canSignIn(), true);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------- cloud-save merge
const doc = (p, fields) => { const d = Object.assign(p.loadProgress(), fields); p.saveProgress(d); return JSON.parse(localStorage.getItem('territory-trail-progress-v1')); };

test('a save conflict merges the other device\'s progress with local progress and saves again', async () => {
  const { p, sh, otherDevice } = await setup('#game_token=' + JWT);
  await p.initHosted();
  doc(p, { stagesCompleted: { 'stage-01': { score: 90, won: true, attempts: 2 } }, achievements: ['first-claim'] });
  await sh.flushSave(true);
  const remote = Object.assign(p.loadProgress(), { stagesCompleted: { 'stage-01': { score: 40, won: false, attempts: 5 }, 'stage-02': { score: 70, won: true, attempts: 1 } }, achievements: ['streak-three'] });
  // Seal it with the module's checksum (merging with an empty doc recomputes it).
  const sealed = p.mergeProgress(remote, { version: 1, stagesCompleted: {}, lessonsCompleted: {}, bestDaily: {}, achievements: [], rating: 1000 });
  try {
    await otherDevice(sealed);
    let merged = null;
    p.onMerged((m) => { merged = m; });
    doc(p, { rating: 1000 }); // a local write that loses to the newer cloud save
    assert.equal(await sh.flushSave(true), false);
    for (let i = 0; i < 50 && !merged; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(merged, 'merged after saveconflict');
    const local = p.loadProgress();
    assert.deepEqual(local.stagesCompleted, { 'stage-01': { score: 90, won: true, attempts: 5 }, 'stage-02': { score: 70, won: true, attempts: 1 } });
    assert.deepEqual(local.achievements.slice().sort(), ['first-claim', 'streak-three']);
    await sh.flushSave(true);
    const cloud = await sh.loadJSON();
    assert.deepEqual(Object.keys(cloud.stagesCompleted).sort(), ['stage-01', 'stage-02']);
  } finally { sh.signOut(); }
});

test('boot merges the cloud save with local progress instead of replacing it', async () => {
  const { p } = await setup('', 'example.com');
  const a = p.mergeProgress({ version: 1, stagesCompleted: { 'stage-03': { score: 50, won: true, attempts: 1 } }, lessonsCompleted: {}, bestDaily: { d1: { score: 10 } }, achievements: [], rating: 1000 },
    { version: 1, stagesCompleted: { 'stage-01': { score: 20, won: false, attempts: 1 } }, lessonsCompleted: { 'lesson-move': { done: true } }, bestDaily: { d1: { score: 30 } }, achievements: ['first-claim'], rating: 1000 });
  assert.deepEqual(Object.keys(a.stagesCompleted).sort(), ['stage-01', 'stage-03']);
  assert.equal(a.bestDaily.d1.score, 30);
  assert.deepEqual(a.lessonsCompleted, { 'lesson-move': { done: true } });
  assert.deepEqual(a.achievements, ['first-claim']);
  assert.ok(typeof a.checksum === 'number');
});

// ---------------------------------------------------------------- reconnect renews the token first
const JWT2 = `x.${b64url({ sub: 'u-12345678', game_scope: 'trail-test', exp: Math.floor(Date.now() / 1000) + 7200 })}.y`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class MockWS {
  constructor(url) { this.url = url; this.readyState = 0; MockWS.all.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen && this.onopen(); }); }
  send() {}
  close() { this.readyState = 3; this.onclose && this.onclose({ code: 1006 }); }
}

async function hostedRoom(renew) {
  const { p, calls, sh } = await setup('#game_token=' + JWT, undefined, (path, init) => {
    if (path.endsWith('/launch-token')) return renew();
    if (path.endsWith('/realtime/rooms') && init.method === 'POST') return new Response(JSON.stringify({ id: 'room-1' }));
    if (path.endsWith('/realtime/rooms/room-1/open')) return new Response(null, { status: 204 });
    if (path.endsWith('/realtime/rooms/mine')) return new Response(JSON.stringify({ roomId: 'room-1' }));
    return null;
  });
  MockWS.all = [];
  globalThis.WebSocket = MockWS;
  const { RoomsClient } = await import('../js/net.js');
  const c = new RoomsClient(p);
  await c.createAndOpen();
  return { p, c, sh, calls, first: MockWS.all[0] };
}

test('reconnect renews the token first and reopens with the new token', async () => {
  const { c, sh, calls, first } = await hostedRoom(() => new Response(JSON.stringify({ token: JWT2 })));
  assert.match(first.url, new RegExp('access_token=' + encodeURIComponent(JWT).replace(/[.]/g, '\\.')));
  first.close();
  await wait(700);
  const renewAt = calls.findIndex((x) => x.url.endsWith('/launch-token'));
  const mineAt = calls.findIndex((x) => x.url.endsWith('/realtime/rooms/mine'));
  assert.ok(renewAt >= 0 && mineAt > renewAt, 'renewal precedes the room lookup');
  assert.equal(MockWS.all.length, 2);
  assert.ok(MockWS.all[1].url.includes('access_token=' + encodeURIComponent(JWT2)));
  c.leave();
  sh.signOut();
});

test("renewal 'retry' backs off without reopening the old URL", async () => {
  const { c, sh, calls, first } = await hostedRoom(() => new Response(null, { status: 503 }));
  const status = [];
  c.on('status', (m) => status.push(m.text));
  first.close();
  await wait(700);
  assert.equal(MockWS.all.length, 1, 'no socket reopened');
  assert.ok(!calls.some((x) => x.url.endsWith('/realtime/rooms/mine')));
  assert.equal(status.filter((t) => /reconnecting/.test(t)).length, 2, 'scheduled another backoff attempt');
  assert.equal(c.roomId, 'room-1');
  c.leave();
  sh.signOut();
});

test("renewal 'relaunch' stops reconnecting and surfaces auth-lost", async () => {
  const { p, c, first } = await hostedRoom(() => new Response(null, { status: 401 }));
  let lost = 0;
  c.on('auth-lost', () => { lost++; });
  first.close();
  await wait(700);
  assert.equal(lost, 1);
  assert.equal(c.roomId, null);
  assert.equal(p.isHosted(), false, 'SDK signed out');
  assert.equal(MockWS.all.length, 1, 'no socket reopened');
  assert.equal(typeof p.relaunch, 'function');
  await wait(1200);
  assert.equal(MockWS.all.length, 1, 'stays stopped');
});

test("renewal 'terms-required' stops reconnecting and surfaces auth-lost with the terms flag", async () => {
  const { p, c, sh, first } = await hostedRoom(() => new Response(JSON.stringify({ error: 'terms_acceptance_required' }), { status: 403 }));
  const lost = [];
  c.on('auth-lost', (m) => { lost.push(m); });
  first.close();
  await wait(700);
  assert.deepEqual(lost, [{ terms: true }]);
  assert.equal(c.roomId, null);
  assert.equal(MockWS.all.length, 1, 'no socket reopened');
  await wait(1200);
  assert.equal(MockWS.all.length, 1, 'stays stopped');
  assert.equal(p.isHosted(), true, 'terms do not sign the player out');
  sh.signOut();
});

test('a room that is gone ends the reconnect loop with an unavailable event', async () => {
  let gone = false;
  const { p, calls, sh } = await setup('#game_token=' + JWT, undefined, (path, init) => {
    if (path.endsWith('/launch-token')) return new Response(JSON.stringify({ token: JWT2 }));
    if (path.endsWith('/realtime/rooms') && init.method === 'POST') return new Response(JSON.stringify({ id: 'room-1' }));
    if (path.endsWith('/realtime/rooms/room-1/open')) return new Response(null, { status: 204 });
    if (path.endsWith('/realtime/rooms/mine')) return gone ? new Response(null, { status: 404 }) : new Response(JSON.stringify({ roomId: 'room-1' }));
    return null;
  });
  MockWS.all = [];
  globalThis.WebSocket = MockWS;
  const { RoomsClient } = await import('../js/net.js');
  const c = new RoomsClient(p);
  await c.createAndOpen();
  let unavailable = 0;
  c.on('unavailable', () => { unavailable++; });
  gone = true;
  MockWS.all[0].close();
  await wait(700);
  assert.equal(unavailable, 1);
  assert.equal(c.roomId, null);
  assert.ok(calls.some((x) => x.url.endsWith('/realtime/rooms/mine')));
  await wait(1200);
  assert.equal(MockWS.all.length, 1, 'no socket reopened');
  sh.signOut();
});

test('session-expired and terms strings exist in every locale', async () => {
  const { SH_STRINGS } = await import('../js/sh-i18n.js');
  for (const [loc, t] of Object.entries(SH_STRINGS)) {
    for (const k of ['expiredTitle', 'expiredBody', 'termsTitle', 'termsBody', 'relaunch', 'playLocal']) assert.ok(t[k], loc + '.' + k);
  }
});
