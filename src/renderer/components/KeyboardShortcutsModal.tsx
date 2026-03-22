import { useEffect, useMemo, useRef } from 'react';

const DEFAULT_TAB_NAMES = [
  'Connection',
  'Chat',
  'Nodes',
  'Map',
  'Radio',
  'Modules',
  'Telemetry',
  'App',
  'Diagnostics',
];

const OTHER_SHORTCUTS = [
  { keys: 'Cmd/Ctrl + F', action: 'Toggle message search (Chat tab)' },
  { keys: 'Escape', action: 'Close search / close DM panel (Chat tab)' },
  { keys: 'Enter', action: 'Send message' },
  { keys: 'Shift + Enter', action: 'New line in message' },
  { keys: '?', action: 'Open this keyboard shortcuts help' },
  { keys: 'Cmd/Ctrl + [', action: 'Switch to Meshtastic' },
  { keys: 'Cmd/Ctrl + ]', action: 'Switch to MeshCore' },
];

interface KeyboardShortcutsModalProps {
  onClose: () => void;
  /** Current tab labels (e.g. from App). When in MeshCore mode, tab 6 is "Repeaters" instead of "Modules". */
  tabNames?: string[];
}

export default function KeyboardShortcutsModal({ onClose, tabNames }: KeyboardShortcutsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  const shortcuts = useMemo(() => {
    const names = tabNames ?? DEFAULT_TAB_NAMES;
    const tabShortcuts = names.slice(0, 9).map((name, i) => ({
      keys: `Cmd/Ctrl + ${i + 1}`,
      action: `Switch to ${name} tab`,
    }));
    return [...tabShortcuts, ...OTHER_SHORTCUTS];
  }, [tabNames]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ),
    ).filter((el) => el.offsetParent !== null || root.contains(el));
    if (focusables.length > 0) {
      focusables[0].focus();
    }
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onTab);
    return () => root.removeEventListener('keydown', onTab);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm cursor-pointer border-0 p-0"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="relative z-10 bg-deep-black border border-gray-700 rounded-xl max-w-md w-full shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 id="shortcuts-title" className="text-lg font-semibold text-gray-100">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg hover:bg-secondary-dark text-muted hover:text-gray-200 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">
          <table className="w-full text-sm">
            <caption className="sr-only">Application keyboard shortcuts</caption>
            <thead>
              <tr className="text-left text-muted text-xs uppercase tracking-wider border-b border-gray-700">
                <th scope="col" className="pb-2 font-medium">
                  Shortcut
                </th>
                <th scope="col" className="pb-2 font-medium pl-4">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {shortcuts.map(({ keys, action }) => (
                <tr key={keys}>
                  <td className="py-2 pr-4">
                    <kbd className="px-1.5 py-0.5 bg-secondary-dark border border-gray-600 rounded text-xs font-mono text-gray-300 whitespace-nowrap">
                      {keys}
                    </kbd>
                  </td>
                  <td className="py-2 pl-4 text-gray-300">{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
