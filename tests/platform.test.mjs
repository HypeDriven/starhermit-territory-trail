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
  const calls = [], store = new Map();
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body, auth: init.headers?.Authorization });
    const path = url.split('?')[0];
    const json = (o) => new Response(JSON.stringify(o));
    const hit = extra && extra(path, init);
    if (hit) return hit;
    if (path.endsWith('/profile')) return json({ nickname: 'Trailblazer' });
    if (path.includes('/cloud-saves/')) {
      if (init.method === 'PUT') { store.set(path, JSON.parse(init.body).dataBase64); return new Response(null, { status: 204 }); }
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
  return { calls, sh: globalThis.StarHermit, location, p };
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
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(calls.length, 0);
});

test('sign-in offered on the platform host without a token', async () => {
  const { p, calls } = await setup('');
  assert.equal(p.canSignIn(), true);
  assert.equal(calls.length, 0);
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

test('session-expired strings exist in every locale', async () => {
  const { SH_STRINGS } = await import('../js/sh-i18n.js');
  for (const [loc, t] of Object.entries(SH_STRINGS)) {
    for (const k of ['expiredTitle', 'expiredBody', 'relaunch', 'playLocal']) assert.ok(t[k], loc + '.' + k);
  }
});
