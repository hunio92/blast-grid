# Bots, Match Settings, Touch Controls, Small Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bots with per-bot difficulty, host match settings, phone-landscape touch controls, and fix six small bugs in Blast Grid.

**Architecture:** Everything stays inside `blast-grid.html` (one inline `<script>`). Bots run on the host/offline sim and
write the same input objects humans produce into `inputs[slot]`, so the network layer is untouched apart from new
lobby/snapshot fields. A dependency-free Node test harness loads the inline script into a `vm` context with DOM stubs so
simulation, settings and bot logic can be tested headlessly; touch layout is checked in a real browser via Playwright.

**Tech Stack:** Vanilla JS + Canvas 2D, PeerJS 1.5.4 (CDN), Node 24 built-in `node:test` + `node:vm` for tests.

**Spec:** `docs/superpowers/specs/2026-11-13-bots-settings-touch-design.md`

## Global Constraints

- Single file: all game code stays in `blast-grid.html`; no build step, no new runtime dependencies.
- Network format changes → `ID_PREFIX = 'blastgrid-v6-'`.
- Max 4 players per match (humans + bots).
- Bot levels are exactly `'easy' | 'normal' | 'hard'`, shown as EASY / NORMAL / HARD.
- Settings choices exactly: wins 1–5 (default 3); round time AUTO / 1:30 / 2:30 / 4:00 (default AUTO = map default
  150/200/250 s); crates FEW 0.55 / NORMAL 0.75 / MANY 0.9 (default NORMAL); every power-up toggle default on.
- Bots never read opponents' hidden mines or invisible (`invis > 0`) opponents.
- Touch target: phones held sideways; portrait during a match shows a "turn your phone sideways" overlay.
- Tests: `node --test tests/` must pass after every task.

## Review Focus

1. Guest joins a lobby that is already full of host + bots → last bot removed, guest gets a slot (Task 4 test `guest join evicts last bot`).
2. All power-ups toggled off → crates drop nothing and the round still plays (Task 3 test `no power-ups enabled`).
3. Bot trapped with no escape (boxed in by its own bomb) → no exception, bot keeps returning valid inputs (Task 4 test `trapped bot does not throw`).
4. Rematch (R / REMATCH button) after settings changed in an earlier lobby → new match uses the settings stored in `M`, bots keep their slots and levels (Task 4 test `rematch keeps bots`).
5. Touch device rotated to portrait mid-match → game keeps running under the rotate overlay; rotating back resumes with no stuck direction (Task 5 browser check step).

---

### Task 1: Headless test harness

**Files:**
- Create: `tests/harness.js`
- Create: `tests/smoke.test.js`
- Create: `package.json` (only `{"private":true,"scripts":{"test":"node --test tests/"}}`)

**Interfaces:**
- Produces: `loadGame() -> { run(code: string): any, ctx }` in `tests/harness.js`. `run` evaluates code in the same
  vm context as the game script, so top-level `let/const` (`S`, `M`, `mode`, `inputs`, `tick`, `newRound`, …) are
  readable and assignable. `loadGame()` returns a fresh context every call.
- Produces: `startLocal(run, opts?)` helper in `tests/harness.js` that sets up an offline match without the DOM click
  path: sets `mode='local'`, builds `M` via `newPl`, calls `applyMapSize()` (or the Task 3 settings equivalent) and
  `newRound()`, sets `started=true`. Task 3 extends it to accept `{ humans, bots: [level…], set }`.

- [ ] **Step 1: Write `tests/smoke.test.js`**

```js
const test = require('node:test'), assert = require('node:assert');
const { loadGame, startLocal } = require('./harness');
test('local match runs 20s of ticks without throwing', () => {
  const { run } = loadGame();
  startLocal(run);
  run('S.phase = "play"; for (let i = 0; i < 1200; i++) tick(1/60);');
  assert.ok(['play', 'grace', 'round', 'match', 'count'].includes(run('S.phase')));
});
test('a bomb placed by P1 explodes after FUSE', () => {
  const { run } = loadGame();
  startLocal(run);
  run('S.phase = "play"; placeBomb(S.players[0]);');
  assert.strictEqual(run('S.bombs.length'), 1);
  run('for (let i = 0; i < Math.ceil(FUSE * 60) + 2; i++) tick(1/60);');
  assert.strictEqual(run('S.bombs.length'), 0);
  assert.ok(run('S.flames.size') > 0);
});
```

