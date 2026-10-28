'use strict';

// Territory Trail — the progress document and the game's own options (pure: no
// storage, no platform), shared by the engine client (native/platform.ts) and
// the node tests.
//
// The engine save (starhermit:storage `saves`, schema 1, on the device and in
// the player's cloud slot) is the document the browser build kept in
// localStorage (territory-trail-progress-v1) and mirrored to the cloud slot
// game:<slug> through the JS SDK's saveJSON, unchanged:
//   { version: 1, stagesCompleted: { id: { score, won, attempts } },
//     lessonsCompleted: { id: { done } }, bestDaily: { day: { score, seed,
//     contentVersion, duration } }, achievements: [key], rating, longRoadTotal,
//     checksum }
// The checksum (FNV-1a over the versioned fields) is kept so a document read
// back from either place is checked as before. Two saves merge as the browser
// build merged them after a save conflict (mergeProgress).

export const PROGRESS_VERSION = 1;

export function freshProgress() {
  const doc = { version: PROGRESS_VERSION, stagesCompleted: {}, lessonsCompleted: {}, bestDaily: {}, achievements: [], rating: 1000, longRoadTotal: 0, checksum: 0 };
  doc.checksum = checksum(doc);
  return doc;
}

export function checksum(doc) {
  const c = JSON.stringify({ v: doc.version, s: doc.stagesCompleted, l: doc.lessonsCompleted, d: doc.bestDaily, a: doc.achievements, r: doc.rating });
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < c.length; i++) { h ^= c.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

/** Validate version + checksum; returns null unless the doc is fully sound (platform.js normalizeProgress). */
export function normalizeProgress(doc) {
  if (!doc || typeof doc !== 'object' || doc.version !== PROGRESS_VERSION) return null;
  if (checksum(doc) !== doc.checksum) return null;
  for (const k of ['stagesCompleted', 'lessonsCompleted', 'bestDaily']) if (!doc[k] || typeof doc[k] !== 'object') return null;
  if (!Array.isArray(doc.achievements)) return null;
  return doc;
}

/** A sound document from anything (the device's save, a migrated slot), else a fresh one. */
export function readProgress(raw) {
  const clean = normalizeProgress(raw);
  return clean ? JSON.parse(JSON.stringify(clean)) : freshProgress();
}

/** The browser build's cloud slot text (the checksummed JSON document), or null. */
export function readForeign(text) {
  try { return normalizeProgress(JSON.parse(String(text))); } catch { return null; }
}

/** Re-stamps the checksum (after a change). */
export function stamp(doc) { doc.checksum = checksum(doc); return doc; }

/**
 * Progress from two devices: per stage the best score, won if either won and
 * the larger attempt count; lessons and achievements united; per day the
 * better daily; the larger rating and long-road total. Either side may be null.
 */
export function mergeProgress(a, b) {
  if (!a) return b; if (!b) return a;
  const out = Object.assign({}, a, b);
  out.stagesCompleted = Object.assign({}, a.stagesCompleted);
  for (const [id, r] of Object.entries(b.stagesCompleted || {})) {
    const p = out.stagesCompleted[id];
    out.stagesCompleted[id] = !p ? r : {
      score: Math.max(p.score || 0, r.score || 0), won: !!(p.won || r.won), attempts: Math.max(p.attempts || 0, r.attempts || 0),
    };
  }
  out.lessonsCompleted = Object.assign({}, a.lessonsCompleted, b.lessonsCompleted);
  out.bestDaily = Object.assign({}, a.bestDaily);
  for (const [day, r] of Object.entries(b.bestDaily || {})) {
    const p = out.bestDaily[day];
    if (!p || (r && r.score > p.score)) out.bestDaily[day] = r;
  }
  out.achievements = (a.achievements || []).slice();
  for (const k of b.achievements || []) if (out.achievements.indexOf(k) < 0) out.achievements.push(k);
  out.rating = Math.max(Number(a.rating) || 0, Number(b.rating) || 0) || 1000;
  out.longRoadTotal = Math.max(Number(a.longRoadTotal) || 0, Number(b.longRoadTotal) || 0);
  delete out.recoveredFromCorruption;
  out.checksum = checksum(out);
  return out;
}

/** Same content (ignoring key order). */
export function sameProgress(a, b) { return canon(a) === canon(b); }
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

// ---------------------------------------------------------------- achievements
// Local, inside the progress document (they travel with the cloud save).
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

// ---------------------------------------------------------------- the game's own options
// What the runtime's Options do not cover (volumes, graphics, language, larger
// text, high contrast and reduced motion are the runtime's): the colour
// palette, the left-handed touch pad, haptics and tutorial hints (the last two
// were stored but never read by the browser build, and still are not).
export const PALETTES = ['default', 'deuteranopia', 'protanopia', 'tritanopia'];
export const DEFAULT_OPTIONS = { palette: 'default', leftHanded: false, haptics: true, showTutorialHints: true };
export const OPTION_KEYS = Object.keys(DEFAULT_OPTIONS);

/** The valid options among `raw`'s fields. */
export function pickOptions(raw) {
  const out = {};
  const r = raw && typeof raw === 'object' ? raw : {};
  if (PALETTES.includes(r.palette)) out.palette = r.palette;
  for (const k of ['leftHanded', 'haptics', 'showTutorialHints']) if (typeof r[k] === 'boolean') out[k] = r[k];
  return out;
}

/** The browser build's keys in the account's settings KV (platform.js PREF_KEYS, and its ui.language choice). */
export const BROWSER_KEYS = ['music', 'effects', 'ambience', 'voice', 'quality', 'gfx', 'reducedMotion', 'highContrast', 'largeText',
  'leftHanded', 'holdToMove', 'haptics', 'palette', 'camera', 'showTutorialHints', 'ui.language'];
