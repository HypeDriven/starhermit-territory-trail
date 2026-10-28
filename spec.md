# Territory Trail — Product and Game Specification

**Document status:** running specification of the game as built (StarHermit engine script game, engine 1.21.0, host API minor 23); the design sections keep the original intent.  
**Game index:** 94  
**Genre:** Realtime territory action  
**Players:** 2–32 players as specified by playlist  
**Targets:** the StarHermit client (native) and browsers through the engine's web runtime; desktop, phones in portrait and landscape  
**Rendering direction:** a `starhermit:scene` board (the three.js r182 scene of the browser build, ported) under an immediate-mode `starhermit:ui` interface with an accessibility mirror

## 1. Product vision

Territory Trail is a game in which players leave owned territory to draw a trail, reconnect to claim enclosed land, and cut exposed rival trails. Its signature setting is a clean floating plane of colored territories. The product should feel immediately understandable, responsive within one input, and polished enough that the board or playfield itself is the visual hero. Sessions should begin quickly, make the next useful action obvious without solving the game for the player, and end with a clear explanation of score and progress.

The experience must be original. Do not copy names, layouts, characters, iconography, writing, audio, progression maps, or level data from an existing title. Use an original visual language, original procedural assets, and internally authored content.

### Design pillars

1. **Readable before spectacular:** legal actions, hazards, selection, ownership, and goals remain legible with effects disabled.
2. **One-input confidence:** every press, tap, drag, key, or pointer action gives immediate visual and sonic acknowledgment.
3. **Short path to play:** a returning player reaches the primary playfield in at most two deliberate actions.
4. **Fair mastery:** randomness is seeded and inspectable; outcomes never depend on hidden purchases or invisible stat boosts.
5. **Scalable beauty:** the same art direction survives low-power mobile hardware and high-resolution desktop displays.

## 2. Core game design

### Objective and rules contract

Leave owned territory to draw a trail, reconnect to claim enclosed land, and cut exposed rival trails.

The rules engine must represent legal actions independently from rendering. It must expose legal-action queries, deterministic resolution, serializable state, a monotonically increasing turn/tick number, and a terminal-state reason. Tutorials and hints call the same legal-action API used by play rather than duplicating rules.

### Core loop

The repeated loop is: **leave safety, steer a vulnerable trail, reconnect to claim area, and pressure rivals**. Input is locked only during the shortest non-interruptible resolution phase. Cosmetic animation may continue after the logical state is ready, but skip/fast-forward must settle every object into the exact deterministic end state.

### Scoring and victory

Score owned area and eliminations; server verifies geometric claims. Results show a component breakdown rather than one unexplained total. Store integers for score and simulation units; format values only in presentation. Ties use, in order: primary objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session identifier.

### Modes

- **Learn:** interactive lessons introduce one rule at a time and require the player to perform the action.
- **Journey:** authored progression with gradually combined mechanics and periodic mastery stages. A stage records best score and attempts on every run but counts as complete only once won. The camera and lights render the gameplay and FX layers; the danger banner sits in flow beneath the objective row, with pause in its own column.
- **Daily:** one shared seed and ruleset per UTC day, synchronized to platform time.
- **Practice:** selectable difficulty, restart, undo where rules permit, and no effect on competitive rating.
- **Challenge:** constrained goals such as move limits, speed targets, altered layouts, or restricted tools.
- **Hosted play:** quick-join rooms and host-created rooms; the round runs on the StarHermit server (server.js, a room-bound session), which records the result.

### Difficulty and content generation

- Represent content as versioned data: identifier, seed, initial state, goals, allowed mechanics, par values, tutorial flags, and presentation theme.
- Run offline validators to prove basic legality, reachable goals, bounded duration, and absence of soft locks. Logic puzzles additionally require a unique or explicitly accepted solution class.
- Difficulty is measured from solution depth, branching factor, time pressure, motor precision, hidden information, and recovery options—not merely larger numbers.
- Introduce one new concept in isolation, combine it with one known concept, then test mastery before adding another.
- Daily seeds are immutable after publication. If content is defective, mark the day excluded from ranking rather than silently replacing it.

### Game-state model

`boot → title → profile-ready → mode-select → preparing → tutorial/countdown → active ↔ paused/reconnecting → resolving → results → progression`.

