// js/progress.js — the progress document the engine save holds: the browser
// build's checksummed document read back unchanged (device save and the old
// game:<slug> cloud slot), merging two devices' progress, the game's options
// and the legacy settings keys (signed-in paths can't be live-tested here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freshProgress, checksum, normalizeProgress, readProgress, readForeign, mergeProgress, sameProgress, stamp, unlockAchievement,
  pickOptions, DEFAULT_OPTIONS, BROWSER_KEYS,
} from '../js/progress.js';

/** A document as the browser build's platform.js saveProgress wrote it. */
function oldDoc(extra = {}) {
  const doc = { version: 1, stagesCompleted: { 'stage-01': { score: 74, won: true, attempts: 3 } }, lessonsCompleted: { 'lesson-move': { done: true } },
    bestDaily: { '2026-10-01': { score: 140, seed: 5, contentVersion: 1, duration: 600 } }, achievements: ['first-claim'], rating: 1000, longRoadTotal: 320, ...extra };
  doc.checksum = checksum(doc);
  return doc;
}

test('a fresh document is sound', () => {
  const d = freshProgress();
  assert.ok(normalizeProgress(d));
  assert.equal(d.rating, 1000);
});
test('the browser build document reads back unchanged; a broken checksum is refused', () => {
  const d = oldDoc();
  assert.deepEqual(readProgress(JSON.parse(JSON.stringify(d))), d);
  assert.equal(normalizeProgress({ ...d, checksum: d.checksum + 1 }), null);
  assert.deepEqual(readProgress({ ...d, checksum: 1 }).stagesCompleted, {});
  assert.deepEqual(readProgress(null).achievements, []);
});
test('the old cloud slot text (JSON) migrates', () => {
  const d = oldDoc();
  assert.deepEqual(readForeign(JSON.stringify(d)), d);
  assert.equal(readForeign('not json'), null);
});
test('two devices merge: best scores, won if either, more attempts, union, better daily', () => {
  const a = oldDoc();
  const b = oldDoc({
    stagesCompleted: { 'stage-01': { score: 90, won: false, attempts: 1 }, 'stage-02': { score: 12, won: false, attempts: 1 } },
    lessonsCompleted: { 'lesson-claim': { done: true } }, achievements: ['long-road'], longRoadTotal: 10, rating: 1010,
    bestDaily: { '2026-10-01': { score: 100, seed: 5, contentVersion: 1, duration: 500 } },
  });
  const m = mergeProgress(a, b);
  assert.deepEqual(m.stagesCompleted['stage-01'], { score: 90, won: true, attempts: 3 });
  assert.ok(m.stagesCompleted['stage-02']);
  assert.deepEqual(Object.keys(m.lessonsCompleted).sort(), ['lesson-claim', 'lesson-move']);
  assert.deepEqual(m.achievements.sort(), ['first-claim', 'long-road']);
  assert.equal(m.bestDaily['2026-10-01'].score, 140);
  assert.equal(m.rating, 1010);
  assert.equal(m.longRoadTotal, 320);
  assert.ok(normalizeProgress(m));
  assert.ok(sameProgress(mergeProgress(m, m), m));
  assert.equal(mergeProgress(null, a), a);
});
test('achievements unlock once; stamp re-checksums', () => {
  const d = freshProgress();
  assert.equal(unlockAchievement(d, 'first-claim'), true);
  assert.equal(unlockAchievement(d, 'first-claim'), false);
  assert.equal(unlockAchievement(d, 'nope'), false);
  assert.equal(normalizeProgress(d), null);
  assert.ok(normalizeProgress(stamp(d)));
});
test('options: only valid values; the legacy keys include every browser preference', () => {
  assert.deepEqual(pickOptions({ palette: 'tritanopia', leftHanded: true, haptics: 'yes', music: 0.4 }), { palette: 'tritanopia', leftHanded: true });
  assert.deepEqual(pickOptions(null), {});
  for (const k of Object.keys(DEFAULT_OPTIONS)) assert.ok(BROWSER_KEYS.includes(k), k);
  assert.ok(BROWSER_KEYS.includes('ui.language'));
});
