// =============================================================================
// Territory Trail — the game's one authoritative server script (starhermit.txt
// `server=server.js`). The platform runs it in its sandboxed Jint host: a fresh
// engine per invocation, one classic script, no imports, no Date/Math.random,
// every bit of state in the documents it returns. The rules are the client's
// own js/rules.js, written into the RULES block below by
// tools/build-server.mjs (`npm run server`): edit tools/server-head.js and
// tools/server-body.js, not server.js.
//
// It runs two kinds of session:
//
// 1. Hosted rounds (room-bound sessions). A hosted room is a realtime room of
//    one team of four seats; when its host starts it the platform fills the
//    empty seats with AI participants and creates a session bound to it, and
//    calls createSession with `ctx.room` (the frozen roster, team then slot)
//    and `ctx.presence`. This script owns the whole round, as the browser
//    build's room host (the first seat's browser) did, but no client is
//    trusted: the 30×30 board (1000 ticks, area goal 120) runs on the
//    session's 8 Hz tick — one rules step per 125 ms of `ctx.now`, at most
//    four when ticks arrive late — every seat steers only from its own
//    player's latest realtime input (`ctx.inputs[i].from`, never a seat
//    named in the payload) through the rules' validated applyCommand, AI
//    seats (the platform's AI participants) are the rules' own bots, a
//    player who left the room or stayed offline for 30 s is out of the round,
//    and the end of the round is the session's `result` (stored on the room
//    by the platform). Nothing a client says about the outcome is read.
//
//    The round waits until every human's game socket is open (at most 15 s),
//    then counts down 2.4 s (the browser build's 3-2-1 at 800 ms).
//
//    Client → script:
//      realtime input { type: 'input', realtime: true, dir }   steer up/down/left/right
//      command { type: 'sync' }      the table and a snapshot, to the sender
//      command { type: 'forfeit' }   the sender leaves the round (Leave round)
//    Script → clients (`broadcast`):
//      { type: 'table', seats: [{ id, name, ai, userId }], width, height,
//        maxTicks, areaGoal }                                     on sync
//      { type: 'snap', k: tick, ph: 'waiting' | 'countdown' | 'active' |
//        'ended', cd: countdown ms left, c: owner per cell (digits, 0 empty),
//        t: trail owner per cell, p: [[x, y, dir, alive, area, eliminations,
//        trail length, invalid actions]], ev: [{ k: 'claim' | 'out', i, by }] }
//                                                                 every tick
//      { type: 'over', reason, winner, rank, players: [{ id, name, area,
//        eliminations, alive }], tick, maxTicks }                  at the end
//
// 2. Score posting (any other session — the practice session the client opens
//    with sessions.practice()): a finished Journey, Daily or Challenge round's
//    total arrives as { type: 'result', scores: { 'high-score': n } }; it is
//    range-checked against BOARDS, returned in `scores` and the session ends —
//    what the browser build's score-script.js did.
'use strict';