Every transition has one owner and an explicit reason. Backgrounding pauses solo simulation. In hosted play, the authoritative clock continues where rules require it, while the returning client receives a fresh snapshot and a concise “while you were away” summary.

## 3. Interaction and user-interface design

### Information hierarchy

1. **Primary:** playfield, current objective, legal interaction target, and immediate danger or turn state.
2. **Secondary:** score/progress, remaining moves or time, opponent/party status where applicable.
3. **Tertiary:** settings, social controls, cosmetics, help, and history.

The 3D board fills the game region but is never the only UI. Menus, text, settings and assistive descriptions are `starhermit:ui` widgets over or beside it, mirrored for screen readers (and as the browser's accessibility layer); the board mirror is a named target over the playfield.

### Responsive layouts

- **Wide desktop (≥1024 CSS px):** centered playfield, objective/progression rail on the left, contextual actions and social/status rail on the right. Maximum line length is 70 characters.
- **Compact desktop/tablet:** playfield remains central; secondary rails collapse into drawers. Pointer hover may preview but never be required.
- **Portrait mobile:** top safe-area status bar, square or perspective-fit playfield, bottom thumb-zone action tray, and sheet-based secondary panels. Never place critical controls under browser chrome or display cutouts.
- **Large screens:** the runtime's UI scale (the window's scale factor times the player's interface size) zooms the status bar, rails, HUD, screens and toast; the board fills the playfield the rails leave.
- **Landscape mobile:** reserve a narrow status rail; preserve at least 44×44 CSS-pixel targets and 8-pixel separation.
- React to resize, orientation, device-pixel-ratio, safe-area insets, virtual keyboard, and visibility changes without losing input or restarting the round.

### Screens and overlays

- **Title/home:** Play is dominant; daily challenge, journey progress, and profile are one level below.
- **Mode setup:** show rules, expected duration, player count, assists, and whether the result is ranked before commitment.
- **Play HUD:** objective, progress, current actor/state, pause, and only context-relevant actions.
- **Pause/settings:** resume first; audio, graphics, controls, accessibility, help, and leave are clearly separated.
- **Results:** outcome headline, score breakdown, progress, achievements, comparison, replay/retry, and next recommended action.
- **Help:** visual rule cards generated from current control mappings and representative legal states.
- Lobby, roster, readiness, invitation, reconnect, result, and report states are first-class screens.

### Input

- Pointer/touch: raycast only against explicit interaction layers; use pointer capture for drags; cancel safely on lost capture.
- Touch: distinguish tap, drag, and camera gesture by distance/time thresholds; never require multi-touch for core play.
- Keyboard: directional navigation among legal targets, confirm, cancel, pause, undo/hint where valid, and camera reset.
- Gamepad: focus navigation, primary/secondary actions, pause, and remappable axes/buttons.
- Prevent accidental double commits with action identifiers, not arbitrary long debounce timers. Provide visible drag origin, target preview, and invalid-action explanation.

### Accessibility

- Full keyboard operation and visible focus; widget equivalents for board controls; headings and live regions for objective, turn, score, errors, and results.
- Color is reinforced by shape, texture, icon, or label. Include contrast-safe and common color-vision palettes.
- Reduced-motion mode removes camera swoops, shake, parallax, rapid particles, and large scaling while preserving event timing.
- Independent sliders for music, effects, ambience, and voice; captions/text cues for meaningful audio; no audio-only gameplay.
- Options for larger text, high contrast, left-handed controls, hold-versus-toggle, timing assistance, haptics off, and tutorial replay.
- Announce Three.js board state through a concise navigable model rather than describing every decorative object.

### Localization and language

- Every player-facing string — title, setup lists (all 40 stage names, lessons, practice difficulties, challenges and their goals), HUD objective and status badge, danger banner, touch-pad labels, pause/results/help/settings screens, standings and rails, achievements, hosted-play statuses, the board mirror, the session-expired / terms screens and the sync and leaderboard lines — ships in nine locales: en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT. Strings live in `js/strings.js` (keyed); `js/i18n.js` exposes `t(key, vars)` and names content (stages, lessons, difficulties, challenges, built-in player names) at draw time; the game state keeps its English data names. Account strings are in `js/sh-i18n.js`. Numbers stay digits.
- The language is the runtime's interface language (`preferences().language`: the player's choice in the StarHermit Options › Language, else the account's preferred language, else the device's), mapped to the nearest shipped locale (`es-MX → es-419`, `en-AU → en-GB`, `fr → fr-FR`). Every string is drawn through `T()` each frame, so a change shows on the next frame while a round or a room keeps running. The browser build's own Language setting is replaced by the runtime's.

