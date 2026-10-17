// i18n.test.mjs — every string key used in index.html and js/*.js exists in
// all nine locales, with the same {placeholders} as US English.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { STRINGS } from '../js/strings.js';
import { STAGES, LESSONS, PRACTICE_DIFFICULTIES, CHALLENGES } from '../js/content.js';
import { stageName, lessonTitle, lessonText, difficultyName, challengeName, challengeGoal, t } from '../js/i18n.js';

const ROOT = new URL('..', import.meta.url);
const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
const html = readFileSync(new URL('index.html', ROOT), 'utf8');
const code = readdirSync(new URL('js/', ROOT)).filter((f) => f.endsWith('.js') && f !== 'strings.js')
  .map((f) => readFileSync(new URL('js/' + f, ROOT), 'utf8')).join('\n');

const used = new Set();
for (const m of html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)) used.add(m[1]);
for (const m of code.matchAll(/\bt\('([A-Za-z0-9]+)'(?!\s*\+)/g)) used.add(m[1]);
for (const m of code.matchAll(/\bsay\('([A-Za-z0-9]+)'/g)) used.add(m[1]);
for (const m of code.matchAll(/\bkey: '([A-Za-z0-9]+)'/g)) used.add(m[1]);
// Keys built at runtime (tables and concatenation).
for (const m of code.matchAll(/'((?:sync|reason|rej|ach|pal|dir)[A-Z][A-Za-z]*)'/g)) used.add(m[1]);
for (const k of ['dirUp', 'dirDown', 'dirLeft', 'dirRight', 'palDefault', 'palDeuteranopia', 'palProtanopia', 'palTritanopia',
  'achFirstClaimDesc', 'achMechanicDesc', 'achStreakDesc', 'achSummitDesc', 'achLongRoadDesc']) used.add(k);
for (const s of STAGES) used.add('stage' + s.index);
LESSONS.forEach((l, i) => { used.add('lesson' + (i + 1) + 'Title'); used.add('lesson' + (i + 1) + 'Text'); });
const sh = new Set(['lbPosting', 'lbNotPosted', 'lbRank', 'lbPosted']); // sh-i18n.js keys
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('ships the nine locales', () => assert.deepEqual(Object.keys(STRINGS).sort(), [...LOCALES].sort()));
test('found the keys in markup and code', () => assert.ok(used.size > 150, String(used.size)));
for (const loc of LOCALES) {
  test(`${loc} has every used key with matching placeholders`, () => {
    const missing = [...used].filter((k) => !sh.has(k) && typeof STRINGS[loc][k] !== 'string');
    assert.deepEqual(missing, []);
    for (const k of used) if (!sh.has(k)) assert.equal(vars(STRINGS[loc][k]), vars(STRINGS['en-US'][k]), `${loc}.${k}`);
  });
}
test('content names resolve through i18n', () => {
  assert.equal(stageName(STAGES[0]), 'First Steps');
  assert.equal(lessonTitle(LESSONS[1]), 'Claim land');
  assert.ok(lessonText(LESSONS[3]).startsWith('Cross'));
  assert.deepEqual(PRACTICE_DIFFICULTIES.map(difficultyName), ['Calm', 'Steady', 'Fierce']);
  assert.deepEqual(CHALLENGES.map(challengeName), ['Sprinter', 'Landgrab', 'Hunter']);
  assert.equal(challengeGoal(CHALLENGES[2]), 'Eliminate every rival before the clock runs out.');
  assert.equal(t('rivalsSize', { n: 2, w: 28, h: 28 }), '2 rivals · 28×28');
});
test('non-English locales are translated', () => {
  for (const loc of LOCALES.filter((l) => !l.startsWith('en'))) {
    const same = [...used].filter((k) => !sh.has(k) && STRINGS[loc][k] === STRINGS['en-US'][k]);
    assert.ok(same.length < 12, `${loc}: ${same.join(', ')}`);
  }
});
