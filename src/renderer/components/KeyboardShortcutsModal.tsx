import { useEffect } from "react";

const SHORTCUTS = [
  { keys: "Cmd/Ctrl + 1", action: "Switch to Connection tab" },
  { keys: "Cmd/Ctrl + 2", action: "Switch to Chat tab" },
  { keys: "Cmd/Ctrl + 3", action: "Switch to Nodes tab" },
  { keys: "Cmd/Ctrl + 4", action: "Switch to Map tab" },
  { keys: "Cmd/Ctrl + 5", action: "Switch to Telemetry tab" },
  { keys: "Cmd/Ctrl + 6", action: "Switch to Radio tab" },
  { keys: "Cmd/Ctrl + 7", action: "Switch to App tab" },
  { keys: "Cmd/Ctrl + 8", action: "Switch to Diagnostics tab" },
  { keys: "Cmd/Ctrl + F", action: "Toggle message search (Chat tab)" },
  { keys: "Escape", action: "Close search / close DM panel (Chat tab)" },
  { keys: "Enter", action: "Send message" },
  { keys: "Shift + Enter", action: "New line in message" },
  { keys: "?", action: "Open this keyboard shortcuts help" },
];

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

export default function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="bg-deep-black border border-gray-700 rounded-xl max-w-md w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
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
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">
          <table className="w-full text-sm">
            <caption className="sr-only">Application keyboard shortcuts</caption>
            <thead>
              <tr className="text-left text-muted text-xs uppercase tracking-wider border-b border-gray-700">
                <th scope="col" className="pb-2 font-medium">Shortcut</th>
                <th scope="col" className="pb-2 font-medium pl-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {SHORTCUTS.map(({ keys, action }) => (
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