## 4. Visual and audio design

### Visual contract

The subject is the active playfield at near-tabletop to room scale, framed so state changes occupy most of the screen. The scene is a clean floating plane of colored territories. Use an authored camera, original procedural geometry, restrained environmental storytelling, and a deterministic visual seed. The no-post-processing baseline must still communicate hierarchy, depth, selection, and state.

### Three.js scene design

- Use physically based lighting and color management with one dominant key, soft environment fill, and contact grounding. Gameplay colors are tested after tone mapping.
- Build reusable semantic meshes for active pieces, board cells, obstacles, targets, and environment modules. Geometry detail follows silhouette importance and camera distance.
- Use instancing for repeated pieces and props, pooled effects, texture atlases where appropriate, and explicit disposal on scene changes.
- Separate render layers for environment, gameplay, selection/ghosts, effects, and UI anchors. Cosmetic particles never intercept raycasts.
- Selection uses a combination of lift/pose, outline or rim, and grounded marker—not bloom alone. Legal targets preview before commit; invalid targets explain why.
- Event hierarchy: input acknowledgment < legal move < combo/goal < round completion. Reserve camera motion, strong emission, and dense particles for the highest tier.
- Audio uses original short transients tied to logical events, layered material impacts, quiet ambience, and adaptive music stems. Randomized pitch/variant is seeded for replay consistency where recording matters.

### Graphics

