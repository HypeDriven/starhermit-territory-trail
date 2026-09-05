# Known Issues — Territory Trail

## Test results

| Check | Result |
| --- | --- |
| `npm test` | 61/61 pass |
| `tests/e2e.mjs` (headless Chrome) | E2E PASS — desktop + mobile, no page errors |

## Resolved

### 1. On-screen touch-pad buttons were dead to touch/pointer input

- **File:** `index.html:73` (`#touch-pad` rule), `index.html:76` (`#touch-pad button` rule)
- **Was:** `#touch-pad` sat inside `#hud` (`index.html:60`), which set `pointer-events:none`.
  `#touch-pad` and its `<button data-dir>` children never re-enabled `pointer-events`, so taps
  passed through to the canvas. Mobile users had to rely on canvas tap-to-steer instead of the
  intended on-screen pad.
- **Fixed:** Added `pointer-events:auto` to the `#touch-pad` rule (and explicitly to its
  buttons) so the pad now captures real taps. HUD remains `pointer-events:none` at the overlay
  level, so the non-interactive HUD overlay behavior is unchanged; only the pad is interactive.
  The pad buttons already dispatch `onAction('dir', ...)` → `sendDir`, the same steering path as
  canvas taps, so no other code change was needed.
- **Expected:** A real tap on a pad steer button drives the same steering command as a canvas tap.
- **Verification:** Added a real `page.touchscreen.tap` on the `data-dir="left"` pad button in the
  mobile e2e pass (`tests/e2e.mjs`). It now reports
  `ok - mobile: touch-pad button tap steered left, player 14,15 (from 16,15), tick 5`, and the full
  suite passes (`node tests/e2e.mjs` → `E2E PASS`). `npm test` → `61 passed, 0 failed`.
