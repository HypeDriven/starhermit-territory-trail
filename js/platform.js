'use strict';

// Platform: same-origin /api adapter with StarHermit launch-token auth,
// per-game settings, checksummed progress persistence (localStorage is the
// offline cache; the cloud slot is a mirror), and local achievements.
//
// Hosted mode activates iff a launch token was read from the URL: fragment
// #game_token=<jwt> (read once, then stripped), with ?token=/&launch=/&launch_token=
// query fallbacks for local dev only. The JWT payload (base64url decode, no
// verify) carries sub (user id) and game_scope (this game's slug). The token
// lives in memory only — never persisted — and is re-minted every 45 min via
// POST /api/v1/games/{slug}/launch-token.
//
// The per-game /api/v1/event and /api/v1/presence routes exist only on the
// game's own dev server (server.js): they are called solely on the local-dev
// path. Hosted mode never issues them — the platform exposes no such routes
// for launch tokens.

const SETTINGS_KEY = 'territory-trail-settings-v1';
const PROGRESS_KEY = 'territory-trail-progress-v1';
const CLOUD_ENTRY = 'save.json';

export const DEFAULT_SETTINGS = {
  music: 0.6, effects: 0.8, ambience: 0.4, voice: 0.0,
  quality: 'auto', // auto | low | medium | high
  reducedMotion: false,
  highContrast: false,
  largeText: false,
  leftHanded: false,
  holdToMove: false,
  haptics: true,
  palette: 'default', // default | deuteranopia | protanopia | tritanopia
  camera: 'fit',
  showTutorialHints: true,
  consentTelemetry: false,
};

// ---------------------------------------------------------------- stored zip
// Minimal ZIP writer/reader (stored entries only, no compression).
// Cloud saves travel as ONE zip+base64 slot; saves are small JSON.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const local = out.length;
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

// ---------------------------------------------------------------- launch token

/** True on the real platform host; query fallbacks are local-dev only. */
function isPlatformHost() {
  try { return /(^|\.)starhermit\.com$/i.test(location.hostname); } catch (e) { return false; }
}

/** Read the launch token once, then strip it from the URL. Returns null offline. */
function readLaunchToken() {
  if (typeof location === 'undefined' || typeof history === 'undefined') return null;
  if (location.hash.length > 1) {
    try {
      const params = new URLSearchParams(location.hash.slice(1));
      const t = params.get('game_token');
      if (t) {
        params.delete('game_token');
        params.delete('session_id');
        const rest = params.toString();
        history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : ''));
        return t;
      }
    } catch (e) { /* malformed fragment; fall through to query */ }
  }
  if (isPlatformHost()) return null; // the platform always delivers the fragment
  try {
    const q = new URLSearchParams(location.search);
    const t = q.get('token') || q.get('launch') || q.get('launch_token');
    if (t) history.replaceState(null, '', location.pathname + location.hash);
    return t;
  } catch (e) {
    return null;
  }
}

/** Decode a JWT payload segment (base64url) without verifying the signature. */
function decodeJwtPayload(token) {
  try {
    const seg = token.split('.')[1];
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const claims = JSON.parse(json);
    return claims && typeof claims === 'object' ? claims : null;
  } catch (e) {
    return null;
  }
}

let token = readLaunchToken();
const claims = token ? decodeJwtPayload(token) : null;
const userId = claims && typeof claims.sub === 'string' ? claims.sub : null;
const gameSlug = claims && typeof claims.game_scope === 'string' ? claims.game_scope : null;
const hosted = !!token; // hosted mode iff a launch token was read

let nickname = null;
let syncListener = null;
let syncStatus = 'offline';
const profileCache = new Map();

/** True when a platform launch token is in memory. */
export function isHosted() { return hosted; }

/** Launch-token user id (sub), or null offline. */
export function getUserId() { return userId; }

/** This game's slug from game_scope (never hard-coded), or null offline. */
export function getGameSlug() { return gameSlug; }

/** Current launch token (memory only) — used for the realtime WS auth. */
export function getToken() { return token; }

/** Fetch a platform API path with the launch token. Throws when offline. */
export async function api(path, opts) {
  opts = opts || {};
  if (!token) throw new Error('offline');
  const headers = Object.assign({}, opts.headers || {});
  headers['Authorization'] = 'Bearer ' + token;
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  return fetch(path, Object.assign({}, opts, { headers: headers }));
}

// Token lifetime is 60 min; re-mint every 45 min, retry failures ~60 s.
let refreshTimer = null;
function scheduleRefresh(delayMs) {
  if (typeof setTimeout === 'undefined') return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshLaunchToken, delayMs);
  if (refreshTimer && refreshTimer.unref) refreshTimer.unref();
}
async function refreshLaunchToken() {
  if (!token || !gameSlug) return;
  try {
    const res = await api('/api/v1/games/' + encodeURIComponent(gameSlug) + '/launch-token', { method: 'POST' });
    if (!res.ok) throw new Error('http-' + res.status);
    const body = await res.json();
    if (body && typeof body.token === 'string' && body.token) token = body.token;
    scheduleRefresh(45 * 60 * 1000);
  } catch (e) {
    scheduleRefresh(60 * 1000);
  }
}
if (token) scheduleRefresh(45 * 60 * 1000);

