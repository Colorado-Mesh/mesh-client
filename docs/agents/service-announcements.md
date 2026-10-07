# Developer service announcements

Maintainers show short notices to every running mesh-client by editing `announcements/announcements.json` on `main`. The authoring guide (JSON fields, publishing and retracting, failure behavior) is [`../service-announcements.md`](../service-announcements.md).

## How it works

| Piece                                                                       | Path                                                                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Feed (source of truth)                                                      | `announcements/announcements.json`                                                                  |
| Fetched from                                                                | `https://raw.githubusercontent.com/Colorado-Mesh/mesh-client/main/announcements/announcements.json` |
| Schema / validator (never throws)                                           | `src/shared/serviceAnnouncementFeed.ts`                                                             |
| Fetch + IPC (`serviceAnnouncements:fetch`, `serviceAnnouncements:open-url`) | `src/main/ipc/service-announcement-handlers.ts`                                                     |
| Polling, dismissal, date window                                             | `src/renderer/hooks/useServiceAnnouncements.ts`, `src/renderer/lib/serviceAnnouncementDismiss.ts`   |
| UI strip (top of `<main>`, below `ConnectionBanner`)                        | `src/renderer/components/ServiceAnnouncementStrip.tsx`                                              |
| Pre-commit diff warning                                                     | `scripts/check-service-announcements.mjs`                                                           |

- Poll timing constants: `SERVICE_ANNOUNCEMENT_*` in `src/shared/timeConstants.ts` (10 s after launch, every 6 h, 60 s after the network returns).
- Main sends `If-None-Match`, so unchanged feeds return `304` from the CDN.
- Dismissal is per `id` in localStorage (`mesh-client:serviceAnnouncementsDismissed`, newest 200).
- Text renders as plain text only. `serviceAnnouncements:open-url` opens a link only if it is `https:` **and** appears in the last validated feed.
- Failures are silent (no toast/dialog/banner); offline is a debug log, malformed feeds a sanitized warn. A failed fetch never retracts the current list.