**Graphics.** The board (`native/render.ts`, a port of the browser build's three.js r182 `js/render.js`) is lit by a warm key directional light (2.2) whose PCF shadow frustum is fitted to the play area (bias −0.0004, normal bias 0.02) and a cool hemisphere fill (0.9), with ACES filmic tone mapping (exposure 1). At engine minor 23 these are three.js r155+ light units and three.js r185 shadows, so the page's own values are used unchanged. On the detailed tiers the scene adds image-based lighting (`PMREMGenerator.fromScene(new RoomEnvironment(renderer), 0.04)` as `scene.environment` at `environmentIntensity` 0.32 — the renderer-lit room three.js r163+ builds), bevelled clear-coated tiles with a subtle grain (baked PNGs, `tools/bake-grain.mjs`), owned land raised slightly above the empty plane, a rounded, textured island slab with a rim trim and a rocky underside, a radial backdrop gradient, trails that glow in their owner's colour (a surface hook adding 0.7 × the base colour as emission, the old `onBeforeCompile`), and pawns with a glowing beacon. Plain tiers draw box tiles with grid lines. Newly claimed cells flash and throw pooled sparks; claim rings expand; pawns bob; drifting motes float around the island; the title shows a self-playing rival-only board behind a soft scrim with a slow camera sway. Every motion effect stops under the runtime's reduced-motion option. Post effects are the runtime's: GTAO (blend 0.7), bloom (strength 0.5, radius 0.4, threshold 0.88), a linear-light colour grade with vignette (S-curve 0.22, saturation 1.1, cool shadows / warm highlights, vignette 0.26) and FXAA / SMAA / MSAA.

**Quality.** The runtime's Options choose the graphics level (Auto from the device, Low, Balanced, High, Ultra), the render scale, the frame-rate limit and readout and adaptive resolution; `native/quality.ts` maps the level to the browser build's presets and budgets (the old Settings › Graphics panel and its per-effect overrides are not offered):

| Level | Shadows | Post | Materials | Bevel / pawn segments | Grain | Motes | Sparks per claimed cell |
|---|---|---|---|---|---|---|---|
| Low | off | none (MSAA) | Lambert, plain boxes, grid lines | — / 12 | — | off (static) | — (ring pulse only) |
| Balanced | 1024² | bloom (half res), grade, FXAA | Standard | 1 / 20 | 128 px | 90 | 3 |
| High | 2048² | GTAO (half res), bloom, grade, SMAA | Physical (clear-coated tiles and pawns) | 2 / 32 | 128 px | 140 | 3 |
| Ultra | 4096² | GTAO 16 samples (full res), bloom, grade, MSAA | Physical | 3 / 48 | 256 px | 220 | 4 |

Mote and spark counts scale up to 2× within a level on stronger devices (`frame().levelIndex`; at most 440 motes, 8 sparks).

### Camera and motion

- Choose orthographic or low-distortion perspective according to depth requirements; expose framing constants rather than magic offsets.
- Camera transitions use authored duration/easing or critically damped springs and remain interruptible. Never animate by cumulative per-frame lerp.
- Decorative motion is paused or reduced when hidden. Gameplay animation derives from simulation state and interpolation alpha, not frame count.
- Camera shake is low-amplitude, event-tiered, disabled by reduced motion, and never changes raycast truth.

### Graphics-skill routing

During implementation, begin with `threejs-skill-router` and load only the following retained skills because they materially affect this visual target:

- `threejs-camera-direction` for deliberate framing and input-safe camera transitions
- `threejs-procedural-geometry` for authored, inspectable meshes instead of primitive-only placeholders
- `threejs-procedural-materials` for coherent PBR surfaces, perceptual parameters, and readable state masks
- `threejs-procedural-animation` for deterministic motion phases, springs, and interruption-safe transitions
- `threejs-procedural-vfx` for bounded particles, trails, impact accents, and event hierarchy
- `threejs-exposure-color-grading` for tone mapping, adaptation limits, and accessible color separation
- `threejs-image-pipeline` for explicit depth/color ownership and pass ordering
- `threejs-visual-validation` for fixed-view captures, seed sweeps, and performance evidence

Follow the skill pack's acceptance gate: deterministic seeds, debug views for controlling fields, perceptually grouped parameters, mechanism-backed quality tiers, and a readable no-post baseline. Do not add an effect merely because a skill exists.

### Performance budgets

- Target 60 fps at the default tier and a stable 30 fps fallback on constrained mobile hardware.
- Default active gameplay: ≤150 draw calls desktop, ≤90 mobile; ≤350k visible triangles desktop, ≤140k mobile; transient particles ≤20k desktop and ≤5k mobile.
- Cap device pixel ratio by quality tier; dynamically lower render scale before dropping simulation rate. UI text remains native resolution.
- Avoid runtime shader compilation during active play by prewarming required variants. Avoid per-frame allocations in simulation/render loops.
- Quality tiers independently control shadows, environment detail, particles, post effects, antialiasing, and render scale; they never alter rules or visibility of hazards.

## 5. Technical architecture

### Client modules

- `bootstrap`: host handshake, capability detection, asset manifest, lifecycle.
- `rules`: pure deterministic state transitions, legality, scoring, seeded random stream.
- `session`: local or hosted commands, snapshots, prediction policy, reconnect, replay.
- `render`: Three.js scene graph, semantic entity views, camera, lighting, VFX, quality.
- `ui`: responsive immediate-mode shell (`starhermit:ui`), focus, localization, settings, overlays, accessibility mirror.
- `audio`: buses, event mapping, focus/background behavior, decode and memory policy.
- `content`: versioned levels, themes, tutorials, validation metadata.
- `platform`: token-aware REST/WebSocket adapter, retries, rate-limit handling.

No module may mutate rules state except through a validated command. Rendering consumes immutable snapshots plus interpolation data. UI state and simulation state are separate so closing a drawer cannot affect a match.

### Determinism, replay, and security

- Fixed simulation step where physics exists; quantize authoritative inputs and define stable collision/order rules.
- Use separate seeded random streams for rules, content decoration, and audiovisual variants. Cosmetic randomness never changes rules.
- Replay envelope: schema version, build/content version, seed, initial hash, timestamp offset, ordered commands, periodic state hashes, terminal result.
- Validate all network input for identity, session membership, turn/tick, bounds, rate, payload size, and legal action. Reject duplicates idempotently by command ID.
- Treat client clocks, scores, inventories, roles, physics outcomes, and completion claims as untrusted in competitive contexts.

### Loading and resilience

- Show useful progress by asset group; load core rules/UI first and scenic assets lazily. Provide procedural low-detail substitutes if optional assets fail.
- Cache immutable hashed assets and the last safe local snapshot. Updates activate between rounds, never during one.
- Recover WebGL context by rebuilding GPU resources from retained CPU descriptors. If 3D is unavailable, present a clear compatibility message and preserve account/session state.
- Background tabs reduce rendering to zero or a low heartbeat while preserving required network lifecycle.

## 6. StarHermit integration

### Packaging and launch
- A StarHermit engine script game: `starhermit.txt` (`engine.api=1`, `engine.entry=native/main.ts`, `engine.version=1.21.0`, `engine.minor=23`, capabilities platform, storage, clipboard; `control.*` keys and `engine.gamepad.*` defaults per action; `server=server.js`). Browsers open `index.html`, the loader `npm run package` (`starhermit package --web .`) writes with `starhermit-files.json`; it pins the engine on wiki.starhermit.com. The StarHermit client plays the same package natively.
- Sign-in, the launch token, renewal and the account dialog are the runtime's. A guest sees **Sign in with StarHermit** on the title (`requestSignIn()`); signed in, **Invite a friend** copies the invite link with a confirmation toast. When the session ends, a toast says progress stays on this device.

### Identity, saves and preferences
- Signed in, the status bar shows "Playing as <name> · cloud <saving / synced / offline>".
- The save (`starhermit:storage` saves, schema 1) is the browser build's checksummed progress document (`js/progress.js`): stages (best score, won, attempts), lessons, daily bests, achievements, rating and the long-road total. It is kept on the device and in the player's cloud slot; two devices' saves merge on a conflict (per stage the best score, won if either won, the larger attempt count; lessons and achievements united; per day the better daily; the larger rating and long-road total). The slot the browser build wrote through the JS SDK (`game:<slug>`, the same document) is read as the foreign save once, merged in and replaced. Old browser localStorage progress of guests does not migrate (the engine cannot read it).
- The game's own options (colour palette, left-handed touch pad, haptics, tutorial hints) are engine settings synced with the account; the browser build's values in the account settings KV are adopted once (unless set since), then all of its keys (volumes, graphics, language and the rest) are removed. Haptics and tutorial hints are stored but, as in the browser build, change nothing.
- Volumes and mute, the voice limit, graphics, frame rate, language, larger text (UI scale), high contrast, reduced motion, key and pad rebinding and problem reports are the runtime's Options (Settings links to them with **Open Options** and **Key bindings**).

### Achievements and leaderboards
- Achievements (first claim, trail mechanic, on a roll, summit climber, the long road) stay inside the progress document, as before.
- Signed in, every finished Journey, Daily or Challenge round posts the local player's total (area + 50 per elimination): the client opens a practice session whose socket carries `{ type: 'result', scores: { 'high-score': n } }`; `server.js` range-checks it (0–100,000, integer; score-script.js's check) and returns it in `scores`. The results show "Leaderboard rank: #N" (or posted / not posted). Learn, Practice and hosted rounds post nothing.

