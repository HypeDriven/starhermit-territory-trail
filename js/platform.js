'use strict';

// Platform: thin adapter over window.StarHermit (starhermit-sdk.js) — launch
// token + renewal, sign-in, profile nickname, the game:<slug> cloud-save slot
// (localStorage is the offline cache; the cloud slot is a mirror), settings
// KV, controls, invite link and the realtime-rooms REST used by net.js —
// plus checksummed progress persistence and local achievements.
//
// Hosted mode = the SDK holds a launch token (#game_token= / #access_token=,
// read once by StarHermit.init() and stripped). Tokens live in memory only.
//
// The client never calls the game's own server.js routes: standalone play
// (any host, loopback included) makes no network calls and uses the local
// clock; there is no telemetry or presence.

const SETTINGS_KEY = 'territory-trail-settings-v1';
const PROGRESS_KEY = 'territory-trail-progress-v1';

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
};
/** Preferences mirrored to the platform settings KV. */
export const PREF_KEYS = ['music', 'effects', 'ambience', 'voice', 'quality', 'gfx', 'reducedMotion',
  'highContrast', 'largeText', 'leftHanded', 'holdToMove', 'haptics', 'palette', 'camera', 'showTutorialHints'];
/** Keyboard actions (KeyboardEvent.code) — mirrors control.* in starhermit.txt. */
export const DEFAULT_BINDINGS = {
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  pause: ['Escape', 'KeyP'], undo: ['KeyU'], camera: ['KeyC'],
};

// ---------------------------------------------------------------- SDK

const SH = (typeof globalThis !== 'undefined' && globalThis.StarHermit) || null;
if (SH) SH.init();

let nickname = null;
let syncListener = null;
let authListener = null;
let syncStatus = 'offline';

/** True when a platform launch token is in memory. */
export function isHosted() { return !!(SH && SH.signedIn); }

/** Launch-token user id (sub), or null offline. */
export function getUserId() { return isHosted() ? SH.userId : null; }

/** This game's slug from game_scope (never hard-coded), or null offline. */
export function getGameSlug() { return SH ? SH.slug : null; }

/** Current launch token (memory only). */
export function getToken() { return isHosted() ? SH.token : null; }

export function canSignIn() { return !!(SH && SH.canSignIn()); }
export function signIn() { return !!(SH && SH.signIn()); }
/** Share link that friends the recipient and invites them back; null offline. */
export function inviteLink() { return isHosted() ? SH.inviteLink() : null; }
/** fn({signedIn}) when the SDK signs in/out (renewal refused → signed out). */
export function onAuth(fn) { authListener = fn; }

if (SH) {
  SH.on('auth', (a) => {
    if (!a.signedIn) { nickname = null; setSyncStatus('offline'); }
    if (authListener) authListener(a);
  });
  SH.on('saved', (ok) => setSyncStatus(ok ? 'synced' : 'offline'));
}

// ---------------------------------------------------------------- realtime rooms
// REST lobby for net.js (host-routed rooms); the SDK attaches the token,
// retries once through renewal on 401, and resolves null on 404.
export const rooms = {
  create: (body) => SH.realtime.createRoom(body),
  open: (roomId) => SH.realtime.open(roomId),
  quickJoin: (body) => SH.realtime.quickJoin(body),
  mine: () => SH.api('/api/v1/realtime/rooms/mine'),
  leave: (roomId) => SH.api('/api/v1/realtime/rooms/' + encodeURIComponent(roomId) + '/leave', { method: 'POST' }),
  result: (roomId, result) => SH.api('/api/v1/realtime/rooms/' + encodeURIComponent(roomId) + '/result', { method: 'POST', body: { result: result } }),
  socketUrl: (roomId) => SH.realtime.socketUrl(roomId),
  /** Before every socket REconnect: 'renewed' | 'retry' | 'relaunch' (token dead, signed out). */
  renewForReconnect: () => (SH ? SH.renewForReconnect() : Promise.resolve('relaunch')),
};

/** Back to the launcher / sign-in for a fresh token; call from a click. False if refused. */
// Leaderboard: post a finished Journey/Daily/Challenge round to the
// high-score board (score-script.js); resolves { posted, rank }.
export async function submitScore(total) {
  if (!isHosted()) return { posted: false, rank: null };
  try {
    const keys = await SH.submitScores({ 'high-score': total });
    if (!keys || keys.indexOf('high-score') < 0) return { posted: false, rank: null };
    try {
      const r = await SH.leaderboard('high-score', { pageSize: 100 });
      const me = (r.items || []).find((i) => i.userId === SH.userId);
      return { posted: true, rank: me ? me.rank : null };
    } catch (e) { return { posted: true, rank: null }; }
  } catch (e) { return { posted: false, rank: null }; }
}