// ---------------------------------------------------------------- profile

/**
 * Resolve a user id to a display nickname (cached). Never returns usernames;
 * falls back to "Player " + id8. Offline callers get the fallback.
 */
export async function profileFor(id) {
  const key = String(id);
  if (profileCache.has(key)) return profileCache.get(key);
  let rec = null;
  if (token) {
    try {
      const res = await api('/api/v1/users/' + encodeURIComponent(key) + '/profile');
      if (res.ok) rec = await res.json();
    } catch (e) { /* offline; fall through to the fallback */ }
  }
  const nick = rec && typeof rec.nickname === 'string' && rec.nickname.trim()
    ? rec.nickname.trim()
    : 'Player ' + key.slice(0, 8);
  profileCache.set(key, nick);
  return nick;
}

/** Load the signed-in player's nickname into the display name. */
export async function fetchProfile() {
  if (!userId) return null;
  nickname = await profileFor(userId);
  return nickname;
}

/** Display name: profile nickname, else "Player " + id8. Null when anonymous. */
export function getDisplayName() {
  if (nickname) return nickname;
  return userId ? 'Player ' + userId.slice(0, 8) : null;
}

/** Status-bar identity line; '' offline. */
export function accountLine() {
  if (!hosted) return '';
  const sync = { saving: 'saving…', synced: 'synced', offline: 'offline' }[syncStatus] || 'offline';
  return 'Playing as ' + getDisplayName() + ' · cloud ' + sync;
}

export function onSyncStatus(fn) { syncListener = fn; }
export function getSyncStatus() { return syncStatus; }
function setSyncStatus(s) {
  syncStatus = s;
  if (syncListener) syncListener(s);
}

// ---------------------------------------------------------------- cloud save
// One slot: GET/PUT /api/v1/me/cloud-saves/{slug} (zip+base64). The remote
// doc wins on load; localStorage remains the offline cache.

let cloudTimer = null;
let cloudBusy = false;
let cloudAgain = false;

function installCloudFlush() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const flush = () => {
    if (!cloudTimer) return;
    clearTimeout(cloudTimer);
    cloudTimer = null;
    pushCloudSave(true);
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
}
if (token) installCloudFlush();

function queueCloudSave() {
  if (!token || !gameSlug) return;
  setSyncStatus('saving');
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    cloudTimer = null;
    pushCloudSave(false);
  }, 2000);
  if (cloudTimer && cloudTimer.unref) cloudTimer.unref();
}

async function pushCloudSave(keepalive) {
  if (!token || !gameSlug) return;
  if (cloudBusy) { cloudAgain = !keepalive; return; }
  cloudBusy = true;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PROGRESS_KEY) : null;
    const doc = raw ? safeParse(raw, null) : null; // already checksummed by saveProgress
    if (!doc) { setSyncStatus('synced'); return; } // nothing saved locally: slot and cache agree
    const zip = zipStore(CLOUD_ENTRY, new TextEncoder().encode(JSON.stringify(doc)));
    const res = await fetch('/api/v1/me/cloud-saves/' + encodeURIComponent(gameSlug), {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataBase64: bytesToBase64(zip) }),
      keepalive: !!keepalive,
    });
    setSyncStatus(res.ok ? 'synced' : 'offline');
  } catch (e) {
    setSyncStatus('offline');
  } finally {
    cloudBusy = false;
    if (cloudAgain) { cloudAgain = false; queueCloudSave(); }
  }
}

/**
 * Load the remote slot (404 = none). Returns the checksummed progress doc,
 * or null when the slot is empty. Throws on malformed payloads.
 */
export async function cloudLoad() {
  if (!token || !gameSlug) return null;
  const res = await api('/api/v1/me/cloud-saves/' + encodeURIComponent(gameSlug));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('http-' + res.status);
  const zipBytes = new Uint8Array(await res.arrayBuffer());
  const doc = JSON.parse(new TextDecoder().decode(unzipFirstEntry(zipBytes)));
  const clean = normalizeProgress(doc);
  if (!clean) throw new Error('bad-cloud-doc');
  return clean;
}

/** Boot handshake for hosted mode: profile first, then the remote save doc.
 *  Returns true when a remote doc was applied over the local cache. */
export async function initHosted() {
  if (!hosted) return false;
  try { await fetchProfile(); } catch (e) { /* nickname falls back to Player id8 */ }
  let remote = null;
  try { remote = await cloudLoad(); } catch (e) { /* local cache stays authoritative */ }
  if (remote) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(remote)); } catch (e) { /* ignore */ }
    setSyncStatus('synced');
    return true;
  }
  queueCloudSave(); // no remote save yet: seed the slot from the local cache
  return false;
}

// ---------------------------------------------------------------- settings

function safeParse(json, fallback) {
  try { return JSON.parse(json); } catch (e) { return fallback; }
}

