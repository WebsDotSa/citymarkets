"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { X, CheckCircle, AlertCircle, Info } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
    
    // Auto dismiss after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const getIcon = (type: ToastType) => {
    switch (type) {
      case "success":
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case "error":
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case "warning":
        return <AlertCircle className="w-5 h-5 text-amber-500" />;
      default:
        return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  const getBorderClass = (type: ToastType) => {
    switch (type) {
      case "success":
        return "border-e-4 border-e-green-500";
      case "error":
        return "border-e-4 border-e-red-500";
      case "warning":
        return "border-e-4 border-e-amber-500";
      default:
        return "border-e-4 border-e-blue-500";
    }
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-container" role="alert" aria-live="polite">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast mb-3 flex items-center gap-3 ${getBorderClass(toast.type)}`}
            >
              {getIcon(toast.type)}
              <p className="flex-1 text-sm text-gray-800">{toast.message}</p>
              <button
                onClick={() => dismissToast(toast.id)}
                className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

/**
 * Promise-based confirm dialog. Replaces `window.confirm()` in admin
 * pages so destructive actions get a styled modal instead of the
 * browser's native dialog (which is blocked in some embedded webviews).
 *
 *   const ask = useConfirm();
 *   if (!await ask({ title: "...", message: "...", danger: true })) return;
 */
type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [resolver, setResolver] = useState<((v: boolean) => void) | null>(null);

  const ask = useCallback((o: ConfirmOptions): Promise<boolean> => {
    setOpts(o);
    return new Promise<boolean>((resolve) => setResolver(() => resolve));
  }, []);

  const close = (value: boolean) => {
    resolver?.(value);
    setResolver(null);
    setOpts(null);
  };

  const dialog = opts ? (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-xl">
        {opts.title && (
          <h3 className="font-bold text-lg text-gray-900 mb-2">{opts.title}</h3>
        )}
        <p className="text-gray-600 text-sm mb-4">{opts.message}</p>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => close(false)}
            className="px-4 py-2 rounded-xl text-gray-700 bg-gray-100 hover:bg-gray-200 font-medium"
          >
            {opts.cancelLabel ?? "إلغاء"}
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            className={`px-4 py-2 rounded-xl text-white font-medium ${
              opts.danger ? "bg-red-600 hover:bg-red-700" : "bg-primary-600 hover:bg-primary-700"
            }`}
          >
            {opts.confirmLabel ?? "تأكيد"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return Object.assign(ask, { dialog });
}
