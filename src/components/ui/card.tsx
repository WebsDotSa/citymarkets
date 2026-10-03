import type { ReactNode } from "react";

interface CardProps {
  /** Card content */
  children: ReactNode;
  /** Optional hover effect */
  interactive?: boolean;
  /** Padding: sm (2), md (3), lg (4) */
  padding?: "sm" | "md" | "lg";
  /** Border radius: none, sm, md, lg */
  rounded?: "none" | "sm" | "md" | "lg";
  /** Background color */
  bgColor?: string;
  /** Optional shadow elevation */
  shadow?: "sm" | "md" | "lg" | "none";
  /** Optional onClick */
  onClick?: () => void;
  /** Additional wrapper classes */
  className?: string;
}

const paddingMap = {
  sm: "p-2",
  md: "p-3",
  lg: "p-4",
};

const radiusMap = {
  none: "rounded-none",
  sm: "rounded-lg",
  md: "rounded-2xl",
  lg: "rounded-3xl",
};

const shadowMap = {
  none: "",
  sm: "shadow-sm",
  md: "shadow",
  lg: "shadow-lg",
};

/**
 * Foundational card component for consistent styling across the app.
 *
 * Features:
 * - Flexible padding and radius options
 * - Optional hover/interactive state
 * - Consistent shadows
 * - RTL-safe
 *
 * Usage:
 *   <Card padding="md" rounded="md" shadow="sm">
 *     <p>Card content</p>
 *   </Card>
 *   <Card interactive onClick={handleClick} className="cursor-pointer">
 *     <div>Clickable content</div>
 *   </Card>
 */
export function Card({
  children,
  interactive = false,
  padding = "md",
  rounded = "md",
  bgColor = "bg-white",
  shadow = "sm",
  onClick,
  className = "",
}: CardProps) {
  const interactiveClass = interactive
    ? "hover:shadow-md transition-shadow cursor-pointer"
    : "";

  return (
    <div
      className={`${bgColor} ${radiusMap[rounded]} ${shadowMap[shadow]} ${paddingMap[padding]} ${interactiveClass} ${className}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                onClick();
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}
