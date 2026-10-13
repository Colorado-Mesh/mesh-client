# Mobile UI prototype

This draft begins Mesh Client's iOS and Android work with a phone UI shell and screenshot scenes. It retains the existing branding and focuses design review on Bluetooth radio connection and messaging. The first goal is to settle layout, navigation, copy, and accessibility before implementing mobile behavior.

Reviewer controls and shell navigation can change the displayed mock view. Connection, pairing, reconnect, and disconnect controls only navigate between static scenes. The send and retry-message controls are disabled visual placeholders. There is no real or simulated connection workflow, message queue, or message delivery. The prototype does not access hardware, invoke Electron IPC, show OS prompts, or open OS settings. Sample radios, conversations, and message statuses are static design fixtures.

## Run and build

Run these commands from the repository root after the normal [development setup](../development-environment.md):

```sh
pnpm exec vite --config vite.mobile-prototype.config.mjs
```

Open <http://127.0.0.1:5175/>. The entry is `src/renderer/mobile/index.html`; the mobile Vite root is `src/renderer/mobile`.

Build a standalone browser preview:

```sh
pnpm exec vite build --config vite.mobile-prototype.config.mjs
pnpm exec vite preview --config vite.mobile-prototype.config.mjs
```

The build output is `dist/mobile-prototype`. Use the URL printed by the preview command. This is a browser design artifact, not an installable iOS or Android app.

## Design direction

The [UI style guide](../style-guide.md) remains the source for branding: ink surfaces, bundled IBM Plex Sans and Mono, existing radius and elevation tokens, and emerald, cyan, and yellow protocol identities. Primary actions use the accent with dark text; connection status uses a semantic status color accompanied by text or an icon.

The phone layout gives each task a single pane and puts the main action within comfortable reach. Interactive targets are at least 48 CSS pixels in each dimension. Text uses rem sizes and supports 200% enlargement. At narrow widths with enlarged text, navigation reflows into two rows and radio metadata stays in the main text column. Safe-area padding protects content from screen cutouts and the home gesture area. Reduced motion removes decorative movement.

The bottom navigation keeps the familiar Chat, Network, Map, Incident, and More destinations. Chat shows conversation and message layouts. Network, Map, and Incident have disabled controls with accessible future-scope labels; they do not imply that mobile network management, maps, incident operations, or settings are implemented.

Platform and scene controls sit outside the phone interface. Selecting iOS or Android changes the review context and permission explanation. Selecting a scene previews a static state. These controls are for reviewers and do not belong in the eventual mobile app.

## Screenshot scenes

| Scene             | Design question                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Radio start       | Is the first connection action obvious, and does the preparation text explain what the user needs?             |
| Nearby radios     | Can the user distinguish radios by name, protocol, and secondary information without relying on color?         |
| Permission        | Does the explanation connect Bluetooth access to finding and connecting a radio?                               |
| Permission denied | Are the limitation and proposed recovery instruction clear?                                                    |
| Connecting        | Is progress readable, with a visible proposed cancellation action?                                             |
| Connected         | Are the named radio and link state apparent, with a clear path to chat?                                        |
| Connection failed | Is failure distinguishable from progress, with understandable proposed retry and choose-another-radio actions? |
| Conversations     | Is it easy to find a channel or conversation on a phone?                                                       |
| Chat              | Are sender, time, message text, and composer arranged for readable mobile messaging?                           |
| Send failed       | Is the failed-message treatment explicit, with understandable proposed retry action?                           |

Screenshots document the visual states. They do not demonstrate a transition between those states, permission approval, a successful radio handshake, or delivery of a message. Future-scope and prototype labels must remain visible so a scene cannot be mistaken for working mobile functionality.

Permission denial and Bluetooth off should remain distinct in the eventual workflow. Radio connection, pairing, reading radio settings, and peer reachability also need distinct states. The ready scene must not imply that a connected radio guarantees a reachable recipient.