### Hosted play
- Hosted Play (signed in) offers **Quick join** (an open room of this game; none open: "No open rooms right now") and **Create room** (one team of four seats, AI backfill). In a room the host sees **Start round** and everyone **Leave room**; the roster lists the players. Guests see a note that hosted play needs a StarHermit sign-in.
- Starting the room fills its empty seats with AI participants and binds a session running `server.js` (a room-bound session). The script is the authority: it waits until every human's game socket is open (at most 15 s), counts down 2.4 s, then runs the rules on its 8 Hz tick (one step per 125 ms of server time, at most four to catch up), steers each seat only from its own player's latest realtime input (`sendInput({ dir })`), plays the AI seats with the rules' bots, takes a player who left the room (or stayed offline for 30 s, or pressed Leave round) out of the round, ends the round when every human has left, and returns the result (reason, winner, standings) which the platform stores on the room. Every client sends `{ type: 'sync' }` on each (re)connection and draws the script's snapshots (owner and trail grids, players) with interpolation; the results say "Result recorded by the StarHermit server". Nothing a client says about the outcome is read.
- When the room goes away mid-round the hosted screen and a toast say so; when the player's session ends mid-room the **Your session expired** / **Your StarHermit terms need attention** screen offers **Back to StarHermit** (the account dialog) or **Play on this device**.
- Text chat and voice are not part of the game.

## 7. Content, economy, and retention