- [ ] **Step 2: Run `node --test tests/` — expect FAIL (`Cannot find module './harness'`).**

- [ ] **Step 3: Implement `tests/harness.js`**

Read `blast-grid.html`, take the body of the `<script>` tag that has no `src`. Context stubs: `document`
(`querySelector`/`getElementById`/`createElement` return a stub element; `querySelectorAll` returns `[]`;
`documentElement.style.setProperty` no-op; `body` stub), stub element = object with `value`, `textContent`,
`innerHTML`, `style` (with `setProperty`), `dataset`, `classList {add,remove,toggle,contains}`, `appendChild`,
`addEventListener`, `getContext()` → canvas-context Proxy (every method a no-op, `measureText` → `{width:0}`,
`createRadialGradient` → `{addColorStop(){}}`, property sets accepted). Globals: `addEventListener` no-op,
`localStorage` (Map-backed), `performance`, `requestAnimationFrame` no-op, `setInterval`/`setTimeout` no-op returning 0,
`clearTimeout`, `confirm: () => true`, `matchMedia: () => ({ matches: false, addEventListener(){} })`,
`navigator: {}`, `URL`, `Blob`, no `Worker` (game falls back to `setInterval`, which is stubbed). Run via
`vm.createContext` + `vm.runInContext(script, ctx)`; `run(code)` = `vm.runInContext(code, ctx)`.

- [ ] **Step 4: Run `node --test tests/` — expect 2 passing tests.**

- [ ] **Step 5: Commit** — `git add tests package.json && git commit -m "Add headless test harness for the game simulation"`

---

### Task 2: Small fixes

**Files:**
- Modify: `blast-grid.html` (constants ~line 195–239, `tick` ~576, `snapshot` ~660–677, keyboard handlers ~782–801, `sfx` ~838, `drawPU` ~915, `render` ~1161–1176, `recordMatch` ~1226)
- Create: `tests/fixes.test.js`

**Interfaces:**
- Produces: snapshot player tuple **without** the frozen field. New index layout (used by `render`, `updateHUD`, Task 4/5):
  `[0 x, 1 y, 2 alive, 3 dir, 4 walk, 5 deathT, 6 maxBombs, 7 range, 8 speed, 9 kick, 10 ghost, 11 tele, 12 flags,
  13 power, 14 hp, 15 inv, 16 curse, 17 curseSecs, 18 invis, 19 flags2(glove|star), 20 mines, 21 softT]`.
- Produces: `ID_PREFIX = 'blastgrid-v6-'`.
- Produces: `muted` loaded from / saved to localStorage key `bg-mute` (`'1'`/`'0'`).

- [ ] **Step 1: Write `tests/fixes.test.js`**

```js
test('no freeze leftovers', () => {           // source-level check
  const src = fs.readFileSync('blast-grid.html', 'utf8');
  for (const s of ['FREEZE_TIME', 'frozen', "'freeze'", "type === 'z'"]) assert.ok(!src.includes(s), s);
});
test('snapshot player tuple has 22 fields', () => { /* startLocal; run('snapshot().p[0].length') === 22 */ });
test('kicked bomb slides over a hidden mine', () => {
  // startLocal; clear row y=1 of crates; mine owned by P2 at (4,1); bomb at (2,1);
  // P1 has kick, call tryKick(S.players[0], 2, 1, 1, 0) then tick until bomb stops:
  // assert bomb.x > 4 (passed the mine) and the mine still exists
});
test('a blast sets off another bomb on the same tile', () => {
  // mine at (3,1) and bomb at (3,1); explode(bomb) → both dead after filter
});
test('mute is saved', () => { /* simulate KeyM keydown via the registered handler, then localStorage.getItem('bg-mute') === '1' */ });
test('recordMatch parses bg-seen at most once per match id', () => {
  // wrap localStorage.getItem with a counter; call recordMatch(v) 10× with the same v.mid → getItem('bg-seen') called ≤ 1
});
```

