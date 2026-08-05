# Reticulum Games — Ratspeak parity checklist

Living matrix for [issue #773](https://github.com/Colorado-Mesh/mesh-client/issues/773). Wire protocol is [lrgp-rs](https://github.com/ratspeak/lrgp-rs) (LRGP v1). Product surface reference is Ratspeak:

- `crates/ratspeak-tauri/src/commands/games.rs`
- `dashboard/static/js/games_tab.js`

Update this file when Games PRs land. `pnpm run update` warns on new Ratspeak releases with stub-kind `games-parity`.

Status: `done` | `partial` | `wontfix` | `todo`

## Commands / API

| Ratspeak command          | mesh-client                                           | Status | Notes                 |
| ------------------------- | ----------------------------------------------------- | ------ | --------------------- |
| `send_game_action`        | `POST /api/v1/games/action` + `reticulum:gamesAction` | done   | Direct-preferred send |
| `get_available_games`     | `GET /api/v1/games/apps`                              | done   |                       |
| `get_all_game_sessions`   | `GET /api/v1/games/sessions`                          | done   | optional `?peer=`     |
| `get_active_games`        | `GET /api/v1/games/sessions?peer=`                    | done   | peer filter           |
| `get_game_session_detail` | `GET /api/v1/games/sessions/:id`                      | done   |                       |
| `mark_game_read`          | `POST …/read`                                         | done   |                       |
| `delete_game_session`     | `DELETE …/:id`                                        | done   |                       |
| `resend_last_game_action` | `POST …/resend`                                       | done   | same envelope/nonce   |

## UI

| Ratspeak UI                         | mesh-client                     | Status  | Notes                                     |
| ----------------------------------- | ------------------------------- | ------- | ----------------------------------------- |
| Games tab                           | Left-rail Games (`Gamepad2`)    | done    | Reticulum-only via `hasLrgpGames`         |
| Session list filters                | GamesPanel filters              | done    |                                           |
| Unread badge                        | session unread + tab affordance | partial | confirm badge wiring vs Chat              |
| TTT board                           | `TicTacToeBoard`                | done    |                                           |
| Chess board                         | `ChessBoard`                    | done    |                                           |
| Challenge from contacts             | Peers / Chat DM Challenge       | done    |                                           |
| Draw / resign                       | session actions                 | done    |                                           |
| Delivery state / resend             | resend IPC + UI                 | partial | match Ratspeak delivery UX                |
| Notification route `lrgp:<session>` | deep-link                       | todo    | follow MeshClientDeepLinkHost later       |
| Optimistic rollback UI              | local reject + action_result    | partial | sidecar rollback; polish UI               |
| Win celebration                     | —                               | wontfix | optional polish; not required for interop |

## Wire interop

| Scenario                        | Status |
| ------------------------------- | ------ |
| mesh-client ↔ mesh-client TTT   | done   |
| mesh-client ↔ mesh-client Chess | done   |
| mesh-client ↔ Ratspeak TTT      | done   |
| mesh-client ↔ Ratspeak Chess    | done   |

Manual gold test: two clients on a TCP hub — challenge → accept → play → resign/draw.
