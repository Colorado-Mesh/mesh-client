# Accessibility Manual Testing Checklist

This is a living document. Check items against VoiceOver (macOS), NVDA (Windows), and Orca (Linux).

---

## Screen Reader Compatibility

- [ ] App title announced on launch
- [ ] Tab labels (Chat, Nodes, Config…) read correctly
- [x] Connection status changes announced (`aria-live="polite"`) — device status in `App.tsx` header (`role="status" aria-live="polite"`); MQTT/TAK indicators still optional follow-up
- [ ] Modal open/close announced as "dialog"
- [x] Confirmation dialogs announced as "alert dialog" — `ConfirmModal` uses `role="alertdialog"` + `aria-describedby`
- [ ] Form validation errors announced immediately (`role="alert"`)
- [ ] Message send status (Sending/Sent/Failed) announced
- [ ] Node list sort order announced via `aria-sort`
- [x] Unread message counts announced on channel tabs — protocol switcher button `aria-label` includes unread count (`ProtocolSwitcher` / `aria.switchTo*WithUnread`); channel-tab unread announcement still open
- [ ] Favorite toggle state announced (pressed/not pressed)
- [ ] Toast/notification messages announced

---

## Visual / Perceivable (WCAG 1.x)

- [ ] All text passes 4.5:1 contrast ratio (use Colour Contrast Analyser)
- [ ] Icon-only UI elements pass 3:1 against adjacent colors
- [ ] Status dots have text alternative (not color-only)
- [x] Charts (Recharts) have accessible text summary or table toggle — `TelemetryPanel` charts use `role="img"` + summarized `aria-label` (table toggle still optional)
- [ ] No content lost when system font size set to 200%
- [ ] No content lost in portrait vs landscape (window resize to 320px wide)
- [ ] Decorative elements (dividers, spacers) marked `aria-hidden="true"`

---

## Electron-Specific Considerations

- [ ] **Native menus**: macOS menu bar (File/Edit/View) must be VoiceOver-navigable; test with macOS Accessibility Inspector, not just browser axe. Electron's Menu API uses native macOS accessibility APIs that browser tools cannot reach.
- [ ] **System dialogs**: File picker, Bluetooth permission dialogs are OS-native; ensure trigger buttons have descriptive labels so screen readers can explain what will open.
- [ ] **Tray icon**: macOS menu bar tray icon must have a `toolTip` set in the Tray constructor. Verify with VoiceOver cursor on menu bar.
- [ ] **Window focus**: When the app regains focus (e.g., after a system dialog), verify focus returns to the last focused element.
- [ ] **Font scaling**: Electron respects OS-level font scaling via `webPreferences.zoomFactor`. Test by setting macOS accessibility display font size to Large and relaunching.
- [ ] **High contrast mode**: On Windows, test with High Contrast Black/White themes. Tailwind CSS `@media (forced-colors: active)` should not override system colors.
- [ ] **Reduce motion (in-app setting)**: **App → Appearance → Reduce motion** (`reduceMotion` in SQLite `app_settings` and `mesh-client:appSettings` localStorage; default **off**). The app does **not** auto-follow the OS `prefers-reduced-motion` media query for UI motion; users opt in via this toggle (WCAG [2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions) / [G223](https://www.w3.org/WAI/WCAG22/Techniques/general/G223)).
  - [ ] **Setting off (default)**: Animated icons respond on hover; loading spinners animate on mount.
  - [ ] **Setting on**: Non-essential motion disabled — animated Lucide icons render static (no hover draw); decorative motion suppressed via `html[data-reduce-motion="true"]` (logo watermark keyframes, map anomaly pulse).
  - [ ] **Setting on — still allowed (essential feedback)**: Loading spinners (`animate-spin`, `Loader`), connection header status pulses (`animate-pulse` on MQTT/device labels and status dots).
  - [ ] Toggle persists across restart (SQLite + localStorage reconcile on mount, same pattern as `locale` / `chatCompactMode`).
  - [x] Optional first-run: if `reduceMotion` key is absent, initializer may default from `matchMedia('(prefers-reduced-motion: reduce)')` once; thereafter only the App toggle applies (not live-synced to OS changes). Implemented by `initReduceMotionDefaultIfAbsent()` in `reduceMotionPreference.ts` (called from `main.tsx` before React mount).
- [ ] **24-hour time (in-app setting)**: **App → Appearance → Use 24-hour time** (`use24HourTime` via `timeFormatStore` / `formatDisplayTime`; SQLite + localStorage, same bundle as Reduce motion). When on, chat and other display clocks force 24-hour format; when off, follow the system locale.

---

## Test Environment Notes

- **macOS VoiceOver**: `Cmd+F5` to toggle; navigate with `Ctrl+Opt+arrow`
- **Windows NVDA**: Free download from nvaccess.org; use with Chrome/Edge
- **Linux Orca**: Built-in on GNOME; `Super+Alt+S` to toggle
- **Colour Contrast Analyser**: Free tool from TPGi; test actual rendered colors, not design specs
- **axe DevTools** (browser extension): Supplements automated vitest-axe tests with interactive inspection