For the keyboard test the harness's `addEventListener` stub must record handlers: store them in
`ctx.__listeners[type]` (extend Task 1 harness).

- [ ] **Step 2: Run `node --test tests/` — expect the new tests to FAIL.**

- [ ] **Step 3: Implement**
  - Delete freeze: `FREEZE_TIME`, `frozen` in `makePlayer`, the `p.frozen` block in `tick`, frozen in snapshot, `'freeze'` sfx, `'z'` icon and colour entry, ice-block render, HUD ❄️ span. Re-index `render`/`updateHUD` reads to the layout above.
  - `recordMatch`: keep `let lastRecordedMid = null`; return immediately when `v.mid === lastRecordedMid`; set it after the storage check.
  - `blur` listener also sets `boardHeld = false`.
  - `muted` initialised from `bg-mute`; toggling saves it.
  - `bombFree`: ignore bombs with `q.mine`. `explode`: after the 4/8-direction loop, explode any other non-dead bomb with the same `x,y`.
  - Bump `ID_PREFIX` to `'blastgrid-v6-'`.

- [ ] **Step 4: Run `node --test tests/` — all pass. Open `blast-grid.html` in a browser, play a same-keyboard round: HUD and sprites render, M toggles sound and survives reload.**

- [ ] **Step 5: Commit** — `git commit -am "Fix small bugs: freeze leftovers, mine reveal, per-frame storage reads, sticky TAB board, mute not saved"`

---

### Task 3: Lobby for every mode + match settings

**Files:**
- Modify: `blast-grid.html` (menu/lobby HTML + CSS, `SIZES`/`mapSize`, `newRound`, `randPU`/`PU_TABLE`, `snapshot`, `updateHUD`, `renderLobby`, `startMatch`, `$('#btnLocal')`, guest `'lobby'` handler)
- Create: `tests/settings.test.js`
- Modify: `tests/harness.js` (`startLocal` accepts `{ humans = 2, bots = [], set }`)

**Interfaces:**
- Produces: `DEFAULT_SET = { size: 'M', wins: 3, time: 'auto', crates: 'normal', off: [] }` — `off` = array of disabled power-up letters. `let SET` loaded from localStorage `bg-set` (merged over defaults, validated), saved by `saveSet()`.
- Produces: `TIME_OPTS = { auto: null, 90: 90, 150: 150, 240: 240 }`, `CRATE_P = { few: 0.55, normal: 0.75, many: 0.9 }`.
- Produces: `roundTimeFor(set) -> number` (auto → `SIZES[set.size].time`).
- Produces: `M.set` — a copy of `SET` frozen at match start; `M.target = M.set.wins`. `newRound` uses `M.set` for crate chance and `puTableFor(M.set.off) -> [[letter, weight], …]` for drops (empty table → `hidden` gets nothing).
- Produces: snapshot field `wt` (wins target); HUD stars use `v.wt`.
- Produces: lobby model `lobbyList() -> [{ name, kind: 'host'|'guest'|'local'|'bot', level? }]`; offline state `localP2: boolean`, `lobbyBots: [{ level }]` (Task 4 fills in bot add/remove UI; this task renders `kind: 'bot'` rows read-only if present).
- Produces: lobby network message `{ t: 'lobby', players: [{ name, bot? }], set: SET }`; guests render settings disabled.
- Produces: menu buttons `#btnBots` (PLAY VS BOTS → offline lobby, `localP2=false`, `lobbyBots=[{level:'normal'}]`) and `#btnLocal` (SAME KEYBOARD → offline lobby, `localP2=true`, `lobbyBots=[]`). Map-size picker removed from the menu, rendered inside the lobby settings block `#setBox`. `mode = 'local'` for both offline entries; `localHumans = localP2 ? 2 : 1`.
- Produces: in offline mode with one human, `dirState(0)` reads both key columns (like online).

