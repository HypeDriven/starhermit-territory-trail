'use strict';

// Platform: same-origin /api adapter, server-time sync, per-game settings
// persistence, and funnel telemetry (anonymous, consent-gated).
// No tokens are ever persisted to local storage.

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
  consentTelemetry: false,
};

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

// Progression: versioned + checksummed document. Never stores credentials.
export function loadProgress() {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PROGRESS_KEY) : null;
  const doc = raw ? safeParse(raw, null) : null;
  if (!doc || doc.version !== 1) {
    return { version: 1, stagesCompleted: {}, lessonsCompleted: {}, bestDaily: {}, achievements: [], rating: 1000, checksum: 0 };
  }
  if (checksum(doc) !== doc.checksum) {
    // Corrupted save: keep both by resetting to a clean doc rather than guessing.
    return { version: 1, stagesCompleted: {}, lessonsCompleted: {}, bestDaily: {}, achievements: [], rating: 1000, checksum: 0, recoveredFromCorruption: true };
  }
  return doc;
}

export function saveProgress(doc) {
  doc.checksum = checksum(doc);
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(doc)); } catch (e) { /* ignore */ }
}

function checksum(doc) {
  const c = JSON.stringify({ v: doc.version, s: doc.stagesCompleted, l: doc.lessonsCompleted, d: doc.bestDaily, a: doc.achievements, r: doc.rating });
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < c.length; i++) { h ^= c.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

// ---------------------------------------------------------------- server time
// /api/v1/time is probed ONCE at startup; it is the only route the host
// guarantees. Every other hosted feature returns a local no-op without
// issuing a request when the probe failed.
let timeOffsetMs = 0;
let timeSynced = false;
let hosted = false;

export async function syncServerTime() {
  try {
    const t0 = Date.now();
    const res = await fetch('/api/v1/time', { cache: 'no-store' });
    if (!res.ok) throw new Error('http-' + res.status);
    const body = await res.json();
    const t1 = Date.now();
    // Round-trip-adjusted offset.
    timeOffsetMs = body.now - (t0 + (t1 - t0) / 2);
    timeSynced = true;
    hosted = true;
  } catch (e) {
    timeOffsetMs = 0; timeSynced = false; hosted = false; // offline: local clock fallback
  }
  return timeSynced;
}

export function serverNow() { return Date.now() + timeOffsetMs; }
export function isTimeSynced() { return timeSynced; }
export function isHosted() { return hosted; }

// ---------------------------------------------------------------- telemetry
// Anonymous funnel events only; consent-gated; random session id.
const sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2);

export function track(eventName, detail) {
  if (!hosted) return; // host exposes no telemetry route: never request it
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
let presenceTimer = null;
export function startPresence() {
  if (!hosted) return; // host exposes no presence route: never request it
  stopPresence();
  presenceTimer = setInterval(() => {
    try { fetch('/api/v1/presence', { method: 'POST', keepalive: true }).catch(() => {}); } catch (e) {}
  }, 30000);
}
export function stopPresence() { if (presenceTimer) clearInterval(presenceTimer); presenceTimer = null; }

// ---------------------------------------------------------------- achievements
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
