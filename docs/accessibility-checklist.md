# Accessibility Manual Testing Checklist

This is a living document. Check items against VoiceOver (macOS), NVDA (Windows), and Orca (Linux).

---

## Keyboard Navigation

- [ ] Tab through every interactive element in order (no skips, no traps outside modals)
- [ ] Shift+Tab reverses correctly
- [ ] **Meshtastic:** `Cmd/Ctrl+1`–`9` select visible indices **0–8** (Connection through **TAK**). **App**, **Diagnostics**, **Stats**, and **Packet Sniffer** use `Cmd/Ctrl+0`, `A`, `M`, and `S` (by tab name). Confirm the overlay (`?`) matches the tab strip.
- [ ] **MeshCore:** **11** visible tabs (**Security** / **TAK** hidden). `Cmd/Ctrl+1`–`9` cover only the **first nine** visible tabs; the rest use `Cmd/Ctrl+0` / `A` / `M` / `S` by name. Verify numbered keys follow the **visible** strip, not Meshtastic-only labels.
- [ ] `?` button opens Keyboard Shortcuts modal; Escape closes it; focus returns to `?` button
- [ ] Keyboard shortcuts modal table is readable by screen reader in correct order
- [ ] Modals: Tab cycles only within modal; Escape closes
- [ ] Dropdown menus: arrow keys navigate options
- [ ] Chat inline actions (reply/react/DM) reachable without mouse (focus-within visible)
- [ ] Cmd/Ctrl+Shift+F opens message search; Escape closes it
- [ ] Sortable table columns activatable with Enter/Space
- [ ] Slider (hop limit) adjustable with arrow keys
- [ ] Focus indicator visible at all times (no invisible focus)

---

## Screen Reader Compatibility

- [ ] App title announced on launch
- [ ] Tab labels (Chat, Nodes, Config…) read correctly
- [ ] Connection status changes announced (`aria-live="polite"`)
- [ ] Modal open/close announced as "dialog"
- [ ] Confirmation dialogs announced as "alert dialog"
- [ ] Form validation errors announced immediately (`role="alert"`)
- [ ] Message send status (Sending/Sent/Failed) announced
- [ ] Node list sort order announced via `aria-sort`
- [ ] Unread message counts announced on channel tabs
- [ ] Favorite toggle state announced (pressed/not pressed)
- [ ] Toast/notification messages announced

---

## Visual / Perceivable (WCAG 1.x)

- [ ] All text passes 4.5:1 contrast ratio (use Colour Contrast Analyser)
- [ ] Icon-only UI elements pass 3:1 against adjacent colors
- [ ] Status dots have text alternative (not color-only)
- [ ] Charts (Recharts) have accessible text summary or table toggle
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
- [ ] **Reduced motion**: Verify `@media (prefers-reduced-motion: reduce)` CSS suppresses animations (connection status pulse, halo rings, emoji picker fade).

---

## Test Environment Notes

- **macOS VoiceOver**: `Cmd+F5` to toggle; navigate with `Ctrl+Opt+arrow`
- **Windows NVDA**: Free download from nvaccess.org; use with Chrome/Edge
- **Linux Orca**: Built-in on GNOME; `Super+Alt+S` to toggle
- **Colour Contrast Analyser**: Free tool from TPGi; test actual rendered colors, not design specs
- **axe DevTools** (browser extension): Supplements automated vitest-axe tests with interactive inspection
