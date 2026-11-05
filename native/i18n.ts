// Localization: assets/strings.json (generated from the browser build's keyed
// tables, the nine StarHermit locales) on the engine's strings, which follow the
// interface language the runtime reports (the player's choice in Options ›
// Language, else the account's preferred language or the device's) and own the
// locale fallback and the account strings (`starhermit.*`). Every string is
// drawn through T() each frame, so a change shows on the next frame while the
// round and any room keep running.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";
import type { Challenge, Difficulty, Lesson, Stage } from "./game.ts";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

export type Vars = Record<string, string | number>;
/** A string of assets/strings.json in the player's language, `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars): string { return strings.t(key, vars); }
/** The engine's account strings (signIn, invite, inviteCopied, inviteFailed, signedOut, leaderboard…). */
export function S(key: string, vars?: Vars): string { return strings.t(`starhermit.${key}`, vars); }

// The content's names (js/i18n.js).
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const LESSON_IDS = ["lesson-move", "lesson-claim", "lesson-danger", "lesson-cut"];
const lessonIndex = (l: Lesson): number => Math.max(0, LESSON_IDS.indexOf(l.id));
const challengeKey = (c: Challenge): string => "ch" + cap(c.id.replace("challenge-", ""));
const REASONS: Record<string, string> = { elimination: "reasonElimination", "area-goal": "reasonAreaGoal", time: "reasonTime", "lesson-complete": "reasonLessonComplete", abandoned: "reasonAbandoned" };
const REJECTS: Record<string, string> = { "illegal-direction": "rejIllegal", "player-eliminated": "rejEliminated", "game-ended": "rejEnded" };
export const L = {
  stageName: (s: Stage): string => T("stage" + s.index),
  stageGoal: (s: Stage): string => T("goalStage", { n: s.areaGoal, ticks: s.maxTicks }),
  lessonTitle: (l: Lesson): string => T("lesson" + (lessonIndex(l) + 1) + "Title"),
  lessonText: (l: Lesson): string => T("lesson" + (lessonIndex(l) + 1) + "Text"),
  difficultyName: (d: Difficulty): string => T("diff" + cap(d.id)),
  challengeName: (c: Challenge): string => T(challengeKey(c)),
  challengeGoal: (c: Challenge): string => T(challengeKey(c) + "Goal"),
  /** Display name for a player: built-in bot / local names are localized at render time. */
  playerName(p: { name: string }): string {
    const name = String(p.name || "");
    let m: RegExpExecArray | null;
    if ((m = /^Rival (\d+)$/.exec(name))) return T("rivalN", { n: m[1]! });
    if ((m = /^Player (\S+)$/.exec(name))) return T("playerN", { id: m[1]! });
    if (name === "You") return T("you");
    return name;
  },
  endReason: (code: string | null): string => (code && REASONS[code] ? T(REASONS[code]!) : String(code)),
  rejectReason: (code: string | undefined): string => T(REJECTS[code ?? ""] ?? "rejOther"),
  dirName: (d: string): string => T("dir" + cap(String(d))),
};
