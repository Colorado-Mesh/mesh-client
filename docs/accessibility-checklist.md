# Accessibility Manual Testing Checklist

This is a living document. Check items against VoiceOver (macOS), NVDA (Windows), and Orca (Linux).

**Last reviewed:** 2026-11-19. `[x]` means verified in code (or by an automated test named inline). `[ ]` means it still needs a human pass with VoiceOver / NVDA / Orca, a physical contrast measurement, or an OS-level setting change. Toast live roles and outbound failed/blocked announcements were fixed in this pass (`Toast.test.tsx`, `ChatPanel.outboxAnnounce.test.tsx`).

---

## Screen Reader Compatibility

- [ ] App title announced on launch
- [ ] Tab labels (Connection, Chat, Nodes, Radio, …) read correctly
- [x] Connection status changes announced (`aria-live="polite"`) — device status in `App.tsx` header (`role="status" aria-live="polite"`); MQTT/TAK indicators still optional follow-up
- [x] Modal open/close announced as "dialog" — shared dialogs use `role="dialog"` / `aria-modal` (e.g. `KeyVerificationDialog`, `ConfirmModal` as `alertdialog`, `ReticulumPeerDetailModal`, `UnifiedInboxDialog`)
- [x] Confirmation dialogs announced as "alert dialog" — `ConfirmModal` uses `role="alertdialog"` + `aria-describedby`
- [x] Form validation errors announced immediately (`role="alert"`) — e.g. `ReticulumInterfaceFieldSet`, `ChatComposer`, `ScheduledSendDialog`
- [x] Message send status (Failed/Blocked) announced — `OutboxBubble` calls `announce()` once on `failed` / `blocked` (`ChatPanel.outboxAnnounce.test.tsx`). Queued/Sending remain visual-only.
- [x] Incoming messages in the open conversation announced — `ChatPanel` writes "New message from …" to the polite `#app-announcer-polite` region via `lib/a11yAnnouncer.ts` (at most once per second; bursts collapse to "N new messages"). The message list is virtualized, so it does not rely on `role="log"`. Verify with each screen reader.
- [x] Node list sort order announced via `aria-sort` — `NodeListPanel`, `RepeatersPanel`, `ReticulumPeerListPanel`
- [x] Unread message counts announced on channel tabs — protocol switcher button `aria-label` includes unread count (`ProtocolSwitcher` / `aria.switchTo*WithUnread`); channel-tab unread announcement still open
- [x] Favorite toggle state announced (pressed/not pressed) — `aria-pressed` on `NodeListPanel` / `NodeDetailModal`
- [x] Toast/notification messages announced — per-toast `role="status"` (success/warning/info) or `role="alert"` (error/emergency) + `aria-atomic` (`Toast.test.tsx`)

---

## Visual / Perceivable (WCAG 1.x)

- [ ] All text passes 4.5:1 contrast ratio (use Colour Contrast Analyser)
- [ ] **Message action colors** (App → Appearance → Colors): with custom **message action** bar/button colors and **Show background** enabled, verify action icons/labels still meet **4.5:1** against the bar fill (and against chat bubble backgrounds when the bar is transparent)
- [ ] Icon-only UI elements pass 3:1 against adjacent colors
- [ ] Status dots have text alternative (not color-only)
- [x] Charts (Recharts) have accessible text summary or table toggle — `TelemetryPanel` charts use `role="img"` + summarized `aria-label` (table toggle still optional)
- [ ] No content lost when system font size set to 200%
- [x] No content lost in portrait vs landscape (window resize to 320px wide) — automated proxy `e2e/phone-layout.spec.ts`; manual visual check still advised
- [ ] Decorative elements (dividers, spacers) marked `aria-hidden="true"`

---

## Electron-Specific Considerations

- [ ] **Native menus**: macOS menu bar (File/Edit/View) must be VoiceOver-navigable; test with macOS Accessibility Inspector, not just browser axe. Electron's Menu API uses native macOS accessibility APIs that browser tools cannot reach.
- [ ] **System dialogs**: File picker, Bluetooth permission dialogs are OS-native; ensure trigger buttons have descriptive labels so screen readers can explain what will open.
- [x] **Tray icon**: macOS menu bar tray icon must have a `toolTip` set in the Tray constructor — `src/main/index.ts` calls `tray.setToolTip`. Verify with VoiceOver cursor on menu bar.
- [ ] **Window focus**: When the app regains focus (e.g., after a system dialog), verify focus returns to the last focused element.
- [ ] **Font scaling**: Electron respects OS-level font scaling via `webPreferences.zoomFactor`. Test by setting macOS accessibility display font size to Large and relaunching.
- [ ] **High contrast mode**: On Windows, test with High Contrast Black/White themes. Tailwind CSS `@media (forced-colors: active)` should not override system colors.
- [x] **Reduce motion (in-app setting)**: **App → Appearance → Reduce motion** (`reduceMotion` in SQLite `app_settings` and `mesh-client:appSettings` localStorage; default **off**). Implemented via `reduceMotionPreference.ts` / `main.tsx`. Human verification of hover/spinner behaviour still advised:
  - [ ] **Setting off (default)**: Animated icons respond on hover; loading spinners animate on mount.
  - [ ] **Setting on**: Non-essential motion disabled — animated Lucide icons render static (no hover draw); decorative motion suppressed via `html[data-reduce-motion="true"]` (logo watermark keyframes, map anomaly pulse).
  - [ ] **Setting on — still allowed (essential feedback)**: Loading spinners (`animate-spin`, `Loader`), connection header status pulses (`animate-pulse` on MQTT/device labels and status dots).
  - [ ] Toggle persists across restart (SQLite + localStorage reconcile on mount, same pattern as `locale` / `chatCompactMode`).
  - [x] Optional first-run: if `reduceMotion` key is absent, initializer may default from `matchMedia('(prefers-reduced-motion: reduce)')` once; thereafter only the App toggle applies (not live-synced to OS changes). Implemented by `initReduceMotionDefaultIfAbsent()` in `reduceMotionPreference.ts` (called from `main.tsx` before React mount).
- [x] **24-hour time (in-app setting)**: **App → Appearance → Use 24-hour time** (`use24HourTime` via `timeFormatStore` / `formatDisplayTime`; SQLite + localStorage). Covered by `rendererPreferences.test.ts`; human check of chat clocks still advised.

---

## Test Environment Notes

- **macOS VoiceOver**: `Cmd+F5` to toggle; navigate with `Ctrl+Opt+arrow`
- **Windows NVDA**: Free download from nvaccess.org; use with Chrome/Edge
- **Linux Orca**: Built-in on GNOME; `Super+Alt+S` to toggle
- **Colour Contrast Analyser**: Free tool from TPGi; test actual rendered colors, not design specs
- **axe DevTools** (browser extension): Supplements automated vitest-axe tests with interactive inspection
