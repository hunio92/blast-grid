# Blast Grid — bots, match settings, touch controls, small fixes

## Intent
Make Blast Grid playable when colleagues aren't around (bots, with selectable difficulty), let the host tune a match
(settings), make it playable without a keyboard (touch), and clear the small bugs found in review.
Everything stays in the single `blast-grid.html` file, opened directly in a browser.

## Goals
- Bots that can fill slots online and in offline matches, each with its own difficulty (EASY / NORMAL / HARD).
- Host-controlled match settings that guests can see.
- On-screen touch controls good enough to play a full match on a phone or tablet.
- Fix the six small bugs listed below.

## Non-goals
- Host migration, client-side prediction, gamepad support (separate work).
- A bot that is "optimal". Bots should be fun to play against, not perfect.

## Anti-goals
- Bots that cheat (seeing hidden mines or invisible players) or freeze the game.
- Settings that let guests and host disagree about the rules.
- Touch controls that cover the middle of the map.

## Approaches considered
- **Bots: host-side input generators (picked).** A bot writes the same `{up,down,left,right,bombSeq,teleSeq,detSeq}`
  input a human would into `inputs[slot]` each tick. The simulation, snapshots and guests don't change.
  The alternative, a bot that moves the player directly, would duplicate the movement and collision rules and drift
  from what humans can do.
- **Touch: floating joystick + buttons (picked).** Touch anywhere on the left side to start a joystick there;
  BOMB / TELE / DET buttons at bottom-right. A fixed 4-button d-pad was the alternative; it's easier to miss on glass.

## Design

### Lobby becomes the setup screen for every mode
- **HOST ONLINE GAME** → lobby as today.
- **PLAY VS BOTS** (new menu button) → lobby in offline mode with you + one NORMAL bot.
- **2 PLAYERS · SAME KEYBOARD** → lobby in offline mode with P1 + P2.
- The lobby has **+ ADD BOT** (up to 4 players total). Click a bot's row to cycle EASY → NORMAL → HARD;
  its ✖ removes it. Offline, P2 can also be added or removed.
- Online, if a guest joins a full lobby, the last bot is removed to make room. Mid-match joins with no free slot are
  still rejected.
- The map size picker moves from the main menu into the lobby settings (it was always a host-only setting).

### Match settings (host / offline only; guests see them read-only)
| Setting | Choices | Default |
|---|---|---|
| Map size | CLASSIC 15×13 / LARGE 21×17 / HUGE 27×19 | last used |
| Wins to take the match | 1 – 5 | 3 |
| Round time | AUTO (map default) / 1:30 / 2:30 / 4:00 | AUTO |
| Crates | FEW (55%) / NORMAL (75%) / MANY (90%) | NORMAL |
| Power-ups | each one on/off (icon grid) | all on |

- Saved per browser; sent to guests in the lobby message and in snapshots (wins target is used by the HUD stars).
- Power-up toggles filter the drop table; if every power-up is off, crates drop nothing.

### Bots
- Bots think on the host only, once per "reaction" interval, and press keys like a player.
- Each think: build a danger map (every bomb's blast tiles and when they go off, including chain reactions; current
  flames; tiles about to be filled by sudden death), then:
  1. If standing in danger → walk the shortest path to a safe tile, avoiding tiles that will burn before it gets past.
  2. Otherwise pick a goal: a nearby good power-up, a spot next to crates, or (by difficulty) an opponent.
  3. Drop a bomb only if, with that bomb added, there is still a safe escape reachable in time.
  4. Never step into a tile that will be burning when it gets there.
- Bots don't see opponents' hidden mines or invisible players.

| | EASY | NORMAL | HARD |
|---|---|---|---|
| Reaction time | ~0.5 s | ~0.25 s | ~0.08 s |
| Chain reactions in danger map | no | yes | yes |
| Avoids bad items (↓, skull) | no | yes | yes |
| Hunts players | rarely | bombs players within reach | actively chases, prefers spots that cut off escape |
| Remote detonate | no | when an opponent is in the blast | when an opponent is in the blast |
| Teleport | no | no | to escape when trapped |

- Kick, ghost, wall pass, star and pierce work for bots automatically through the normal rules. HARD bots plan
  around them where it's simple to do.
- Bot names: "BOT 1"… with difficulty shown in the lobby and HUD.

### Touch controls
- Target: **phones held sideways (landscape)** — decided by the user. Tablets get the same layout.
- Appear on touch devices (`pointer: coarse` or first touch). One human per device.
- Left side: floating joystick (appears under your thumb; 4-way, with a dead zone).
- Right side: big BOMB button, smaller TELE and DET buttons.
- Small top bar buttons replace keys: SCORES (hold), SOUND, REMATCH (when the match is over), QUIT.
- Page zoom and scroll are disabled during play. Landscape: the map fills the height, the HUD shrinks to a thin
  strip, and the controls overlay the left and right edges. Portrait during a match shows a "turn your phone
  sideways" message (the match keeps running underneath).
- Menus and the lobby must be usable on a sideways phone (scrollable panels, no hover-only actions).
- In same-keyboard matches, touch controls player 1.

### Small fixes
1. `recordMatch` runs every frame on the match-end screen → remember the last recorded match id.
2. Scoreboard sticks open after alt-tab while holding TAB → clear on window blur.
3. Remove the leftover freeze power-up code (state, snapshot field, sound, icon, ice rendering).
4. All-time board: only real players are recorded (bots skipped); same-keyboard matches are not recorded.
5. Mute (M) is saved per browser.
6. A kicked or thrown bomb no longer stops at a hidden mine (which revealed it). It passes over; a bomb blast on a
   tile also sets off anything else on that tile.

### Network
- Snapshot and lobby formats change → bump `ID_PREFIX` to `blastgrid-v6-` so old and new versions don't mix.

## Left to the builder
- Exact bot path-scoring weights and timing margins.
- Exact touch control sizes, colors and layout breakpoints.
