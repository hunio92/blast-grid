# Blast Grid — online feel (guest prediction + smoothing)

## Intent
Guests feel a delay of one full round trip before their own player moves, and other players jitter because they are
drawn at the latest snapshot. Make online play feel as responsive as playing on the host. Approved by the user after
the two fixes were described in chat ("merge it and then do this improvement").

## Goals
- A guest's own player moves on the frame the key/stick is pressed.
- The guest's own position ends up where the host has it (no lasting drift), and is corrected when the host disagrees
  for real (blocked by a bomb the guest didn't know about yet, kicked into, teleported, portal, death).
- Other players and moving (sliding / thrown) bombs move smoothly on guests.

## Non-goals
- Predicting bombs, explosions, pickups, kicks, teleports or deaths: the host stays the only authority.
- Changing the host simulation, the snapshot rate, or the network format (no `ID_PREFIX` bump).

## Anti-goals
- A guest being "pulled back" every snapshot while walking (rubber-banding) because of latency estimates.
- Walking through walls or bombs on the guest's screen for more than a moment.

## Approaches considered
- **Prediction with error-tolerant correction (picked).** The guest runs the same `movePlayer` code locally against the
  latest grid and bombs. On each snapshot it compares the host position with where the guest was about one round trip
  ago (a short position history). Small differences while moving are ignored (latency estimates are never exact);
  real ones are applied as a correction that is shown smoothly; jumps of more than 1.5 tiles snap. Once input has been
  idle for longer than the round trip, any difference over 0.03 tiles is corrected, so final positions match.
- **Full rewind-and-replay from acknowledged inputs.** Exact in theory, but the host applies held-key states per tick
  with network jitter, so replay needs per-tick input timing the protocol doesn't carry. Rejected: more protocol work
  for little visible gain at this game's speeds.

## Design
- Guest message handling moves into `guestOnData(d)`; host per-guest handling into `hostOnData(entry, d)` (pure
  refactor, so tests can drive a host and a guest in one process).
- Snapshot buffer on guests: arrival time + snapshot, last ~1 s.
- Interpolation delay adapts to snapshot arrival: average gap + 2 × its deviation + 10 ms, clamped to 40–160 ms.
  Other players: positions interpolated between the two snapshots around `now − delay`. Moving bombs: matched by owner
  and distance (< 1.6 tiles) between those snapshots and interpolated. Everything else (grid, flames, items, HUD, alive
  flags) comes from the latest snapshot.
- Prediction runs only while the round is in `play`/`grace`, the guest's player is alive and not a late joiner;
  otherwise the guest's player is drawn like the others. Fixed 60 Hz sub-steps; uses live local input (`dirState(0)`,
  keys + touch), speed/curse/ghost/wall-pass from the latest snapshot; kick disabled in prediction.
- Bomb walk-off: a bomb first seen while the predicted player overlaps its tile can be walked off (like the host's
  `pass`), until the player leaves that tile.
- Correction thresholds: moving 0.35 tiles, idle 0.03 tiles, snap 1.5 tiles; corrections shift the position history
  too (no double counting) and the shown position eases to the corrected one over ~100 ms.
- Latency estimate: measured ping (already tracked) + 25 ms (host tick + snapshot interval).

## Left to the builder
- Exact history length and easing constant.
