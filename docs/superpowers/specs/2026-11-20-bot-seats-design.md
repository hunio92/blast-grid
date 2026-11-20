# Blast Grid — bots give up seats to joiners and take them back

## Intent
When the host fills an online match with bots, colleagues should be able to drop in and out at any time: someone who
joins takes a bot's seat, and when they leave that bot comes back. The table stays the size the host set up.

## Goals
- Hot join into a match that is full only because of bots: the joiner takes the seat of the bot in the highest seat.
- A leaver who bumped a bot gives that same bot (name, difficulty, score) back; it takes over their character where it
  stands, so the round carries on.
- Lobby behaves the same: a guest who leaves gives back the bot their arrival hid.

## Non-goals / anti-goals
- A leaver who did not bump a bot leaves an empty seat, as today (user picked option A: only bumped bots come back).
  A 1v1 with no bots still ends when the colleague leaves.
- A joiner never inherits a bot's wins. Four humans is still "full".
- No network message changes (no `ID_PREFIX` bump).

## Approaches
- **Seat remembers the bot it replaced (picked).** The human's match record holds the bumped bot record (`bumped`);
  on leave it is put back in the seat. Keeps the bot's name and score.
- Counting the host's chosen bots and re-spawning fresh ones: loses which bot was where and its score.

## Design
- **Lobby:** `lobbyBots` stays the host's configured list; only the first `MAX_PLAYERS − humans` are seated (shown,
  sent to guests, started). A guest joining hides the last bot; leaving shows it again. Room is full only with 4 humans.
- **Match start / rematch:** seated bots as above; each hidden bot is attached as `bumped` to a guest's record
  (last guests first), so a guest who leaves mid-match brings it back.
- **hotJoin seat choice:** (1) a free seat left under their name (today's rejoin); (2) their old seat if a bot now sits
  in it; (3) any free left seat; (4) a new seat if under 4; (5) the highest bot seat. Taking a bot's seat stores the
  bot record as `bumped`, removes the bot's character at once (no death animation, no kill), clears its brain
  (`S.bots[slot]`). Joiner plays from next round (or now during the countdown), like today's late join.
- **Leave mid-match, with `bumped`:** the leaver's record is stashed in `M.away[name] = { rec, seat }` and the bot
  record goes back into the seat; the character stays alive and the bot drives it (fresh `S.bots[slot]`).
  Rejoining under that name restores `rec`'s stats. **Without `bumped`:** unchanged (seat marked left, character dies).
- Guests see the swap through the existing snapshot fields (`names`, `bt`, `con`); the HUD is refreshed (`hudKey = ''`).

## Left to the builder
- Which guest gets which hidden bot at match start (any stable order).