- [ ] **Step 1: Write `tests/settings.test.js`**

```js
test('crate density follows the setting', () => {
  // for few/normal/many: startLocal({ set: { crates } }) 5×, average share of '+' among non-safe '.' cells
  // within ±0.08 of 0.55 / 0.75 / 0.9
});
test('no power-ups enabled', () => {
  // set.off = every letter → newRound: S.hidden.size === 0; run 10s of ticks with bombs placed — no throw
});
test('disabled power-ups never drop', () => {
  // set.off = everything except 'k' → 20 rounds: every S.hidden value === 'k'
});
test('round time and wins target', () => {
  // { size: 'S', time: 'auto' } → S.time === 150; { time: '240' } → 240; { wins: 5 } → M.target === 5 and snapshot().wt === 5
});
test('settings persist and bad saved values fall back to defaults', () => {
  // localStorage bg-set = '{"wins":99,"crates":"lots"}' before load → SET.wins === 3, SET.crates === 'normal'
});
test('one human offline: both key columns move P1', () => {
  // localP2 = false; keys.add('ArrowLeft'); dirState(0).left === true
});
```

- [ ] **Step 2: Run tests — new ones FAIL.**

- [ ] **Step 3: Implement** settings state, `puTableFor`, `roundTimeFor`, `M.set`, `wt`; lobby HTML: players list, `#setBox` with segmented controls (size, wins 1–5, time, crates) and a power-up icon grid (toggle buttons, emoji from the POWER-UPS screen); START/LEAVE work for offline mode; guests see `#setBox` with all buttons `disabled`. Rematch reuses `M.set`.

- [ ] **Step 4: Run tests — all pass. Browser check: host a room in one tab, join in another; change settings on host → guest lobby updates; start → round time/crates/wins match; PLAY VS BOTS and SAME KEYBOARD reach the lobby and start.**

- [ ] **Step 5: Commit** — `git commit -am "Match settings in the lobby; lobby used for offline modes too"`

---

### Task 4: Bots

**Files:**
- Modify: `blast-grid.html` (new `// ================== BOTS ==================` section after the simulation; `newPl`, `tick`, `startMatch`, `hotJoin`, `renderLobby`, `recordMatch`, `updateHUD`, `drawBoard`)
- Create: `tests/bots.test.js`

**Interfaces:**
- Consumes: `lobbyBots`, `lobbyList()`, `M.set` from Task 3; snapshot layout from Task 2.
- Produces: `newPl(name, keep, bot?)` — `M.players[i].bot` is `'easy'|'normal'|'hard'` or `undefined`.
- Produces: `BOT_LEVELS = { easy: { react: 0.5, chain: false, avoidBad: false, hunt: 0.1, remote: false, tele: false }, normal: { react: 0.25, chain: true, avoidBad: true, hunt: 0.5, remote: true, tele: false }, hard: { react: 0.08, chain: true, avoidBad: true, hunt: 1, remote: true, tele: true } }`.
- Produces: `dangerMap(forSlot: number, chain: boolean) -> Float32Array(W*H)` — seconds until each tile burns (`0` = burning now, `Infinity` = safe). Includes non-mine bombs (thrown bombs at their landing tile), the bot's own mines only, current flames, and the next sudden-death spiral tiles when `S.time <= 0` (time = position in queue × `S.sdStep`).
- Produces: `botThink(p, dt)` — called from `tick` for every alive bot during `'play'`/`'grace'` before the player loop; writes `inputs[p.slot]` (same shape as human input, incrementing `bombSeq`/`teleSeq`/`detSeq` to press). Per-bot memory in `S.bots[slot] = { t, goal, path, in }`; re-plans when `t <= 0` (then `t = level.react`), but steers along the current path every tick.
- Decision order per think (from spec): escape if in danger → else goal (good power-up / crate-adjacent tile / opponent by `hunt` chance) → drop bomb only if `canEscapeAfterBomb(p)` → never path into a tile whose burn time overlaps arrival (arrival = steps / speed, margin 0.35 s; EASY ignores burn times > 1.2 s).
- Lobby: `+ ADD BOT` (disabled at 4 players), click a bot row cycles level, ✖ removes; host lobby message includes bots. Guest joining a full lobby → last bot removed (host side, in `conn.on('open')`). Bot names `BOT 1…`; HUD/board show the level after the name (e.g. `BOT 1 · HARD`).
- `recordMatch` skips players whose `M.players[i].bot` is set (needs a snapshot field `bt: M.players.map(q => q.bot || '')`) and records nothing when `mode === 'local' && localHumans === 2`.

