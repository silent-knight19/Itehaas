"use client";
import React, { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-sm border px-3 py-2 text-xs shadow-lg transition-all ${
              t.type === "success"
                ? "border-success-border bg-surface text-fg"
                : t.type === "error"
                ? "border-danger-border bg-surface text-danger"
                : "border-border bg-surface text-fg-secondary"
            }`}
          >
            {t.type === "success" && <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />}
            {t.type === "error" && <AlertCircle className="h-3.5 w-3.5 text-danger shrink-0" />}
            {t.type === "info" && <Info className="h-3.5 w-3.5 text-accent shrink-0" />}
            <span className="font-mono text-[11px]">{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              className="ml-2 text-fg-muted hover:text-fg-primary"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
