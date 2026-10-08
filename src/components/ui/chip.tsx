import type { ReactNode } from "react";

interface ChipProps {
  /** Chip label */
  label: string;
  /** Is chip selected */
  selected?: boolean;
  /** Chip variant */
  variant?: "default" | "outlined";
  /** Optional icon before label */
  icon?: ReactNode;
  /** Optional onClick handler */
  onClick?: () => void;
  /** Is chip disabled */
  disabled?: boolean;
  /** Optional size (sm, md) */
  size?: "sm" | "md";
  /** Additional wrapper classes */
  className?: string;
}

/**
 * Chip component for categorized selections (filters, tags, etc.).
 *
 * Features:
 * - Selected/unselected states
 * - Icon support
 * - Variants: default (filled) and outlined
 * - RTL-safe with gap
 * - Accessible keyboard support
 *
 * Usage:
 *   <Chip label="الكل" selected={true} onClick={handleClick} />
 *   <Chip label="الأحدث" icon={<NewIcon />} />
 *   <Chip label="نشط" variant="outlined" disabled={false} />
 */
export function Chip({
  label,
  selected = false,
  variant = "default",
  icon,
  onClick,
  disabled = false,
  size = "md",
  className = "",
}: ChipProps) {
  const sizeClass = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";

  const baseClass = `inline-flex items-center gap-1.5 rounded-full font-medium transition-all ${sizeClass}`;

  let colorClass = "";
  if (variant === "default") {
    colorClass = selected
      ? "bg-primary text-white hover:bg-primary-dark"
      : "bg-gray-100 text-gray-700 hover:bg-gray-200";
  } else {
    colorClass = selected
      ? "border-2 border-primary bg-primary/5 text-primary"
      : "border border-gray-200 bg-white text-gray-700 hover:border-gray-300";
  }

  const disabledClass = disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${baseClass} ${colorClass} ${disabledClass} ${className}`}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      <span>{label}</span>
    </button>
  );
}
