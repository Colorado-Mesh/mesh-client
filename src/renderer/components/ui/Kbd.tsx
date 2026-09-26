/**
 * Keyboard hint chip ("Esc", "Ctrl+K", "⌘K"). Hidden on touch-only screens (`pointer: coarse`),
 * where there is no keyboard to press it on; every shortcut also has a touch path.
 */
export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="border-secondary-dark bg-sidebar-active-bg text-label rounded-[3px] border px-1.5 py-px font-mono leading-4 text-slate-300 pointer-coarse:hidden">
      {children}
    </kbd>
  );
}