- Launch scope: tutorial sequence, at least 40 authored stages or equivalent procedural depth, daily challenge, practice, five visual themes, and a mastery track.
- Cosmetic rewards may alter materials, trails, board surrounds, ambience, or profile flourishes, but never hitboxes, timing windows, information, or power.
- Reward cadence: early feedback every session, meaningful unlock every 3–5 sessions, and long-term goals visible without manipulative countdowns.
- No real-money wagering, paid random rewards, forced advertising, energy pressure, punitive streak loss, or purchases that affect competitive outcomes.
- Notifications, if ever added by the host, are opt-in, frequency-capped, quiet-hour aware, and never use false urgency.

## 8. Analytics and privacy

Measure tutorial completion, first meaningful action time, session duration bands, level attempts, quit state, input modality, performance tier, reconnect success, and accessibility feature usage only in aggregate. Use random session identifiers, short retention, and explicit consent where required. Never collect message content, drawings, voice, private board notes, or exact pointer trails as analytics.

Success targets for the first public test: median first-play time under 20 seconds, tutorial completion above 80%, crash-free sessions above 99.5%, p95 input acknowledgment below 100 ms locally, and at least 95% of supported mobile sessions holding their selected frame-rate tier.

## 9. Testing and acceptance criteria

### Rules and content

- Unit-test every legal action, invalid-action reason, scoring component, terminal state, and serialization migration.
- Property-test deterministic replay: the same version, seed, and commands produce identical state hashes.
- Fuzz malformed commands and generated content; prove no hangs, NaN physics, impossible mandatory states, or unbounded loops.
- Golden-test representative easy, medium, hard, interrupted, resumed, and terminal sessions.

### Interface and accessibility

- Test pointer, coarse touch, keyboard-only, gamepad, screen reader, zoom to 200%, reduced motion, high contrast, safe areas, and both mobile orientations.
- Verify focus restoration after every modal, meaningful live announcements, no keyboard traps, and no hover-only instructions.
- Confirm all critical labels fit translated strings at 30% expansion and support right-to-left layout where localized.

### Graphics and performance

- Produce fixed-camera captures for every quality tier, deterministic seed sweeps, no-post baselines, debug-view mosaics, and 10-minute temporal stability runs.
- Profile CPU, GPU, memory, shader compilation, draw calls, triangles, texture memory, and garbage collection on representative desktop and mobile classes.
- Verify effects cannot obscure legal targets, alter picking, leak resources, or continue expensive updates while hidden.

### Platform and network

- Test expired/rotated tokens, privacy settings, rate limits, offline start, reconnect at each game state, duplicate commands, out-of-order events, server restart, and version mismatch.
- Verify achievement idempotency, leaderboard validation, friends-only filtering, cloud-save conflict handling, activity start/end pairing, and server-time countdown accuracy.
- For hosted sessions, test disconnect/rejoin, abandonment, timeout, invitation expiry, result reconciliation, replay access, moderation controls, and authoritative cheat attempts.

## 10. Definition of done and non-goals

This specification is ready for implementation when rules examples, content schema, wireframes for all responsive breakpoints, visual target frames, accessibility annotations, authoritative message schema, achievement definitions, leaderboard definitions, and performance test devices are approved.

This document does **not** authorize implementation, asset production, monetization work, native wrappers, real-money systems, or copying any existing product. The initial build should favor one excellent core loop and a coherent original visual identity over feature breadth.

## 11. The engine client as built

### Files
- `js/rules.js`, `js/session.js`, `js/content.js` — the browser build's rules (8 ticks a second), fixed-step session and content, unchanged; `js/strings.js`, `js/i18n.js`, `js/sh-i18n.js` — strings; `js/progress.js` — the progress document and options; `js/online.js` — hosted rooms (lobby and round clients).
- `native/main.ts` — the flow, modes, steering, round end, hosted play, lifecycle; `native/screens.ts` — the UI; `native/render.ts` — the board; `native/audio.ts`, `native/platform.ts`, `native/quality.ts`, `native/style.ts` (CSS in `tools/ui-style.css` → `assets/ui-style.json` by `npm run css`), `native/i18n.ts`, `native/game.ts` (typed facade).
- `server.js` — the one server script, built by `npm run server` from `tools/server-head.js`, `js/rules.js` and `tools/server-body.js`.

