// The look of the status bar, rails, HUD, touch pad, toasts and screens: the
// browser build's index.html <style>, rewritten class-based in
// tools/ui-style.css and converted once with `starhermit css` into
// assets/ui-style.json (`npm run css`), registered at start with the theme the
// runtime's own widgets (scroll bars, focus rings, selects, check boxes) take.
// The runtime's high contrast option is the old body.high-contrast token set.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string>;
const BASE: Tokens = {
  bg: "#0b1220", panel: "#131c30", panel2: "#1a2540", text: "#e8ecf3", muted: "#93a1ba", accent: "#4ade80", danger: "#f87171",
  focus: "#7dd3fc", edge: "#2c3a5c", "card-edge": "#26355a", "rail-edge": "#22304e", ink: "#062312",
};
/** body.high-contrast. */
const CONTRAST: Tokens = { panel: "#000000", panel2: "#111111", text: "#ffffff", muted: "#dddddd", accent: "#00ff88", focus: "#ffe600" };

let current: Tokens = { ...BASE };
let css: ui.CssStyles | null = null;
let key = "";
export function initStyles(): void {
  css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "sans-serif" });
  ui.setTheme({
    fontSize: 16, smallSize: 13.6, headingSize: 24, padding: 8, spacing: 8, radius: 10,
    text: BASE.text!, muted: BASE.muted!, panel: BASE.panel!, control: BASE.panel2!, hovered: "#22304e",
    pressed: "#2c3a5c", field: BASE.panel2!, accent: BASE.accent!, focus: BASE.focus!, outline: BASE.edge!,
  });
  key = "";
  applyTokens(false);
}
/** The base or high-contrast tokens and styles (cheap when unchanged). */
export function applyTokens(highContrast: boolean): void {
  const k = String(highContrast);
  if (k === key || !css) return;
  key = k;
  current = { ...BASE, ...(highContrast ? CONTRAST : {}) };
  ui.setTokens({ ...css.tokens, ...current });
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$text" } },
    paragraph: { text: { color: "$text" } },
    heading: { text: { color: "$text" } },
    widget: { focusRing: { color: "$focus", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "$edge", radius: 4 } } },
    tooltip: { background: "$panel2", text: { color: "$text" }, radius: 6, padding: 6 },
  });
  ui.setTheme({
    text: current.text!, muted: current.muted!, panel: current.panel!, control: current.panel2!,
    field: current.panel2!, accent: current.accent!, focus: current.focus!, outline: current.edge!,
  });
}
/** A token's current colour (for draw calls, which take real colours). */
export function token(name: string): string { return current[name] ?? "#000000"; }
