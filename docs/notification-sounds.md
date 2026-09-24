# Notification sounds

## Survey and decision

Surveyed against `c63bccf3` (Electron 44.1.1), September 23, 2026.

| Event                                    | Existing sound                                             | Owner                                        |
| ---------------------------------------- | ---------------------------------------------------------- | -------------------------------------------- |
| Channel message                          | 880 Hz, 150 ms pulse                                       | `chatNotifications.ts`                       |
| DM                                       | 587/784 Hz double pulse, 135 ms overall                    | Same                                         |
| Reply or mention                         | Same sound as DM                                           | Same                                         |
| MECP ROUTINE                             | Repeated rising triple pulse                               | Same, selected by `mecpAlert.ts`             |
| MECP SAFETY                              | Short–long (dit–dah) pairs × 6, piercing square (~4.4s)    | Same                                         |
| MECP URGENT                              | 853+960 Hz attention tone, 5 seconds                       | Same                                         |
| MECP MAYDAY                              | Six sweeping siren cycles, ~5.0 seconds (matches URGENT)   | Same                                         |
| RRC room messages, mentions and whispers | Reuses channel/reply/DM categories                         | `rrcInactiveNotifications.ts`                |
| Reticulum game activity                  | Reuses DM                                                  | `reticulumGamesNotifications.ts`             |
| Watched node online/offline              | OS default notification sound                              | `useNodeStatusNotifier.ts`                   |
| Update-check results                     | OS default notification sound                              | Main `notify:message` IPC                    |
| Reticulum voice call progress            | Dial, DTMF, modem handshake/carrier, ringback, busy/reject | Separate `reticulumVoiceCallTones.ts` engine |

### Default MECP tone shapes

Built-in profiles in `SOUND_PROFILES` (`chatNotifications.ts`); users can replace them under **App → Notifications**.

- **SAFETY (`mecpSafety`, `shortLong`):** one 1175 Hz square short pulse (~80 ms) then one long (~320 ms), pause (~280 ms); that pair repeats **6** times (~4.4 s — double the prior ×3 length; square + higher pitch for urgency).
- **MAYDAY (`mecpSiren`):** sawtooth sweep 800↔1200 Hz, **6** cycles at ~417 ms half-sweep each → ~5.0 s total (aligned with URGENT).
- **URGENT (`mecpEas`):** simultaneous 853 Hz + 960 Hz, 5 s.
- **ROUTINE (`mecp`):** rising triple 784/988/1175 Hz, repeated twice.

ChatPanel handles foreground chat views; App handles inactive panels/protocols and hidden windows. The existing gates determine whether a sound is appropriate. Hidden Meshtastic and MECP desktop notifications are silent so they do not duplicate Web Audio playback. The audio context is reused and resumed when suspended. MECP drills stay silent; MAYDAY/URGENT bypass notification mutes, while ROUTINE/SAFETY respect them.

There is no single documented Electron API for opening each OS's alert-tone settings picker. The platform APIs differ:

| Platform  | Native support                                                                                              | Practical limitation                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| macOS     | Electron Notification accepts a named installed/custom sound                                                | Tied to an OS notification; notification delivery requires signing. Installed alert files may be AIFF.                  |
| Windows   | Electron exposes toast XML; Windows toast audio supports system event aliases and constrained custom sounds | Toast behavior and supported paths depend on Windows packaging/notification rules. It is not a foreground sound picker. |
| Linux     | Desktop Notifications defines sound-name/file hints when the notification server supports sound             | Desktop/server support varies; Electron does not expose a general sound-hints selector.                                 |
| All three | Web Audio playback and Electron's native file chooser                                                       | Mesh Client must provide the tone-selection UI and manage its chosen files.                                             |

Sources: [Electron Notification](https://www.electronjs.org/docs/latest/api/notification), [Electron Dialog](https://www.electronjs.org/docs/latest/api/dialog), [Windows toast audio](https://learn.microsoft.com/en-us/uwp/schemas/tiles/toastschema/element-audio), [Desktop Notifications](https://specifications.freedesktop.org/notification/latest-single/).

Keep a single Web Audio owner for chat/MECP. Adding a second native sound path would risk two sounds per event and different behavior when the app is focused. This change adds flexibility there first; watched-node/update OS notifications and the voice-call state machine remain separate follow-up work.

## Controls

**App → Notifications → Notification tones** provides an independent selection for channel messages, DMs, replies/mentions, and each of the four MECP severities. DM settings also apply to game notifications and RRC whispers; RRC mentions use the reply setting.

Each row offers the original sound, four additional presets, **Choose file**, **Preview/Stop**, volume, and **Reset**. Existing users retain their original sounds until they choose another. Preview is an explicit playback action even when notifications are muted. MAYDAY and URGENT retain mute bypass and a 10% minimum volume; this cannot override a muted output device or guarantee that a custom recording is audible.

The native file chooser starts in the installed sound directory when it exists: `/System/Library/Sounds` on macOS, `%WINDIR%/Media` on Windows, `/usr/share/sounds` on Linux. Linux portal versions below 4 may ignore the starting directory. Users can navigate to any accessible audio file. This imports a copy; it neither changes OS sound settings nor tracks later sound-theme changes.

Prefer WAV, Ogg, FLAC, or MP3 for portable custom tones. The Linux chooser offers these formats; it omits AAC and M4A because decoding support varies between Linux Chromium builds. Windows and macOS still offer AAC/M4A, subject to import validation.

Imports are limited to 2 MiB and 10 seconds. Chromium decodes WAV, MP3, Ogg, FLAC, and other supported audio; the extension alone is not proof of a valid recording. macOS AIFF is converted to WAV with the OS's `afconvert` utility. Unreadable saved audio falls back to that event's original tone during incoming notifications; Preview reports failure so the selection can be repaired.

Before full Web Audio decoding, a local media element reads duration metadata with a five-second timeout. Unknown or excessive duration is rejected, and the probe releases its media source and blob URL on every exit. This prevents a small compressed recording from allocating a long PCM buffer before the duration check. The decoded duration is checked again. See the [HTML media preload specification](https://html.spec.whatwg.org/multipage/media.html#attr-media-preload) and [Web Audio decoding specification](https://webaudio.github.io/web-audio-api/#dom-baseaudiocontext-decodeaudiodata).

Failed incoming sound loads retry after one minute; successful loads stay cached. Explicit Preview retries and re-imports can recover immediately.

Preferences live in SQLite with a local startup cache. Audio is stored in bounded per-event records under the profile's `notification-sounds` directory. Import uses atomic replacement and retains the previously selected recording until its replacement preference is saved. A cancelled chooser, failed validation, or failed settings write must leave the prior selection usable.

## Verification plan

- Preserve normal mute, per-view mute, background, history, drill and MECP dedupe behavior.
- Exercise all three platform file-dialog branches; verify macOS AIFF conversion and cleanup.
- Test invalid/oversized files, missing audio, failed writes, rapid previews, unmount, and startup hydration races.
- Test component keyboard labels and accessibility; check the existing layout in a real Electron window.
- Exercise import, selection, preview, source removal and restart in an isolated Electron profile. Never connect radios or alter the installed app/profile during automated tests.
- Run full repository PR checks and normal commit hooks before publishing a change.
