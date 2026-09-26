/** Keyboard hint chip ("Esc", "Ctrl+K", "⌘K"). */
export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="border-secondary-dark bg-sidebar-active-bg rounded-[3px] border px-1.5 py-px font-mono text-[11px] leading-4 text-slate-300">
      {children}
    </kbd>
  );
}