export function relaunch() { return !!(SH && SH.relaunch()); }

// ---------------------------------------------------------------- profile

/**
 * Resolve a user id to a display nickname (cached by the SDK). Never returns
 * usernames; falls back to "Player " + id prefix.
 */
export async function profileFor(id) {
  const p = SH ? await SH.profile(String(id)) : null;
  return p ? p.displayName : 'Player ' + String(id).slice(0, 6);
}

/** Load the signed-in player's nickname into the display name. */
export async function fetchProfile() {
  if (!isHosted()) return null;
  nickname = await profileFor(SH.userId);
  return nickname;
}

/** Display name: profile nickname, else "Player " + id prefix. Null when anonymous. */
export function getDisplayName() {
  if (nickname) return nickname;
  const id = getUserId();
  return id ? 'Player ' + id.slice(0, 6) : null;
}

/** Status-bar identity line; '' offline. */
export function accountLine() {
  if (!isHosted()) return '';
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
// One slot (game:<slug>) holding the checksummed progress doc. The remote doc
// wins on load; localStorage remains the offline cache.

if (typeof window !== 'undefined' && typeof document !== 'undefined' && window.addEventListener) {
  const flush = () => { if (isHosted()) SH.flushSave(true); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
}

function queueCloudSave() {
  if (!isHosted()) return;
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PROGRESS_KEY) : null;
  const doc = raw ? safeParse(raw, null) : null; // already checksummed by saveProgress
  if (!doc) { setSyncStatus('synced'); return; } // nothing saved locally: slot and cache agree
  setSyncStatus('saving');
  SH.saveJSON(doc, 2000);
}

/** Load the remote slot. Returns the checksummed progress doc, or null. */
export async function cloudLoad() {
  if (!isHosted()) return null;
  return normalizeProgress(await SH.loadJSON());
}

/** Boot handshake for hosted mode: profile, remote save doc, platform
 *  preferences. Returns true when remote progress was applied locally. */
export async function initHosted() {
  if (!isHosted()) return false;
  try { await fetchProfile(); } catch (e) { /* nickname falls back to Player id */ }
  await loadPlatformSettings();
  const remote = await cloudLoad();
  if (remote) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(remote)); } catch (e) { /* ignore */ }
    setSyncStatus('synced');
    return true;
  }
  queueCloudSave(); // no remote save yet: seed the slot from the local cache
  return false;
}

// ---------------------------------------------------------------- settings KV + controls

let pushedPrefs = {};
let prefTimer = null;
function pickPrefs(s) {
  const out = {};
  for (const k of PREF_KEYS) if (s && s[k] !== undefined) out[k] = s[k];
  return out;
}

/** Adopt platform-stored preferences into the local settings (platform wins). */
export async function loadPlatformSettings() {
  if (!isHosted()) return null;
  const remote = await SH.getSettings();
  const local = loadSettings();
  const patch = {};
  for (const k of PREF_KEYS) if (remote && remote[k] != null) patch[k] = remote[k];
  pushedPrefs = Object.assign(pickPrefs(local), patch);
  if (Object.keys(patch).length) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign(local, patch))); } catch (e) { /* ignore */ }
  }
  return patch;
}

function pushSettings(s) {
  if (!isHosted()) return;
  clearTimeout(prefTimer);
  prefTimer = setTimeout(() => {
    const prefs = pickPrefs(s), diff = {};
    for (const k of PREF_KEYS) {
      if (JSON.stringify(prefs[k]) !== JSON.stringify(pushedPrefs[k])) diff[k] = prefs[k] === undefined ? null : prefs[k];
    }
    if (!Object.keys(diff).length) return;
    Object.assign(pushedPrefs, diff);
    SH.patchSettings(diff);
  }, 800);
}

/** Effective keyboard bindings; platform overrides win when signed in. */
export async function loadBindings() {
  if (!isHosted()) {
    const out = {};
    for (const k of Object.keys(DEFAULT_BINDINGS)) out[k] = DEFAULT_BINDINGS[k].slice();
    return out;
  }
  return SH.loadBindings(DEFAULT_BINDINGS);
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
  pushSettings(settings);
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

// ---------------------------------------------------------------- time
// Local clock (the platform exposes no per-game time route the game needs).
export function serverNow() { return Date.now(); }

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
