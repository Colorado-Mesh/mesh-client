# Reticulum Games — Ratspeak parity checklist

Living matrix for [issue #773](https://github.com/Colorado-Mesh/mesh-client/issues/773). Wire protocol is [lrgp-rs](https://github.com/ratspeak/lrgp-rs) (LRGP v1). Product surface reference is Ratspeak:

- `crates/ratspeak-tauri/src/commands/games.rs`
- `dashboard/static/js/games_tab.js`

Update this file when Games PRs land. `pnpm run update` warns only when a **published** Ratspeak GitHub Release is newer than the `reviewed-ref` pin on the `games-parity` entry in `scripts/update.sh` (bump that pin after review). Tags, `main`, and RCs without a GitHub Release are ignored.

**Last review:** 2026-08-28 (Ratspeak v1.0.31 — voice message reliability; no Games API or `games_tab.js` delta vs v1.0.30. **Four in a Row UI landed in mesh-client**: `FourInARowBoard` + optimistic column drop, so the last outstanding Games parity gap is closed). Prior: 2026-08-26 (Ratspeak v1.0.30 — message reactions/replies/selection + BLE RNode reconnect/mobile pairing; no Games API delta vs v1.0.28).

Status: `done` | `partial` | `wontfix` | `todo`

## Commands / API

| Ratspeak command          | mesh-client                                           | Status | Notes                                            |
| ------------------------- | ----------------------------------------------------- | ------ | ------------------------------------------------ |
| `send_game_action`        | `POST /api/v1/games/action` + `reticulum:gamesAction` | done   | Direct-preferred send                            |
| `get_available_games`     | `GET /api/v1/games/apps`                              | done   |                                                  |
| `get_all_game_sessions`   | `GET /api/v1/games/sessions`                          | done   | optional `?peer=`                                |
| `get_active_games`        | `GET /api/v1/games/sessions?peer=`                    | done   | peer filter                                      |
| `get_game_session_detail` | `GET /api/v1/games/sessions/:id`                      | done   |                                                  |
| `mark_game_read`          | `POST …/read`                                         | done   |                                                  |
| `delete_game_session`     | `DELETE …/:id`                                        | done   |                                                  |
| `resend_last_game_action` | `POST …/resend`                                       | done   | same envelope/nonce; overlay DB survives restart |

## UI

| Ratspeak UI                         | mesh-client                             | Status | Notes                                                                                                         |
| ----------------------------------- | --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| Games tab                           | Left-rail Games (`Gamepad2`)            | done   | Reticulum-only via `hasLrgpGames`                                                                             |
| Session list filters                | GamesPanel filters                      | done   |                                                                                                               |
| Unread badge                        | session unread + Games tab badge        | done   | sidebar red pill via `gamesUnread`                                                                            |
| TTT board                           | `TicTacToeBoard`                        | done   |                                                                                                               |
| Chess board                         | `ChessBoard`                            | done   |                                                                                                               |
| Challenge from contacts             | Peers / Chat DM Challenge               | done   |                                                                                                               |
| Draw / resign                       | session actions                         | done   |                                                                                                               |
| Delivery state / resend             | session `delivery_state` + Resend       | done   | LXMF outbound bridge; chips; Resend on `failed`                                                               |
| Notification route `lrgp:<session>` | `lrgp:` + `lxm://game/<id>` → Games tab | done   | `MeshClientDeepLinkHost` + `openReticulumGameSession`                                                         |
| Optimistic rollback UI              | client backup + restore                 | done   | TTT + Chess optimistic paint; WS/`action_result` rollback                                                     |
| Chess promotion picker              | `ChessBoard` chooser                    | done   | q/r/b/n filtered by `legal_moves`                                                                             |
| Threefold / 50-move claims          | Claim buttons → `draw_offer` `{ r }`    | done   | `3fr` / `50m` when `draw_offer_reason` set                                                                    |
| Win celebration                     | `burstConfetti` on local win            | done   | `confettiBurst.ts` canvas burst; once per `session_id`; reduce-motion aware                                   |
| Four in a Row                       | `FourInARowBoard`                       | done   | 7×6 gravity board; column click sends `{ c }`; optimistic drop + win/draw detection; winning line highlighted |

## Wire interop

| Scenario                                | Status |
| --------------------------------------- | ------ |
| mesh-client ↔ mesh-client TTT           | done   |
| mesh-client ↔ mesh-client Chess         | done   |
| mesh-client ↔ Ratspeak TTT              | done   |
| mesh-client ↔ Ratspeak Chess            | done   |
| mesh-client ↔ mesh-client Four in a Row | todo   |
| mesh-client ↔ Ratspeak Four in a Row    | todo   |

Manual gold test: two clients on a TCP hub — challenge → accept → play → resign/draw.

## Remaining follow-ups

None for the delivery / envelope / optimistic / Chess promotion+claim track. Envelope bytes live in sidecar companion `games_outbound.db` (not `lrgp-rs` `LrgpStore` schema).

Four in a Row ships with unit + axe coverage, but the two wire-interop rows above are still **unverified on a live mesh** — run the manual gold test against Ratspeak before marking them `done`. The board follows `lrgp-rs` `SPEC.md` appendix C: 42 cells row-major (`row * 7 + column`), markers `A` (challenger, first) / `B`, local outgoing payload exactly `{ c }` with the sidecar deriving `n`, landing row/cell, and terminal claims.
