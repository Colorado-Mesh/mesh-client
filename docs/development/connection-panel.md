# Connection panel helpers

Developer reference for ConnectionPanel error humanization, last-connection rehydrate, storage migrations, or MeshCore chat-channel filtering. Repo-wide rules live in [`AGENTS.md`](../../AGENTS.md).

- **Error humanization:** `connectionPanelErrorHumanize.ts` — serial/HTTP/BLE user-facing hints (i18n); uses `electronAPI.getPlatform()`.
- **Last connection / reconnect rehydrate:** `lastConnectionStorage.ts` — `mesh-client:lastConnection:<protocol>` and BLE fallback keys; rebuild RF params after wake or GATT disconnect.
- **Storage migrations:** `connectionPanelStorageMigrations.ts` — idempotent localStorage fixes on ConnectionPanel mount and from `main.tsx` before React mount (MeshCore MQTT preset reconcile, Colorado port 443 migration, Colorado region-ack auto-launch gate, and IATA topic-prefix normalization).
- **MeshCore chat channel filter:** `meshcoreConfiguredChatChannels.ts` — zero-PSK slots excluded from unread badges and chat channel pills.
- **Planned-reboot reconnect (MeshCore):** a companion reboot from the CLI settings sets `meshcorePlannedRebootRef`; the reconnect cycle then sets `plannedReboot` on the connection record (`connectionStore` → `useConnectionView`) and the App banner shows `connectionBanner.rebootingReconnectAttempt` instead of a connection-loss message. The first reconnect attempt waits at least `MESHCORE_PLANNED_REBOOT_RECONNECT_DELAY_MS` (8 s, `firstAttemptMinDelayMs`) for boot and BLE re-advertising; exhaustion or a manual disconnect clears the flag. See [meshcore-companion-cli.md](meshcore-companion-cli.md).
