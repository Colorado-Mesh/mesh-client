import { useEffect, useMemo, useRef } from 'react';

const DEFAULT_TAB_NAMES = [
  'Connection',
  'Chat',
  'Nodes',
  'Map',
  'Radio',
  'Modules',
  'Telemetry',
  'Security',
  'TAK',
  'App',
  'Diagnostics',
  'Sniffer',
];

function tabShortcutDisplayName(tabName: string): string {
  return tabName === 'Sniffer' ? 'Packet Sniffer' : tabName;
}

const OTHER_SHORTCUTS = [
  { keys: 'Cmd/Ctrl + Shift + F', action: 'Toggle message search (Chat tab)' },
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
    const currentNames = tabNames ?? DEFAULT_TAB_NAMES;
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'A', 'S'];
    const tabShortcuts = DEFAULT_TAB_NAMES.map((name, i) => {
      const currentTabIndex = currentNames.indexOf(name);
      const currentTabAtPosition = currentNames[i];
      let suffix = '';
      if (currentTabAtPosition !== name) {
        if (i === 7 && currentTabIndex === -1) {
          suffix = ' (not available in MeshCore)';
        } else if (i === 8 && currentTabIndex === -1) {
          suffix = ' (not available in MeshCore)';
        } else if (i === 5 && currentTabAtPosition === 'Repeaters') {
          suffix = ' (MeshCore: Repeaters)';
        }
      }
      return {
        keys: `Cmd/Ctrl + ${keys[i]}`,
        action: `Switch to ${tabShortcutDisplayName(name)} tab${suffix}`,
      };
    });
    return [...tabShortcuts, ...OTHER_SHORTCUTS];
  }, [tabNames]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
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
    return () => {
      root.removeEventListener('keydown', onTab);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 cursor-pointer border-0 bg-black/50 p-0 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="bg-deep-black relative z-10 w-full max-w-md rounded-xl border border-gray-700 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-gray-700 px-5 py-4">
          <h2 id="shortcuts-title" className="text-lg font-semibold text-gray-100">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="hover:bg-secondary-dark text-muted rounded-lg p-1.5 transition-colors hover:text-gray-200"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <table className="w-full text-sm">
            <caption className="sr-only">Application keyboard shortcuts</caption>
            <thead>
              <tr className="text-muted border-b border-gray-700 text-left text-xs tracking-wider uppercase">
                <th scope="col" className="pb-2 font-medium">
                  Shortcut
                </th>
                <th scope="col" className="pb-2 pl-4 font-medium">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {shortcuts.map(({ keys, action }) => (
                <tr key={keys}>
                  <td className="py-2 pr-4">
                    <kbd className="bg-secondary-dark rounded border border-gray-600 px-1.5 py-0.5 font-mono text-xs whitespace-nowrap text-gray-300">
                      {keys}
                    </kbd>
                  </td>
                  <td className="py-2 pl-4 text-gray-300">{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted mt-3 text-xs leading-relaxed">
            Cmd/Ctrl+0, A, and S switch to the App, Diagnostics, and Packet Sniffer tabs by name
            when those tabs are visible (not by fixed slot, so shortcuts stay correct when some tabs
            are hidden).
          </p>
        </div>
      </div>
    </div>
  );
}
