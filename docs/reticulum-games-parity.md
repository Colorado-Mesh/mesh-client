# Reticulum Games — Ratspeak parity checklist

Living matrix for [issue #773](https://github.com/Colorado-Mesh/mesh-client/issues/773). Wire protocol is [lrgp-rs](https://github.com/ratspeak/lrgp-rs) (LRGP v1). Product surface reference is Ratspeak:

- `crates/ratspeak-tauri/src/commands/games.rs`
- `dashboard/static/js/games_tab.js`

Update this file when Games PRs land. `pnpm run update` warns on new Ratspeak releases with stub-kind `games-parity`.

**Last review:** 2026-08-06 (delivery_state / envelope persist / optimistic board / Chess promotion+claims).

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

| Ratspeak UI                         | mesh-client                             | Status  | Notes                                                     |
| ----------------------------------- | --------------------------------------- | ------- | --------------------------------------------------------- |
| Games tab                           | Left-rail Games (`Gamepad2`)            | done    | Reticulum-only via `hasLrgpGames`                         |
| Session list filters                | GamesPanel filters                      | done    |                                                           |
| Unread badge                        | session unread + Games tab badge        | done    | sidebar red pill via `gamesUnread`                        |
| TTT board                           | `TicTacToeBoard`                        | done    |                                                           |
| Chess board                         | `ChessBoard`                            | done    |                                                           |
| Challenge from contacts             | Peers / Chat DM Challenge               | done    |                                                           |
| Draw / resign                       | session actions                         | done    |                                                           |
| Delivery state / resend             | session `delivery_state` + Resend       | done    | LXMF outbound bridge; chips; Resend on `failed`           |
| Notification route `lrgp:<session>` | `lrgp:` + `lxm://game/<id>` → Games tab | done    | `MeshClientDeepLinkHost` + `openReticulumGameSession`     |
| Optimistic rollback UI              | client backup + restore                 | done    | TTT + Chess optimistic paint; WS/`action_result` rollback |
| Chess promotion picker              | `ChessBoard` chooser                    | done    | q/r/b/n filtered by `legal_moves`                         |
| Threefold / 50-move claims          | Claim buttons → `draw_offer` `{ r }`    | done    | `3fr` / `50m` when `draw_offer_reason` set                |
| Win celebration                     | —                                       | wontfix | optional polish; not required for interop                 |

## Wire interop

| Scenario                        | Status |
| ------------------------------- | ------ |
| mesh-client ↔ mesh-client TTT   | done   |
| mesh-client ↔ mesh-client Chess | done   |
| mesh-client ↔ Ratspeak TTT      | done   |
| mesh-client ↔ Ratspeak Chess    | done   |

Manual gold test: two clients on a TCP hub — challenge → accept → play → resign/draw.

## Remaining follow-ups

None for the delivery / envelope / optimistic / Chess promotion+claim track. Envelope bytes live in sidecar companion `games_outbound.db` (not `lrgp-rs` `LrgpStore` schema).