export function loadSettings() {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null;
  return Object.assign({}, DEFAULT_SETTINGS, raw ? safeParse(raw, {}) : {});
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* storage full/blocked: session-only */ }
}

// ---------------------------------------------------------------- progress
// Versioned + checksummed document. localStorage is the offline cache; the
// cloud slot mirrors it (debounced) whenever a launch token is present.

export function loadProgress() {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PROGRESS_KEY) : null;
  const doc = raw ? safeParse(raw, null) : null;
  const clean = normalizeProgress(doc);
  if (clean) return clean;
  const fresh = { version: 1, stagesCompleted: {}, lessonsCompleted: {}, bestDaily: {}, achievements: [], rating: 1000, checksum: 0 };
  // Corrupted save (version ok, checksum bad): keep both by resetting to a
  // clean doc rather than guessing.
  if (doc && doc.version === 1) fresh.recoveredFromCorruption = true;
  return fresh;
}

/** Validate version + checksum; returns null unless the doc is fully sound. */
function normalizeProgress(doc) {
  if (!doc || typeof doc !== 'object' || doc.version !== 1) return null;
  if (checksum(doc) !== doc.checksum) return null;
  return doc;
}

export function saveProgress(doc) {
  doc.checksum = checksum(doc);
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(doc)); } catch (e) { /* ignore */ }
  queueCloudSave(); // no-op unless hosted
}

function checksum(doc) {
  const c = JSON.stringify({ v: doc.version, s: doc.stagesCompleted, l: doc.lessonsCompleted, d: doc.bestDaily, a: doc.achievements, r: doc.rating });
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < c.length; i++) { h ^= c.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

// ---------------------------------------------------------------- server time
// /api/v1/time exists only on the game's own dev server: probe it solely on
// the local-dev path (never hosted — the platform exposes no such route) and
// fall back to the local clock on failure. Every other dev feature returns a
// local no-op when the probe failed.
let timeOffsetMs = 0;
let timeSynced = false;

export async function syncServerTime() {
  if (hosted) return false; // keep the local clock on-platform (labeled in UI)
  try {
    const t0 = Date.now();
    const res = await fetch('/api/v1/time', { cache: 'no-store' });
    if (!res.ok) throw new Error('http-' + res.status);
    const body = await res.json();
    const t1 = Date.now();
    if (!body || typeof body.now !== 'number' || !isFinite(body.now)) throw new Error('bad-time-payload');
    // Round-trip-adjusted offset.
    timeOffsetMs = body.now - (t0 + (t1 - t0) / 2);
    timeSynced = true;
  } catch (e) {
    timeOffsetMs = 0; timeSynced = false; // offline: local clock fallback
  }
  return timeSynced;
}

export function serverNow() { return Date.now() + timeOffsetMs; }
export function isTimeSynced() { return timeSynced; }

// ---------------------------------------------------------------- telemetry
// Anonymous funnel events only; consent-gated; random session id. Dev server
// only — hosted mode never issues this fabricated route.
const sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2);

export function track(eventName, detail) {
  if (hosted) return; // platform exposes no per-game telemetry route
  if (!timeSynced) return; // our own dev server only
  const settings = loadSettings();
  if (!settings.consentTelemetry) return;
  const allowed = ['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error'];
  if (allowed.indexOf(eventName) < 0) return;
  try {
    fetch('/api/v1/event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: eventName, session: sessionId, detail: detail || null, at: Date.now() }),
      keepalive: true,
    }).catch(() => {});
  } catch (e) { /* offline */ }
}

// ---------------------------------------------------------------- presence
// Dev server only — hosted mode never issues this fabricated route.
let presenceTimer = null;
export function startPresence() {
  if (hosted) return; // platform exposes no presence route: never request it
  if (!timeSynced) return; // our own dev server only
  stopPresence();
  presenceTimer = setInterval(() => {
    try { fetch('/api/v1/presence', { method: 'POST', keepalive: true }).catch(() => {}); } catch (e) {}
  }, 30000);
}
export function stopPresence() { if (presenceTimer) clearInterval(presenceTimer); presenceTimer = null; }

// ---------------------------------------------------------------- achievements
// Local only (server.js is a dev server, not a Jint game script): unlocks are
// part of the progress doc and travel with the cloud save.
export const ACHIEVEMENTS = [
  { key: 'first-claim', name: 'First Claim', desc: 'Claim your first enclosed territory.' },
  { key: 'mechanic-mastery', name: 'Trail Mechanic', desc: 'Complete all Learn lessons.' },
  { key: 'streak-three', name: 'On a Roll', desc: 'Win three rounds in a row.' },
  { key: 'chapter-five', name: 'Summit Climber', desc: 'Complete the final Journey mastery stage.' },
  { key: 'long-road', name: 'The Long Road', desc: 'Claim 10,000 total cells across all sessions.' },
];

export function unlockAchievement(doc, key) {
  if (doc.achievements.indexOf(key) >= 0) return false; // idempotent
  if (!ACHIEVEMENTS.some((a) => a.key === key)) return false;
  doc.achievements.push(key);
  return true;
}
