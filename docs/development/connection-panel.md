# Connection panel helpers

Developer reference for ConnectionPanel error humanization, last-connection rehydrate, storage migrations, or MeshCore chat-channel filtering. Repo-wide rules live in [`AGENTS.md`](../../AGENTS.md).

- **Error humanization:** `connectionPanelErrorHumanize.ts` — serial/HTTP/BLE user-facing hints (i18n); uses `electronAPI.getPlatform()`.
- **Last connection / reconnect rehydrate:** `lastConnectionStorage.ts` — `mesh-client:lastConnection:<protocol>` and BLE fallback keys; rebuild RF params after wake or GATT disconnect. The single last-connection record remains the auto-connect / wake MRU.
- **Saved device history:** `connectionHistoryStorage.ts` — `mesh-client:connectionHistory:<protocol>` list (BLE / serial / HTTP / TCP / UDP). `useConnectionHistoryRecorder` (mounted once from `App`) upserts on any LoRa identity reaching `configured`, even when ConnectionPanel shows another protocol; the panel also upserts for the visible protocol so form fields stay accurate. Device → Connection shows the Saved devices list (Reconnect / Delete) while connected or disconnected; the panel reloads from storage on `configured` / `disconnected` so recorder writes are visible. Seeds from `lastConnection` when the history key is missing, or when the stored list is empty but an MRU still exists.
- **Storage migrations:** `connectionPanelStorageMigrations.ts` — idempotent localStorage fixes on ConnectionPanel mount and from `main.tsx` before React mount (MeshCore MQTT preset reconcile, Colorado port 443 migration, Colorado region-ack auto-launch gate, and IATA topic-prefix normalization).
- **MeshCore chat channel filter:** `meshcoreConfiguredChatChannels.ts` — zero-PSK slots excluded from unread badges and chat channel pills.
- **Planned-reboot reconnect (MeshCore):** a companion reboot from the CLI settings sets `meshcorePlannedRebootRef`; the reconnect cycle then sets `plannedReboot` on the connection record (`connectionStore` → `useConnectionView`) and the App banner shows `connectionBanner.rebootingReconnectAttempt` instead of a connection-loss message. The first reconnect attempt waits at least `MESHCORE_PLANNED_REBOOT_RECONNECT_DELAY_MS` (8 s, `firstAttemptMinDelayMs`) for boot and BLE re-advertising; exhaustion or a manual disconnect clears the flag. See [meshcore-companion-cli.md](meshcore-companion-cli.md).

## First-run protocol wizard (localStorage)

The welcome picker/tour is **not** SQLite-backed. Progress lives in renderer `localStorage` under `mesh-client:firstRunWizard` (`FIRST_RUN_WIZARD_STORAGE_KEY` in `firstRunWizard.ts`):

| Status    | Meaning                                                                                     |
| --------- | ------------------------------------------------------------------------------------------- |
| `unseen`  | Existing installs default here; wizard does not open until a fresh DB is detected.          |
| `pending` | Shown on a new install but not finished; opens again on the next launch until done/skipped. |
| `done`    | Finished or skipped; never shown again.                                                     |

`useFirstRunWizardLauncher` (mounted from `App.tsx`) decides when to surface the wizard. It opens when status is `pending`, or when status is `unseen` **and** `window.electronAPI.db.wasCreatedThisLaunch` is strictly `true` (fresh SQLite on this boot). IPC/read failures are intentionally **fail-open** — a broken `wasCreatedThisLaunch` call must not block startup. See `firstRunWizardStore.ts` and [renderer-storage.md](renderer-storage.md) for durable vs ephemeral storage boundaries.