- [ ] **Step 1: Write `tests/bots.test.js`**

```js
test('dangerMap marks a bomb cross with its fuse and leaves other tiles safe', () => {
  // bomb range 2 at (3,3) fuse 2 on a cleared map → danger[idx(3,3)], [idx(5,3)] ≈ 2; [idx(6,3)] === Infinity
});
test('chain reaction shortens the second bomb time when chain = true only', () => {});
test('bot walks out of its own bomb blast', () => {
  // 1 human (idle) + 1 hard bot, bot placeBomb at spawn; tick 4s; bot alive
});
for (const level of ['easy', 'normal', 'hard']) test(`${level} bot survives 60s alone with crates`, () => {
  // startLocal({ humans: 1, bots: [level] }), human P1 frozen far away (stays in corner, never bombs), S.time huge;
  // tick 60s → bot alive for normal/hard; for easy assert only "no throw" and ≥ 1 crate destroyed
});
test('bot breaks crates and picks up items', () => { /* hard bot, 60s: M.players[1].crates > 5 */ });
test('4 bots finish a match', () => { /* humans: 0 + 4 bots (allowed in tests), tick up to 15 min sim time → S.phase === 'match' */ });
test('trapped bot does not throw', () => {
  // bot boxed in by crates on all 4 sides with its own bomb under it → 5s of ticks, inputs[slot] stays an object
});
test('bots ignore invisible players and hidden enemy mines', () => {
  // human invis > 0 at distance 3 in line: hard bot does not path toward the human; enemy mine on bot's path is not in dangerMap(bot)
});
test('guest join evicts last bot', () => {
  // mode = 'host', lobbyBots = 3 bots, simulate conn open → lobbyBots.length === 2
});
test('rematch keeps bots', () => {
  // offline: 1 human + normal + hard; finish match (set wins), startMatch() → M.players[1].bot === 'normal', [2] === 'hard'
});
test('bots are not recorded on the all-time board', () => {});
```

- [ ] **Step 2: Run tests — new ones FAIL.**

- [ ] **Step 3: Implement `dangerMap`, `canEscapeAfterBomb(p) -> boolean`, `botPath(p, danger, goalFn) -> [tileIdx…] | null` (BFS over tiles passable for `p` per `blocked`), `botThink`, lobby bot UI, slot assignment (`startMatch`: host → guests → bots; offline: humans → bots), `hotJoin` unchanged except bots count as taken slots.**

Steering: next path tile's centre; press the axis toward it (corner-assist in `step` does alignment); release when within `0.08` of the final tile centre. Remote: when `level.remote` and any opponent tile has `danger` from own remote bomb ≤ its range and the bot's tile is safe → `detSeq++`. Teleport: when `level.tele`, in danger, `botPath` returns null and `p.tele > 0` → face the direction whose landing tile (per `teleport`) is safe, `teleSeq++`.

- [ ] **Step 4: Run tests — all pass. Browser check: PLAY VS BOTS with one of each level on LARGE; watch a full match — bots move smoothly, rarely self-kill on NORMAL, almost never on HARD; HARD visibly chases.**

