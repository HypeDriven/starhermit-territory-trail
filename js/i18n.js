'use strict';

// Territory Trail — localization runtime.
// The language comes from sh-language.js (window.StarHermitLanguage): explicit
// game choice (ui.language) → StarHermit account preferredLanguage → device
// languages → en-US. A change re-applies static markup and notifies listeners
// (onLanguage) so code-built text re-renders in place.

import { STRINGS } from './strings.js';

export const SUPPORTED = Object.keys(STRINGS);
let lang = 'en-US';
let dict = STRINGS[lang];
const listeners = new Set();

export function locale() { return lang; }

/** Localized string for key with {placeholders} filled from vars. */
export function t(key, vars) {
  const s = (dict && dict[key]) ?? STRINGS['en-US'][key] ?? key;
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : s;
}

/** Re-apply data-i18n (text) and data-i18n-aria (aria-label) markup. */
export function applyStatic(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  if (root.documentElement) root.documentElement.lang = lang;
}

/** fn(locale) runs after every language change. */
export function onLanguage(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function setLocale(next) {
  lang = STRINGS[next] ? next : 'en-US';
  dict = STRINGS[lang];
  if (typeof document !== 'undefined') applyStatic(document);
  for (const fn of listeners) { try { fn(lang); } catch (e) { console.error(e); } }
}

const SL = typeof window !== 'undefined' ? window.StarHermitLanguage : null;
export const language = SL ? SL.create({ game: 'territory-trail', supported: SUPPORTED, apply: setLocale }) : null;

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
const REASONS = { elimination: 'reasonElimination', 'area-goal': 'reasonAreaGoal', time: 'reasonTime', 'lesson-complete': 'reasonLessonComplete' };
export function endReason(code) { return REASONS[code] ? t(REASONS[code]) : String(code); }
const REJECTS = { 'illegal-direction': 'rejIllegal', 'player-eliminated': 'rejEliminated', 'game-ended': 'rejEnded' };
export function rejectReason(code) { return t(REJECTS[code] || 'rejOther'); }
export function dirName(dir) { return t('dir' + cap(String(dir))); }
