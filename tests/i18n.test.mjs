import { readFileSync as readReviewedIdentityData } from 'node:fs';
const REVIEWED_IDENTITIES = JSON.parse(readReviewedIdentityData(new URL('./reviewed-identities.json', import.meta.url), 'utf8'));
// Only exact reviewed key/source pairs are exempt; all other English copies count.
function isReviewedIdentity(locale, key, source) {
  const row = REVIEWED_IDENTITIES.locales[locale]?.[key];
  return row?.source === source && typeof row.reason === 'string' && row.reason.length > 0;
}
// i18n.test.mjs — every string key the engine client (native/*.ts) uses exists in
// all nine locales, with the same {placeholders} as US English.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { STAGES, LESSONS, PRACTICE_DIFFICULTIES, CHALLENGES } from '../js/content.js';

const ROOT = new URL('..', import.meta.url);
const STRINGS = JSON.parse(readFileSync(new URL('assets/strings.json', ROOT), 'utf8'));
const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT', 'fr-BE', 'de-BE', 'en-SG', 'en-HK', 'en-BQ', 'es-CO', 'de-IT', 'fr-IT', 'es-CL', 'es-AR', 'es-EC', 'ja-JP', 'nl-BE', 'zh-SG', 'ms-SG', 'ta-SG', 'zh-HK', 'yue-HK', 'nl-NL', 'fi-FI', 'sv-FI', 'et-EE', 'id-ID', 'vi-VN', 'de-BR', 'da-DE', 'lb-BE', 'ca-FR', 'oc-FR', 'sl-IT', 'fur-IT', 'ca-IT', 'oc-IT', 'ru-FI', 'ca-ES', 'gl-ES', 'ru-EE', 'su-ID', 'km-VN', 'co-FR', 'eu-FR', 'eu-ES', 'bew-ID'];
// The engine client (native/*.ts) and the shared modules it shows text from.
const files = readdirSync(new URL('native/', ROOT)).filter((f) => f.endsWith('.ts')).map((f) => 'native/' + f)
  .concat(['js/online.js']);
const code = files.map((f) => readFileSync(new URL(f, ROOT), 'utf8')).join('\n');

const used = new Set();
for (const m of code.matchAll(/\bT\(\s*"([A-Za-z0-9]+)"(?!\s*\+)/g)) used.add(m[1]);
for (const m of code.matchAll(/\bt\('([A-Za-z0-9]+)'(?!\s*\+)/g)) used.add(m[1]);
for (const m of code.matchAll(/\bkey: ["']([A-Za-z0-9]+)["']/g)) used.add(m[1]);
for (const m of code.matchAll(/\btext: T\("([A-Za-z0-9]+)"/g)) used.add(m[1]);
for (const m of code.matchAll(/["']((?:sync|reason|rej|ach|pal|dir|mode)[A-Z][A-Za-z]*)["']/g)) used.add(m[1]);
for (const k of ['dirUp', 'dirDown', 'dirLeft', 'dirRight', 'palDefault', 'palDeuteranopia', 'palProtanopia', 'palTritanopia',
  'achFirstClaimDesc', 'achMechanicDesc', 'achStreakDesc', 'achSummitDesc', 'achLongRoadDesc', 'modeJourneyDesc', 'modePracticeDesc',
  'modeDailyDesc', 'modeChallengeDesc', 'modeLearnDesc', 'modeHostedDesc', 'rivalN', 'playerN', 'you', 'hostedHint', 'hostedNone',
  'joinedRoom', 'roomLobby', 'creatingRoom', 'lookingForRoom', 'noOpenRooms', 'hostedUnavailable', 'roundStartingStatus', 'leftRoom',
  'notConnected', 'roomGone']) used.add(k);
for (const s of STAGES) used.add('stage' + s.index);
LESSONS.forEach((l, i) => { used.add('lesson' + (i + 1) + 'Title'); used.add('lesson' + (i + 1) + 'Text'); });
const sh = new Set(['lbPosting', 'lbNotPosted', 'lbRank', 'lbPosted', 'signIn', 'invite', 'copied', 'copyFail', 'signedOut', 'expiredTitle', 'expiredBody', 'termsTitle', 'termsBody', 'relaunch', 'playLocal']); // sh-i18n.js keys
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('ships the nine locales', () => assert.deepEqual(Object.keys(STRINGS).sort(), [...LOCALES].sort()));
test('found the keys in the client code', () => assert.ok(used.size > 150, String(used.size)));
for (const loc of LOCALES) {
  test(`${loc} has every used key with matching placeholders`, () => {
    const missing = [...used].filter((k) => !sh.has(k) && typeof STRINGS[loc][k] !== 'string');
    assert.deepEqual(missing, []);
    for (const k of used) if (!sh.has(k)) assert.equal(vars(STRINGS[loc][k]), vars(STRINGS['en-US'][k]), `${loc}.${k}`);
  });
}
test('content names resolve in the tables', () => {
  const en = STRINGS['en-US'];
  assert.equal(en['stage' + STAGES[0].index], 'First Steps');
  assert.equal(en.lesson2Title, 'Claim land');
  assert.ok(en.lesson4Text.startsWith('Cross'));
  assert.deepEqual(PRACTICE_DIFFICULTIES.map((d) => en['diff' + d.id[0].toUpperCase() + d.id.slice(1)]), ['Calm', 'Steady', 'Fierce']);
  assert.deepEqual(CHALLENGES.map((c) => { const k = c.id.replace('challenge-', ''); return en['ch' + k[0].toUpperCase() + k.slice(1)]; }), ['Sprinter', 'Landgrab', 'Hunter']);
  assert.equal(en.chHunterGoal, 'Eliminate every rival before the clock runs out.');
});
test('non-English locales are translated', () => {
  for (const loc of LOCALES.filter((l) => !l.startsWith('en'))) {
    const same = ([...used].filter((k) => !sh.has(k) && STRINGS[loc][k] === STRINGS['en-US'][k])).filter((key) => !isReviewedIdentity(loc, key, STRINGS['en-US'][key]));
    assert.ok(same.length < 12, `${loc}: ${same.join(', ')}`);
  }
});