The [existing BLE contracts](ble-serial.md#lora-ble-reconnect-parity-meshtastic--meshcore) require deliberate disconnect to remain disconnected. Preserve that contract when behavior is implemented. The current static disconnect control does not exercise it.

## Captured screens

The committed screenshots show the shell at normal text size. The iOS review context is 390 pixels wide, and the Android context is 412 pixels wide. These are browser captures; they do not show native OS chrome or dialogs.

| iOS                                                                                      | Android                                                                                  |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ![iOS radio connection screen](mobile-prototype/screenshots/ios-connect.png)             | ![Android radio selection screen](mobile-prototype/screenshots/android-radios.png)       |
| ![iOS Bluetooth permission explanation](mobile-prototype/screenshots/ios-permission.png) | ![Android sample connected radio](mobile-prototype/screenshots/android-ready.png)        |
| ![iOS sample conversation](mobile-prototype/screenshots/ios-chat.png)                    | ![Android failed-message layout](mobile-prototype/screenshots/android-message-error.png) |

## Platform requirements for later implementation

These requirements inform the scenes and future architecture. They are not implemented native capabilities in this draft.

| Area                 | iOS                                                                                                                                                       | Android                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bluetooth permission | Use Core Bluetooth authorization and a meaningful `NSBluetoothAlwaysUsageDescription`. Distinguish authorization denied or restricted from adapter state. | Android 12 and later require runtime scan/connect permissions for the relevant operations, presented as Nearby devices access. Earlier supported Android versions need a separate permission plan. |
| Pairing              | Leave system pairing to the native Bluetooth boundary; do not carry over the desktop Windows PIN workflow as an iOS form.                                 | Integrate the native pairing flow when the selected radio requires it and preserve cancel and failure outcomes.                                                                                    |
| Navigation           | Preserve familiar back and modal dismissal behavior.                                                                                                      | Support system back and predictive back. A cancelled back gesture must not commit navigation or radio changes.                                                                                     |
| Insets and text      | Respect safe areas and support Dynamic Type or an equivalent scaling path.                                                                                | Respect system bars, display cutouts, gesture insets, and system text scaling.                                                                                                                     |

Request permission when the user chooses the feature that needs it and allow a declined request to return to a usable interface. Do not repeatedly prompt after denial or treat permission approval as a successful radio connection. Returning from real settings must recheck authorization and adapter state.

For Android, `neverForLocation` is a promise about the use of Bluetooth scan results and can filter some BLE beacons. Select it only after verifying the intended radio discovery behavior and location requirements. Map or phone-location features require their own permission decisions; Bluetooth access is not a blanket location grant.

The desktop app currently connects Meshtastic and MeshCore through the Rust sidecar's GATT transport and Electron IPC. That implementation is evidence about protocol and connection contracts, not a mobile runtime. Mobile BLE ownership, supported protocols and radios, foreground/background behavior, reconnect budgets, and framework choice need a separate architecture decision and physical-device validation.

## Visual review checklist

Browser validation covered 360 combinations of scene, platform, protocol, phone width (320, 390, 430 pixels), and text size (100%, 200%). Every checked shell control was at least 48 by 48 CSS pixels, with no horizontal page overflow. All 60 rendered WCAG axe runs passed and no browser page errors were observed. The 18 component tests include four axe cases with the real-theme hydration helper. Native device checks below remain separate.

- [x] Review every scene in the iOS and Android contexts.
- [x] Verify reviewer controls and shell navigation show the intended mock views, with accessible names and a clear selected state.
- [x] Verify connection and messaging controls are recognizable visual placeholders and do not imply real or simulated transport behavior.
- [x] Confirm prototype, sample-data, and future-scope labels remain visible in the screenshots.
- [x] Review widths of 320, 390, and 430 CSS pixels at default and 200% text. No page-level horizontal overflow, clipped labels, overlapping targets, or hidden content.
- [x] Check every interactive target is at least 48 by 48 CSS pixels and that adjacent actions are easy to distinguish.
- [ ] Check safe-area padding around the header and bottom navigation. Browser screenshots do not verify native system insets or gestures.
- [ ] Check keyboard navigation, visible focus, accessible names, logical reading order, and selected navigation semantics.
- [x] Check status and failure text is understandable without color alone.
- [x] Check text and non-text contrast against the actual theme tokens; run axe with the repository's real-theme hydration helper for component coverage.
- [x] Check reduced-motion behavior and bundled assets in the preview. The built preview loaded successfully with external network requests blocked.
- [x] Build the standalone preview and complete the repository checks required by `AGENTS.md`. The full local gate passed with 15,599 tests passing and five skipped.

Native VoiceOver and TalkBack, permission and pairing prompts, hardware discovery, radio handshakes, real message delivery and acknowledgements, background behavior, and platform packaging remain unverified by this browser UI shell.

## Research sources

Primary platform documentation was checked on October 13, 2026:

- [Apple accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility): iOS defaults include 44-point controls and 17-point custom text, and guidance recommends supporting at least 200% text enlargement. The shared 48-pixel prototype target is a design choice; CSS pixels do not constitute native point or dp validation.
- [Apple safe-area layout guide](https://developer.apple.com/documentation/uikit/uiview/safearealayoutguide): content and controls must account for bars and other obscuring views.
- [Apple Bluetooth usage description](https://developer.apple.com/documentation/bundleresources/information-property-list/nsbluetoothalwaysusagedescription) and [Core Bluetooth authorization states](https://developer.apple.com/documentation/corebluetooth/cbmanagerauthorization): explain access and handle authorization states explicitly.
- [Android accessibility guidance](https://developer.android.com/guide/topics/ui/accessibility/apps): recommends targets of at least 48 by 48 dp, meaningful control descriptions, and sufficient contrast.
- [Android Bluetooth permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions): defines version-specific scan/connect permissions and the limitations of `neverForLocation`.
- [Android runtime permission workflow](https://developer.android.com/training/permissions/requesting): request access in context, permit cancellation, and handle denial gracefully.
- [Android system bars](https://developer.android.com/design/ui/mobile/guides/foundations/system-bars) and [predictive back design](https://developer.android.com/design/ui/mobile/guides/patterns/predictive-back): preserve system navigation and keep interactive content clear of gesture areas.

## Decisions after design review

Agree on the first supported protocols and radios, minimum OS versions, behavior while the phone is locked or the app is backgrounded, and whether one or multiple radio links are needed. Then choose the native framework and transport boundary, implement connection and messaging workflows, plan persistence, and define a physical iOS/Android test matrix. Signing, store distribution, notifications, and the remaining product areas belong to that later scope.
