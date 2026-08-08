# Agent reference: Connection panel helpers

Deep subsystem reference for AI assistants. Open this when a task touches ConnectionPanel error humanization, last-connection rehydrate, storage migrations, or MeshCore chat-channel filtering. Hard rules live in [`AGENTS.md`](../../AGENTS.md).

- **Error humanization:** `connectionPanelErrorHumanize.ts` — serial/HTTP/BLE user-facing hints (i18n); uses `electronAPI.getPlatform()`.
- **Last connection / reconnect rehydrate:** `lastConnectionStorage.ts` — `mesh-client:lastConnection:<protocol>` and BLE fallback keys; rebuild RF params after wake or Noble disconnect.
- **Storage migrations:** `connectionPanelStorageMigrations.ts` — idempotent localStorage fixes on ConnectionPanel mount and from `main.tsx` before React mount (MeshCore MQTT preset reconcile, Colorado port 443 migration, Colorado region-ack auto-launch gate, and IATA topic-prefix normalization).
- **MeshCore chat channel filter:** `meshcoreConfiguredChatChannels.ts` — zero-PSK slots excluded from unread badges and chat channel pills.
