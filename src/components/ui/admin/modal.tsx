"use client";

import { useEffect, ReactNode } from "react";
import {
  X,
  XCircle,
  AlertTriangle,
  Info,
  CheckCircle,
  Loader2,
} from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  closeOnOverlay?: boolean;
  showClose?: boolean;
  className?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = "md",
  closeOnOverlay = true,
  showClose = true,
  className = "",
}: ModalProps) {
  const sizes = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
    full: "max-w-[95vw]",
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4 admin-animate-fade-in"
      onClick={closeOnOverlay ? onClose : undefined}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className={`relative bg-white rounded-2xl shadow-2xl w-full ${sizes[size]} max-h-[90vh] overflow-hidden admin-animate-scale-in ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {(title || showClose) && (
          <div className="flex items-start justify-between p-6 border-b border-gray-100">
            <div>
              {title && (
                <h2 className="text-xl font-bold text-gray-800">{title}</h2>
              )}
              {description && (
                <p className="text-sm text-gray-500 mt-1">{description}</p>
              )}
            </div>
            {showClose && (
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">{children}</div>

        {/* Footer */}
        {/* Footer can be added via children or a specific footer prop */}
      </div>
    </div>
  );
}

// Modal Footer
interface ModalFooterProps {
  children: ReactNode;
  className?: string;
}

export function ModalFooter({ children, className = "" }: ModalFooterProps) {
  return (
    <div
      className={`flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50 ${className}`}
    >
      {children}
    </div>
  );
}

// Confirm Dialog
interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info" | "success";
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  icon?: ReactNode;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  variant = "danger",
  onConfirm,
  onCancel,
  loading = false,
  icon,
}: ConfirmDialogProps) {
  const config = {
    danger: {
      iconBg: "bg-red-100",
      iconColor: "text-red-600",
      btnClass: "admin-btn-danger",
      defaultIcon: <XCircle className="w-6 h-6" />,
    },
    warning: {
      iconBg: "bg-amber-100",
      iconColor: "text-amber-600",
      btnClass: "admin-btn-warning",
      defaultIcon: <AlertTriangle className="w-6 h-6" />,
    },
    info: {
      iconBg: "bg-blue-100",
      iconColor: "text-blue-600",
      btnClass: "admin-btn-primary",
      defaultIcon: <Info className="w-6 h-6" />,
    },
    success: {
      iconBg: "bg-primary-100",
      iconColor: "text-primary-600",
      btnClass: "admin-btn-success",
      defaultIcon: <CheckCircle className="w-6 h-6" />,
    },
  };

  const { iconBg, iconColor, btnClass, defaultIcon } = config[variant];

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onCancel} size="sm" closeOnOverlay>
      <div className="text-center">
        <div
          className={`w-16 h-16 mx-auto rounded-full ${iconBg} flex items-center justify-center mb-4 ${iconColor}`}
        >
          {icon || defaultIcon}
        </div>
        <h3 className="text-lg font-bold text-gray-800 mb-2">{title}</h3>
        <p className="text-sm text-gray-500 mb-6">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={onCancel}
            className="admin-btn admin-btn-outline"
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`admin-btn ${btnClass}`}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>جاري...</span>
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
