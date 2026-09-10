# Known Issues — Territory Trail

## Test results

| Check | Result |
| --- | --- |
| `npm test` | 61/61 pass |
| `tests/e2e.mjs` (headless Chrome) | E2E PASS — desktop + mobile, no page errors |

## Resolved

### 10. Three authored SFX events were never triggered

- **File:** `js/main.js`
- **Was:** the manifest declared `ui` (`ui-click.opus`), `move`
  (`trail-step`/`trail-step-alt.opus`), and `warning` (`warning-ping.opus`)
  clips, and `audio.play()` could render them, but no code path ever called
  `play()` with those events — button presses, confirmed steering commands,
  and becoming trail-exposed were silent despite the authored clips.
- **Fixed:** a delegated click listener plays `ui` for every button except
  the touch-pad (which already plays `input`/`move` via `sendDir`); the
  session's confirmed `input` events now play `move` (footstep variants
  rotate automatically); the per-tick danger check plays `warning` on the
  rising edge of the local player's trail-exposed state (reset per round).
- **Verification:** `npm test` 61/61, `npm run test:e2e` PASS (desktop +
  mobile, no page errors), asset audit PASS.

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

### 2. Static file server: path-traversal prefix bypass and malformed-URL crash

- **File:** `server.js` (static file branch of the HTTP handler)
- **Was:** (a) the confinement check was `full.startsWith(ROOT)`, so a sibling
  directory whose name merely shares the `territory-trail` prefix
  (e.g. `territory-trail-x`) would pass the check for `../territory-trail-x/...`
  requests; (b) `decodeURIComponent(pathname)` threw `URIError` on malformed
  percent-encoding (e.g. `/%`), an uncaught exception that crashed the server
  process.
- **Fixed:** Wrapped `decodeURIComponent` in try/catch → `400 bad-request`, and
  tightened the check to `full !== ROOT && !full.startsWith(ROOT + path.sep)`.
- **Verification:** Manual probe against `node server.js`: `GET /%` → 400,
  `GET /../territory-trail-x/a` → 403, normal asset requests → 200. See review log.

### 3. Stale cell colors when restarting a same-size round

- **File:** `js/render.js` (`buildBoard`)
- **Was:** `ownerCache` persisted across `buildBoard` calls. The fresh
  `InstancedMesh` starts with every cell colored `theme.empty`, but `update()`
  skipped any cell whose owner matched the cached value from the *previous*
  board — so after restarting a round on a same-size grid (e.g. retrying the
  daily), cells owned in both rounds kept the empty color.
- **Fixed:** `this.ownerCache = null` in `buildBoard`, forcing a full recolor.

### 4. Claim FX ring spawned at the wrong player

- **File:** `js/render.js` (`spawnClaimFx`), `js/session.js` (claim event)
- **Was:** the claim effect picked `players.findIndex(p => p.trail.length === 0)`
  — the first player with an empty trail, not necessarily the player who just
  claimed (visible in hosted rounds, where claim events are broadcast).
- **Fixed:** the claim event now carries the player identity
  (`playerIndex` from the local session, `playerId` already present in hosted
  snapshots) and `spawnClaimFx` resolves the player from it, keeping the old
  heuristic only as fallback.

### 5. No feedback when the local player cuts a rival trail

- **File:** `js/session.js`, `js/main.js`
- **Was:** the `cut` sound (synthesized fallback + `trail-cut.opus` sample) was
  never played because no `cut` event was ever emitted; eliminating a rival was
  silent.
- **Fixed:** the session diffs `eliminatedOrder` each tick and emits a `cut`
  event for eliminations caused by the local player; `main.js` plays the `cut`
  sound for it.

### 6. Hosted round could reuse a stale solo board

- **File:** `js/main.js` (hosted `start`/`snapshot` handlers)
- **Was:** the board was only rebuilt when grid width differed. After a solo
  round on a same-size grid with a different player count or theme, a hosted
  round rendered with leftover pawns (or missing pawns) and the wrong theme.
- **Fixed:** the `start` message sets `needBoard`, forcing a rebuild on the
  first snapshot of each hosted round; the dimension check now also compares
  height.

### 7. Dead status-clock element

- **File:** `index.html` (`#status-clock`), `js/main.js`, `js/ui.js`
- **Was:** the HUD clock element existed but was never written to — permanently
  empty.
- **Fixed:** added `ui.setClock()`; the per-tick UI update now shows the
  remaining round time (`m:ss left`) derived from `maxTicks - tick` at the fixed
  8 Hz tick rate.

### 8. Hosted player names injected via innerHTML

- **File:** `js/ui.js` (`showResults`, `updateRails`)
- **Was:** player names (attacker-controlled in hosted rooms) were interpolated
  into `innerHTML`, an HTML-injection/XSS vector.
- **Fixed:** standings and rail rows now build DOM nodes with `textContent`.

### 9. Misc robustness

- **File:** `js/main.js`, `js/session.js`
- A stale countdown chain (previous round still counting when a new round
  starts) could call its completion callback into the new round; countdowns are
  now token-guarded so superseded chains stop.
- Removed a wasted duplicate `createGame()` call in the `Session` constructor.
- `tests/e2e.mjs` comment updated: it still claimed the touch-pad was dead after
  the earlier pointer-events fix.
