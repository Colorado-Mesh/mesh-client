# Service announcements

Maintainers can show a short notice to every running mesh-client (maintenance windows, outages, "please update", feature news) by editing one JSON file on `main`: [`announcements/announcements.json`](https://github.com/charlottemeshtastic/mesh-client/blob/main/announcements/announcements.json).

Each client fetches the file from `https://raw.githubusercontent.com/charlottemeshtastic/mesh-client/main/announcements/announcements.json` 10 seconds after launch, every 6 hours, and 60 seconds after the network comes back. Notices appear in a dismissible strip at the top of the window, one at a time with a `1 of N` control. Dismissal is remembered per announcement `id`.

Anyone who can merge to `main` can put text in front of every user. Review feed PRs like a release note.

## Authoring

```json
{
  "schema": 1,
  "announcements": [
    {
      "id": "2026-10-backbone-maintenance",
      "severity": "warning",
      "title": "RNS backbone maintenance Saturday",
      "body": "The public backbone will be offline 02:00-04:00 UTC.\nLocal RF is unaffected.",
      "url": "https://github.com/charlottemeshtastic/mesh-client/discussions",
      "urlLabel": "Details",
      "startsAt": "2026-10-08T00:00:00Z",
      "expiresAt": "2026-10-12T00:00:00Z",
      "minAppVersion": "6.0.0",
      "maxAppVersion": "6.9.9",
      "localized": { "es": { "title": "Mantenimiento del backbone RNS el sábado" } }
    }
  ]
}
```

| Field                             | Rules                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`                              | Required. `^[a-z0-9][a-z0-9-]{0,63}$`, unique. Dismissal is keyed on it, so **use a new id to re-show** an edited notice. |
| `severity`                        | Required. `info` (indigo), `warning` (orange), `critical` (red, announced as an alert).                                   |
| `title` / `body`                  | Required. Plain text, at most 120 / 1000 characters. `body` keeps newlines.                                               |
| `url` / `urlLabel`                | Optional. `https:` only, no credentials; label at most 40 characters (defaults to "Learn more").                          |
| `startsAt` / `expiresAt`          | Optional ISO 8601 with `Z` or `±HH:MM` (zone-less rejected). Shown from `startsAt` until before `expiresAt`.              |
| `minAppVersion` / `maxAppVersion` | Optional `X.Y.Z`, inclusive. Filters by the running app version.                                                          |
| `localized`                       | Optional `{ "<lang>": { title?, body?, urlLabel? } }`. Falls back to the English fields per field.                        |

The feed holds at most 20 entries. Text renders as plain text only, and a link opens only if it is `https:` **and** appears in the last validated feed. Unknown fields are ignored (forward compatible); bump `schema` only for breaking changes, since older clients ignore a feed with an unknown `schema`.

## Publishing and retracting

1. Edit `announcements/announcements.json` in a PR to `main`.
2. Pre-commit runs `check:service-announcements`, which prints a prominent warning listing added, changed, and removed ids (it does not block). Malformed JSON or a wrong top-level shape blocks the commit. Pre-commit also runs `src/shared/serviceAnnouncementFeed.file.test.ts`, which fails if any row would be dropped by clients.
3. After merge, raw.githubusercontent.com may cache for about 5 minutes; clients pick it up on their next check (up to 6 hours, or on next launch).
4. To retract, remove the entry (or set `expiresAt` in the past) and merge. A failed fetch never retracts; only a successful fetch does.

## Failure behavior

Checks fail silently, like the update checker. No toast, dialog, or banner is ever shown for a failed check.

| Feed state                                                                   | Result                                    | What users see     |
| ---------------------------------------------------------------------------- | ----------------------------------------- | ------------------ |
| No internet, DNS failure, timeout                                            | `offline` (debug log)                     | Current list stays |
| `404` (file missing)                                                         | Empty list                                | Nothing            |
| Empty or whitespace-only file                                                | Empty list                                | Nothing            |
| Malformed JSON, wrong shape, unknown `schema`, over 64 KB, other HTTP errors | `error` (sanitized warn in the app log)   | Current list stays |
| Some rows invalid                                                            | Valid rows only (warn lists skipped rows) | Valid rows         |

## Implementation

| Piece                                                                       | Path                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Feed (source of truth)                                                      | `announcements/announcements.json`                                                                |
| Schema / validator (never throws)                                           | `src/shared/serviceAnnouncementFeed.ts`                                                           |
| Fetch + IPC (`serviceAnnouncements:fetch`, `serviceAnnouncements:open-url`) | `src/main/ipc/service-announcement-handlers.ts`                                                   |
| Polling, dismissal, date window                                             | `src/renderer/hooks/useServiceAnnouncements.ts`, `src/renderer/lib/serviceAnnouncementDismiss.ts` |
| UI strip (top of `<main>`, below `ConnectionBanner`)                        | `src/renderer/components/ServiceAnnouncementStrip.tsx`                                            |
| Pre-commit diff warning                                                     | `scripts/check-service-announcements.mjs`                                                         |

- Poll timing constants: `SERVICE_ANNOUNCEMENT_*` in `src/shared/timeConstants.ts`.
- Main sends `If-None-Match`, so unchanged feeds return `304` from the CDN.
- Dismissal is per `id` in localStorage (`mesh-client:serviceAnnouncementsDismissed`, newest 200).
