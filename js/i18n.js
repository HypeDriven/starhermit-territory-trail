'use strict';

// Territory Trail — localization runtime (pure: no DOM). The engine client
// (native/i18n.ts) sets the language from the runtime's interface language
// (preferences().language: the player's choice in Options › Language, else the
// account's preferred language, else the device's), mapped to the nearest
// shipped locale (es-MX → es-419, en-AU → en-GB, fr → fr-FR).

import { STRINGS } from './strings.js';
import { shLocale } from './sh-i18n.js';

export const SUPPORTED = Object.keys(STRINGS);
let lang = 'en-US';
let dict = STRINGS[lang];

export function locale() { return lang; }

/** Localized string for key with {placeholders} filled from vars. */
export function t(key, vars) {
  const s = (dict && dict[key]) ?? STRINGS['en-US'][key] ?? key;
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : s;
}

/** Sets the language from a BCP 47 tag (nearest shipped locale); returns the locale. */
export function setLocale(tag) {
  const next = shLocale(tag);
  lang = STRINGS[next] ? next : 'en-US';
  dict = STRINGS[lang];
  return lang;
}

// ---------------------------------------------------------------- content names
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export function stageName(stage) { return t('stage' + stage.index); }
export function stageGoal(stage) { return t('goalStage', { n: stage.areaGoal, ticks: stage.maxTicks }); }
export function lessonTitle(lesson) { return t('lesson' + (lessonIndex(lesson) + 1) + 'Title'); }
export function lessonText(lesson) { return t('lesson' + (lessonIndex(lesson) + 1) + 'Text'); }
const LESSON_IDS = ['lesson-move', 'lesson-claim', 'lesson-danger', 'lesson-cut'];
function lessonIndex(lesson) { return Math.max(0, LESSON_IDS.indexOf(lesson.id)); }
export function difficultyName(d) { return t('diff' + cap(d.id)); }
export function challengeName(c) { return t('ch' + cap(c.id.replace('challenge-', ''))); }
export function challengeGoal(c) { return t('ch' + cap(c.id.replace('challenge-', '')) + 'Goal'); }
/** Display name for a player: built-in bot / local names are localized at render time. */
export function playerName(p) {
  const name = String(p && p.name || '');
  let m;
  if ((m = /^Rival (\d+)$/.exec(name))) return t('rivalN', { n: m[1] });
  if ((m = /^Player (\S+)$/.exec(name))) return t('playerN', { id: m[1] });
  if (name === 'You') return t('you');
  return name;
}
const REASONS = { elimination: 'reasonElimination', 'area-goal': 'reasonAreaGoal', time: 'reasonTime', 'lesson-complete': 'reasonLessonComplete', abandoned: 'reasonAbandoned' };
export function endReason(code) { return REASONS[code] ? t(REASONS[code]) : String(code); }
const REJECTS = { 'illegal-direction': 'rejIllegal', 'player-eliminated': 'rejEliminated', 'game-ended': 'rejEnded' };
export function rejectReason(code) { return t(REJECTS[code] || 'rejOther'); }
export function dirName(dir) { return t('dir' + cap(String(dir))); }
