# Online Feel (Guest Prediction + Smoothing) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guests' own player responds instantly and other players move smoothly, with the host still authoritative.

**Architecture:** Guest-only code in `blast-grid.html`: a snapshot buffer, an interpolated "display view" for other
players and moving bombs, and local prediction of the guest's own player with tolerant correction. Host/guest message
handlers become top-level functions so a two-context headless test can connect them with simulated latency.

**Tech Stack:** Vanilla JS; Node `node:test` + the existing `tests/harness.js` vm harness.

**Spec:** `docs/superpowers/specs/2026-11-13-online-feel-design.md`

## Global Constraints
- No change to the host simulation, snapshot contents/rate, or `ID_PREFIX`.
- Thresholds: moving 0.35 tiles, idle 0.03, snap 1.5; interpolation delay 40–160 ms; latency = ping + 25 ms.
- `npm test` green after every task.

## Review Focus
1. Steady walking with 60–140 ms random latency → guest speed on screen matches host speed (no rubber-banding) (Task 2 test `no rubber-banding under jitter`).
2. Guest blocked by a bomb it hadn't seen yet → ends at the host's position (Task 2 test `unseen bomb correction`).
3. Teleport / portal / round restart → snaps, no slide across the map (Task 2 test `big jumps snap`).
4. Guest dead, between rounds, or late-joined spectator → no prediction (Task 2 test `no prediction when not playing`).
5. Snapshots arriving out of order or in bursts → other players never jump backwards (Task 3 test `interpolation is monotonic under jitter`).

---

### Task 1: Handlers as functions + two-context network test rig
**Files:** Modify `blast-grid.html` (host `conn.on('data')`, guest `hostConn.on('data')`, `frame`); Create `tests/net.js`, `tests/net.test.js`.
**Interfaces:**
- Produces: `hostOnData(entry, d)`, `guestOnData(d)` (same behaviour as the inline handlers); `guestUpdate(now: ms, dt: s) -> view` returning the view to draw (Task 1: returns `view` unchanged); `frame` calls `render(mode === 'guest' ? guestUpdate(now, dt) : view, dt)`.
- Produces: `tests/net.js` `makeLink({ seed, latency: [minMs, maxMs], bots })` → `{ host, guest, step(ms), now() }`: host context in `'host'` mode with one guest entry whose `conn.send` queues JSON-cloned messages to the guest with latency; guest context in `'guest'` mode whose `hostConn.send` queues to the host; `step` advances both clocks in 1000/60 ms frames, delivers due messages, runs host `simStep()` and guest `guestUpdate`. Starts a match on SMALL with all crates removed around spawns for movement tests.
- [ ] Step 1: `tests/net.test.js` test `guest sees the host's world after start`: makeLink, step 500 ms → guest `view.ph` defined and `mySlot === 1`. Run → FAIL (`hostOnData is not defined`).
- [ ] Step 2: Implement the refactor + `guestUpdate` stub + `tests/net.js`. Run → PASS; full suite PASS.
- [ ] Step 3: Commit "Refactor network handlers into functions; two-context latency test rig".

### Task 2: Guest prediction with tolerant correction
**Files:** Modify `blast-grid.html` (new `// ================== GUEST SMOOTHING ==================` section; `guestOnData` 's' branch; `render` player positions); `tests/net.test.js`.
**Interfaces:**
- Produces: `PRED` (`null` or `{ x, y, dir, walk, offX, offY, hist: [{t,x,y}], pass: Set, known: Set, lastInput }`), `predictReset()`, `predictOnSnapshot(d, now)`, `predictStep(now, dt)`; `guestUpdate` returns a shallow copy of `view` with `p[mySlot]` x/y/dir/walk replaced by the predicted display position when `PRED` is active. `render` draws guest positions as given (drop the old exponential smoothing for guests).
- Tests (all through `makeLink`, latency 100 ms unless stated):
  - `own player moves before the host hears about it` — press right; after 50 ms guest display x of mySlot > start + 0.1 while host `S.players[1].x` == start.
  - `ends where the host is` — hold right 0.8 s, release, step 1 s → |guest x − host x| < 0.05 and same y.
  - `no rubber-banding under jitter` — latency 60–140 ms, hold right on an open row 1 s; guest displacement over the last 0.5 s within 10% of host speed × 0.5 s; positions sampled each frame never decrease.
  - `unseen bomb correction` — host drops a bomb (owner 0, pass empty) 2 tiles ahead of the guest just after the guest starts walking toward it; step 1.5 s → guest x within 0.05 of host x and guest x < bomb x − 0.5.
  - `big jumps snap` — host sets the guest's player 5 tiles away; within 100 ms + latency of the snapshot the guest display is within 0.05 of it.
  - `no prediction when not playing` — dead guest player / `round` phase: guest display == latest snapshot position.
- [ ] Steps: write tests → RED → implement → GREEN → suite → commit "Guest prediction: own player moves instantly, corrected only for real disagreements".

### Task 3: Interpolate other players and moving bombs
**Files:** Modify `blast-grid.html` (snapshot buffer in `guestOnData`, `guestUpdate`); `tests/net.test.js`.
**Interfaces:** `snapBuf: [{t, v}]`, `interpDelay` (ms), `interpView(now) -> { p, b }` used by `guestUpdate` for slots ≠ mySlot (or all slots when `PRED` is null) and for moving bombs.
- Tests:
  - `interpolation is monotonic under jitter` — host walks player 0 right steadily (scripted input); guest display x of slot 0 sampled every frame never decreases and no frame step exceeds 3 × (speed / 60).
  - `interpolation delay adapts` — with 30 Hz snapshots and ±20 ms jitter, `interpDelay` between 40 and 160.
  - `sliding bomb moves smoothly` — kicked bomb: guest display x of that bomb never decreases while sliding and steps ≤ 3 × (9 / 60).
- [ ] Steps: tests → RED → implement → GREEN → suite → commit "Smooth other players and moving bombs on guests".

### Task 4: Browser check
- [ ] Two Playwright tabs (host + guest, one bot) with the guest's network throttled is not possible over WebRTC in Playwright; instead run the guest tab and confirm no page errors, own player responsive (keyboard right → display moves within 2 frames), and `render` works with the display view. Commit any fixes.
