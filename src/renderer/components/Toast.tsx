import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
}

interface ToastContextValue {
  addToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  addToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(0);

  const addToast = useCallback(
    (message: string, type: ToastType = "info", duration = 4000) => {
      const id = nextIdRef.current++;
      setToasts((prev) => [...prev, { id, message, type, duration }]);
    },
    []
  );

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {/* Toast container — fixed bottom-right */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    // Slide in
    requestAnimationFrame(() => setVisible(true));
    // Auto-dismiss
    timerRef.current = setTimeout(() => {
      setVisible(false);
      dismissTimerRef.current = setTimeout(() => onDismiss(toast.id), 300);
    }, toast.duration);
    return () => {
      clearTimeout(timerRef.current);
      clearTimeout(dismissTimerRef.current);
    };
  }, [toast, onDismiss]);

  const icon = {
    success: "✓",
    error: "✗",
    warning: "⚠",
    info: "ℹ",
  }[toast.type];

  const colors = {
    success: "bg-brand-green/15 border-brand-green text-bright-green",
    error: "bg-red-900/90 border-red-600 text-red-200",
    warning: "bg-yellow-900/90 border-yellow-600 text-yellow-200",
    info: "bg-deep-black/90 border-gray-600 text-gray-200",
  }[toast.type];

  return (
    <div
      className={`pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-lg border shadow-lg backdrop-blur-sm text-sm transition-all duration-300 ${colors} ${
        visible ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"
      }`}
    >
      <span className="text-base shrink-0">{icon}</span>
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={() => {
          clearTimeout(timerRef.current);
          setVisible(false);
          dismissTimerRef.current = setTimeout(() => onDismiss(toast.id), 300);
        }}
        className="text-muted hover:text-gray-200 ml-2 shrink-0"
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}