- [ ] **Step 5: Commit** — `git commit -am "Bots with EASY/NORMAL/HARD difficulty, usable online and offline"`

---

### Task 5: Touch controls (phone, landscape)

**Files:**
- Modify: `blast-grid.html` (viewport meta, CSS, `#game` HTML, input section, `enterGame`)
- Create: `tests/touch.test.js`

**Interfaces:**
- Consumes: `localIn[0]`, `dirState`, `sendGuestInput`, `startMatch`, `toMenu`, `boardHeld`, `muted` + `bg-mute` save from Task 2.
- Produces: `touchDir = { up, down, left, right }` merged (OR) into `dirState(0)`; `touchPress(act: 'bomb'|'tele'|'det')` increments the matching `localIn[0]` seq and calls `sendGuestInput()`; `setTouchStick(dx, dy)` sets `touchDir` (dead zone 0.35 of the stick radius, 4-way by dominant axis, sets `localIn[0].pri`).
- Produces: `document.body.classList` `touch` when `matchMedia('(pointer: coarse)').matches` or on first `touchstart`.
- DOM: `#touch` overlay inside `#game` with `#stickZone` (left 45% of screen), `#tBomb`, `#tTele`, `#tDet`; top bar `#tbar` with SCORES (hold), SOUND, REMATCH (visible only when `view.ph === 'match'` and not guest), QUIT; `#rotate` overlay shown by CSS `@media (orientation: portrait)` when `body.touch` and the game is visible.
- Layout (body.touch, landscape): canvas sized by height (`calc(100vh - 40px)` × `--ar`, capped by width), HUD compressed to a single 32px strip (name dot, ★, 💣/🔥/⚡ only), foot hidden; `touch-action: none` on `#game`; viewport `maximum-scale=1, user-scalable=no`. Menus/lobby: `.panel` `max-height: 100vh; overflow: auto`.

- [ ] **Step 1: Write `tests/touch.test.js`**

```js
test('stick right beyond dead zone → right only, pri h', () => { /* setTouchStick(0.8, 0.2) → dirState(0).right && !up && !down */ });
test('stick inside dead zone → no direction', () => { /* setTouchStick(0.2, 0.1) */ });
test('bomb button presses once per tap', () => { /* touchPress('bomb') ×2 → localIn[0].bombSeq increased by 2 */ });
test('touch drives player 1 in a same-keyboard match', () => { /* localP2 true; setTouchStick(-1,0); dirState(0).left */ });
```

- [ ] **Step 2: Run tests — FAIL.**

- [ ] **Step 3: Implement** touch state + handlers (`pointerdown/move/up/cancel` with pointer capture; stick origin = first touch point in `#stickZone`, radius 60 px; visual knob), buttons, top bar, rotate overlay, landscape CSS; clear `touchDir` on `blur`, `pointercancel`, and when `#rotate` becomes visible (`matchMedia('(orientation: portrait)')` change).

- [ ] **Step 4: Run tests — pass. Browser check with Playwright: emulate a touch phone at 844×390 landscape (hasTouch, isMobile), open `blast-grid.html`, PLAY VS BOTS → START; screenshot: whole map visible, stick zone left, BOMB/TELE/DET right, nothing covers the map centre; tap BOMB → a bomb appears; resize to 390×844 → rotate overlay shown; back to landscape → overlay gone, player not moving.**

- [ ] **Step 5: Commit** — `git commit -am "Touch controls for phones held sideways"`

---

### Task 6: Final pass

- [ ] **Step 1:** Update the POWER-UPS screen and lobby hint texts (mention bots, settings, touch); keep `index.html` redirect unchanged.
- [ ] **Step 2:** `node --test tests/` — all pass.
- [ ] **Step 3:** Two-tab online check (host + guest, one bot): settings visible to guest, bot plays, guest sees bot as `BOT 1 · NORMAL`, match ends and all-time board on both tabs records only humans.
- [ ] **Step 4:** Commit — `git commit -am "Update in-game help for bots, settings and touch"`
