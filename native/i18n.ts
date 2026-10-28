// Localization: the browser build's tables (js/strings.js, keyed; the nine
// StarHermit locales; the account strings in js/sh-i18n.js) in the interface
// language the runtime reports (preferences().language: the player's choice
// in Options › Language, else the account's preferred language or the
// device's). The runtime's Options replace the game's own Language setting
// (sh-language.js) and the DOM re-labelling: every string is drawn through T()
// each frame, so a change shows on the next frame while the round and any
// room keep running.
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { L } from "./game.ts";
import { shText } from "../js/sh-i18n.js";

let current = "";
function apply(tag: string): void {
  const next = L.setLocale(String(tag || "en-US"));
  if (next === current) return;
  current = next;
  ui.setLanguage(current);
}
apply(preferences().language);
onPreferencesChange((p) => apply(p.language));

export type Vars = Record<string, string | number>;
/** A string of js/strings.js in the player's language, `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars): string { return L.t(key, vars); }
/** The account strings (signIn, invite, copied, copyFail, signedOut, expired…, lbPosting, lbRank, lbPosted, lbNotPosted). */
export function S(key: string, vars?: Vars): string { return (shText as (k: string, v: Vars, tag: string) => string)(key, vars ?? {}, current); }
export function locale(): string { return current; }