### Time
The runtime's fixed steps (60 a second) drive a game clock: the session's 8-tick clock (a tick every 7.5 steps), the 3-2-1 countdown (800 ms each, 400 ms with reduced motion), the title board (a step every 150 ms) and toasts, so rounds replay exactly. A hidden window (suspend) pauses a solo round on the pause screen; the player resumes deliberately. Hosted rounds keep running on the server.

### Controls
- Keys: arrows / WASD steer, Escape or P pauses (and resumes; closes Help, Settings and the drawers), U undoes in Practice, C refits the camera. Gamepads: the D-pad or left stick steers, Start pauses, West undoes, the right stick press resets the camera. Everything rebinds in the runtime's Options; F1 is the runtime's.
- Pointer and touch on the board: a swipe longer than 24 logical px turns toward its dominant axis; a quick tap turns toward the tapped cell relative to the marker. Presses the UI takes (`ui.pointerCaptured()`) never reach the board.
- On touch screens (and windows under 600 logical px wide) the touch pad (▲ ◀ ▶ ▼, 52 px, right side or left with Left-handed controls) sits above the Camera button.

### Screens and layout
- Status bar: rail toggles (☰ progress, ≡ status) below 1024 logical px, the title (ellipsized), the mode badge, the player line, the time left (hidden at 480 px and below), Help (?) and Settings (⚙). From 1024 px the progress rail (Journey stages, lessons, achievements, rating) and the status rail (each player's cells, out marks, the tick) sit beside the playfield; below they are drawers with a tap-outside scrim.
- HUD: the objective pill with Pause in its own column, the danger banner ("Trail exposed — get home!") beneath it while the local trail is out, Undo (Practice) and Camera at the bottom. The board mirror is a named label target over the playfield ("Tick N of M. You have … cells …").
- Screens inside the playfield: the title (Play — the Journey's first unwon stage; Daily Challenge — today's UTC date by the platform's clock; Learn; Hosted Play; Choose a mode; Sign in / Invite; the progress line), Choose a mode (Journey, Practice, Daily, Challenge, Learn and Hosted cards — the browser build drew this screen but never linked it; the title now opens it), setup (the Journey's 40 stages with Start for the first unwon one, Practice's three difficulties, the three Challenges or Learn's four lessons), the countdown, pause (Resume, Settings, Help, Restart, Leave round), results (headline, end reason and tick, score breakdown, standings, achievements, progress, leaderboard line; Retry / Next / Home, or Home / Hosted Play after a hosted round), hosted play and session expired; Help (rule cards with the effective keys) and Settings (the runtime's Options and key bindings, colour palette, left-handed controls, haptics, tutorial hints) open over them.

### Audio
The authored clips (`sfx/*.opus`) play per event on the effects bus (ui press, steer, invalid, footsteps alternating, claim, cut, eliminated, the exposed-trail warning, win, lose, countdown); the quiet ambience (low-passed noise, rendered once into a loop) plays on the music bus at the old ambience-to-effects ratio. The synthesized fallback blips are not ported (a clip still loading is silent).

### Checks
- `npm test`: the rules suite (`test/run-tests.js`), string, progress, server-script, online-client and Jint-sandbox tests (`tests/*.test.mjs`), and `tests/native.mjs` (web index current, `tsc`, `starhermit check` with no warnings, and the render-check play scripts in `tests/native/`: desktop menus and the Claim lesson by keys, a phone's first lesson by the touch pad, a landscape phone's drawer, Journey stage 1 to its results and stage 2 left from pause, and every mode from Choose a mode: a Journey stage from the list, Practice with a claim and Undo, a Challenge, the Daily, Learn and Hosted cards).
- `npm run test:online`: two runtimes on `--dev --local-platform` (alice hosts on a desktop, bob quick-joins on a phone) play a hosted round to the result server.js records.
- `npm run test:browser`: the web package in Chrome on the GPU at desktop, phone (DPR 3) and landscape phone (DPR 3): the Claim lesson by keys, the Daily paused and left, the first lesson by the touch pad and by swipes.

### Known limitations
- Rules behaviours kept as they were: a solo Journey stage with no rivals counts as won when time runs out (the lone player ranks first); a round's elimination winner is the last one alive even when another player scored more.
- Hosted rounds post no leaderboard scores (as before); late joiners cannot join a running round (rooms are not join-in-progress).
- The board's grid lines (Low) are one pixel wide, as WebGL lines are.

